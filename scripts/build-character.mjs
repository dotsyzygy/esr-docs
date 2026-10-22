#!/usr/bin/env node
// Generates site/data/character.<lang>.js: the game data the Character page needs to read a
// character save (.d2s) in the browser and show it. That is the stats' save widths and
// wording, item bases, unique/set/runeword/affix names and each class's skills.
//
// Usage:
//   node scripts/build-character.mjs [--esr=<path>] [--out=site] [--report=character-report.md] [--strict] [--lang=enUS] [--save=<a.d2s>[,<b.d2s>…]]
//
// --esr points at a checkout of the Eastern_Sun_Resurrected repo (also settable with the
// ESR_REPO environment variable). It defaults to ../Eastern_Sun_Resurrected next to this repo.
//
// Saves are read by site/assets/d2s.js and worded by site/assets/item-text.js, the same code
// the page runs. --save test-parses saves (default: every *.d2s in the repo root, which are
// gitignored) and the report lists what couldn't be read or named; with --strict a save that
// doesn't parse fails the build. No dependencies; requires Node 18+.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, gamePaths, requireTable, readText, tsvReader, loadStrings, loadStringIds,
  CLASS_NAMES, reportTable, bump,
} from './lib/game-data.mjs';
import { createCubeResolver } from './lib/cube-resolve.mjs';
import { skillRecord, missileRecord, formulas } from './lib/skill-records.mjs';
import { createPropertyResolver } from './lib/property-stats.mjs';

const args = parseArgs();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PATHS = gamePaths(args, ROOT);
const LANG = args.lang || 'enUS';
const OUT_FILE = path.join(path.resolve(ROOT, args.out || 'site'), 'data', `character.${LANG}.js`);
const require = createRequire(import.meta.url);
const D2S = require(path.join(ROOT, 'site', 'assets', 'd2s.js'));
const ItemText = require(path.join(ROOT, 'site', 'assets', 'item-text.js'));
const SkillCalc = require(path.join(ROOT, 'site', 'assets', 'skill-calc.js'));
const CharCalc = require(path.join(ROOT, 'site', 'assets', 'char-calc.js'));

requireTable(PATHS, 'itemstatcost.txt');

const readTsv = tsvReader(PATHS.excel);
const cubeRules = JSON.parse(readText(path.join(HERE, 'cube-rules.json')));
const str = loadStrings(PATHS.strings, LANG, ['item-modifiers.json', 'item-names.json', 'item-runes.json', 'item-nameaffixes.json', 'skills.json']);

const report = {
  unresolvedTokens: new Map(),
  unresolvedProps: new Map(),
  missingStrings: new Map(),
  missingStats: new Map(),
  saves: [],
  saveErrors: new Map(),
  skippedStats: new Map(),
  unnamed: new Map(),
  effectWarnings: new Map(),
  unresolvedBonuses: new Map(),
  missingEffects: new Map(),
};
// Item names match the Cube Recipes page (cube-rules.json itemNames).
const R = createCubeResolver({ readTsv, str, rules: cubeRules, report });

const num = v => (v === '' || v == null ? 0 : +v || 0);
const text = key => {
  if (!key) return undefined;
  const t = str(key, { dropHidden: true });
  if (t == null) bump(report.missingStrings, key, 'string key');
  return t ?? undefined;
};

// ---------------------------------------------------------------------------
// Stats: how each is saved (Save Bits on items, CSvBits for the character) and worded
// ---------------------------------------------------------------------------

const stats = {};
const statId = new Map();
for (const r of readTsv('itemstatcost.txt')) {
  if (r['*ID'] === '') continue;
  const s = { n: r.Stat };
  const set = (k, v) => { if (v !== '' && v != null && v !== 0) s[k] = v; };
  set('sb', num(r['Save Bits']));
  set('sa', num(r['Save Add']));
  set('pb', num(r['Save Param Bits']));
  set('cb', num(r.CSvBits));
  set('cs', num(r.CSvSigned));
  set('cp', num(r.CSvParam));
  set('fn', num(r.descfunc));
  if (r.descval !== '') s.dv = num(r.descval);
  set('p', text(r.descstrpos));
  set('g', text(r.descstrneg));
  set('s2', text(r.descstr2));
  set('pr', num(r.descpriority));
  set('op', num(r.op));
  set('opp', num(r['op param']));
  set('ob', r['op base']);
  stats[r['*ID']] = s;
  statId.set(r.Stat, +r['*ID']);
}
const idOf = name => {
  if (!statId.has(name)) { bump(report.missingStats, name, 'itemstatcost.txt'); return undefined; }
  return statId.get(name);
};

