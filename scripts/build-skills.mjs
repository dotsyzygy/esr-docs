#!/usr/bin/env node
// Generates site/data/skills.<lang>.js from the mod's skills.txt and skilldesc.txt.
//
// Usage:
//   node scripts/build-skills.mjs [--esr=<path>] [--out=site] [--report=skills-report.md] [--strict] [--lang=enUS]
//
// --esr points at a checkout of the Eastern_Sun_Resurrected repo (also settable with the
// ESR_REPO environment variable). It defaults to ../Eastern_Sun_Resurrected next to this repo.
//
// The page shows each class's skill trees plus the non-class skills that items grant as
// oskills. Description lines keep the game's own formulas: site/assets/skill-calc.js
// evaluates them here (to validate every line at every level) and again in the browser
// (for the chosen skill and character level). Presentation choices are in
// scripts/skill-rules.json. No dependencies; requires Node 18+.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, gamePaths, requireTable, readText, tsvReader, loadStrings,
  CLASS_NAMES, reportTable, bump,
} from './lib/game-data.mjs';
import { skillRecord, missileRecord, formulas } from './lib/skill-records.mjs';
import { createStatTemplate, statTextMap } from './lib/stat-text.mjs';

const args = parseArgs();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PATHS = gamePaths(args, ROOT);
const LANG = args.lang || 'enUS';
const SITE = path.resolve(ROOT, args.out || 'site');
const OUT_FILE = path.join(SITE, 'data', `skills.${LANG}.js`);
const rules = JSON.parse(readText(path.join(HERE, 'skill-rules.json')));
const SkillCalc = createRequire(import.meta.url)(path.join(ROOT, 'site', 'assets', 'skill-calc.js'));

requireTable(PATHS, 'skills.txt');
requireTable(PATHS, 'skilldesc.txt');

const readTsv = tsvReader(PATHS.excel);
const str = loadStrings(PATHS.strings, LANG, ['skills.json', 'item-modifiers.json', 'item-names.json', 'item-runes.json', 'item-nameaffixes.json']);

const report = {
  unresolvedStrings: new Map(),
  unknownLineTypes: new Map(),
  calcWarnings: new Map(),
  badText: new Map(),
  skippedOskills: new Map(),
  hiddenLines: new Map(),
  statLines: new Map(),
  undescribedStats: new Map(),
  noLines: new Map(),
  emptySkills: new Map(),
  unmodelledSynergies: new Map(),
  onStriking: new Map(),
  missileLines: new Map(),
  classCounts: new Map(),
};

const MAX_LEVEL = rules.maxLevel || 110;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const skillText = readText(path.join(PATHS.excel, 'skills.txt'));
const baseSkills = path.join(PATHS.excel, 'base', 'skills.txt');
if (fs.existsSync(baseSkills) && readText(baseSkills) !== skillText) {
  console.warn('warning: excel/skills.txt and excel/base/skills.txt differ; using excel/skills.txt');
}

const skillRows = readTsv('skills.txt');
const skillByKey = new Map();
const skillById = new Map();
for (const r of skillRows) {
  if (!r.skill) continue;
  const key = r.skill.toLowerCase();
  if (!skillByKey.has(key)) skillByKey.set(key, r);
  skillById.set(r['*Id'], r);
}
const descByKey = new Map(readTsv('skilldesc.txt').map(d => [d.skilldesc, d]));
const statByKey = new Map(readTsv('itemstatcost.txt').map(r => [r.Stat.toLowerCase(), r]));
const missileByKey = new Map();
for (const m of readTsv('missiles.txt')) if (m.Missile) missileByKey.set(m.Missile.toLowerCase(), m);

// Strings keep their stored line order: tooltip lines are drawn bottom line first, but only
// after their placeholders are filled, so skill-calc.js reverses them when formatting.
function text(key, context) {
  if (!key) return '';
  const t = str(key, { keepLines: true });
  if (t == null) {
    bump(report.unresolvedStrings, key, context);
    return key;
  }
  return t;
}

function skillName(row) {
  const d = descByKey.get(row.skilldesc);
  return (d && str(d['str name'])) || row.skill;
}

function lookupSkill(param) {
  if (param === '' || param == null) return null;
  return /^\d+$/.test(param) ? skillById.get(param) : skillByKey.get(String(param).toLowerCase());
}

// ---------------------------------------------------------------------------
// Classes and trees (charstats.txt lists the tabs as "+%d to Bow and Crossbow Skills")
// ---------------------------------------------------------------------------

