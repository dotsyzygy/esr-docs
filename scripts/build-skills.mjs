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
// Where items grant skills as oskills
// ---------------------------------------------------------------------------

const range = (min, max) => {
  const a = +min || 0, b = max === '' || max == null ? a : +max;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return lo === hi ? `+${lo}` : `+${lo}-${hi}`;
};

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

const oskillProps = new Set(rules.oskillProperties || ['oskill']);
const sourcesBySkill = new Map(); // skill key -> Map(dedupe key -> source)
for (const spec of SOURCES) {
  if (!fs.existsSync(path.join(PATHS.excel, spec.file))) continue;
  for (const r of readTsv(spec.file)) {
    if (spec.enabled && !spec.enabled(r)) continue;
    for (const [code, param, min, max] of spec.slots) {
      if (!oskillProps.has(r[code])) continue;
      const row = lookupSkill(r[param]);
      if (!row) { bump(report.skippedOskills, `unknown skill ${r[param]}`, spec.file); continue; }
      const key = row.skill.toLowerCase();
      const src = spec.cube ? { k: spec.kind } : { k: spec.kind, n: spec.name(r), v: range(r[min], r[max]) };
      if (!spec.cube && !src.n) continue;
      const m = sourcesBySkill.get(key) || new Map();
      const dk = JSON.stringify(src);
      if (m.has(dk)) { if (spec.cube) m.get(dk).c = (m.get(dk).c || 1) + 1; } else m.set(dk, src);
      sourcesBySkill.set(key, m);
    }
  }
}
const SOURCE_ORDER = SOURCES.map(s => s.kind);
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

const n = v => (v === '' || v == null ? 0 : +v || 0);
const trimEnd = arr => { let e = arr.length; while (e && (arr[e - 1] === 0 || arr[e - 1] === '')) e--; return arr.slice(0, e); };
const nonEmpty = arr => arr.some(v => v !== 0 && v !== '');

function damageColumns(row, minCol, minLev, maxCol, maxLev) {
  return [n(row[minCol]), ...slots(5, i => n(row[`${minLev}${i}`])), n(row[maxCol]), ...slots(5, i => n(row[`${maxLev}${i}`]))];
}

function skillRecord(row) {
  const d = descByKey.get(row.skilldesc) || {};
  const rec = { k: row.skill.toLowerCase() };
  if (row.maxlvl) rec.mx = +row.maxlvl;
  const p = trimEnd(slots(20, i => n(row[`Param${i}`])));
  if (p.length) rec.p = p;
  const c = trimEnd(slots(10, i => row[`calc${i}`] || ''));
  if (c.length) rec.c = c;
  const as = trimEnd(slots(6, i => row[`aurastatcalc${i}`] || ''));
  if (as.length) rec.as = as;
  const ps = trimEnd(slots(14, i => row[`passivecalc${i}`] || ''));
  if (ps.length) rec.ps = ps;
  if (row.auralencalc) rec.len = row.auralencalc;
  if (row.aurarangecalc) rec.rng = row.aurarangecalc;
  if (row.petmax) rec.pet = row.petmax;
  if (row.mana || row.lvlmana || row.minmana) {
    rec.mn = [n(row.mana), n(row.lvlmana), row.manashift === '' ? null : n(row.manashift), n(row.minmana)];
  }
  if (row.ToHit || row.LevToHit) rec.th = [n(row.ToHit), n(row.LevToHit)];
  if (row.HitShift !== '') rec.hs = n(row.HitShift);
  const pd = damageColumns(row, 'MinDam', 'MinLevDam', 'MaxDam', 'MaxLevDam');
  if (nonEmpty(pd)) rec.pd = pd;
  if (row.DmgSymPerCalc) rec.psym = row.DmgSymPerCalc;
  const ed = damageColumns(row, 'EMin', 'EMinLev', 'EMax', 'EMaxLev');
  if (nonEmpty(ed)) rec.ed = ed;
  if (row.EDmgSymPerCalc) rec.esym = row.EDmgSymPerCalc;
  const el = [n(row.ELen), ...slots(3, i => n(row[`ELevLen${i}`]))];
  if (nonEmpty(el)) rec.el = el;
  if (row.ELenSymPerCalc) rec.lsym = row.ELenSymPerCalc;
  const ms = slots(3, i => (d[`descmissile${i}`] || '').toLowerCase());
  if (ms.some(Boolean)) rec.ms = trimEnd(ms);
  return rec;
}