// The stats the item layout itself uses, and the stats saved as a group (no ids after the first).
const statIds = {
  armor: idOf('armorclass'), dur: idOf('durability'), maxDur: idOf('maxdurability'),
  sockets: idOf('item_numsockets'), questDiff: statId.get('questitemdifficulty'),
};
const paired = {};
for (const [first, ...rest] of [
  ['item_maxdamage_percent', 'item_mindamage_percent'], ['firemindam', 'firemaxdam'], ['lightmindam', 'lightmaxdam'],
  ['magicmindam', 'magicmaxdam'], ['coldmindam', 'coldmaxdam', 'coldlength'], ['poisonmindam', 'poisonmaxdam', 'poisonlength'],
]) paired[idOf(first)] = rest.map(idOf);

// ---------------------------------------------------------------------------
// Items: base names, weapon/armor (by item type, as the game decides), damage
// ---------------------------------------------------------------------------

const parents = new Map();
for (const t of readTsv('itemtypes.txt')) if (t.Code) parents.set(t.Code, [t.Equiv1, t.Equiv2].filter(Boolean));
function isA(type, want, seen = new Set()) {
  if (type === want) return true;
  if (!type || seen.has(type)) return false;
  seen.add(type);
  return (parents.get(type) || []).some(p => isA(p, want, seen));
}

const items = {};
for (const file of ['weapons.txt', 'armor.txt', 'misc.txt']) {
  for (const r of readTsv(file)) {
    if (!r.code || items[r.code]) continue;
    const it = { n: R.items.get(r.code)?.name || r.name || r.code };
    it.k = isA(r.type, 'armo') ? 'a' : isA(r.type, 'weap') ? 'w' : 'm';
    let f = 0;
    if (isA(r.type, 'char')) f |= 1;
    if (isA(r.type, 'scro') || isA(r.type, 'book')) f |= 2;
    if (isA(r.type, 'body')) f |= 4;
    if (isA(r.type, 'play')) f |= 8;
    if (isA(r.type, 'gold')) f |= 16;
    if (num(r.quest) && num(r.questdiffcheck)) f |= 32;
    if (isA(r.type, 'shie')) f |= 64;
    if (f) it.f = f;
    if (it.k === 'w') {
      // animation class (one hand, and two hands where the weapon allows it) and speed modifier
      it.wc = (r.wclass || 'hth').toLowerCase();
      if (r['2handedwclass'] && r['2handed'] === '1') it.wc = r['2handedwclass'].toLowerCase();
      if (num(r.speed)) it.sp = num(r.speed);
      // % damage per point of Strength / Dexterity (StrBonus, DexBonus: 100 = 1% per point)
      if (num(r.StrBonus)) it.sb = num(r.StrBonus);
      if (num(r.DexBonus)) it.db = num(r.DexBonus);
      if (num(r.maxdam)) it.d1 = [num(r.mindam), num(r.maxdam)];
      if (num(r['2handmaxdam'])) it.d2 = [num(r['2handmindam']), num(r['2handmaxdam'])];
      if (num(r.maxmisdam)) it.dt = [num(r.minmisdam), num(r.maxmisdam)];
    }
    items[r.code] = it;
  }
}

// ---------------------------------------------------------------------------
// Names: uniques and set items by row id, affixes by row, runewords by string id
// ---------------------------------------------------------------------------

const uniques = {};
for (const r of readTsv('uniqueitems.txt')) if (r['*ID'] !== '' && r.index) uniques[r['*ID']] = str(r.index, { reverseLines: true }) || r.index;

const setNames = new Map(readTsv('sets.txt').map(r => [r.index, str(r.name) || str(r.index) || r.index]));
const sets = {};
for (const r of readTsv('setitems.txt')) {
  if (r['*ID'] !== '' && r.index) sets[r['*ID']] = [str(r.index, { reverseLines: true }) || r.index, setNames.get(r.set) || r.set, r.set];
}

