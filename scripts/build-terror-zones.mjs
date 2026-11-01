#!/usr/bin/env node
// Generates site/data/terror-zones.<lang>.js: the terror zone rotation's config and each zone's
// areas. The home page works out the current and next zones in the browser with
// site/assets/terror-zones.js, since the site only rebuilds when the game data changes.
//
// Usage:
//   node scripts/build-terror-zones.mjs [--esr=<path>] [--out=site] [--report=terror-zones-report.md] [--strict] [--lang=enUS]
//
// --esr points at a checkout of the Eastern_Sun_Resurrected repo (also settable with the
// ESR_REPO environment variable). It defaults to ../Eastern_Sun_Resurrected next to this repo.
//
// Checks are in scripts/terror-zone-rules.json: known retail picks and zones seen in game.
// No dependencies; requires Node 18+.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, gamePaths, requireTable, readText, tsvReader, loadStrings, reportTable, bump,
} from './lib/game-data.mjs';

const args = parseArgs();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PATHS = gamePaths(args, ROOT);
const LANG = args.lang || 'enUS';
const OUT_FILE = path.join(path.resolve(ROOT, args.out || 'site'), 'data', `terror-zones.${LANG}.js`);
const CONFIG_FILE = path.join(PATHS.data, 'hd', 'global', 'excel', 'desecratedzones.json');
const rules = JSON.parse(readText(path.join(HERE, 'terror-zone-rules.json')));
const TerrorZones = createRequire(import.meta.url)(path.join(ROOT, 'site', 'assets', 'terror-zones.js'));

requireTable(PATHS, 'levels.txt');
requireTable(PATHS, 'levelgroups.txt');
if (!fs.existsSync(CONFIG_FILE)) {
  console.error(`error: ${path.relative(PATHS.esr, CONFIG_FILE)} not found under ${PATHS.esr}`);
  process.exit(1);
}

const readTsv = tsvReader(PATHS.excel);
const str = loadStrings(PATHS.strings, LANG, ['levels.json', 'item-names.json']);
const levels = new Map(readTsv('levels.txt').map(r => [r.Id, r]));
const groups = new Map(readTsv('levelgroups.txt').map(r => [r.LevelGroupId, r]));

const report = { unnamed: new Map(), duplicates: new Map(), failed: [] };

