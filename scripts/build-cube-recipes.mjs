#!/usr/bin/env node
// Generates site/data/cube-recipes.<lang>.js from the mod's cubemain.txt.
//
// Usage:
//   node scripts/build-cube-recipes.mjs [--esr=<path>] [--out=site] [--report=cube-report.md] [--strict] [--lang=enUS]
//
// --esr points at a checkout of the Eastern_Sun_Resurrected repo (also settable with the
// ESR_REPO environment variable). It defaults to ../Eastern_Sun_Resurrected next to this repo.
//
// Codes in cubemain.txt are resolved through the other excel tables
// (misc/armor/weapons/itemtypes/uniqueitems/setitems/properties/itemstatcost/
// skills/skilldesc) into strings from data/local/lng/strings/*.json.
// Categorisation, hiding and grouping are driven by scripts/cube-rules.json.
// No dependencies; requires Node 18+.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, gamePaths, requireTable, readText, tsvReader, loadStrings,
  reportTable as table, bump,
} from './lib/game-data.mjs';
import { createCubeResolver } from './lib/cube-resolve.mjs';

const args = parseArgs();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PATHS = gamePaths(args, ROOT);
const EXCEL = PATHS.excel;
const RULES_FILE = path.join(HERE, 'cube-rules.json');
const LANG = args.lang || 'enUS';
const OUT_FILE = path.join(path.resolve(ROOT, args.out || 'site'), 'data', `cube-recipes.${LANG}.js`);

requireTable(PATHS, 'cubemain.txt');

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const readTsv = tsvReader(EXCEL);
const rules = JSON.parse(readText(RULES_FILE));

// String tables: earlier files win when a key is duplicated.
const STRING_PRIORITY = ['item-names.json', 'item-runes.json', 'item-modifiers.json', 'item-nameaffixes.json', 'skills.json'];
const str = loadStrings(PATHS.strings, LANG, STRING_PRIORITY);

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

const report = {
  unresolvedTokens: new Map(),
  unresolvedProps: new Map(),
  unhandledConditions: new Map(),
  hiddenByRule: new Map(),
  uncategorized: new Map(),
  categoryCounts: new Map(),
};

const {
  items, itemTypes, uniques, setItems, statsById, skillName, CLASS_NAMES, DIFFICULTY, QUALITY, typeName, resolveItem, splitToken, parseInput, parseOutput, describeMod, parseMods, describeCondition, outputSet,
} = createCubeResolver({ readTsv, str, rules, report });

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const compiledRules = (rules.rules || []).map((r, i) => ({ ...r, i, re: new RegExp(r.match, r.flags ?? 'i') }));
const categories = rules.categories || [];
const categoryIds = new Set(categories.map(c => c.id));

function normalizeDescription(desc) {
  let d = desc;
  for (const [pattern, repl] of rules.titleReplacements || []) d = d.replace(new RegExp(pattern, 'g'), repl);
  let prev;
  do {
    prev = d;
    d = d.replace(/\s*\([^()]*\)\s*$/, '').replace(/[\s:_-]*\d+\s*$/, '').trim();
  } while (d !== prev);
  return d.replace(/\s{2,}/g, ' ').trim();
}

// Descriptions often end with the ingredients ("Cow Portal: Club + 1 TP Tome"), which can be
// stale and repeat the card's real input list, so that suffix is dropped. Shorthand is then expanded.
const ingredientSuffix = rules.ingredientSuffix ? new RegExp(rules.ingredientSuffix) : null;
const titleAbbreviations = (rules.titleAbbreviations || []).map(([p, r]) => [new RegExp(p, 'g'), r]);

function finalizeTitle(title) {
  let t = title.replace(/[\s:]+$/, '');
  const cut = t.lastIndexOf(': ');
  if (ingredientSuffix && cut > 0) {
    const suffix = t.slice(cut + 2);
    // "A + B = Result" / "A + B -> Result": keep just the result.
    const result = suffix.split(/\s+(?:=|->)\s+/);
    if (result.length > 1) t = `${t.slice(0, cut)}: ${result[result.length - 1]}`;
    else if (ingredientSuffix.test(suffix)) t = t.slice(0, cut);
  } else if (ingredientSuffix) {
    const m = t.match(/^(.+\+.+?)\s+(?:=|->)\s+(.+)$/);
    if (m) t = m[2];
  }
  for (const [re, repl] of titleAbbreviations) t = t.replace(re, repl);
  return t.replace(/\s{2,}/g, ' ').trim();
}


// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const cubeText = readText(path.join(EXCEL, 'cubemain.txt'));
const baseCube = path.join(EXCEL, 'base', 'cubemain.txt');
if (fs.existsSync(baseCube) && readText(baseCube) !== cubeText) {
  console.warn('warning: excel/cubemain.txt and excel/base/cubemain.txt differ; using excel/cubemain.txt');
}
const cubeRows = readTsv('cubemain.txt');

// Rows that use a removed item (by item type, e.g. Gem Cans) are dropped entirely.
const hiddenTypes = new Set(rules.hideItemTypes || []);
function usesHiddenType(row) {
  if (!hiddenTypes.size) return null;
  const cols = ['input 1', 'input 2', 'input 3', 'input 4', 'input 5', 'input 6', 'input 7', 'output', 'output b', 'output c'];
  for (const c of cols) {
    const code = splitToken(row[c] || '')[0];
    if (!code) continue;
    if (hiddenTypes.has(code)) return code;
    const it = items.get(code);
    if (it && hiddenTypes.has(it.type)) return it.type;
  }
  return null;
}

// Rows whose output is one of these tokens (e.g. portals) are dropped entirely.
const hiddenOutputs = new Set(rules.hideOutputs || []);

const groups = new Map();
let enabled = 0, shown = 0;