function missileRecord(row) {
  const rec = { k: row.Missile.toLowerCase() };
  if (row.Range) rec.r = n(row.Range);
  if (row.Radius) rec.rad = n(row.Radius);
  const p = trimEnd(slots(5, i => n(row[`Param${i}`])));
  if (p.length) rec.p = p;
  if (row.HitShift !== '') rec.hs = n(row.HitShift);
  const pd = damageColumns(row, 'MinDamage', 'MinLevDam', 'MaxDamage', 'MaxLevDam');
  if (nonEmpty(pd)) rec.pd = pd;
  if (row.DmgSymPerCalc) rec.psym = row.DmgSymPerCalc;
  const ed = damageColumns(row, 'EMin', 'MinELev', 'EMax', 'MaxELev');
  if (nonEmpty(ed)) rec.ed = ed;
  if (row.EDmgSymPerCalc) rec.esym = row.EDmgSymPerCalc;
  const el = [n(row.ELen), ...slots(3, i => n(row[`ELevLen${i}`]))];
  if (nonEmpty(el)) rec.el = el;
  return rec;
}

// Every formula string in a record (or line list), for following references.
function formulas(obj) {
  const out = [];
  (function walk(v) {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  })(obj);
  return out;
}

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
  // Descriptions are hard-wrapped for the tooltip; rejoin a line that continues a sentence
  // (starts lowercase), keep breaks before lines that start a new one.
  const desc = text(d['str long'] || d['str short'], name).replace(/\n(?=[a-z])/g, ' ');
  if (desc && desc !== d['str long']) e.d = desc;
  const ctx = `${name} (${row.skill})`;
  // In-game, the per-level desc lines read bottom-up (Mana Cost last); dsc2/dsc3 read top-down.
  const g = lines(d, 'dsc2', 5, ctx, key);
  const l = lines(d, 'desc', 6, ctx, key, { reverse: true });
  const s = lines(d, 'dsc3', 7, ctx, key);
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
    const rec = skillRecord(row);
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

// Validate: evaluate every line at every skill level, at the lowest and highest character level.
let evaluated = 0;
for (const ulvl of [1, MAX_LEVEL]) {
  let current = '';
  const calc = new SkillCalc.Calc(db, { ulvl, warn: (kind, detail) => bump(report.calcWarnings, `${kind}: ${detail}`, current) });
  for (const e of entries) {
    current = e.n;
    const rec = db.s[e.k];
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
  levels: { max: MAX_LEVEL, skill: rules.defaultSkillLevel || 20, character: rules.defaultCharacterLevel || MAX_LEVEL },
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
`;

if (typeof args.report === 'string') fs.writeFileSync(path.resolve(ROOT, args.report), md);
console.log(`skills: ${entries.length} skills (${other.length} other) -> ${path.relative(ROOT, OUT_FILE)} (${(json.length / 1024).toFixed(0)} KB)`);
console.log(`  formula warnings: ${report.calcWarnings.size}, unknown line types: ${report.unknownLineTypes.size}, unresolved strings: ${report.unresolvedStrings.size}, unformatted lines: ${report.badText.size}`);

if (args.strict && (report.unknownLineTypes.size || report.unresolvedStrings.size || report.badText.size)) {
  console.error('strict: unknown line types, unresolved strings or unformatted lines present');
  process.exit(1);
}
