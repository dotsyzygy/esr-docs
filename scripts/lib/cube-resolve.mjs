// Resolves cubemain.txt rows into display data: item/type/unique/set names, input and
// output tokens, mods (properties -> itemstatcost -> strings) and conditions.
// Shared by the generators that read cube recipes, so mod wording is the same on every page.
// Wording overrides come from the rules object (scripts/cube-rules.json); unresolved codes are
// counted in report.unresolvedTokens / unresolvedProps / unhandledConditions.

import { CLASS_NAMES as BASE_CLASS_NAMES, bump } from './game-data.mjs';

export function createCubeResolver({ readTsv, str, rules, report }) {
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

  return {
    items, itemTypes, uniques, setItems, properties, statsByName, statsById, skillName, CLASS_NAMES, DIFFICULTY, QUALITY, typeName, resolveItem, splitToken, parseInput, parseOutput, range, describeStat, describeMod, isFlagProperty, parseMods, describeCondition, outputSet,
  };
}
