# CLAUDE.md

Docs site for the Eastern Sun Resurrected (ESR) Diablo II Resurrected mod. The site is generated from the mod's game data and deployed to GitHub Pages at https://dotsyzygy.github.io/esr-docs/. So far it has one page, Cube Recipes. Other pages from the old site will be migrated in over time.

## Hard rules

- **The game data is read-only.** It lives in a separate repo, `CelestialRayOne/Eastern_Sun_Resurrected`, checked out locally at `../Eastern_Sun_Resurrected`. Never edit anything there, especially `Eastern_Sun_Resurrected.mpq/`. When the data is wrong, stale or confusing (e.g. a `description` that names the wrong gem), fix the presentation here, usually in `scripts/cube-rules.json`.
- **The site is standalone.** Don't link to pages of the old site (easternsunresurrected.com, `*.htm`) until those pages are migrated here.
- **No tracking, analytics or ads scripts.** The old site has them; this one doesn't.
- **Commits use the repo-local git identity** (`Syzygy`). Push as the repo owner account, `dotsyzygy`.

## Layout

```
scripts/build-cube-recipes.mjs   generator (Node 18+, no dependencies)
scripts/cube-rules.json          every presentation decision (see below)
site/cube-recipes.html           the page; site/index.html redirects to it
site/assets/                     cube-recipes.js (renderer/search), cube-recipes.css, icon
site/data/                       GENERATED, gitignored (cube-recipes.enUS.js)
.github/workflows/deploy.yml     build + deploy to Pages
```

## Commands

```sh
node scripts/build-cube-recipes.mjs --report=cube-report.md          # reads ../Eastern_Sun_Resurrected
node scripts/build-cube-recipes.mjs --esr=<path> --report=cube-report.md
node scripts/build-cube-recipes.mjs --strict                         # fail on unresolved/uncategorized
```

Preview by opening `site/cube-recipes.html` directly in a browser; it works over `file://`. After any rules or generator change, rebuild and check `cube-report.md`. The goal is 0 uncategorized rows and 0 unresolved tokens. A few unresolved internal properties are expected.

For visual checks, headless Chrome works:
`"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --screenshot=<out.png> --window-size=1300,1500 --virtual-time-budget=8000 "file:///C:/dev/repos/esr-docs/site/cube-recipes.html#q=khalim"`

## How the generator works

- **Parsing:** it parses `cubemain.txt` (tab-separated). Input tokens look like `code[,qualifiers][,qty=N]`; outputs can be `useitem`/`usetype`/codes with flags; there are mods 1–5 for outputs a/b/c, and the `op`/`param`/`value` columns are a condition.
- **Resolving codes into the game's own strings** (`data/local/lng/strings/*.json`, with `ÿcX` colour codes stripped):
  - item codes: `weapons`/`armor`/`misc.txt` `namestr`
  - type codes: `itemtypes.txt` (shown as "Any …")
  - unique and set names: `uniqueitems`/`setitems` `index`
  - mods: `properties` → `itemstatcost` (`descfunc`/`descstrpos`), then `item-modifiers.json`
  - skills: `skills` → `skilldesc`
- **Conditions:** `param` is an `itemstatcost` stat ID. Ops are inferred, not documented: 15 `>`, 16 `<`, 17 `≠`, 18 `=`, 3/6 `≥`.
- **Removals:** an output that sets a *flag* stat (descval 0, e.g. "Forged") to a negative value is a removal. Its negative mods render as "Removes …".
- **Grouping:** rows are grouped by category + title. Exact duplicate variants are dropped, and identical a/b/c outputs merge into one with a count.

## cube-rules.json

- `rules`: case-insensitive regexes matched in order against `description`; the first match wins. Each sets `category` or `hide: true`, plus optional `title`/`group` (with `$1…`) and `capitalize`. Rows that match no rule go to "Other Recipes" and show up in the report. Add a rule rather than leaving them there.
- `hideOutputs` (portals), `hideItemTypes` (`can1` Gem Cans and `can9` Crystal Cans, which were removed from the game): drop whole rows.
- Titles come from the developer descriptions, which can be stale. `ingredientSuffix` strips the trailing ingredient list ("X: A + B" becomes "X"; "A + B -> Y" becomes "Y"), then `titleAbbreviations` spells out shorthand (P-Gem, DS, FH, TO, …). Never show raw descriptions on the page; they're only used for search.
- `conditionText` / `hiddenConditionStats`: the "Requires:" chips. Use **"must"** wording (e.g. "Item must not have a Forging mod").
- `propertyText`, `hiddenProperties`, `deltaProperties`: mod wording. Internal counters are hidden, and stocker counters show as deltas ("Ber Rune: +3").

## Content decisions already made

- **Hidden:**
  - internal plumbing: `Trap` rows, test rows, "Check if already", the per-outcome rows for corruptions, anointments and sanctification, multi-input stocker combos, `OLD` rows
  - Gem Cans and Crystal Cans
  - portals
  - **Kill Ledger, Ascendancy and Vessel of Souls**, which have their own pages
- **Kept:** Secret recipes (they were public on the old page) and the player-facing "Corrupt / Anoint / Sanctify an item" steps.
- **Categories** keep the old page's anchor ids (`#sec`, `#dst`, `#for`, …) and section intros.

## Front end

`site/assets/cube-recipes.js` builds everything with DOM APIs; only the trusted `intro` HTML from the rules file uses innerHTML. Filter state lives in the URL hash (`#q=…&cat=…&quality=…&class=…`), and plain hashes jump to category or group ids. Keep WCAG 2.2 AA:

- text contrast ≥ 4.5:1 against the surface colours
- quality is never shown by colour alone (there is always a text label)
- labelled controls, visible focus, a live region for result counts
- the layout works at phone width

## Deployment

`deploy.yml` runs on push to `main`, on manual dispatch, and every 30 minutes. The scheduled run compares the game repo's `main` SHA (via `git ls-remote`) with `esrCommit` in the live `build-info.json`, and only builds when they differ. The build sparse-checks-out just `excel/` and `strings/` from the game repo. The workflow uses Node 24 and the latest major versions of the Pages actions. GitHub pauses scheduled workflows in repos with no activity for 60 days; re-enable it from the Actions tab if the docs stop updating.