// Bonuses that aren't on the items: socketed gems and runes (gems.txt, by the kind of item they
// are in) and the set bonuses for wearing several items of a set (sets.txt). Stats as
// [id, value, param], from the item properties (lib/property-stats.mjs).
const resolveProperty = createPropertyResolver({ readTsv });
const bonus = (code, param, min, max, context) => {
  if (!code) return [];
  const out = resolveProperty(code, param, min, max);
  if (!out) { bump(report.unresolvedBonuses, code, context); return []; }
  return out.map(st => (st.param ? [st.id, st.value, st.param] : [st.id, st.value]));
};
const gems = {};
for (const r of readTsv('gems.txt')) {
  if (!r.code) continue;
  gems[r.code] = ['weapon', 'helm', 'shield'].map(k => [1, 2, 3].flatMap(i =>
    bonus(r[`${k}Mod${i}Code`], r[`${k}Mod${i}Param`], r[`${k}Mod${i}Min`], r[`${k}Mod${i}Max`], `gems.txt ${r.name}`)));
}
const setSizes = new Map();
for (const r of readTsv('setitems.txt')) if (r.set) setSizes.set(r.set, (setSizes.get(r.set) || 0) + 1);
const setBonuses = {};
for (const r of readTsv('sets.txt')) {
  if (!r.index || !setSizes.has(r.index)) continue;
  const partial = {};
  for (let n = 2; n <= 5; n++) {
    const list = ['a', 'b'].flatMap(x => bonus(r[`PCode${n}${x}`], r[`PParam${n}${x}`], r[`PMin${n}${x}`], r[`PMax${n}${x}`], `sets.txt ${r.index}`));
    if (list.length) partial[n] = list;
  }
  const full = [1, 2, 3, 4, 5, 6, 7, 8].flatMap(i => bonus(r[`FCode${i}`], r[`FParam${i}`], r[`FMin${i}`], r[`FMax${i}`], `sets.txt ${r.index}`));
  setBonuses[r.index] = { n: setSizes.get(r.index), p: partial, f: full };
}

const affixNames = file => readTsv(file).map(r => (r.Name ? str(r.Name) || r.Name : ''));
const prefixes = affixNames('magicprefix.txt');
const suffixes = affixNames('magicsuffix.txt');

const runeRows = readTsv('runes.txt');
const runewords = {};
for (const [id, key] of loadStringIds(PATHS.strings, new Set(runeRows.map(r => r.Name).filter(Boolean)))) {
  runewords[id] = str(key) || key;
}

// Monster names by *hcIdx and monster types by row, for "versus <type>" and "Reanimate as"
// mods. ESR also keeps some item descriptions as monster names (item_mythicaldesc).
const monsters = {};
for (const r of readTsv('monstats.txt')) {
  if (r['*hcIdx'] !== '' && r.NameStr) monsters[r['*hcIdx']] = str(r.NameStr, { reverseLines: true, keepLines: true }) || r.Id;
}
const montypes = readTsv('montype.txt').map(r => (r.strplur && str(r.strplur)) || r.type || '');

// ---------------------------------------------------------------------------
// Classes and skills (the save lists a class's skills in skills.txt order)
// ---------------------------------------------------------------------------

const classByName = Object.fromEntries(Object.entries(CLASS_NAMES).map(([id, n]) => [n.toLowerCase(), id]));
const classes = [];
for (const r of readTsv('charstats.txt')) {
  const id = classByName[(r.class || '').toLowerCase()];
  if (!id) continue;
  const tabs = [1, 2, 3].map(n => text(r[`StrSkillTab${n}`]) || '');
  classes.push({
    id, name: CLASS_NAMES[id],
    all: text(r.StrAllSkills) || `%+d to ${CLASS_NAMES[id]} Skill Levels`,
    tabs, only: text(r.StrClassOnly) || '',
    // life/stamina per point of vitality and mana per energy, in quarters
    per: { life: num(r.LifePerVitality), stamina: num(r.StaminaPerVitality), mana: num(r.ManaPerMagic) },
    trees: tabs.map((t, i) => t.replace(/^%?\+?%?\+?d\s+to\s+/i, '').replace(/\s*\([^)]*only\)\s*$/i, '').trim() || `Skill Tab ${i + 1}`),
    skills: [],
  });
}
const classIndex = new Map(classes.map((c, i) => [c.id, i]));