const classByName = Object.fromEntries(Object.entries(CLASS_NAMES).map(([id, n]) => [n.toLowerCase(), id]));
const classes = [];
for (const r of readTsv('charstats.txt')) {
  const id = classByName[(r.class || '').toLowerCase()];
  if (!id) continue;
  const trees = [1, 2, 3].map(n => {
    const s = str(r[`StrSkillTab${n}`]) || `Skill Tab ${n}`;
    return s.replace(/^%?\+?%?\+?d\s+to\s+/i, '').replace(/\s*\([^)]*only\)\s*$/i, '').trim();
  });
  classes.push({ id, title: CLASS_NAMES[id], trees });
}

// ---------------------------------------------------------------------------
// Where items grant skills: oskills, chance to cast (procs), charges and auras
// ---------------------------------------------------------------------------

const range = (min, max) => {
  const a = +min || 0, b = max === '' || max == null ? a : +max;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return lo === hi ? `+${lo}` : `+${lo}-${hi}`;
};

// The item properties that grant a skill (skill-rules.json grantProperties), worded with the
// stat's own string minus the skill name: "9% Chance to Cast Level 12 on Striking",
// "Level 5 (20/20 Charges)". oskills show their bonus ("+3"), auras their level.
const statByProperty = new Map(readTsv('properties.txt').map(p => [p.code, p.stat1]));
const fill = (tmpl, vals) => { let i = 0; return tmpl.replace(/%(\+?)([dsi%])/g, (_, p, t) => (t === '%' ? '%' : String(vals[i++] ?? ''))); };
const grantProps = new Set(rules.grantProperties || ['oskill']);
function grantText(code, min, max) {
  if (code === 'oskill') return range(min, max);
  const st = statByKey.get((statByProperty.get(code) || '').toLowerCase()) || {};
  const s = str(st.descstrpos);
  const tidy = t => t.replace(/\s+/g, ' ').replace(/ \(/, ' (').trim();
  if (+st.descfunc === 15 && s) return tidy(fill(s, [min, max, '']));
  if (+st.descfunc === 24 && s) return tidy(fill(s, [max, '', min, min]));
  if (/aura/.test(code)) return `Level ${range(min, max).slice(1)} Aura When Equipped`;
  return range(min, max);
}

// Cube rows: Vessel of Souls and per-slot anointment outcomes are their own sources; other
// recipes are counted and link to the Cube Recipes page.
function cubeSource(r) {
  const desc = r.description || '';
  if (/^(Anointment - )?Vessel of Souls/i.test(desc)) return { k: 'Vessel of Souls' };
  const m = /^Anointment - (.+?) \d+\b/i.exec(desc);
  if (m) return { k: 'Anointment', n: m[1] };
  return { k: 'Cube recipe' };
}

const slots = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
const SOURCES = [
  {
    file: 'uniqueitems.txt', kind: 'Unique',
    name: r => str(r.index, { reverseLines: true }) || r.index,
    slots: slots(12, i => [`prop${i}`, `par${i}`, `min${i}`, `max${i}`]),
  },
  {
    file: 'setitems.txt', kind: 'Set item',
    name: r => str(r.index, { reverseLines: true }) || r.index,
    slots: [
      ...slots(9, i => [`prop${i}`, `par${i}`, `min${i}`, `max${i}`]),
      ...slots(5, i => ['a', 'b'].map(x => [`aprop${i}${x}`, `apar${i}${x}`, `amin${i}${x}`, `amax${i}${x}`])).flat(),
    ],
  },
  {
    file: 'sets.txt', kind: 'Set bonus',
    name: r => str(r.name) || str(r.index) || r.index,
    slots: [
      ...slots(4, i => ['a', 'b'].map(x => [`PCode${i + 1}${x}`, `PParam${i + 1}${x}`, `PMin${i + 1}${x}`, `PMax${i + 1}${x}`])).flat(),
      ...slots(8, i => [`FCode${i}`, `FParam${i}`, `FMin${i}`, `FMax${i}`]),
    ],
  },
  {
    file: 'runes.txt', kind: 'Runeword',
    name: r => str(r.Name) || r['*Rune Name'] || r.Name,
    enabled: r => r.complete === '1',
    slots: slots(7, i => [`T1Code${i}`, `T1Param${i}`, `T1Min${i}`, `T1Max${i}`]),
  },
  ...['magicprefix.txt', 'magicsuffix.txt'].map(file => ({
    file, kind: file === 'magicprefix.txt' ? 'Magic prefix' : 'Magic suffix',
    name: r => str(r.Name) || r.Name,
    enabled: r => r.spawnable === '1',
    slots: slots(3, i => [`mod${i}code`, `mod${i}param`, `mod${i}min`, `mod${i}max`]),
  })),
  {
    file: 'cubemain.txt', kind: 'Cube recipe', cube: true,
    enabled: r => r.enabled === '1',
    slots: ['', 'b ', 'c '].flatMap(p => slots(5, i => [`${p}mod ${i}`, `${p}mod ${i} param`, `${p}mod ${i} min`, `${p}mod ${i} max`])),
  },
];

const sourcesBySkill = new Map(); // skill key -> Map(dedupe key -> source)
for (const spec of SOURCES) {
  if (!fs.existsSync(path.join(PATHS.excel, spec.file))) continue;
  for (const r of readTsv(spec.file)) {
    if (spec.enabled && !spec.enabled(r)) continue;
    for (const [code, param, min, max] of spec.slots) {
      if (!grantProps.has(r[code])) continue;
      const row = lookupSkill(r[param]);
      if (!row) { bump(report.skippedOskills, `unknown skill ${r[param]}`, spec.file); continue; }
      const key = row.skill.toLowerCase();
      const v = grantText(r[code], r[min], r[max]);
      const src = spec.cube ? cubeSource(r) : { k: spec.kind, n: spec.name(r) };
      if (!spec.cube && !src.n) continue;
      if (src.k !== 'Cube recipe') src.v = v;
      const m = sourcesBySkill.get(key) || new Map();
      const dk = JSON.stringify(src);
      if (m.has(dk)) { if (spec.cube) m.get(dk).c = (m.get(dk).c || 1) + 1; } else m.set(dk, src);
      sourcesBySkill.set(key, m);
    }
  }
}
const SOURCE_ORDER = [...SOURCES.map(s => s.kind), 'Anointment', 'Vessel of Souls'];
// One entry per item; an item listed more than once (e.g. a runeword on several bases)
// shows each of its levels: "+5 / +10".
function sourcesFor(key) {
  const m = sourcesBySkill.get(key);
  if (!m) return undefined;
  const byItem = new Map();
  for (const s of m.values()) {
    const ik = `${s.k}\u0000${s.n || ''}`;
    const prev = byItem.get(ik);
    if (!prev) byItem.set(ik, { ...s });
    else if (s.v && !prev.v.split(' / ').includes(s.v)) prev.v += ` / ${s.v}`;
  }
  return [...byItem.values()].sort((a, b) =>
    SOURCE_ORDER.indexOf(a.k) - SOURCE_ORDER.indexOf(b.k) || (a.n || '').localeCompare(b.n || ''));
}

// ---------------------------------------------------------------------------
// Calc records: the formula inputs the evaluator needs for one skill or missile
// ---------------------------------------------------------------------------

// skillRecord, missileRecord and formulas are in lib/skill-records.mjs (shared with the
// Character page's generator).

// ---------------------------------------------------------------------------
// Description lines
// ---------------------------------------------------------------------------

// Lines that can't be shown correctly (they reference strings or missiles missing from the
// game data) are dropped by skill-rules.json hideLines: [{ skill, match }] on the raw textA.
const hiddenLines = (rules.hideLines || []).map(h => ({ skill: h.skill.toLowerCase(), re: new RegExp(h.match, 'i') }));

function lines(d, prefix, count, context, skillKey, { reverse = false } = {}) {
  const out = [];
  for (let i = 1; i <= count; i++) {
    const t = +d[`${prefix}line${i}`] || 0;
    if (!t) continue;
    const rawA = d[`${prefix}texta${i}`] || '';
    const hide = hiddenLines.find(h => h.skill === skillKey && (h.re.test(rawA) || h.re.test(str(rawA) || '')));
    if (hide) { bump(report.hiddenLines, `${context}: ${rawA}`, hide.re.source); continue; }
    if (!SkillCalc.isKnownType(t)) bump(report.unknownLineTypes, `${prefix}line ${t}`, context);
    const line = { t };
    const a = text(d[`${prefix}texta${i}`], context);
    const b = text(d[`${prefix}textb${i}`], context);
    if (a) line.a = a;
    if (b) line.b = b;
    if (d[`${prefix}calca${i}`]) line.x = d[`${prefix}calca${i}`];
    if (d[`${prefix}calcb${i}`]) line.y = d[`${prefix}calcb${i}`];
    out.push(line);
  }
  return reverse ? out.reverse() : out;
}

// Some skills (mostly item oskills such as Magic Mastery) have no description lines at all.
// Their effect is the stats they grant, so describe those the way the game words them on
// items: a "%+d%% to Magic Spell Damage" template filled with the passive/aura calc.
const statTemplate = createStatTemplate(statByKey, str);

// skill-rules.json statText rewords a stat whose raw value means little on a skill:
// { stat: { text, calc } }, where calc wraps the value ({v}), e.g. hpregen in 256ths per frame.
const statText = statTextMap(rules.statText);

function statLines(row, context) {
  const out = [];
  const add = (stat, token) => {
    if (!stat) return;
    const over = statText.get(stat.toLowerCase());
    const a = over ? over.text : statTemplate(stat);
    if (!a) { bump(report.undescribedStats, stat, context); return; }
    out.push({ t: 13, a, x: over && over.calc ? over.calc.replace(/\{v\}/g, token) : token });
    bump(report.statLines, context, stat);
  };
  for (let i = 1; i <= 14; i++) add(row[`passivestat${i}`], `pst${i}`);
  for (let i = 1; i <= 6; i++) add(row[`aurastat${i}`], `ast${i}`);
  // A timed buff (aura stats with a length, e.g. Warm Up) also says how long it lasts; the
  // length is in frames (25 per second), worded like the game's own Duration lines.
  if (out.length && row.aurastat1 && row.auralencalc && row.aura !== '1') {
    out.push({ t: 36, a: text('StrSkillDurationSingular'), b: text('StrSkill20'), x: 'len', y: '25' });
  }
  return out;
}

// Proc skills granted by items often have no description either; show the skill's own damage
// when skills.txt has it. Poison is per frame in 256ths, so its total is over the length;
// poison without a length (Poison Surge) is dealt instantly like the other Surges.
const DAMAGE_TEXT = { fire: 'Fire Damage', cold: 'Cold Damage', ltng: 'Lightning Damage', mag: 'Magic Damage', pois: 'Poison Damage' };
function damageLines(row) {
  const out = [];
  if (row.MinDam || row.MaxDam) out.push({ t: 74, a: 'Damage: %d-%d', x: 'pnma', y: 'pxma' });
  const label = DAMAGE_TEXT[row.EType];
  if (label && (row.EMin || row.EMax)) {
    out.push(row.EType === 'pois' && row.ELen
      ? { t: 74, a: `${label}: %d-%d`, x: 'enms*edln/256', y: 'exms*edln/256' }
      : { t: 74, a: `${label}: %d-%d`, x: 'enma', y: 'exma' });
  }
  return out;
}

// A proc that fires a missile deals a share of weapon damage (skills.txt SrcDam, or else the
// missile's own SrcDamage, in 128ths), which the missile, or a missile it spawns on hit, may convert to an element
// (pSrvDmgFunc 1 with a numeric DmgCalc1 percentage and an EType). Only for skills that do
// fire a missile; a skill without one may do something else entirely.
const MISSILE_COLUMNS = ['srvmissile', 'srvmissilea', 'srvmissileb', 'srvmissilec'];
const SUB_MISSILE_COLUMNS = ['HitSubMissile1', 'HitSubMissile2', 'SubMissile1', 'SubMissile2', 'ExplosionMissile'];
function conversion(missileKey, depth = 0, seen = new Set()) {
  const m = missileByKey.get((missileKey || '').toLowerCase());
  if (!m || seen.has(m.Missile) || depth > 2) return null;
  seen.add(m.Missile);
  if (m.pSrvDmgFunc === '1' && /^\d+$/.test(m.DmgCalc1) && DAMAGE_TEXT[m.EType]) return { pct: +m.DmgCalc1, label: DAMAGE_TEXT[m.EType] };
  for (const c of SUB_MISSILE_COLUMNS) {
    const sub = m[c] && m[c] !== 'dummymissile' ? conversion(m[c], depth + 1, seen) : null;
    if (sub) return sub;
  }
  return null;
}
function missileLines(row, context) {
  const missiles = [...new Set(MISSILE_COLUMNS.map(c => row[c]).filter(Boolean))];
  const src = +row.SrcDam || missiles.map(m => +(missileByKey.get(m.toLowerCase()) || {}).SrcDamage || 0).find(Boolean);
  if (!missiles.length || !(src > 0)) return [];
  const pct = Math.round(src * 100 / 128);
  const conv = missiles.map(m => conversion(m)).find(Boolean);
  const a = !conv ? `Deals ${pct}% of Weapon Damage`
    : conv.pct >= 100 ? `Deals ${pct}% of Weapon Damage as ${conv.label}`
    : `Deals ${pct}% of Weapon Damage, ${conv.pct}% converted to ${conv.label}`;
  bump(report.missileLines, context, a);
  return [{ t: 18, a }];
}

// Skills on the Static Field function (srvdofunc 20), such as Absolute Zero: calc1 is the
// share of nearby enemies' current life dealt as the skill's element, and the radius is
// aurarangecalc in game units (yards = units * 2/3, as the game's own Radius lines show).
function percentLifeLines(row) {
  if (row.srvdofunc !== '20' || !row.calc1) return [];
  const label = DAMAGE_TEXT[row.EType] || 'Damage';
  const out = [{ t: 13, a: `Deals %d%% of nearby enemies' current Life as ${label}`, x: 'clc1' }];
  if (row.aurarangecalc) out.push({ t: 36, a: text('StrSkillRadiusSingular'), b: text('StrSkill18'), x: 'rng*2', y: '3' });
  return out;
}

// Hand-written lines from skill-rules.json extraLines, for skills whose effect the data
// doesn't describe anywhere: { skill, lines: [{ text, x, y }] } (text is a printf template).
// "Chance to cast on striking": does the skill strike (deal weapon damage in melee or with a
// missile that carries it)? Spells don't. See onStriking in skill-rules.json.
const striking = rules.onStriking || {};
const strikeOverrides = new Map(Object.entries(striking.skills || {}).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k.toLowerCase(), v]));
const MISSILE_CHILDREN = ['ExplosionMissile', 'SubMissile1', 'SubMissile2', 'SubMissile3', 'HitSubMissile1', 'HitSubMissile2', 'HitSubMissile3', 'HitSubMissile4'];
function missileTree(key, test, depth = 0, seen = new Set()) {
  const m = missileByKey.get((key || '').toLowerCase());
  if (!m || seen.has(m.Missile) || depth > 3) return false;
  seen.add(m.Missile);
  return test(m) || MISSILE_CHILDREN.some(c => m[c] && missileTree(m[c], test, depth + 1, seen));
}
// { value, reason } or null when the skill doesn't hit anything (buffs, summons) or it's unclear.
function strikes(row) {
  const over = strikeOverrides.get(row.skill.toLowerCase());
  if (over) return { value: !!over.value, reason: over.reason || '' };
  if (row.passive === '1' || row.aura === '1') return null;
  const fn = row.srvdofunc;
  if ((striking.noHitRoutines || {})[fn]) return null;
  if (row.summon) return null; // the summon hits, not the caster
  const srcDam = +row.SrcDam > 0;
  const note = (striking.notes || {})[fn];
  const withNote = r => (note ? `${r} ${note}` : r);
  if ((striking.meleeRoutines || {})[fn] && (srcDam || (striking.withoutSrcDam || []).includes(fn))) {
    return { value: true, reason: withNote('It hits with your weapon.') };
  }
  const missiles = ['srvmissile', 'srvmissilea', 'srvmissileb', 'srvmissilec'].map(c => row[c]).filter(Boolean);
  if (missiles.length && (srcDam || missiles.some(m => missileTree(m, x => +x.SrcDamage > 0)))) {
    return { value: true, reason: withNote('Its missiles carry your weapon damage.') };
  }
  if (srcDam) { bump(report.onStriking, `unclear: ${row.skill}`, `SrcDam ${row.SrcDam}, srvdofunc ${fn || '-'}`); return null; }
  const damage = r => +r.MinDam > 0 || +r.MaxDam > 0 || +r.EMin > 0 || +r.EMax > 0;
  const missileDamage = x => +x.MinDamage > 0 || +x.MaxDamage > 0 || +x.EMin > 0 || +x.EMax > 0;
  if (!damage(row) && !missiles.some(m => missileTree(m, missileDamage))) return null;
  // A buff that fires nothing (Venom, Energy Shield): its damage columns aren't a hit.
  if (!missiles.length && row.aurastate) return null;
  // An attack (weapon range, attack speed) with no weapon damage: not clearly a spell or a strike.
  if (row.UseAttackRate === '1' && ['h2h', 'rng', 'both'].includes(row.range)) {
    bump(report.onStriking, `unclear: ${row.skill}`, `attack with no weapon damage, srvdofunc ${fn || '-'}`);
    return null;
  }
  return { value: false, reason: 'It deals no weapon damage, and spells don’t count as strikes.' };
}

