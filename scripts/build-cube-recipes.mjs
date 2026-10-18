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
  CLASS_NAMES as BASE_CLASS_NAMES, reportTable as table, bump,
} from './lib/game-data.mjs';

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

const items = new Map(); // code -> { name, type }
for (const file of ['weapons.txt', 'armor.txt', 'misc.txt']) {
  for (const r of readTsv(file)) {
    if (!r.code || items.has(r.code)) continue;
    let name = rules.itemNames?.[r.code] ?? str(r.namestr, { reverseLines: true });
    if (!name || name.length <= 3 || /^[+*]/.test(name)) name = r.name || name;
    items.set(r.code, { name, type: r.type });
  }
}

const itemTypes = new Map(); // code -> name
for (const r of readTsv('itemtypes.txt')) {
  if (r.Code && !itemTypes.has(r.Code)) itemTypes.set(r.Code, r.ItemType);
}

const uniques = new Map(); // index -> { name, code }
for (const r of readTsv('uniqueitems.txt')) {
  if (r.index && !uniques.has(r.index)) {
    uniques.set(r.index, { name: str(r.index, { reverseLines: true }) || r.index, code: r.code });
  }
}
const setItems = new Map();
for (const r of readTsv('setitems.txt')) {
  if (r.index && !setItems.has(r.index)) {
    setItems.set(r.index, { name: str(r.index, { reverseLines: true }) || r.index, code: r.item });
  }
}

const properties = new Map();
for (const r of readTsv('properties.txt')) if (r.code) properties.set(r.code, r);

const statsByName = new Map();
const statsById = new Map();
for (const r of readTsv('itemstatcost.txt')) {
  statsByName.set(r.Stat, r);
  if (r['*ID'] !== '') statsById.set(r['*ID'], r);
}

const skillDescName = new Map();
for (const r of readTsv('skilldesc.txt')) skillDescName.set(r.skilldesc, r['str name']);
const skillsById = new Map();
const skillsByName = new Map();
for (const r of readTsv('skills.txt')) {
  const name = str(skillDescName.get(r.skilldesc)) || r.skill;
  const s = { name, cls: r.charclass };
  skillsById.set(r['*Id'], s);
  skillsByName.set(r.skill.toLowerCase(), s);
}
function skillName(param) {
  if (param === '' || param == null) return null;
  const s = /^\d+$/.test(param) ? skillsById.get(param) : skillsByName.get(String(param).toLowerCase());
  return s ? s.name : String(param);
}

const CLASS_NAMES = { ...BASE_CLASS_NAMES, ...(rules.classNames || {}) };
const DIFFICULTY = ['Normal', 'Nightmare', 'Hell'];

// ---------------------------------------------------------------------------
// Token parsing
// ---------------------------------------------------------------------------

const QUALITY = {
  low: 'Low Quality', nor: 'Normal', hiq: 'Superior', mag: 'Magic',
  set: 'Set', rar: 'Rare', uni: 'Unique', crf: 'Crafted', tmp: 'Tempered',
};
const INPUT_QUALIFIERS = {
  ...QUALITY,
  nru: 'Not a Runeword', nos: 'No Sockets', sock: 'Socketed',
  noe: 'Not Ethereal', eth: 'Ethereal',
  bas: 'Normal Base', exc: 'Exceptional Base', eli: 'Elite Base',
  upg: 'Upgradeable',
  ...(rules.inputQualifiers || {}),
};

// Returns the display text for an item type code ("Any Weapon"), or null.
function typeName(code) {
  if (rules.typeNames && rules.typeNames[code]) return rules.typeNames[code];
  const t = itemTypes.get(code);
  return t ? (rules.anyPrefix ?? 'Any ') + t : null;
}