// Seeds are above 2^53, so JSON.parse would round them and change the whole rotation: they're
// quoted first and stay strings. Older versions of the file have comments after the seed.
const raw = readText(CONFIG_FILE).replace(/\/\*[\s\S]*?\*\//g, '').replace(/("seed"\s*:\s*)(\d+)/g, '$1"$2"');

const utcSeconds = text => Date.parse(text.trim().replace(' ', 'T') + 'Z') / 1000;

// The names the game's own display lists: each level group once (Chasm of Horrors (Tier 1) for all
// its levels), then the levels with no group by name. Checked with the screenshots in the rules.
function zoneAreas(zone) {
  const grouped = new Set(), ungrouped = new Set();
  for (const { level_id: id } of zone.levels) {
    const level = levels.get(String(id));
    const group = level && groups.get(level.LevelGroup);
    const name = group ? str(group.NameString) : level && str(level.LevelName);
    if (!name) bump(report.unnamed, id, zone.id);
    else (group ? grouped : ungrouped).add(name);
  }
  return [...grouped, ...ungrouped];
}

const configs = JSON.parse(raw).desecrated_zones.map(c => {
  // The game skips a zone whose id is already taken ("Duplicate or collision found").
  const seen = new Set();
  const zones = c.zones.filter(z => {
    if (!seen.has(z.id)) return seen.add(z.id);
    bump(report.duplicates, z.id, c.name);
    return false;
  });
  return {
    start: utcSeconds(c.start_time_utc),
    end: c.end_time_utc ? utcSeconds(c.end_time_utc) : null,
    zoneMinutes: c.zone_duration_minutes,
    breakMinutes: c.break_duration_minutes,
    seed: c.seed,
    zones: zones.map(z => ({ id: z.id, areas: zoneAreas(z) })),
  };
}).filter(c => {
  if (c.zones.length && c.zoneMinutes > 0) return true;
  report.failed.push(`config with seed ${c.seed} has no zones or no zone duration; left out`);
  return false;
});
if (!configs.length) report.failed.push('no usable config');

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

for (let i = 0; i < 500; i++) {
  const bytes = [...crypto.randomBytes(8)];
  const expected = crypto.createHash('sha1').update(Buffer.from(bytes)).digest('hex');
  const actual = Buffer.from(TerrorZones.sha1(bytes)).toString('hex');
  if (actual !== expected) { report.failed.push(`SHA-1 of ${bytes} gave ${actual}, not ${expected}`); break; }
}

{
  const r = rules.retailCheck;
  const start = utcSeconds(r.start), period = r.zoneMinutes * 60;
  const first = (Date.parse(r.from) / 1000 - start) / period;
  const picks = TerrorZones.pickZones(start, period, BigInt(r.seed), r.zoneCount, first + r.picks.length - 1).slice(first);
  if (picks.join() !== r.picks.join()) report.failed.push(`retail picks are ${picks}, not ${r.picks}`);
}

const warnings = [];
let observedChecked = 0;
if (configs.some(c => c.seed === rules.observed.seed)) {
  for (const seen of rules.observed.zones) {
    const [window] = TerrorZones.schedule(configs, Date.parse(seen.at) / 1000, 1);
    const areas = window ? window.zone.areas.join(', ') : 'nothing';
    if (areas === seen.areas.join(', ')) observedChecked++;
    else warnings.push(`terror zone at ${seen.at} comes out as ${areas}, but ${seen.areas.join(', ')} was seen in game`);
  }
} else {
  warnings.push('the terror zone seed changed, so the zones seen in game no longer apply: re-check in game');
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
const json = JSON.stringify({ configs });
fs.writeFileSync(OUT_FILE, `/* Generated by scripts/build-terror-zones.mjs - do not edit. */\nwindow.ESR_TZ_DATA=${json};\n`);

const md = `## Terror zones generation (${LANG})

- Configs: **${configs.length}**, zones: **${configs.reduce((a, c) => a + c.zones.length, 0)}**
- Zones matching what was seen in game: **${observedChecked}** of ${rules.observed.zones.length}
- Output: \`${path.relative(ROOT, OUT_FILE).replace(/\\/g, '/')}\` (${(json.length / 1024).toFixed(1)} KB)

${configs.map(c => `| Zone | Areas |\n|---|---|\n${c.zones.map(z => `| ${z.id} | ${z.areas.join(', ')} |`).join('\n')}\n`).join('\n')}
${reportTable('Levels with no name (left out)', report.unnamed)}
${reportTable('Duplicate zone ids (skipped, like the game)', report.duplicates)}
### Failed checks (${report.failed.length + warnings.length})

${[...report.failed, ...warnings].map(f => `- ${f}`).join('\n') || 'None.'}
`;

if (typeof args.report === 'string') fs.writeFileSync(path.resolve(ROOT, args.report), md);
console.log(`terror zones: ${configs.reduce((a, c) => a + c.zones.length, 0)} zones -> ${path.relative(ROOT, OUT_FILE)} (${(json.length / 1024).toFixed(1)} KB)`);
console.log(`  unnamed levels: ${report.unnamed.size}, duplicate zones: ${report.duplicates.size}, failed checks: ${report.failed.length}`);
for (const w of warnings) console.log(`warning: ${w}`);

if (report.failed.length) console.error(report.failed.join('\n'));
if (args.strict && (report.failed.length || report.unnamed.size)) {
  console.error('strict: failed checks or unnamed levels present');
  process.exit(1);
}