const extraLines = new Map((rules.extraLines || []).map(x => [x.skill.toLowerCase(), x.lines]));
// Hand-written descriptions (skill-rules.json descriptions), for skills whose numbers depend on
// other skills or on mechanics the data can't pin down: { skill (skills.txt name): text }.
const descriptions = new Map(Object.entries(rules.descriptions || {}).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k.toLowerCase(), v]));

const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hidden = new Set((rules.hideSkills || []).map(s => s.toLowerCase()));

const usedIds = new Set();
function entryFor(row, cls) {
  const d = descByKey.get(row.skilldesc);
  const name = skillName(row);
  const key = row.skill.toLowerCase();
  let id = `${cls}-${slug(name)}`, k = 2;
  while (usedIds.has(id)) id = `${cls}-${slug(name)}-${k++}`;
  usedIds.add(id);
  const e = { id, n: name, c: cls, k: key };
  if (cls !== 'other') {
    e.tr = +d.SkillPage;
    e.row = +d.SkillRow || 0;
    e.col = +d.SkillColumn || 0;
  }
  if (+row.reqlevel > 1) e.r = +row.reqlevel;
  const pre = ['reqskill1', 'reqskill2', 'reqskill3'].map(c => lookupSkill(row[c])).filter(Boolean).map(skillName);
  if (pre.length) e.pre = pre;
  if (row.passive === '1') e.pas = 1;
  if (row.aura === '1') e.aur = 1;
  const strike = strikes(row);
  if (strike) {
    e.os = strike.value ? 1 : 0;
    if (strike.reason) e.osr = strike.reason;
    if (cls !== 'other') bump(report.onStriking, strike.value ? 'triggers' : 'does not trigger', name);
  }
  // Descriptions are hard-wrapped for the tooltip; rejoin a line that continues a sentence
  // (starts lowercase), keep breaks before lines that start a new one.
  const desc = text(d['str long'] || d['str short'], name).replace(/\n(?=[a-z])/g, ' ');
  // Some descriptions just repeat the name ("Magic Mastery"); don't show those.
  if (desc && desc !== d['str long'] && desc.toLowerCase() !== name.toLowerCase()) e.d = desc;
  if (descriptions.has(key)) e.d = descriptions.get(key);
  const ctx = `${name} (${row.skill})`;
  // In-game, the per-level desc lines read bottom-up (Mana Cost last); dsc2/dsc3 read top-down.
  const g = lines(d, 'dsc2', 5, ctx, key);
  const l = lines(d, 'desc', 6, ctx, key, { reverse: true });
  const s = lines(d, 'dsc3', 7, ctx, key);
  if (!g.length && !l.length && !s.length) {
    const extra = extraLines.get(key);
    if (extra) l.push(...extra.map(x => ({ t: x.y ? 74 : 13, a: x.text, x: x.x, ...(x.y ? { y: x.y } : {}) })));
    else l.push(...statLines(row, ctx));
    if (!l.length) l.push(...percentLifeLines(row));
    if (!l.length) l.push(...damageLines(row));
    if (!l.length) g.push(...missileLines(row, ctx));
    if (!l.length && !g.length) bump(report.noLines, ctx, e.d ? 'has a description' : 'no description');
  }
  if (g.length) e.g = g;
  if (l.length) e.l = l;
  if (s.length) e.s = s;
  const src = sourcesFor(key);
  if (src) e.src = src;
  return e;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const entries = [];
const classIds = new Set(classes.map(c => c.id));
for (const row of skillRows) {
  if (!classIds.has(row.charclass)) continue;
  const d = descByKey.get(row.skilldesc);
  if (!d || !(+d.SkillPage > 0) || hidden.has(row.skill.toLowerCase())) continue;
  entries.push(entryFor(row, row.charclass));
}
const classOrder = classes.map(c => c.id);
entries.sort((a, b) => classOrder.indexOf(a.c) - classOrder.indexOf(b.c) || a.tr - b.tr || a.row - b.row || a.col - b.col);

// Other skills: non-class skills that items grant with a visible oskill.
const other = [];
for (const key of sourcesBySkill.keys()) {
  const row = skillByKey.get(key);
  if (!row || row.charclass || hidden.has(key)) continue;
  const d = descByKey.get(row.skilldesc);
  if (!d || !str(d['str name'])) { bump(report.skippedOskills, `no description: ${row.skill}`, 'skilldesc'); continue; }
  other.push(entryFor(row, 'other'));
}
other.sort((a, b) => a.n.localeCompare(b.n));
entries.push(...other);

const withoutComments = o => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !k.startsWith('$')));