const descByKey = new Map(readTsv('skilldesc.txt').map(d => [d.skilldesc, d]));
// stat names in numbered columns, keeping their positions (aurastatcalc N goes with aurastat N)
const slotsOf = (r, col, n) => {
  const out = Array.from({ length: n }, (_, i) => r[`${col}${i + 1}`] || '');
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
};
const skills = [];
// Skills whose stats can apply to the character, by id: { k: skills.txt key (the Skills page's
// formula records), kind, as: aura stat names, ps: passive stat names }. kind is
// "buff" (cast with a duration, a state on the caster), "aura" or "passive" (always on).
const effects = {};
// skills.txt keys (the Skills page's formula keys) where they aren't the lower-cased name
const skillKeys = {};
for (const r of readTsv('skills.txt')) {
  if (r['*Id'] === '') continue;
  const d = descByKey.get(r.skilldesc);
  const entry = [(d && str(d['str name'])) || r.skill];
  const ci = classIndex.get(r.charclass);
  if (ci != null) {
    entry.push(ci, num(d?.SkillPage));
    classes[ci].skills.push(+r['*Id']);
  }
  skills[+r['*Id']] = entry;
  if (r.skill.toLowerCase() !== entry[0].toLowerCase()) skillKeys[r['*Id']] = r.skill.toLowerCase();
  const as = slotsOf(r, 'aurastat', 6);
  const ps = slotsOf(r, 'passivestat', 14);
  let kind = null;
  if (r.passive === '1' && ps.length) kind = 'passive';
  else if (r.aura === '1' && as.length) kind = 'aura';
  else if (as.length && r.auralencalc && r.aurastate) kind = 'buff';
  if (!kind) continue;
  const e = effects[r['*Id']] = { k: r.skill.toLowerCase(), kind, as, ps };
  // aurafilter says whom the stats land on: a filter that ignores allies (0x8000) or is just
  // players/monsters (2, 3) puts them on enemies (Conviction, Judgement, Super Teleport), unless
  // it has 0x40000000 (the caster's own stacks) or the state is the caster's during the skill
  // (srvstfunc 39: Berserk Fury). Without a filter, or allies only (Might), they're the caster's.
  const f = num(r.aurafilter);
  if (f && !(f & 0x40000000) && ((f & 0x8000) || (f & ~3) === 0) && r.srvstfunc !== '39') e.t = 1;
  // a stacking counter: an aura stat whose formula reads itself back (Permafrost, Fist of the Heavens)
  const sc = as.findIndex((n, i) => new RegExp(`stat\\('${n}'\\.accr\\)`).test(r[`aurastatcalc${i + 1}`] || ''));
  if (sc >= 0) e.sc = sc;
}

