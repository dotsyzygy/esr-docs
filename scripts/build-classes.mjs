#!/usr/bin/env node
// Generates site/data/classes.<lang>.js: class mechanics that the Skills page can't show.
// So far: the Warlock's Consume, whose bonus depends on the demon consumed (monpet.txt).
//
// Usage:
//   node scripts/build-classes.mjs [--esr=<path>] [--out=site] [--report=classes-report.md] [--strict] [--lang=enUS]
//
// --esr points at a checkout of the Eastern_Sun_Resurrected repo (also settable with the
// ESR_REPO environment variable). It defaults to ../Eastern_Sun_Resurrected next to this repo.
//
// Effects keep the game's own formulas; site/assets/skill-calc.js evaluates them here (to
// validate every line at every Consume level) and again in the browser (for the chosen Consume
// level and Consume Effect bonus). Presentation choices are in scripts/class-rules.json.
// No dependencies; requires Node 18+.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, gamePaths, requireTable, readText, tsvReader, loadStrings, CLASS_NAMES, reportTable, bump,
} from './lib/game-data.mjs';
import { createStatTemplate, statTextMap } from './lib/stat-text.mjs';

const args = parseArgs();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PATHS = gamePaths(args, ROOT);
const LANG = args.lang || 'enUS';
const OUT_FILE = path.join(path.resolve(ROOT, args.out || 'site'), 'data', `classes.${LANG}.js`);
const rules = JSON.parse(readText(path.join(HERE, 'class-rules.json')));
const SkillCalc = createRequire(import.meta.url)(path.join(ROOT, 'site', 'assets', 'skill-calc.js'));

requireTable(PATHS, 'monpet.txt');

const readTsv = tsvReader(PATHS.excel);
const str = loadStrings(PATHS.strings, LANG, ['skills.json', 'item-modifiers.json', 'monsters.json', 'item-names.json']);

const report = {
  undescribedStats: new Map(),
  calcWarnings: new Map(),
  badText: new Map(),
  unnamed: new Map(),
  hidden: new Map(),
  sectionCounts: new Map(),
};

const n = v => (v === '' || v == null ? 0 : +v);
const statByKey = new Map(readTsv('itemstatcost.txt').map(r => [r.Stat.toLowerCase(), r]));
const statTemplate = createStatTemplate(statByKey, str);
const statText = statTextMap(rules.statText);
const skillRows = readTsv('skills.txt');
const skillByKey = new Map(skillRows.map(r => [r.skill.toLowerCase(), r]));
const descByKey = new Map(readTsv('skilldesc.txt').map(d => [d.skilldesc, d]));
const skillName = row => str(descByKey.get(row.skilldesc)?.['str name']) || row.skill;

// ---------------------------------------------------------------------------
// The Consume skill: the record skill-calc.js evaluates, and its own (every demon) bonus
// ---------------------------------------------------------------------------

const consumeRow = skillByKey.get(rules.consume.skill.toLowerCase());
const bindRow = skillByKey.get(rules.consume.bindSkill.toLowerCase());
if (!consumeRow || !bindRow) throw new Error(`skills.txt has no ${rules.consume.skill} or ${rules.consume.bindSkill}`);

function skillRecord(row) {
  const trim = a => { while (a.length && (a[a.length - 1] === '' || a[a.length - 1] === 0)) a.pop(); return a; };
  const rec = { k: row.skill.toLowerCase() };
  if (row.maxlvl) rec.mx = +row.maxlvl;
  rec.p = trim(Array.from({ length: 20 }, (_, i) => n(row[`Param${i + 1}`])));
  rec.c = trim(Array.from({ length: 10 }, (_, i) => row[`calc${i + 1}`] || ''));
  rec.as = trim(Array.from({ length: 6 }, (_, i) => row[`aurastatcalc${i + 1}`] || ''));
  if (row.auralencalc) rec.len = row.auralencalc;
  if (row.mana || row.lvlmana || row.minmana) {
    rec.mn = [n(row.mana), n(row.lvlmana), row.manashift === '' ? null : n(row.manashift), n(row.minmana)];
  }
  return rec;
}
const consume = skillRecord(consumeRow);

// skilldesc lines of Consume itself (duration, life and mana, attributes); the pet-bonus line
// that only says "plus a bonus from the demon" is what the rest of the page spells out.
function descLines(row) {
  const d = descByKey.get(row.skilldesc) || {};
  const out = [];
  for (let i = 1; i <= 6; i++) {
    const t = +d[`descline${i}`];
    if (!t) continue;
    const line = { t, a: str(d[`desctexta${i}`], { keepLines: true }) || '', b: str(d[`desctextb${i}`], { keepLines: true }) || '' };
    if (d[`desccalca${i}`]) line.x = d[`desccalca${i}`];
    if (d[`desccalcb${i}`]) line.y = d[`desccalcb${i}`];
    out.push(line);
  }
  // Stored bottom line first, like the game's tooltip.
  return out.reverse();
}