// Calc records for the shown skills, the basic skills and everything they reference
// through sklvl()/miss() or their description missiles.
const baseKeys = (rules.baseSkills || []).map(s => s.toLowerCase());
const db = { s: {}, m: {}, base: baseKeys, stats: rules.stats || {}, aliases: withoutComments(rules.tokenAliases) };
{
  const queue = [...new Set([...entries.map(e => e.k), ...baseKeys])];
  const refRe = /\b(sklvl|miss)\s*\(\s*'([^']+)'/gi;
  while (queue.length) {
    const key = queue.shift();
    if (db.s[key]) continue;
    const row = skillByKey.get(key);
    if (!row) continue;
    const rec = skillRecord(row, descByKey.get(row.skilldesc));
    db.s[key] = rec;
    const texts = formulas(rec);
    const entry = entries.find(e => e.k === key);
    if (entry) texts.push(...formulas([entry.g, entry.l, entry.s]));
    for (const m of rec.ms || []) texts.push(`miss('${m}'.x)`);
    for (const t of texts) {
      for (const m of t.matchAll(refRe)) {
        const target = m[2].toLowerCase();
        if (m[1].toLowerCase() === 'sklvl') { if (!db.s[target]) queue.push(target); continue; }
        const mr = missileByKey.get(target);
        if (mr && !db.m[target]) {
          db.m[target] = missileRecord(mr);
          for (const f of formulas(db.m[target])) for (const mm of f.matchAll(refRe)) {
            if (mm[1].toLowerCase() === 'sklvl') queue.push(mm[2].toLowerCase());
          }
        }
      }
    }
  }
}