// Formula records for the skills a character can have: every class skill, every skill an item
// grants (skill-rules.json grantProperties on uniques, set items, sets, runewords and affixes),
// the buff/aura/passive skills, and the skills and missiles they reach through sklvl()/miss() or
// their description missiles. The same records as the Skills page's, built with
// lib/skill-records.mjs, plus what damage needs: sd (SrcDam, % weapon damage in 128ths),
// an (animation mode) and et (element). site/assets/char-calc.js evaluates them with
// skill-calc.js for the character's skill levels and stats.
const skillRules = JSON.parse(readText(path.join(HERE, 'skill-rules.json')));
const withoutComments = o => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !k.startsWith('$')));
const calcDb = { s: {}, m: {}, base: (skillRules.baseSkills || []).map(x => x.toLowerCase()), stats: {}, aliases: withoutComments(skillRules.tokenAliases) };
{
  const rowByKey = new Map();
  const rowById = new Map();
  for (const r of readTsv('skills.txt')) {
    if (r.skill && !rowByKey.has(r.skill.toLowerCase())) rowByKey.set(r.skill.toLowerCase(), r);
    if (r['*Id'] !== '') rowById.set(r['*Id'], r);
  }
  const missileByKey = new Map(readTsv('missiles.txt').filter(m => m.Missile).map(m => [m.Missile.toLowerCase(), m]));
  const keyOf = p => { const r = /^\d+$/.test(p) ? rowById.get(p) : rowByKey.get(String(p).toLowerCase()); return r ? r.skill.toLowerCase() : null; };

  const grants = new Set(skillRules.grantProperties || []);
  const granted = new Set();
  const scan = (file, slots) => {
    if (!fs.existsSync(path.join(PATHS.excel, file))) return;
    for (const r of readTsv(file)) for (const [code, param] of slots) if (grants.has(r[code]) && r[param]) { const k = keyOf(r[param]); if (k) granted.add(k); }
  };
  const n = (count, f) => Array.from({ length: count }, (_, i) => f(i + 1));
  scan('uniqueitems.txt', n(12, i => [`prop${i}`, `par${i}`]));
  scan('setitems.txt', [...n(9, i => [`prop${i}`, `par${i}`]), ...n(5, i => [[`aprop${i}a`, `apar${i}a`], [`aprop${i}b`, `apar${i}b`]]).flat()]);
  scan('sets.txt', [...n(4, i => [[`PCode${i + 1}a`, `PParam${i + 1}a`], [`PCode${i + 1}b`, `PParam${i + 1}b`]]).flat(), ...n(8, i => [`FCode${i}`, `FParam${i}`])]);
  scan('runes.txt', n(7, i => [`T1Code${i}`, `T1Param${i}`]));
  scan('magicprefix.txt', n(3, i => [`mod${i}code`, `mod${i}param`]));
  scan('magicsuffix.txt', n(3, i => [`mod${i}code`, `mod${i}param`]));

  const classKeys = [...rowByKey.values()].filter(r => r.charclass).map(r => r.skill.toLowerCase());
  const queue = [...new Set([...Object.values(effects).map(e => e.k), ...classKeys, ...granted])];
  const refRe = /\b(sklvl|miss)\s*\(\s*'([^']+)'/gi;
  while (queue.length) {
    const key = queue.shift();
    const row = rowByKey.get(key);
    if (calcDb.s[key] || !row) continue;
    const rec = skillRecord(row, descByKey.get(row.skilldesc));
    delete rec.mn; delete rec.th; delete rec.rng; delete rec.pet;
    if (num(row.SrcDam)) rec.sd = num(row.SrcDam);
    if (row.anim) rec.an = row.anim;
    if (row.EType) rec.et = row.EType;
    // a timed state on the caster that fires no missile, has no % weapon damage and describes no
    // damage is a buff (Energy Shield, Bone Armor), even when its damage columns hold numbers
    if (row.aurastate && row.auralencalc && !['srvmissile', 'srvmissilea', 'srvmissileb', 'srvmissilec'].some(c => row[c]) && !num(row.SrcDam) && !num(descByKey.get(row.skilldesc)?.descdam)) rec.nd = 1;
    // damage conversion is on the missile the skill fires: pSrvDmgFunc 1 with DmgCalc1 = the %
    // of physical damage converted to the missile's EType (dl12 = dParam1 + dParam2 per level)
    const sm = (row.srvmissile || '').toLowerCase();
    const mr = sm && missileByKey.get(sm);
    if (mr && mr.pSrvDmgFunc === '1' && mr.DmgCalc1 && mr.EType) {
      rec.cv = { c: mr.DmgCalc1, p: [num(mr.dParam1), num(mr.dParam2)], et: mr.EType };
      if (mr.ApplyMastery === '1') rec.cv.am = 1;
    }
    calcDb.s[key] = rec;
    const texts = formulas(rec);
    for (const m of rec.ms || []) texts.push(`miss('${m}'.x)`);
    for (const t of texts) {
      for (const m of t.matchAll(refRe)) {
        const target = m[2].toLowerCase();
        if (m[1].toLowerCase() === 'sklvl') { queue.push(target); continue; }
        const mr = missileByKey.get(target);
        if (mr && !calcDb.m[target]) calcDb.m[target] = missileRecord(mr);
      }
    }
  }
}

// Animations for breakpoints (AnimData.d2): "<token><mode><weapon class>" -> [frames, speed], for
// the player classes' tokens. FCR's cap comes from ESR's cast-rate-cap plugin config when present.
const CLASS_TOKENS = { ama: 'AM', sor: 'SO', nec: 'NE', pal: 'PA', bar: 'BA', dru: 'DZ', ass: 'AI', war: 'WL' };
classes.forEach(c => { c.token = CLASS_TOKENS[c.id]; });
const anim = {};
{
  const file = path.join(PATHS.data, 'global', 'AnimData.d2');
  if (fs.existsSync(file)) {
    const b = fs.readFileSync(file);
    const tokens = new Set(Object.values(CLASS_TOKENS));
    let p = 0;
    for (let block = 0; block < 256 && p + 4 <= b.length; block++) {
      const count = b.readUInt32LE(p); p += 4;
      for (let i = 0; i < count; i++, p += 160) {
        const name = b.toString('latin1', p, p + 8).replace(/\0.*$/s, '');
        if (tokens.has(name.slice(0, 2))) anim[name] = [b.readUInt32LE(p + 8), b.readUInt32LE(p + 12)];
      }
    }
  } else bump(report.missingStrings, 'AnimData.d2', 'not found: no breakpoints');
}
let fcrCap = 200;
{
  const file = path.join(PATHS.esr, 'd2rloader', 'config', 'celestialrayone.cast-rate-cap.toml');
  if (fs.existsSync(file)) {
    const t = readText(file);
    const on = /^\s*enabled\s*=\s*true/m.test(t);
    const m = /^\s*fcr_cap\s*=\s*(\d+)/m.exec(t);
    if (on && m) fcrCap = +m[1];
  }
}

