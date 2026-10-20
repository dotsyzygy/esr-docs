#!/usr/bin/env bash
# Builds the docs site locally from the game data and checks the result.
#
# Usage: ./build.sh [options]
#   --esr=<path>   game data checkout (default: $ESR_REPO or ../Eastern_Sun_Resurrected)
#   --pull         fast-forward both repos from their remotes before building
#   --no-git       skip the "both repos up to date" check (e.g. offline)
#   --no-open      don't open the home page in the browser when done (it opens by default)
#
# Steps: check both repos are current with their remotes (warns, or pulls with --pull),
# run the generators in --strict mode, then check the site: script syntax, generated data,
# and that every local file a page references exists. Reports are written to
# cube-report.md, skills-report.md, vessel-report.md and character-report.md. Any .d2s saves in
# the repo root (gitignored) are test-parsed by the character generator. Exits non-zero on any failure.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ESR="${ESR_REPO:-$ROOT/../Eastern_Sun_Resurrected}"
PULL=0 GIT=1 OPEN=1

for arg in "$@"; do
  case "$arg" in
    --esr=*) ESR="${arg#--esr=}" ;;
    --pull) PULL=1 ;;
    --no-git) GIT=0 ;;
    --open) OPEN=1 ;;
    --no-open) OPEN=0 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then BOLD=$'\e[1m' RED=$'\e[31m' YEL=$'\e[33m' GRN=$'\e[32m' OFF=$'\e[0m'; else BOLD= RED= YEL= GRN= OFF=; fi
step() { printf '\n%s== %s%s\n' "$BOLD" "$1" "$OFF"; }
ok()   { printf '%s  ok%s %s\n' "$GRN" "$OFF" "$1"; }
warn() { printf '%s  warning%s %s\n' "$YEL" "$OFF" "$1"; WARNINGS=$((WARNINGS + 1)); }
fail() { printf '%s  FAILED%s %s\n' "$RED" "$OFF" "$1"; FAILURES=$((FAILURES + 1)); }
WARNINGS=0 FAILURES=0

cd "$ROOT"

# ---------------------------------------------------------------------------
step "Prerequisites"
# ---------------------------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then echo "node is not installed (Node 18+ is required)" >&2; exit 1; fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then echo "Node 18+ is required (found $(node -v))" >&2; exit 1; fi
ok "node $(node -v)"

if [ ! -f "$ESR/Eastern_Sun_Resurrected.mpq/data/global/excel/skills.txt" ]; then
  echo "game data not found at $ESR (pass --esr=<path> or set ESR_REPO)" >&2
  exit 1
fi
ESR="$(cd "$ESR" && pwd)"
ok "game data: $ESR"

# ---------------------------------------------------------------------------
step "Repos up to date"
# ---------------------------------------------------------------------------

check_repo() { # <name> <dir>
  local name="$1" dir="$2" branch upstream behind ahead
  if ! git -C "$dir" rev-parse --git-dir >/dev/null 2>&1; then warn "$name: not a git checkout"; return; fi
  branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
  if ! upstream="$(git -C "$dir" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)"; then
    warn "$name: branch $branch has no upstream"; return
  fi
  if ! git -C "$dir" fetch --quiet; then warn "$name: git fetch failed (offline? use --no-git)"; return; fi
  if [ "$PULL" = 1 ]; then
    if git -C "$dir" merge --ff-only --quiet "$upstream" 2>/dev/null; then :; else warn "$name: can't fast-forward $branch to $upstream"; fi
  fi
  behind="$(git -C "$dir" rev-list --count "HEAD..$upstream")"
  ahead="$(git -C "$dir" rev-list --count "$upstream..HEAD")"
  if [ "$behind" -gt 0 ]; then warn "$name: $branch is $behind commit(s) behind $upstream (run with --pull)"
  elif [ "$ahead" -gt 0 ]; then ok "$name: $branch is up to date ($ahead local commit(s) not pushed)"
  else ok "$name: $branch is up to date with $upstream ($(git -C "$dir" rev-parse --short HEAD))"
  fi
}

if [ "$GIT" = 1 ]; then
  check_repo "esr-docs" "$ROOT"
  check_repo "Eastern_Sun_Resurrected" "$ESR"
else
  echo "  skipped (--no-git)"
fi

# ---------------------------------------------------------------------------
step "Generate"
# ---------------------------------------------------------------------------