// Synergies for the skill detail page: the class skills shown here that a skill's formulas
// read. sy: read by hard points (blvl, at most SYNERGY_POINTS); sl: only by level with +skills.
// Other references (item-effect skills like "Eschuta Temper Passive") stay at 0, and so a
// reference that only counts alongside one (Zap for Fire Ball) changes nothing and is dropped.
const SYNERGY_POINTS = rules.synergyPoints || 20;
{
  const idByKey = new Map();
  for (const e of entries) if (e.c !== 'other' && !idByKey.has(e.k)) idByKey.set(e.k, e.id);
  const plain = new SkillCalc.Calc(db, { ulvl: MAX_LEVEL });
  const texts = (calc, e) => [1, 20, MAX_LEVEL].flatMap(lvl => [...(e.g || []), ...(e.l || [])].map(line => calc.line(db.s[e.k], line, lvl))).join('\n');
  for (const e of entries) {
    const refs = SkillCalc.skillRefs(db, db.s[e.k], [e.g, e.l, e.s]);
    const sy = [], sl = [];
    const base = texts(plain, e);
    for (const [key, r] of Object.entries(refs)) {
      const id = idByKey.get(key);
      if (!id) continue;
      const levels = { [key]: { blvl: r.blvl ? SYNERGY_POINTS : 0, lvl: r.blvl ? SYNERGY_POINTS : MAX_LEVEL } };
      if (texts(new SkillCalc.Calc(db, { ulvl: MAX_LEVEL, levels }), e) === base) continue;
      (r.blvl ? sy : sl).push(id);
    }
    if (sy.length) e.sy = sy;
    if (sl.length) e.sl = sl;
    // Synergy lines name skills, but the detail page found nothing to adjust: the bonus works
    // through something the evaluator doesn't model (passive stats read back with stat()).
    const named = (e.s || []).filter(l => l.t === 76 || l.t === 79).map(l => l.b);
    if (e.c !== 'other' && named.length && !sy.length && !sl.length) bump(report.unmodelledSynergies, e.n, named.join(', '));
  }
}

