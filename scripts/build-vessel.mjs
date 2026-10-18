#!/usr/bin/env node
// Generates site/data/vessel-of-souls.<lang>.js from the Vessel of Souls rows in cubemain.txt.
//
// Usage:
//   node scripts/build-vessel.mjs [--esr=<path>] [--out=site] [--report=vessel-report.md] [--strict] [--lang=enUS]
//
// --esr points at a checkout of the Eastern_Sun_Resurrected repo (also settable with the
// ESR_REPO environment variable). It defaults to ../Eastern_Sun_Resurrected next to this repo.
//
// Rows are sorted into tiers by scripts/vessel-rules.json; items and mods are resolved with the
// same code and wording rules as the Cube Recipes page (scripts/lib/cube-resolve.mjs +
// scripts/cube-rules.json). No dependencies; requires Node 18+.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, gamePaths, requireTable, readText, tsvReader, loadStrings, reportTable, bump,
} from './lib/game-data.mjs';
import { createCubeResolver } from './lib/cube-resolve.mjs';

const args = parseArgs();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PATHS = gamePaths(args, ROOT);
const LANG = args.lang || 'enUS';
const OUT_FILE = path.join(path.resolve(ROOT, args.out || 'site'), 'data', `vessel-of-souls.${LANG}.js`);

requireTable(PATHS, 'cubemain.txt');

const readTsv = tsvReader(PATHS.excel);
const rules = JSON.parse(readText(path.join(HERE, 'vessel-rules.json')));
const cubeRules = JSON.parse(readText(path.join(HERE, 'cube-rules.json')));
const str = loadStrings(PATHS.strings, LANG, ['item-names.json', 'item-runes.json', 'item-modifiers.json', 'item-nameaffixes.json', 'skills.json']);

const report = {
  unresolvedTokens: new Map(),
  unresolvedProps: new Map(),
  unhandledConditions: new Map(),
  hiddenByRule: new Map(),
  unmatchedLimits: new Map(),
  sectionCounts: new Map(),
};
const R = createCubeResolver({ readTsv, str, rules: cubeRules, report });

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const compiled = (rules.rules || []).map(r => ({ ...r, re: new RegExp(r.match, r.flags ?? 'i') }));
const sections = rules.sections || [];
const sectionIds = new Set(sections.map(s => s.id));
const hiddenMods = new Set(rules.hiddenMods || []);
const expand = (t, m) => String(t).replace(/\$(\d)/g, (_, i) => m[i] ?? '').toLowerCase().trim();
// "Vessel of Souls Tier 2 - str" / "… - hit-skill 12" -> "tier2 - str" / "tier2 - hit-skill"
const recipeKey = desc => {
  const m = desc.match(/Tier (\d+) - (.+?)\s*\d*$/i);
  return m ? `tier${m[1]} - ${m[2]}`.toLowerCase() : null;
};

// The vessel's starting souls come from its uniqueitems.txt row.
let startSouls = null;
for (const u of readTsv('uniqueitems.txt')) {
  if (u.index !== 'Vessel of Souls') continue;
  for (let i = 1; i <= 12; i++) if (u[`prop${i}`] === 'soul-counter') startSouls = +u[`max${i}`] || +u[`min${i}`];
}

// ---------------------------------------------------------------------------
// Rows -> recipes
// ---------------------------------------------------------------------------

// A copy of the row without the bookkeeping mods (soul counter, flavor text flags).
function withoutHiddenMods(row) {
  const copy = { ...row };
  for (const p of ['', 'b ', 'c ']) {
    for (let i = 1; i <= 5; i++) if (hiddenMods.has(copy[`${p}mod ${i}`])) copy[`${p}mod ${i}`] = '';
  }
  return copy;
}

function soulCost(row) {
  for (let i = 1; i <= 5; i++) {
    if (row[`mod ${i}`] === 'soul-counter') return -(+row[`mod ${i} min`] || 0);
  }
  return 0;
}

function input(raw, desc) {
  const it = R.parseInput(raw, desc);
  const code = R.splitToken(raw)[0];
  const col = rules.itemColors?.[code];
  if (it && col) it.col = col;
  return it;
}

const cubeRows = readTsv('cubemain.txt');
const limits = new Map(); // recipe key -> times
const recipes = new Map(); // merge key -> recipe
let considered = 0;

