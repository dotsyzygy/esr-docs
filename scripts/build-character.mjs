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

const args = parseArgs();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PATHS = gamePaths(args, ROOT);
const LANG = args.lang || 'enUS';
const OUT_FILE = path.join(path.resolve(ROOT, args.out || 'site'), 'data', `character.${LANG}.js`);
const require = createRequire(import.meta.url);
const D2S = require(path.join(ROOT, 'site', 'assets', 'd2s.js'));
const ItemText = require(path.join(ROOT, 'site', 'assets', 'item-text.js'));

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
    if (f) it.f = f;
    if (it.k === 'w') {
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
  if (r['*ID'] !== '' && r.index) sets[r['*ID']] = [str(r.index, { reverseLines: true }) || r.index, setNames.get(r.set) || r.set];
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
const skills = [];
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
}

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
  stats, statIds, paired, items, uniques, sets, prefixes, suffixes, runewords, monsters, montypes,
  skills: Array.from(skills, s => s || null), classes, text: textOut,
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
  report.saves.push(`${label}: ${h.name}, level ${h.level} ${cls?.name ?? `class ${h.classId}`}, ${count} items (${save.merc.length} on the mercenary)`);
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
${reportTable('Stats missing from itemstatcost.txt', report.missingStats)}
${reportTable('Missing strings', report.missingStrings)}
`;

if (typeof args.report === 'string') fs.writeFileSync(path.resolve(ROOT, args.report), md);
console.log(`character: ${Object.keys(stats).length} stats, ${Object.keys(items).length} item bases -> ${path.relative(ROOT, OUT_FILE)} (${(json.length / 1024).toFixed(0)} KB)`);
console.log(`  test-parsed saves: ${report.saves.length}, failed: ${report.saveErrors.size}, hidden stats: ${report.skippedStats.size}, unnamed items: ${report.unnamed.size}`);

if (args.strict && (report.saveErrors.size || report.missingStats.size)) {
  console.error('strict: a save failed to parse, or a stat the save layout needs is missing');
  process.exit(1);
}