// ---------------------------------------------------------------------------
// Demons: monpet.txt rows, named from monstats.txt or superuniques.txt
// ---------------------------------------------------------------------------

const monstats = new Map(readTsv('monstats.txt').map(m => [m.Id, m]));
const superuniques = new Map(readTsv('superuniques.txt').map(s => [s.Superunique, s]));
const hideMonsters = new Set(rules.hideMonsters || []);

// Monsters the Warlock summons: the `summon` column of the class's skills.
const warSummons = new Map();
for (const r of skillRows) {
  if (r.charclass === rules.consume.class && r.summon) warSummons.set(r.summon, skillName(r));
}

// A sksrc('Bind Demon'.clcN) condition in the bind calcs means the demon can only be bound with
// a stat, given by an item (the elite Warlock books): Bind Demon's calcN is stat('x'.accr)>0.
// clc0 is calc10 (the token has one digit).
const propByStat = new Map(readTsv('properties.txt').map(p => [p.stat1, p.code]));
const uniqueByProp = new Map();
for (const u of readTsv('uniqueitems.txt')) {
  for (let i = 1; i <= 12; i++) if (u[`prop${i}`] && !uniqueByProp.has(u[`prop${i}`])) uniqueByProp.set(u[`prop${i}`], u.index);
}
function bindRequirement(p) {
  const m = /sksrc\('[^']+'\.clc(\d)\)/i.exec([p.calc1, p.calc2, p.calc3, p.calc4, p.calc5].join(' '));
  if (!m) return null;
  const calc = bindRow[`calc${+m[1] || 10}`] || '';
  const stat = /stat\('([^']+)'/.exec(calc)?.[1];
  const item = uniqueByProp.get(propByStat.get(stat));
  if (!item) { bump(report.unnamed, `bind requirement ${calc}`, p.monster); return null; }
  return str(item) || item;
}

// sksrc('Consume'.x) is the consuming skill's own value; skill-calc reads that as skill('consume'.x).
const consumeRef = new RegExp(`sksrc\\('${rules.consume.skill}'\\.`, 'gi');
const toCalc = f => String(f).replace(consumeRef, `skill('${consume.k}'.`).replace(new RegExp(`skill\\('${consume.k}'\\.lvl\\)`, 'g'), 'lvl');

// class-rules.json calcText: a stat whose formula reads something the page can't know (the
// player's max Life for Mephisto's regen) gets fixed text, matched on the formula.
const calcText = (rules.calcText || []).map(r => ({ ...r, re: new RegExp(r.match, 'i') }));

/* One line per stat, worded like the stat on an item. statText (class-rules.json) rewords a stat:
   { text | string, x, with: [stat2, stat3], y, z, hide }. `with` folds other stats of the same
   demon into the line (min + max damage + length -> "Adds 75-100 Cold Damage"); x/y/z are calc
   templates over the stats' values {1} {2} {3}, defaulting to {1}, {2} and {3}. */
function effectLines(p, context) {
  const stats = new Map();
  for (let i = 1; i <= 5; i++) {
    if (p[`consumestat${i}`]) stats.set(p[`consumestat${i}`].toLowerCase(), toCalc(p[`consumecalc${i}`]));
  }
  const used = new Set();
  const out = [];
  for (const [stat, calc] of stats) {
    if (used.has(stat)) continue;
    const fixed = calcText.find(r => r.re.test(calc));
    if (fixed) { out.push({ t: 18, a: fixed.text }); continue; }
    const over = statText.get(stat);
    if (over?.hide) continue;
    const partners = (over?.with || []).map(s => s.toLowerCase());
    const whole = partners.every(s => stats.has(s));
    const a = (whole && over && (over.text || str(over.string))) || statTemplate(stat);
    if (!a) { bump(report.undescribedStats, stat, context); continue; }
    if (!a.includes('%')) { out.push({ t: 18, a }); continue; }
    const vals = [calc, ...(whole ? partners.map(s => stats.get(s)) : [])];
    const tmpl = (t, d) => (t || d).replace(/\{(\d)\}/g, (_, k) => `(${vals[k - 1] ?? 0})`);
    const line = { t: 74, a, x: tmpl(over?.x, '{1}') };
    if (whole && partners.length) {
      partners.forEach(s => used.add(s));
      line.y = tmpl(over.y, '{2}');
      if (partners.length > 1) line.z = tmpl(over.z, '{3}');
    }
    out.push(line);
  }
  return out;
}

function section(p, m, su) {
  if (!p.bindchancecalc) return warSummons.has(p.monster) ? 'summons' : null;
  if (su) return 'superuniques';
  if (m?.boss === '1') return 'bosses';
  return 'monsters';
}