// Crushing blow's share of the target's current life per target type, from ESR's crushing-blow
// plugin: vanilla's melee share (25%, 12.5% for super uniques and act bosses) x the plugin's
// percent; ranged hits get [attack] ranged percent of that. Vanilla without the config.
const crush = { targets: { monster: 25, champion: 25, unique: 25, minion: 25, super_unique: 12.5, act_boss: 12.5 }, ranged: 50 };
{
  const file = path.join(PATHS.esr, 'd2rloader', 'config', 'celestialrayone.crushing-blow.toml');
  if (fs.existsSync(file)) {
    const t = readText(file);
    if (/^\s*enabled\s*=\s*true/m.test(t)) {
      let sectionName = '';
      for (const line of t.split(/\r?\n/)) {
        const sec = /^\s*\[([^\]]+)\]/.exec(line);
        if (sec) { sectionName = sec[1].trim(); continue; }
        const kv = /^\s*([a-z_]+)\s*=\s*([\d.]+)/.exec(line);
        if (!kv) continue;
        if (sectionName === 'targets' && kv[1] in crush.targets) crush.targets[kv[1]] = crush.targets[kv[1]] * +kv[2] / 100;
        if (sectionName === 'attack' && kv[1] === 'ranged') crush.ranged = +kv[2];
      }
    }
  }
}

// Resistance penalty per difficulty (difficultylevels.txt; ESR's are much harsher than retail).
const difficulty = readTsv('difficultylevels.txt').filter(r => r.Name).map(r => ({ n: r.Name, rp: num(r.ResistPenalty) }));

const TEXT_KEYS = [
  'strModEnhancedDamage', 'strModMinDamage', 'strModMinDamageRange',
  'strModFireDamage', 'strModFireDamageRange', 'strModLightningDamage', 'strModLightningDamageRange',
  'strModMagicDamage', 'strModMagicDamageRange', 'strModColdDamage', 'strModColdDamageRange',
  'strModPoisonDamage', 'strModPoisonDamageRange', 'strModAllResistances', 'Moditem2allattrib',
];
const textOut = Object.fromEntries(TEXT_KEYS.map(k => [k, text(k)]).filter(([, v]) => v));