// Validate: evaluate every line at every skill level, at the lowest and highest character level,
// with no synergies and with every synergy at its cap.
let evaluated = 0;
const keyById = new Map(entries.map(e => [e.id, e.k]));
for (const [ulvl, maxed] of [[1, false], [MAX_LEVEL, false], [MAX_LEVEL, true]]) {
  let current = '';
  const warn = (kind, detail) => bump(report.calcWarnings, `${kind}: ${detail}`, current);
  const plain = new SkillCalc.Calc(db, { ulvl, warn });
  for (const e of entries) {
    current = e.n;
    const rec = db.s[e.k];
    let calc = plain;
    if (maxed) {
      if (!e.sy && !e.sl) continue;
      const levels = {};
      for (const id of e.sy || []) levels[keyById.get(id)] = { blvl: SYNERGY_POINTS, lvl: SYNERGY_POINTS };
      for (const id of e.sl || []) levels[keyById.get(id)] = { blvl: 0, lvl: MAX_LEVEL };
      calc = new SkillCalc.Calc(db, { ulvl, warn, levels });
    }
    for (const line of [...(e.g || []), ...(e.l || []), ...(e.s || [])]) {
      for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
        const t = calc.line(rec, line, lvl);
        evaluated++;
        if (t != null && /%[+]?[ds]|NaN|undefined|Infinity/.test(t)) bump(report.badText, t, e.n);
        if (!SkillCalc.usesCalc(line)) break;
      }
    }
  }
}