// Resolve the item part of a cube token. Returns { name, k } where k is a
// quality/kind hint used for colouring (uni/set/rune/type/item/special).
function resolveItem(code, context) {
  if (rules.specialTokens && code in rules.specialTokens) {
    return { name: rules.specialTokens[code], k: 'special' };
  }
  const it = items.get(code);
  if (it) return { name: it.name, k: it.type === 'rune' ? 'rune' : 'item' };
  const tn = typeName(code);
  if (tn) return { name: tn, k: 'type' };
  const u = uniques.get(code);
  if (u) return { name: u.name, k: 'uni' };
  const s = setItems.get(code);
  if (s) return { name: s.name, k: 'set' };
  const direct = str(code, { reverseLines: true });
  if (direct) return { name: direct, k: 'special' };
  bump(report.unresolvedTokens, code, context);
  return { name: code, k: 'unknown' };
}

function splitToken(raw) {
  return raw.replace(/"/g, '').split(',').map(s => s.trim()).filter(Boolean);
}

function parseInput(raw, context) {
  const parts = splitToken(raw);
  if (!parts.length) return null;
  const { name, k } = resolveItem(parts[0], context);
  let qty = 1;
  const q = [];
  let quality = null;
  for (const p of parts.slice(1)) {
    const m = p.match(/^qty=(\d+)$/);
    if (m) { qty = +m[1]; continue; }
    if (QUALITY[p]) quality = p;
    q.push(INPUT_QUALIFIERS[p] || p);
  }
  const out = { n: name, k: quality || k };
  if (qty !== 1) out.c = qty;
  if (q.length) out.q = q;
  return out;
}

const OUTPUT_FLAGS = {
  ...QUALITY,
  mod: 'Keeps Mods', eth: 'Ethereal', rep: 'Repaired', rch: 'Recharged',
  reg: 'Keeps Sockets & Gems', exc: 'Upgraded to Exceptional', eli: 'Upgraded to Elite',
  uns: 'Sockets Emptied (destroyed)', rem: 'Sockets Emptied (kept)',
  ...(rules.outputFlags || {}),
};

function parseOutput(raw, context) {
  const parts = splitToken(raw);
  if (!parts.length) return null;
  const head = parts[0];
  let name, k;
  if (head === 'useitem') { name = rules.sameItemText || 'Same item'; k = 'same'; }
  else if (head === 'usetype') { name = rules.sameTypeText || 'Same base type (new item)'; k = 'same'; }
  else ({ name, k } = resolveItem(head, context));
  const q = [];
  let qty = 1;
  let quality = null;
  for (const p of parts.slice(1)) {
    let m;
    if ((m = p.match(/^qty=(\d+)$/))) { qty = +m[1]; continue; }
    if ((m = p.match(/^sock=(\d+)$/))) { q.push(`${m[1]} Socket${m[1] === '1' ? '' : 's'}`); continue; }
    if ((m = p.match(/^lvl=(\d+)$/))) { q.push(`Item Level ${m[1]}`); continue; }
    if ((m = p.match(/^(pre|suf)=(\d+)$/))) { q.push(m[1] === 'pre' ? `Prefix #${m[2]}` : `Suffix #${m[2]}`); continue; }
    if (QUALITY[p]) quality = p;
    q.push(OUTPUT_FLAGS[p] || p);
  }
  const out = { n: name, k: quality || k };
  if (qty !== 1) out.c = qty;
  if (q.length) out.q = q;
  return out;
}

// ---------------------------------------------------------------------------
// Modifier text
// ---------------------------------------------------------------------------

function range(min, max, { signed = false, abs = false } = {}) {
  let a = +min, b = +max;
  if (Number.isNaN(a)) a = 0;
  if (Number.isNaN(b)) b = a;
  if (abs) { a = Math.abs(a); b = Math.abs(b); }
  if (b < a) [a, b] = [b, a];
  const neg = a < 0 && b < 0;
  const sign = neg ? '-' : signed ? '+' : '';
  const x = neg ? -b : a, y = neg ? -a : b;
  if (x === y) return `${sign}${neg || !signed ? Math.abs(x) : x}`.replace('+-', '-');
  return `${sign}(${x}-${y})`;
}

// Substitute printf-style placeholders in order with the supplied values.
function sprintf(fmt, values) {
  let i = 0;
  return fmt.replace(/%(\+?)(d|s|i|%)/g, (_, plus, t) => {
    if (t === '%') return '%';
    const v = values[i++];
    if (v && typeof v === 'object') return range(v.min, v.max, { signed: !!plus });
    return v == null ? '' : String(v);
  }).replace(/%%/g, '%');
}

function describeStat(statRow, min, max, param) {
  const fn = +statRow.descfunc;
  const val = statRow.descval === '' ? 1 : +statRow.descval;
  const negative = +max < 0 && +min <= 0;
  const pos = str(statRow.descstrpos);
  const neg = str(statRow.descstrneg);
  const s = (negative ? neg || pos : pos || neg) || '';
  const s2 = str(statRow.descstr2) || '';
  const r = { min, max };
  const skill = skillName(param);

  if (/%[+]?[dsi]/.test(s)) {
    switch (fn) {
      case 15: return sprintf(s, [min, max, skill]);
      case 16: return sprintf(s, [range(min, max), skill]);
      case 24: return sprintf(s, [max, skill, min, min]);
      case 27: case 28: return sprintf(s, [r, skill]);
      default: return sprintf(s, [r, r]);
    }
  }
  if (!s && fn === 0) return null;

  const v = range(min, max);
  const sv = range(min, max, { signed: true });
  const wrap = (value, text, after = '') => {
    const parts = val === 0 ? [text] : val === 2 ? [text, value] : [value, text];
    return parts.concat(after ? [after] : []).join(' ').replace(/\s+%/g, '%').trim();
  };
  switch (fn) {
    case 1: case 12: return wrap(sv, s);
    case 2: return wrap(`${v}%`, s);
    case 3: return val === 0 ? s : wrap(v, s);
    case 4: return wrap(`${sv}%`, s);
    case 5: return wrap(`${range(Math.round(min * 100 / 128), Math.round(max * 100 / 128))}%`, s);
    case 6: return wrap(sv, s, s2);
    case 7: return wrap(`${v}%`, s, s2);
    case 8: return wrap(`${sv}%`, s, s2);
    case 9: return wrap(v, s, s2);
    case 11: return s;
    case 13: return `${sv} to ${CLASS_NAMES[param] || param || ''} Skill Levels`.replace(/\s+/g, ' ');
    case 14: return `${sv} ${s}`;
    case 15: return `${min}% Chance to cast level ${max} ${skill} ${s}`;
    case 16: return `Level ${v} ${skill} Aura When Equipped`;
    case 20: return wrap(`-${range(min, max, { abs: true })}%`, s);
    case 21: return wrap(`-${range(min, max, { abs: true })}`, s);
    case 24: return `Level ${max} ${skill} (${min} charges)`;
    case 27: case 28: return `${sv} to ${skill}`;
    default: return s ? wrap(sv, s, s2) : null;
  }
}

const hiddenProps = (rules.hiddenProperties || []).map(p => new RegExp(p));
const deltaProps = (rules.deltaProperties || []).map(p => new RegExp(p));

// Returns display text, or null when the mod is internal / hidden.
function describeMod(code, param, min, max, context) {
  const overrides = rules.propertyText || {};
  if (code in overrides) {
    const t = overrides[code];
    if (t == null) return null;
    return t
      .replace('{range}', range(min, max))
      .replace('{srange}', range(min, max, { signed: true }))
      .replace('{min}', min).replace('{max}', max)
      .replace('{param}', param)
      .replace('{skill}', skillName(param) ?? '')
      .replace('{class}', CLASS_NAMES[param] || param);
  }
  if (hiddenProps.some(re => re.test(code))) return null;
  if (deltaProps.some(re => re.test(code))) {
    const st = statsByName.get(properties.get(code)?.stat1);
    const label = st && (str(st.descstrpos) || '').replace(/%[+]?[dsi]/g, '').replace(/[:\s]+$/, '').trim();
    if (label) return `${label}: ${range(min, max, { signed: true })}`;
  }
  if (CLASS_NAMES[code]) return `${range(min, max, { signed: true })} to ${CLASS_NAMES[code]} Skill Levels`;
  const prop = properties.get(code);
  const statName = prop?.stat1;
  const st = statName && statsByName.get(statName);
  let text = null;
  if (st) text = describeStat(st, min || 0, max === '' ? min || 0 : max, param);
  else if (prop && prop.func1 === '' && !statName) text = null;
  if (!text) {
    bump(report.unresolvedProps, code, context);
    return null;
  }
  return text;
}

// A flag stat shows only its text, never a value (e.g. "*** Forged (Jewel) ***").
function isFlagProperty(code) {
  const st = statsByName.get(properties.get(code)?.stat1);
  return !!st && st.descval === '0' && st.descstrpos !== '';
}

function parseMods(row, prefix) {
  const mods = [];
  for (let i = 1; i <= 5; i++) {
    const code = row[`${prefix}mod ${i}`];
    if (code) mods.push({ i, code, min: row[`${prefix}mod ${i} min`], max: row[`${prefix}mod ${i} max`] });
  }
  // Clearing a flag (negative value) means the recipe removes something, e.g. a Forging.
  // Show its negative mods as what gets removed rather than as negative bonuses.
  const removal = mods.some(m => isFlagProperty(m.code) && +m.max < 0 && +m.min <= 0);

  const out = [];
  for (const { i, code, min, max } of mods) {
    const ctx = row.description;
    const param = row[`${prefix}mod ${i} param`];
    const negative = +max < 0 && +min <= 0;
    let text;
    if (removal && negative) {
      text = describeMod(code, param, String(-max), String(-min), ctx);
      if (text) text = `Removes ${isFlagProperty(code) ? text.replace(/^\*+\s*|\s*\*+$/g, '') : text}`;
    } else {
      text = describeMod(code, param, min, max, ctx);
    }
    if (!text) continue;
    const chance = +row[`${prefix}mod ${i} chance`];
    out.push(chance && chance < 100 ? `${text} (${chance}% chance)` : text);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

const hiddenCondStats = (rules.hiddenConditionStats || []).map(p => new RegExp(p));
const OPS = { 1: '≥', 2: '≥', 3: '≥', 4: '≤', 5: '≥', 6: '≥', 15: '>', 16: '<', 17: '≠', 18: '=', ...(rules.ops || {}) };

function describeCondition(row) {
  const op = row.op;
  if (!op || op === '0') return null;
  const stat = statsById.get(row.param);
  const statName = stat?.Stat || row['*stat'] || row.param;
  const conds = rules.conditionText || {};
  const key = `${op}:${statName}`;
  let tmpl = key in conds ? conds[key] : conds[statName];
  if (tmpl && typeof tmpl === 'object') tmpl = row.value in tmpl ? tmpl[row.value] : tmpl.default;
  if (tmpl === null) return null;
  if (tmpl === undefined && hiddenCondStats.some(re => re.test(statName))) return null;
  if (tmpl === undefined) {
    bump(report.unhandledConditions, key, row.description);
    return null;
  }
  return tmpl.replace('{op}', OPS[op] || `op${op}`).replace('{value}', row.value);
}

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

function outputSet(row, prefix) {
  const head = prefix ? row[`output ${prefix.trim()}`] : row.output;
  if (!head) return null;
  const o = parseOutput(head, row.description);
  if (!o) return null;
  const p = prefix;
  const lvl = row[`${p}lvl`], plvl = row[`${p}plvl`], ilvl = row[`${p}ilvl`];
  const notes = [];
  const levelMatters = !['item', 'rune', 'special'].includes(o.k);
  if (lvl && levelMatters) notes.push(`Item Level ${lvl}`);
  if (plvl) notes.push(`Item Level: ${plvl}% of character level`);
  if (ilvl) notes.push(`Item Level: ${ilvl}% of input item level`);
  if (notes.length) o.q = (o.q || []).concat(notes);
  const mods = parseMods(row, p);
  if (mods.length) o.m = mods;
  return o;
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