const data = {
  generatedAt: new Date().toISOString(),
  source: crypto.createHash('sha1').update(readText(path.join(PATHS.excel, 'itemstatcost.txt'))).digest('hex').slice(0, 12),
  lang: LANG,
  stats, statIds, paired, items, uniques, sets, setBonuses, gems, difficulty, anim, fcrCap, crush, prefixes, suffixes, runewords, monsters, montypes,
  skills: Array.from(skills, s => s || null), skillKeys, effects, calc: calcDb, classes, text: textOut,
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
const json = JSON.stringify(data);
fs.writeFileSync(OUT_FILE, `/* Generated by scripts/build-character.mjs - do not edit. */\nwindow.ESR_CHAR_DATA=${json};\n`);

// ---------------------------------------------------------------------------
// Test-parse local saves with the page's own code
// ---------------------------------------------------------------------------

const saveFiles = typeof args.save === 'string'
  ? args.save.split(',').map(f => path.resolve(ROOT, f))
  : fs.readdirSync(ROOT).filter(f => f.toLowerCase().endsWith('.d2s')).map(f => path.join(ROOT, f));
const wording = ItemText.create(data);
let warnContext = '';
const charCalc = CharCalc.create({ data, SkillCalc, wording, warn: (kind, detail) => bump(report.effectWarnings, `${kind}: ${detail}`, warnContext) });

function walk(list, f) {
  for (const it of list) { f(it); walk(it.socketed || [], f); }
}

for (const file of saveFiles) {
  const label = path.basename(file);
  let save;
  try { save = D2S.parse(new Uint8Array(fs.readFileSync(file)), data); }
  catch (e) { bump(report.saveErrors, label, e.message); continue; }
  const h = save.header;
  let count = 0;
  const base = Object.fromEntries(save.stats.map(s => [stats[s.id]?.n, s.value]));
  const ctx = { level: h.level, base, skipped: [] };
  walk([...save.items, ...save.corpse, ...save.merc], it => {
    count++;
    const n = wording.name(it);
    if (/^(Unique|Set|Runeword)\b/.test(n.title) && n.title !== n.base) bump(report.unnamed, `${n.quality} ${it.code} #${it.rw ?? it.qid}`, label);
    for (const list of [it.stats, it.rwStats, ...(it.setStats || []).map(s => s.stats)]) {
      ctx.skipped = [];
      wording.lines(list || [], ctx);
      for (const id of ctx.skipped) bump(report.skippedStats, stats[id]?.n ?? id, `${n.title} (${label})`);
    }
  });
  const cls = classes[h.classId];
  if (cls && save.skills.length !== cls.skills.length) {
    bump(report.saveErrors, label, `${save.skills.length} skill slots but ${cls.name} has ${cls.skills.length} skills in skills.txt`);
  }
  // every buff, aura and passive the character could have, switched on
  warnContext = label;
  const all = charCalc.compute(save);
  const on = Object.fromEntries(all.effects.map(e => [e.key, true]));
  const model = charCalc.compute(save, { on });
  for (const e of model.effects) if (e.missing && e.level) bump(report.missingEffects, `${e.name} (${e.k})`, label);
  const casts = model.effects.filter(e => e.casts > 1).map(e => `${e.name} ${e.levels.join('→')}`);
  report.saves.push(`${label}: ${h.name}, level ${h.level} ${cls?.name ?? `class ${h.classId}`}, ${count} items (${save.merc.length} on the mercenary), ${model.effects.length} buffs/auras/passives, settles in ${model.rounds} round(s)${casts.length ? ` (recast: ${casts.join(', ')})` : ''}`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const md = `## Character data generation (${LANG})

- Stats: **${Object.keys(stats).length}**, item bases: **${Object.keys(items).length}**, uniques: **${Object.keys(uniques).length}**, set items: **${Object.keys(sets).length}**, runeword names: **${Object.keys(runewords).length}**, skills: **${skills.filter(Boolean).length}**
- Output: \`${path.relative(ROOT, OUT_FILE).replace(/\\/g, '/')}\` (${(json.length / 1024).toFixed(0)} KB)

### Test-parsed saves (${report.saves.length})

${report.saves.length ? report.saves.map(s => `- ${s}`).join('\n') : 'None (put a .d2s in the repo root, or pass --save=<file>).'}

${reportTable('Saves that failed to parse', report.saveErrors)}
${reportTable('Stats the page hides (no description in the game data)', report.skippedStats)}
${reportTable('Items without a name in the data', report.unnamed)}
${reportTable('Gem and set bonuses left out (property not resolved)', report.unresolvedBonuses)}
${reportTable('Buffs, auras and passives without formula records', report.missingEffects)}
${reportTable('Formula warnings (buffs, auras, passives; all on)', report.effectWarnings)}
${reportTable('Stats missing from itemstatcost.txt', report.missingStats)}
${reportTable('Missing strings', report.missingStrings)}
`;

if (typeof args.report === 'string') fs.writeFileSync(path.resolve(ROOT, args.report), md);
console.log(`character: ${Object.keys(stats).length} stats, ${Object.keys(items).length} item bases -> ${path.relative(ROOT, OUT_FILE)} (${(json.length / 1024).toFixed(0)} KB)`);
console.log(`  test-parsed saves: ${report.saves.length}, failed: ${report.saveErrors.size}, hidden stats: ${report.skippedStats.size}, unnamed items: ${report.unnamed.size}, effect formula warnings: ${report.effectWarnings.size}, effects without formulas: ${report.missingEffects.size}`);

if (args.strict && (report.saveErrors.size || report.missingStats.size)) {
  console.error('strict: a save failed to parse, or a stat the save layout needs is missing');
  process.exit(1);
}
