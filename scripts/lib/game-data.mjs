// Shared loading helpers for the generators: command-line args, the game repo's paths,
// excel tables (tab-separated) and the localized string tables.
// The game data is read-only; nothing here writes to the game repo.

import fs from 'node:fs';
import path from 'node:path';

export function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }));
}

// --esr points at a checkout of the Eastern_Sun_Resurrected repo (also settable with the
// ESR_REPO environment variable). It defaults to ../Eastern_Sun_Resurrected next to this repo.
export function gamePaths(args, root) {
  const esr = path.resolve(args.esr || process.env.ESR_REPO || path.join(root, '..', 'Eastern_Sun_Resurrected'));
  const data = path.join(esr, 'Eastern_Sun_Resurrected.mpq', 'data');
  return {
    esr,
    data,
    excel: path.join(data, 'global', 'excel'),
    strings: path.join(data, 'local', 'lng', 'strings'),
  };
}

export function requireTable(paths, name) {
  if (!fs.existsSync(path.join(paths.excel, name))) {
    console.error(`error: ${name} not found under ${paths.esr}\n` +
      'Pass --esr=<path to Eastern_Sun_Resurrected checkout> or set ESR_REPO.');
    process.exit(1);
  }
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

export function tsvReader(excelDir) {
  return function readTsv(name) {
    const lines = readText(path.join(excelDir, name)).split(/\r?\n/);
    const header = lines[0].split('\t');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cells = lines[i].split('\t');
      const row = { _line: i + 1 };
      header.forEach((h, j) => { if (!(h in row)) row[h] = (cells[j] ?? '').trim(); });
      rows.push(row);
    }
    return rows;
  };
}

// Strip colour codes; multi-line strings are stored bottom line first.
// With keepLines the lines stay separate (joined by "\n") instead of being run together.
// With dropHidden, text coloured black (ÿc6), which the game uses to hide it, is removed.
export function clean(s, { reverseLines = false, keepLines = false, dropHidden = false } = {}) {
  if (s == null) return s;
  let t = String(s);
  if (dropHidden) t = t.replace(/ÿc6[^ÿ]*/g, '');
  t = t.replace(/ÿc./g, '').replace(/\[[A-Za-z]+\]/g, '');
  let lines = t.split(/\n|\\n/).map(l => l.trim()).filter(Boolean);
  if (reverseLines) lines = lines.reverse();
  if (keepLines) return lines.map(l => l.replace(/\s+/g, ' ')).join('\n');
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

// String tables: files earlier in `priority` win when a key is duplicated.
// Returns str(key, cleanOptions), which is null when the key is unknown.
export function loadStrings(stringsDir, lang, priority = []) {
  const strings = new Map();
  const stringsLower = new Map();
  const files = fs.readdirSync(stringsDir).filter(f => f.endsWith('.json'));
  files.sort((a, b) => {
    const pa = priority.indexOf(a), pb = priority.indexOf(b);
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || a.localeCompare(b);
  });
  for (const f of files) {
    let entries;
    try { entries = JSON.parse(readText(path.join(stringsDir, f))); } catch { continue; }
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (!e || typeof e.Key !== 'string') continue;
      const text = e[lang] ?? e.enUS;
      if (text == null) continue;
      if (!strings.has(e.Key)) strings.set(e.Key, text);
      const lk = e.Key.toLowerCase();
      if (!stringsLower.has(lk)) stringsLower.set(lk, text);
    }
  }
  return function str(key, opts) {
    if (!key) return null;
    const v = strings.get(key) ?? stringsLower.get(key.toLowerCase());
    return v == null ? null : clean(v, opts);
  };
}

// Numeric string ids ("id" in the string tables) for the given keys: Map(id -> key).
// Saves refer to some names (runewords) by this id rather than by a table row.
export function loadStringIds(stringsDir, keys) {
  const ids = new Map();
  for (const f of fs.readdirSync(stringsDir).filter(n => n.endsWith('.json'))) {
    let entries;
    try { entries = JSON.parse(readText(path.join(stringsDir, f))); } catch { continue; }
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (e && keys.has(e.Key) && Number.isInteger(e.id)) ids.set(e.id, e.Key);
    }
  }
  return ids;
}

export const CLASS_NAMES = {
  ama: 'Amazon', ass: 'Assassin', bar: 'Barbarian', dru: 'Druid',
  nec: 'Necromancer', pal: 'Paladin', sor: 'Sorceress', war: 'Warlock',
};

// Markdown table of counted report entries ({ count, sample } values), most frequent first.
export function reportTable(title, map, limit = 200) {
  const entries = [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  if (!entries.length) return `### ${title}\n\nNone.\n`;
  const rowsMd = entries.slice(0, limit).map(([k, v]) =>
    `| \`${String(k).replace(/\|/g, '\\|')}\` | ${v.count} | ${String(v.sample ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 90)} |`);
  const more = entries.length > limit ? `\n_…and ${entries.length - limit} more._\n` : '';
  return `### ${title} (${entries.length})\n\n| Key | Rows | Example |\n|---|---:|---|\n${rowsMd.join('\n')}\n${more}`;
}

export function bump(map, key, sample) {
  const e = map.get(key) || { count: 0, sample };
  e.count++;
  map.set(key, e);
}