run_generator() { # <script> <report>
  # Lines a generator prints as "warning: ..." count as build warnings (not failures).
  local out status
  out=$(node "scripts/$1" --esr="$ESR" --report="$2" --strict 2>&1); status=$?
  printf '%s\n' "$out" | grep -v '^warning: '
  if [ "$status" = 0 ]; then ok "$1 (report: $2)"; else fail "$1 (see $2)"; fi
  while IFS= read -r line; do warn "$1: ${line#warning: }"; done < <(printf '%s\n' "$out" | grep '^warning: ')
}
run_generator build-cube-recipes.mjs cube-report.md
run_generator build-skills.mjs skills-report.md
run_generator build-vessel.mjs vessel-report.md
run_generator build-character.mjs character-report.md

# ---------------------------------------------------------------------------
step "Check site"
# ---------------------------------------------------------------------------

BEFORE=$FAILURES
for f in site/assets/*.js scripts/*.mjs scripts/lib/*.mjs; do
  if ! node --check "$f" 2>/dev/null; then fail "syntax error in $f"; node --check "$f" || true; fi
done
[ "$FAILURES" = "$BEFORE" ] && ok "script syntax"

BEFORE=$FAILURES
for f in scripts/*.json; do
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$f" 2>/dev/null || fail "invalid JSON in $f"
done
[ "$FAILURES" = "$BEFORE" ] && ok "rules files are valid JSON"

# Every generated data file loads and defines its global.
node - <<'EOF' || FAILURES=$((FAILURES + 1))
const fs = require('fs'), vm = require('vm');
const checks = { 'site/data/cube-recipes.enUS.js': 'ESR_CUBE_DATA', 'site/data/skills.enUS.js': 'ESR_SKILL_DATA', 'site/data/vessel-of-souls.enUS.js': 'ESR_VESSEL_DATA', 'site/data/character.enUS.js': 'ESR_CHAR_DATA' };
let bad = 0;
for (const [file, name] of Object.entries(checks)) {
  const sandbox = { window: {} };
  try { vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox); } catch (e) { console.log(`  FAILED ${file}: ${e.message}`); bad++; continue; }
  if (!sandbox.window[name]) { console.log(`  FAILED ${file} doesn't define window.${name}`); bad++; continue; }
  console.log(`  ok ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}
process.exit(bad ? 1 : 0);
EOF

# Every local src/href in the pages points at a file that exists, and every page has the nav.
node - <<'EOF' || FAILURES=$((FAILURES + 1))
const fs = require('fs'), path = require('path');
let bad = 0;
const pages = fs.readdirSync('site').filter(f => f.endsWith('.html'));
const nav = fs.readFileSync('site/assets/site-nav.js', 'utf8');
for (const page of pages) {
  const html = fs.readFileSync(path.join('site', page), 'utf8');
  for (const m of html.matchAll(/\s(?:src|href)="([^"#?]+)/g)) {
    const ref = m[1];
    if (/^[a-z]+:|^\/\//i.test(ref)) continue;
    if (!fs.existsSync(path.join('site', ref))) { console.log(`  FAILED ${page}: missing ${ref}`); bad++; }
  }
  if (!html.includes('id="site-nav"') || !html.includes('assets/site-nav.js')) { console.log(`  FAILED ${page}: no site nav`); bad++; }
  if (!nav.includes(`'${page}'`)) { console.log(`  FAILED ${page} is not in PAGES in site/assets/site-nav.js`); bad++; }
}
for (const m of nav.matchAll(/href: '([^'#][^']*)'/g)) {
  if (!fs.existsSync(path.join('site', m[1]))) { console.log(`  FAILED site-nav.js links to missing page ${m[1]}`); bad++; }
}
if (!bad) console.log(`  ok ${pages.length} pages: links resolve, nav present`);
process.exit(bad ? 1 : 0);
EOF

# ---------------------------------------------------------------------------
step "Result"
# ---------------------------------------------------------------------------

HOME_URL="file://$( (command -v cygpath >/dev/null && cygpath -m "$ROOT/site/index.html") || echo "$ROOT/site/index.html")"
[ "${HOME_URL:7:1}" = "/" ] || HOME_URL="file:///${HOME_URL#file://}"

if [ "$FAILURES" -gt 0 ]; then
  printf '%s%d check(s) failed%s, %d warning(s).\n' "$RED" "$FAILURES" "$OFF" "$WARNINGS"
  exit 1
fi
printf '%sAll checks passed%s (%d warning(s)). Preview: %s\n' "$GRN" "$OFF" "$WARNINGS" "$HOME_URL"

if [ "$OPEN" = 1 ]; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) start "" "$HOME_URL" ;;
    Darwin) open "$HOME_URL" ;;
    *) xdg-open "$HOME_URL" >/dev/null 2>&1 & ;;
  esac
fi