for (const e of entries) report.classCounts.set(e.c, (report.classCounts.get(e.c) || 0) + 1);

// Skills whose card would say nothing about what they do: no skilldesc lines, no description,
// and nothing from the rules or the generic fallbacks. Not fatal; listed to be addressed later
// (add extraLines, a descriptions entry, a generic rule, or hideSkills).
const empty = entries.filter(e => !e.g && !e.l && !e.s && !e.d);
for (const e of empty) bump(report.emptySkills, `${e.n} (${e.k})`, e.src ? `${e.src.length} source(s)` : e.c);

const outClasses = classes.map(c => ({
  id: c.id, title: c.title,
  trees: c.trees.map((t, i) => ({ id: `${c.id}-tree-${i + 1}`, n: i + 1, title: t }))
    .filter(t => entries.some(e => e.c === c.id && e.tr === t.n)),
}));
if (other.length) outClasses.push({ id: 'other', title: rules.otherTitle || 'Other Skills', intro: rules.otherIntro });

const data = {
  generatedAt: new Date().toISOString(),
  source: crypto.createHash('sha1').update(skillText).update(readText(path.join(PATHS.excel, 'skilldesc.txt'))).digest('hex').slice(0, 12),
  lang: LANG,
  notes: rules.pageNotes || [],
  levels: { max: MAX_LEVEL, skill: rules.defaultSkillLevel || 20, character: rules.defaultCharacterLevel || MAX_LEVEL, synergy: SYNERGY_POINTS },
  classes: outClasses,
  skills: entries,
  db,
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
const json = JSON.stringify(data);
fs.writeFileSync(OUT_FILE, `/* Generated by scripts/build-skills.mjs - do not edit. */\nwindow.ESR_SKILL_DATA=${json};\n`);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const classLines = outClasses.map(c => `| ${c.title} | ${report.classCounts.get(c.id) || 0} |`);
const md = `## Skills generation (${LANG})

- Skills shown: **${entries.length}** (${other.length} other skills), calc records: **${Object.keys(db.s).length}** skills, **${Object.keys(db.m).length}** missiles
- Lines evaluated: **${evaluated.toLocaleString('en-US')}**, output: \`${path.relative(ROOT, OUT_FILE).replace(/\\/g, '/')}\` (${(json.length / 1024).toFixed(0)} KB)

| Class | Skills |
|---|---:|
${classLines.join('\n')}

${reportTable('Formula warnings (value taken as 0)', report.calcWarnings)}
${reportTable('Unknown description line types', report.unknownLineTypes)}
${reportTable('Unresolved strings', report.unresolvedStrings)}
${reportTable('Lines with unformatted text', report.badText, 50)}
${reportTable('Skipped oskills', report.skippedOskills)}
${reportTable('Lines hidden by rule', report.hiddenLines)}
${reportTable('Lines built from the stats a skill grants (no skilldesc lines)', report.statLines)}
${reportTable('Granted stats with no description', report.undescribedStats)}
${reportTable('Weapon-damage lines from the missile a skill fires (no skilldesc lines)', report.missileLines)}
${reportTable('Skills with no lines at all', report.noLines)}
${reportTable('Skills that show nothing (no lines, no description) - to be addressed', report.emptySkills)}
${reportTable('Skills whose synergy lines have no adjustable synergies on the detail page', report.unmodelledSynergies)}
${reportTable('"On striking" (class skills; unclear ones show nothing, set them in onStriking.skills)', report.onStriking)}
`;

if (typeof args.report === 'string') fs.writeFileSync(path.resolve(ROOT, args.report), md);
console.log(`skills: ${entries.length} skills (${other.length} other) -> ${path.relative(ROOT, OUT_FILE)} (${(json.length / 1024).toFixed(0)} KB)`);
for (const e of empty) console.warn(`warning: ${e.n} (${e.k}) has no description or lines; add extraLines, a descriptions entry or hideSkills in skill-rules.json`);
console.log(`  formula warnings: ${report.calcWarnings.size}, unknown line types: ${report.unknownLineTypes.size}, unresolved strings: ${report.unresolvedStrings.size}, unformatted lines: ${report.badText.size}`);

if (args.strict && (report.unknownLineTypes.size || report.unresolvedStrings.size || report.badText.size)) {
  console.error('strict: unknown line types, unresolved strings or unformatted lines present');
  process.exit(1);
}