for (const row of cubeRows) {
  if (row.enabled !== '1') continue;
  const desc = row.description || '';
  const rule = compiled.find(r => r.re.test(desc));
  if (!rule) continue;
  considered++;
  const m = desc.match(rule.re);
  if (rule.hide) { bump(report.hiddenByRule, rule.why || rule.match, desc); continue; }
  if (rule.limit) { limits.set(expand(rule.limit, m), +expand(rule.times, m)); continue; }

  const section = expand(rule.section, m);
  if (!sectionIds.has(section)) throw new Error(`rule ${JSON.stringify(rule.match)} references unknown section "${section}"`);
  const group = rule.group ? expand(rule.group, m) : '';
  const clean = withoutHiddenMods(row);
  const inputs = [];
  for (let i = 1; i <= 7; i++) if (row[`input ${i}`]) inputs.push(input(row[`input ${i}`], desc));
  const outputs = ['', 'b ', 'c '].map(p => R.outputSet(clean, p)).filter(Boolean);

  const key = JSON.stringify([section, group, inputs, outputs]);
  let r = recipes.get(key);
  if (!r) {
    r = { section, group, i: inputs, o: outputs, line: row._line, key: recipeKey(desc), ops: new Set(), need: null, req: [] };
    if (rule.outcome) r.name = m[1];
    const cost = soulCost(row);
    if (cost) r.cost = cost;
    recipes.set(key, r);
  }
  // Soul conditions: souls > N and souls = N rows merge into "at least N".
  const stat = R.statsById.get(row.param)?.Stat;
  if (stat === rules.soulStat) {
    r.ops.add(row.op);
    r.need = +row.value;
  } else if (!rule.outcome) {
    const c = R.describeCondition(row);
    if (c && !r.req.includes(c)) r.req.push(c);
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const fill = (t, vars) => String(t).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const mostCommon = values => {
  const counts = new Map();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
function needText(r) {
  if (r.need == null) return null;
  const t = rules.conditionText;
  let kind = r.ops.has('15') && r.ops.has('18') ? 'atLeast' : r.ops.has('18') ? 'exactly' : 'moreThan';
  if (kind === 'exactly' && r.need === 0 && t.none) kind = 'none';
  return { kind, text: fill(t[kind], { souls: `${r.need} soul${r.need === 1 ? '' : 's'}` }) };
}

const usedLimits = new Set();
const outSections = [];
for (const s of sections) {
  const list = [...recipes.values()].filter(r => r.section === s.id).sort((a, b) => a.line - b.line);
  if (!list.length) continue;
  const cost = mostCommon(list.map(r => r.cost));
  const needs = list.map(r => needText(r)?.text);
  const need = mostCommon(needs);
  // A requirement shared by most of the section goes in its header; recipes only show exceptions.
  const shared = need && needs.filter(n => n === need).length > list.length / 2 ? need : null;
  const groupIds = [...new Set(list.map(r => r.group))];
  const groups = groupIds.map(g => ({
    id: g ? `${s.id}-${g.replace(/[^a-z0-9]+/g, '-')}` : s.id + '-all',
    t: g ? (rules.groupTitles?.[g] || g) : null,
    v: list.filter(r => r.group === g).map(r => {
      const out = { i: r.i, o: r.o };
      if (r.name) out.n = r.name;
      if (r.cost && (r.cost !== cost || s.id === 'tier4')) out.cost = r.cost;
      const n = needText(r);
      const req = [...r.req];
      if (n && n.text !== shared) req.unshift(n.text);
      const times = r.key && limits.get(r.key);
      if (times) {
        usedLimits.add(r.key);
        req.push(fill(rules.limitText[times] || rules.limitText.default, { times }));
      }
      if (req.length) out.r = req;
      return out;
    }),
  }));
  const sec = { id: s.id, title: s.title, groups };
  if (s.intro) sec.intro = fill(s.intro, { cost: cost ?? '', souls: startSouls ?? '' });
  if (shared) sec.need = shared;
  outSections.push(sec);
  report.sectionCounts.set(s.id, list.length);
}
for (const k of limits.keys()) if (!usedLimits.has(k)) bump(report.unmatchedLimits, k, 'no recipe with this key');

const data = {
  generatedAt: new Date().toISOString(),
  source: crypto.createHash('sha1').update(readText(path.join(PATHS.excel, 'cubemain.txt'))).digest('hex').slice(0, 12),
  lang: LANG,
  intro: (rules.intro || []).map(p => fill(p, { souls: startSouls ?? '' })),
  sections: outSections,
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
const json = JSON.stringify(data);
fs.writeFileSync(OUT_FILE, `/* Generated by scripts/build-vessel.mjs - do not edit. */\nwindow.ESR_VESSEL_DATA=${json};\n`);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const total = [...report.sectionCounts.values()].reduce((a, b) => a + b, 0);
const md = `## Vessel of Souls generation (${LANG})

- Rows matched: **${considered}**, recipes shown: **${total}**, usage limits: **${limits.size}**, starting souls: **${startSouls ?? 'unknown'}**
- Output: \`${path.relative(ROOT, OUT_FILE).replace(/\\/g, '/')}\` (${(json.length / 1024).toFixed(0)} KB)

| Section | Recipes |
|---|---:|
${outSections.map(s => `| ${s.title} | ${report.sectionCounts.get(s.id)} |`).join('\n')}

${reportTable('Unresolved item tokens', report.unresolvedTokens)}
${reportTable('Unresolved properties (mods omitted)', report.unresolvedProps)}
${reportTable('Conditions without text (omitted)', report.unhandledConditions)}
${reportTable('Usage limits that match no recipe', report.unmatchedLimits)}
${reportTable('Hidden by rule', report.hiddenByRule, 100)}
`;

if (typeof args.report === 'string') fs.writeFileSync(path.resolve(ROOT, args.report), md);
console.log(`vessel of souls: ${total} recipes in ${outSections.length} sections -> ${path.relative(ROOT, OUT_FILE)} (${(json.length / 1024).toFixed(0)} KB)`);
console.log(`  unresolved tokens: ${report.unresolvedTokens.size}, unresolved props: ${report.unresolvedProps.size}, conditions w/o text: ${report.unhandledConditions.size}, unmatched limits: ${report.unmatchedLimits.size}`);

if (args.strict && (report.unresolvedTokens.size || report.unresolvedProps.size || report.unmatchedLimits.size || startSouls == null)) {
  console.error('strict: unresolved tokens or properties, unmatched usage limits, or unknown starting souls');
  process.exit(1);
}