const effects = new Map(); // section + lines -> effect
for (const p of readTsv('monpet.txt')) {
  const m = monstats.get(p.monster), su = superuniques.get(p.monster);
  const name = str(su ? su.Name : m?.NameStr) || null;
  if (hideMonsters.has(p.monster)) { bump(report.hidden, p.monster, 'hideMonsters'); continue; }
  if (!p.consumestat1) { bump(report.hidden, p.monster, 'no consume effect'); continue; }
  const sec = section(p, m, su);
  if (!sec) { bump(report.hidden, p.monster, 'not bindable and not a Warlock summon'); continue; }
  if (!name) { bump(report.unnamed, p.monster, p['*monster name']); continue; }
  const lines = effectLines(p, name);
  if (!lines.length) continue;
  const key = JSON.stringify([sec, lines]);
  let e = effects.get(key);
  if (!e) effects.set(key, e = { sec, id: p.monster, l: lines, m: [], line: p._line });
  const who = { n: name };
  const req = bindRequirement(p);
  if (req) who.r = req;
  if (sec === 'summons') who.r = warSummons.get(p.monster);
  if (!e.m.some(x => x.n === who.n && x.r === who.r)) e.m.push(who);
}

// ---------------------------------------------------------------------------
// Validate: every line at Consume levels 1-max, with and without a Consume Effect bonus
// ---------------------------------------------------------------------------

const MAX_LEVEL = rules.maxLevel || 60;
const db = { s: { [consume.k]: consume }, m: {}, stats: {}, aliases: {} };
const base = descLines(consumeRow);
let evaluated = 0;
for (const bonus of [0, 100]) {
  let current = '';
  const calc = new SkillCalc.Calc(db, { warn: (kind, detail) => bump(report.calcWarnings, `${kind}: ${detail}`, current) });
  calc.stats = { consumeeffect: bonus };
  const check = (line, ctx) => {
    current = ctx;
    for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
      const t = calc.line(consume, line, lvl);
      evaluated++;
      if (t != null && /%[+]?[ds]|NaN|undefined|Infinity/.test(t)) bump(report.badText, t, ctx);
    }
  };
  for (const l of base) check(l, 'Consume');
  for (const e of effects.values()) for (const l of e.l) check(l, e.m[0].n);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const sections = rules.consume.sections.map(s => {
  const list = [...effects.values()].filter(e => e.sec === s.id).sort((a, b) => a.line - b.line);
  report.sectionCounts.set(s.id, list.length);
  return { id: s.id, title: s.title, intro: s.intro, effects: list.map(({ id, l, m }) => ({ id, l, m })) };
}).filter(s => s.effects.length);

const fill = (t, vars) => String(t).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const names = { consume: skillName(consumeRow), bind: skillName(bindRow) };
const data = {
  generatedAt: new Date().toISOString(),
  source: crypto.createHash('sha1').update(readText(path.join(PATHS.excel, 'monpet.txt'))).update(readText(path.join(PATHS.excel, 'skills.txt'))).digest('hex').slice(0, 12),
  lang: LANG,
  classes: [{
    id: rules.consume.class,
    title: CLASS_NAMES[rules.consume.class],
    consume: {
      title: names.consume,
      intro: (rules.consume.intro || []).map(t => fill(t, names)),
      levels: { max: MAX_LEVEL, def: rules.defaultLevel || 20, maxSkill: consume.mx || null },
      base,
      sections,
    },
  }],
  db,
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
const json = JSON.stringify(data);
fs.writeFileSync(OUT_FILE, `/* Generated by scripts/build-classes.mjs - do not edit. */\nwindow.ESR_CLASS_DATA=${json};\n`);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const total = [...report.sectionCounts.values()].reduce((a, b) => a + b, 0);
const demons = [...effects.values()].reduce((a, e) => a + e.m.length, 0);
const md = `## Classes generation (${LANG})

- Consume effects: **${total}** (${demons} demons), lines evaluated: **${evaluated.toLocaleString('en-US')}**
- Output: \`${path.relative(ROOT, OUT_FILE).replace(/\\/g, '/')}\` (${(json.length / 1024).toFixed(0)} KB)

| Section | Effects |
|---|---:|
${rules.consume.sections.map(s => `| ${s.title} | ${report.sectionCounts.get(s.id) || 0} |`).join('\n')}

${reportTable('Consume stats with no description (line omitted)', report.undescribedStats)}
${reportTable('Formula warnings (value taken as 0)', report.calcWarnings)}
${reportTable('Lines with unformatted text', report.badText, 50)}
${reportTable('Monsters with no name (omitted)', report.unnamed)}
${reportTable('Hidden monsters', report.hidden, 100)}
`;

if (typeof args.report === 'string') fs.writeFileSync(path.resolve(ROOT, args.report), md);
console.log(`classes: ${total} consume effects (${demons} demons) -> ${path.relative(ROOT, OUT_FILE)} (${(json.length / 1024).toFixed(0)} KB)`);
console.log(`  undescribed stats: ${report.undescribedStats.size}, formula warnings: ${report.calcWarnings.size}, unformatted lines: ${report.badText.size}, unnamed: ${report.unnamed.size}`);

if (args.strict && (report.undescribedStats.size || report.calcWarnings.size || report.badText.size || report.unnamed.size)) {
  console.error('strict: undescribed stats, formula warnings, unformatted lines or unnamed monsters present');
  process.exit(1);
}