for (const row of cubeRows) {
  if (row.enabled !== '1') continue;
  enabled++;
  const desc = row.description || '';
  const rule = compiledRules.find(r => r.re.test(desc));
  if (rule?.hide) { bump(report.hiddenByRule, rule.match, desc); continue; }
  const removed = usesHiddenType(row);
  if (removed) { bump(report.hiddenByRule, `item type ${removed}`, desc); continue; }
  const hiddenOut = ['output', 'output b', 'output c'].map(c => splitToken(row[c] || '')[0]).find(o => hiddenOutputs.has(o));
  if (hiddenOut) { bump(report.hiddenByRule, `output ${hiddenOut}`, desc); continue; }

  let cat = rule?.category || 'uncategorized';
  if (!rule) bump(report.uncategorized, normalizeDescription(desc), desc);
  if (cat !== 'uncategorized' && !categoryIds.has(cat)) {
    throw new Error(`rule ${JSON.stringify(rule.match)} references unknown category "${cat}"`);
  }

  const inputs = [];
  for (let i = 1; i <= 7; i++) {
    const raw = row[`input ${i}`];
    if (raw) { const inp = parseInput(raw, desc); if (inp) inputs.push(inp); }
  }
  // Identical outputs in the a/b/c slots (e.g. two Anvil Stones returned) are shown once with a count.
  const outputs = [];
  for (const o of ['', 'b ', 'c '].map(p => outputSet(row, p)).filter(Boolean)) {
    const key = JSON.stringify([o.n, o.k, o.q, o.m]);
    const same = outputs.find(x => JSON.stringify([x.n, x.k, x.q, x.m]) === key);
    if (same) same.c = (same.c || 1) + (o.c || 1);
    else outputs.push(o);
  }

  const req = [];
  if (row.class) req.push(`${CLASS_NAMES[row.class] || row.class} only`);
  if (row['min diff'] && +row['min diff'] > 0) req.push(`${DIFFICULTY[+row['min diff']]} or higher`);
  if (row.ladder === '1') req.push('Ladder only');
  const cond = describeCondition(row);
  if (cond) req.push(cond);

  const m = rule ? desc.match(rule.re) : null;
  const expand = t => t.replace(/\$(\d)/g, (_, n) => m?.[n] ?? '').replace(/\s{2,}/g, ' ').trim();
  let title = rule?.title ? expand(rule.title) : null;
  if (!title) title = normalizeDescription(desc);
  title = title.trim() || desc;
  if (rule?.capitalize) title = title.replace(/(^|[\s(/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  title = finalizeTitle(title);
  const groupKey = `${cat}\u0000${(rule?.group ? expand(rule.group) : title).toLowerCase()}`;

  let g = groups.get(groupKey);
  if (!g) {
    g = { id: '', c: cat, t: title, v: [], order: row._line };
    if (rule?.note) g.note = rule.note;
    groups.set(groupKey, g);
  }
  const variant = { i: inputs, o: outputs };
  if (req.length) variant.r = req;
  if (normalizeDescription(desc) !== title && desc !== title) variant.d = desc;
  g.v.push(variant);
  shown++;
  report.categoryCounts.set(cat, (report.categoryCounts.get(cat) || 0) + 1);
}

// Drop exact-duplicate variants (same inputs/outputs/requirements) inside a group.
for (const g of groups.values()) {
  const seen = new Set();
  g.v = g.v.filter(v => {
    const key = JSON.stringify([v.i, v.o, v.r]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Stable, readable ids for deep links.
const usedIds = new Set();
const orderedGroups = [...groups.values()].sort((a, b) => {
  const ca = categories.findIndex(c => c.id === a.c), cb = categories.findIndex(c => c.id === b.c);
  return (ca < 0 ? 1e9 : ca) - (cb < 0 ? 1e9 : cb) || a.order - b.order;
});
for (const g of orderedGroups) {
  let base = `${g.c}-${g.t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`.slice(0, 64) || g.c;
  let id = base, n = 2;
  while (usedIds.has(id)) id = `${base}-${n++}`;
  usedIds.add(id);
  g.id = id;
  delete g.order;
}

const usedCats = new Set(orderedGroups.map(g => g.c));
const outCategories = categories.filter(c => usedCats.has(c.id) || c.static);
if (usedCats.has('uncategorized')) {
  outCategories.push({ id: 'uncategorized', title: rules.uncategorizedTitle || 'Other Recipes' });
}

const data = {
  generatedAt: new Date().toISOString(),
  source: crypto.createHash('sha1').update(cubeText).digest('hex').slice(0, 12),
  lang: LANG,
  notes: rules.pageNotes || [],
  categories: outCategories,
  groups: orderedGroups,
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
const json = JSON.stringify(data);
fs.writeFileSync(OUT_FILE, `/* Generated by scripts/build-cube-recipes.mjs - do not edit. */\nwindow.ESR_CUBE_DATA=${json};\n`);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const catLines = outCategories.map(c => {
  const n = report.categoryCounts.get(c.id) || 0;
  const gcount = orderedGroups.filter(g => g.c === c.id).length;
  return `| ${c.title} | ${gcount} | ${n} |`;
});
const hiddenTotal = [...report.hiddenByRule.values()].reduce((a, b) => a + b.count, 0);
const md = `## Cube recipe generation (${LANG})

- Enabled rows: **${enabled}**, shown: **${shown}**, hidden by rules: **${hiddenTotal}**
- Groups: **${orderedGroups.length}**, output: \`${path.relative(ROOT, OUT_FILE).replace(/\\/g, '/')}\` (${(json.length / 1024).toFixed(0)} KB)

| Category | Groups | Rows |
|---|---:|---:|
${catLines.join('\n')}

${table('Uncategorized descriptions', report.uncategorized)}
${table('Unresolved item tokens', report.unresolvedTokens)}
${table('Unresolved properties (mods omitted)', report.unresolvedProps)}
${table('Conditions without text (omitted)', report.unhandledConditions)}
${table('Hidden by rule', report.hiddenByRule, 100)}
`;

if (typeof args.report === 'string') fs.writeFileSync(path.resolve(ROOT, args.report), md);
console.log(`cube recipes: ${shown}/${enabled} rows shown in ${orderedGroups.length} groups -> ${path.relative(ROOT, OUT_FILE)} (${(json.length / 1024).toFixed(0)} KB)`);
console.log(`  uncategorized: ${report.uncategorized.size}, unresolved tokens: ${report.unresolvedTokens.size}, unresolved props: ${report.unresolvedProps.size}, conditions w/o text: ${report.unhandledConditions.size}`);

if (args.strict && (report.unresolvedTokens.size || report.uncategorized.size)) {
  console.error('strict: unresolved tokens or uncategorized rows present');
  process.exit(1);
}
