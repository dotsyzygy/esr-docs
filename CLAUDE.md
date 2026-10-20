# CLAUDE.md

Docs site for the Eastern Sun Resurrected (ESR) Diablo II Resurrected mod. The site is generated from the mod's game data and deployed to GitHub Pages at https://dotsyzygy.github.io/esr-docs/. So far it has a home page, three docs pages (Cube Recipes, Skills, Vessel of Souls) and a Character page that reads a player's save in the browser. Other pages from the old site will be migrated in over time.

## Hard rules

- **The game data is read-only.** It lives in a separate repo, `CelestialRayOne/Eastern_Sun_Resurrected`, checked out locally at `../Eastern_Sun_Resurrected`. Never edit anything there, especially `Eastern_Sun_Resurrected.mpq/`. When the data is wrong, stale or confusing (e.g. a `description` that names the wrong gem), fix the presentation here, usually in `scripts/cube-rules.json` or `scripts/skill-rules.json`.
- **The site is standalone.** Don't link to pages of the old site (easternsunresurrected.com, `*.htm`) until those pages are migrated here.
- **No tracking, analytics or ads scripts.** The old site has them; this one doesn't.
- **Commits use the repo-local git identity** (`Syzygy`). Push as the repo owner account, `dotsyzygy`.
- **Make sure both this repo (esr-docs) and Eastern_Sun_Resurrected (../Eastern_Sun_Resurrected) are up to date before making changes.**

## Layout

```
scripts/lib/game-data.mjs        shared loading: args, game repo paths, TSV, strings, report tables
scripts/lib/cube-resolve.mjs     shared cubemain resolver: items, inputs/outputs, mods, conditions (cube + vessel)
scripts/build-cube-recipes.mjs   cube generator (Node 18+, no dependencies)
scripts/cube-rules.json          every cube presentation decision (see below)
scripts/build-skills.mjs         skills generator
scripts/skill-rules.json         skills presentation decisions (see below)
scripts/build-vessel.mjs         Vessel of Souls generator (cubemain rows, via cube-resolve)
scripts/vessel-rules.json        vessel tiers, limits, colours and texts (see below)
scripts/build-character.mjs      Character page data (stat save widths and wording, item bases, names, class skills)
build.sh                         local build + checks (see Commands)
site/index.html                  home page: intro + a card per page (assets/home.css)
site/cube-recipes.html           cube page
site/skills.html                 skills page
site/vessel-of-souls.html        Vessel of Souls page (styled after the old vessel_of_souls.htm)
site/character.html              Character page: pick a .d2s, see attributes, skills, items
site/assets/site.css             shared tokens, header, nav, .page and ui-* components
site/assets/site-nav.js          the nav bar and home page cards, from one PAGES list
site/assets/                     cube-recipes.js/.css; skills.js/.css; vessel-of-souls.js/.css; character.js/.css; home.css; skill-calc.js (formula evaluator); d2s.js (save reader) and item-text.js (item wording), both UMD; icon
site/data/                       GENERATED, gitignored (cube-recipes.enUS.js, skills.enUS.js, vessel-of-souls.enUS.js, character.enUS.js)
.github/workflows/deploy.yml     build + deploy to Pages
```

## Commands

```sh
./build.sh                     # check repos are current, build both (strict), check the site, open the home page
./build.sh --pull              # fast-forward both repos first
./build.sh --no-git --no-open  # skip the git check (offline) / don't open a browser; also --esr=<path>

node scripts/build-cube-recipes.mjs --report=cube-report.md          # reads ../Eastern_Sun_Resurrected
node scripts/build-cube-recipes.mjs --esr=<path> --report=cube-report.md
node scripts/build-cube-recipes.mjs --strict                         # fail on unresolved/uncategorized
node scripts/build-skills.mjs --report=skills-report.md              # same --esr/--strict options
node scripts/build-vessel.mjs --report=vessel-report.md              # same --esr/--strict options
node scripts/build-character.mjs --report=character-report.md        # same options, plus --save=<a.d2s>[,…]
```

In VS Code, F5 ("Docs: build and open", `.vscode/launch.json`) runs the "Build docs" task (`build.sh --no-open` via Git Bash) and opens `site/index.html` in Chrome or Edge; Ctrl+Shift+B runs just the build. `build.sh` fails if a generator's `--strict` check fails, a script has a syntax error, a data file doesn't load, or a page references a missing local file, lacks the nav or is missing from `PAGES`. It only warns when a repo is behind its remote, or when a generator prints a `warning: …` line (e.g. a skill that resolves to nothing: no lines, no description, nothing from the rules; listed under "Skills that show nothing" in `skills-report.md`, to be fixed with `extraLines`, `descriptions` or `hideSkills`). Preview by opening `site/index.html` (or any page) directly in a browser; it works over `file://`. After any rules or generator change, rebuild and check `cube-report.md`. The goal is 0 uncategorized rows and 0 unresolved tokens. A few unresolved internal properties are expected. For skills, check `skills-report.md`: the goal is 0 formula warnings, unknown line types, unresolved strings and unformatted lines, and nothing under "Skills with no lines at all" that lacks a description. For the vessel, `vessel-report.md`: 0 unresolved tokens/properties and 0 usage limits that match no recipe.

For visual checks, headless Chrome works:
`"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --screenshot=<out.png> --window-size=1300,1500 --virtual-time-budget=8000 "file:///C:/dev/repos/esr-docs/site/cube-recipes.html#q=khalim"`
Headless Chrome won't go below ~500px wide; to check phone width, load the page in a 390px `<iframe>` from a scratch HTML file.

## How the cube generator works

- **Parsing:** it parses `cubemain.txt` (tab-separated). Input tokens look like `code[,qualifiers][,qty=N]`; outputs can be `useitem`/`usetype`/codes with flags; there are mods 1–5 for outputs a/b/c, and the `op`/`param`/`value` columns are a condition.
- **Resolving codes into the game's own strings** (`data/local/lng/strings/*.json`, with `ÿcX` colour codes stripped):
  - item codes: `weapons`/`armor`/`misc.txt` `namestr`
  - type codes: `itemtypes.txt` (shown as "Any …")
  - unique and set names: `uniqueitems`/`setitems` `index`
  - mods: `properties` → `itemstatcost` (`descfunc`/`descstrpos`), then `item-modifiers.json`
  - skills: `skills` → `skilldesc`
- **Conditions:** `param` is an `itemstatcost` stat ID. Ops are inferred, not documented: 15 `>`, 16 `<`, 17 `≠`, 18 `=`, 3/6 `≥`.
- **Removals:** an output that sets a _flag_ stat (descval 0, e.g. "Forged") to a negative value is a removal. Its negative mods render as "Removes …".
- **Grouping:** rows are grouped by category + title. Exact duplicate variants are dropped, and identical a/b/c outputs merge into one with a count.

## cube-rules.json

- `rules`: case-insensitive regexes matched in order against `description`; the first match wins. Each sets `category` or `hide: true`, plus optional `title`/`group` (with `$1…`) and `capitalize`. Rows that match no rule go to "Other Recipes" and show up in the report. Add a rule rather than leaving them there.
- `hideOutputs` (portals), `hideItemTypes` (`can1` Gem Cans and `can9` Crystal Cans, which were removed from the game): drop whole rows.
- Titles come from the developer descriptions, which can be stale. `ingredientSuffix` strips the trailing ingredient list ("X: A + B" becomes "X"; "A + B -> Y" becomes "Y"), then `titleAbbreviations` spells out shorthand (P-Gem, DS, FH, TO, …). Never show raw descriptions on the page; they're only used for search.
- `conditionText` / `hiddenConditionStats`: the "Requires:" chips. Use **"must"** wording (e.g. "Item must not have a Forging mod").
- `propertyText`, `hiddenProperties`, `deltaProperties`: mod wording. Internal counters are hidden, and stocker counters show as deltas ("Ber Rune: +3").

## How the skills generator works

- **Which skills:** class skills on a tree (`charclass` + `skilldesc.SkillPage` > 0), grouped by class and tree (tab names from `charstats` `StrSkillTab1-3`). "Item Skills" are non-class skills granted by a visible `grantProperties` mod (oskill, chance to cast such as `hit-skill`/`kill-skill`, `charged`, `aura`) on uniques, set items, set bonuses, runewords, magic affixes or cube recipes. The `-hidden` variants are item-effect plumbing and are skipped. Every skill lists its sources (collapsed), worded with the stat's own string minus the skill name ("9% Chance to Cast Level 12 on Striking"). Cube rows split into Vessel of Souls (linked to that page), per-slot Anointments, and other recipes (linked to the Cube Recipes page).
- **Lines** come from `skilldesc`: `dsc2` (general), `desc` (per level, shown reversed so Mana Cost is last, as in game), `dsc3` (synergies). Line types are formatted in `skill-calc.js` (`LINE_TYPES`). Multi-line strings get their placeholders filled in stored order, then display bottom line first. Long descriptions are not reversed, and a line starting lowercase is joined to the previous one. A skill with no `skilldesc` lines (e.g. the item-oskill masteries) gets lines built from its `passivestat`/`aurastat` stats, worded with `itemstatcost` + `item-modifiers.json` (or `statText` in the rules), plus a Duration line from `auralencalc` (frames, 25 per second) for timed buffs, or from `extraLines` in the rules, or failing that the skill's own `skills.txt` damage. Failing that, a skill that fires a missile (`srvmissile*`) gets "Deals N% of Weapon Damage [as <Element> Damage]": N from `SrcDam` (128ths), the element from the missile or a missile it spawns (`pSrvDmgFunc` 1 + numeric `DmgCalc1` + `EType`, up to 2 levels deep). A skill with no `SrcDam` falls back to its missile's `SrcDamage`. Skills on the Static Field function (`srvdofunc` 20: Absolute Zero, Overload, Singularity, Heat Death) get "Deals `calc1`% of nearby enemies' current Life as <Element>" plus a radius from `aurarangecalc`. Other skills that fire no missile get nothing, since they may be spells or buffs. "Values by level" only shows when a line changes with level. A description that only repeats the skill's name isn't shown.
- **Formulas are shipped, not precomputed.** The generator writes each skill's formula inputs (params, calcs, aura/passive calcs, mana, damage, missiles) to `db`. `site/assets/skill-calc.js` (UMD, used by both Node and the page) evaluates them. The generator evaluates every line at levels 1–110 at character levels 1 and 110, and reports problems.
- **Assumptions** (an unequipped character): `stat(…)` is 0, other skills are level 0 (synergies add nothing), the basic skills (Attack, Throw, …) are level 1, and own `blvl` is capped at `maxlvl`. Integer maths; `/` truncates. Damage is per level bracket (2-8, 9-16, 17-22, 23-28, 29+), shifted by `HitShift`. A line whose percentage comes out as 0 (usually because it depends on another skill's points) is hidden, and the game's " percent" string (`StrSkill23`) shows as "%". `ed*` tokens are before synergies, `en*`/`ex*` after, and `..ns/..ms` values are in 256ths.

## skill-rules.json

- `tokenAliases`: fix formula typos in the data (`me3o` → `m3eo`) or pin a token to a number (`mael`: 0).
- `extraLines`: `{ skill, lines: [{ text, x, y }] }` hand-written printf lines for a skill whose data describes nothing (no skilldesc lines, no granted stats with a description), e.g. Spirit of Nature Mastery.
- `hideLines`: `{ skill, match }` drops a line that references a string or missile missing from the game data; listed in the report.
- `statText`: `{ stat: { text, calc } }` rewording for a granted stat whose raw value misleads, e.g. `hpregen` (256ths of a point per frame) as Life per second; `{v}` in `calc` is the stat's value.
- `descriptions`: `{ "<skills.txt name>": text }` hand-written description, only for skills whose numbers depend on other skills or on mechanics the data can't pin down (the Discharges, Long Shot). Always try to derive numbers from the data first (`extraLines` with a calc, or a generic rule in the generator).
- `grantProperties`: item property codes that count as granting a skill.
- `stats`, `baseSkills`, `hideSkills`, `defaultSkillLevel` (20), `defaultCharacterLevel` (110), `maxLevel` (110), `pageNotes`, `otherTitle`/`otherIntro`.

## How the Vessel of Souls generator works

- It reads the vessel rows of `cubemain.txt` (hidden from the cube page) and resolves them with `lib/cube-resolve.mjs` + `cube-rules.json`, so items and mod wording match the Cube Recipes page.
- **Pairs merge:** each recipe has a `souls > N` row (op 15) and a `souls = N` row (op 18, which also adds the "tier exhausted" flavor text). With the bookkeeping mods hidden (`hiddenMods`: soul counter, flavor text, …) they merge into one recipe that needs "at least N souls". Op 18 alone means "exactly N" (0 = "All souls used").
- **Costs** come from the `soul-counter` mod. A section header shows the most common cost and soul requirement, and recipes show only the exceptions (tier 4 always shows its cost).
- **Trap rows** are hidden: "Tier N - Trap" rows lock a tier until the previous one is done; "Transform … Anoint Trap" rows block transforms while an anointment is pending. "… max N trap" rows become a "Can be applied up to N times" note on the recipe with the same key (`tierN - <stat>`, with a trailing digit dropped, e.g. `cast2` → `cast`).
- The starting souls come from the vessel's `uniqueitems.txt` row (`soul-counter`).

## vessel-rules.json

- `rules`: regexes on `description`, first match wins: `hide`, `limit`/`times`, or `section` (+ `group`, `outcome` for anointment names).
- `sections` (ids `tier1`–`tier4`, `completion` keep the old page's anchors; plus `anointments`) with intros (`{cost}` = the tier's common cost, `{souls}` = starting souls), `groupTitles` for tier 1's trigger types, `intro` paragraphs, `conditionText`/`limitText`.
- `itemColors`: input code → the old page's colour (Heart red, Tail orange, Soul blue, …); the CSS lightens them for AA contrast. Items are always named, so colour is never the only signal.

## How the Character page works

- **Nothing is uploaded.** `character.js` reads the picked file with FileReader, `d2s.js` parses it, `item-text.js` words it. Saves are personal: `*.d2s` is gitignored; put test saves in the repo root and `build-character.mjs` (and so `build.sh`) test-parses them with the page's own code (`--strict` fails on a save that doesn't parse). `character-report.md` lists hidden stats and unnamed items.
- **Save format:** ESR uses D2RLoader's extended save format (version bytes `05 00 'R' 'D'`), which is retail v105 with wider fields. The widths were reverse-engineered from a real save (D2RLoader doesn't document them) and are listed at the top of `d2s.js` (`FORMAT`): 16-bit stat ids ending in 0xFFFF, 32-bit item stat params, 16-bit unique/set ids, affixes and rare names, 2 extra bits before rare affix slots, an extra byte after the item flags. The runeword field is the **string id** of the runeword's name. Field order otherwise follows d2s-rs (github.com/ResurrectedTrader/d2s-rs). Weapon/armor is decided by the item-type tree (`weap`/`armo`), not the file (quivers are in weapons.txt but have no durability).
- **Wording:** the tooltip's own strings by `descfunc`; an empty `descval` means no value; descfunc 19 without placeholders is a flag ("Indestructible"); text coloured black (`ÿc6`) is the game hiding it (`clean(..., { dropHidden })`). Per-level stats scale with the character level, or with the stat named in `op base` (Total Kills on `kill_base`). descfunc 23 names a monster by `*hcIdx`; ESR keeps item descriptions there (`item_mythicaldesc`). Stats with no description (e.g. `item_nonclassskill`/`item_aura`, whose `_display` twins carry the text) are hidden.
- **Picking the file:** a page can't choose the folder the Open dialog starts in, so the page shows ESR's Windows save folder (`SAVE_FOLDER` in `character.js`) with a Copy button to paste into the dialog's File name box. Where `showOpenFilePicker` exists (Chrome, Edge) it replaces the plain input, and its `id` makes the dialog reopen in the last folder used.
- **Skill levels:** hard points plus +skills from active gear (`activeItems` in `character.js`: equipped items of the active weapon set from the header's weapon-switch flag, and charms in the charm inventory, since ESR sets `allow_inventory_charms = false`), their runewords, socketed jewels and the partial set bonuses for the set items worn. +skills only raise skills with hard points or an oskill (`item_nonclassskill`); oskills of other classes are listed separately with their sources. Charm-dedup groups and item requirements are ignored.
- **Attributes:** Base (saved points; life/mana/stamina are saved in 256ths) and Final (with gear, `finalAttributes`: flat + per-level, then % bonus; gear vitality/energy add life, stamina and mana at the class's charstats rates in quarters, shipped as `classes[].per`). The save's current life/mana/stamina are shown as a lower bound; for PewPewPew they are well above the computed Final, so skills/auras/full-set/gem bonuses still matter a lot.
- **Items shown:** only what counts towards stats: Equipped (both weapon sets; the inactive one is labelled) and the Charm Inventory. Inventory, belt, cube, stash and mercenary items aren't shown (the parser still reads them).
- **Not yet:** socketed gem/rune bonuses (gems.txt), character totals (advanced stats), DPS. Rare names (ESR has no rareprefix/raresuffix data) show as the base name. The shared stash (.d2i) isn't read.

## Content decisions already made

- **Hidden:**
  - internal plumbing: `Trap` rows, test rows, "Check if already", the per-outcome rows for corruptions, anointments and sanctification, multi-input stocker combos, `OLD` rows
  - Gem Cans and Crystal Cans
  - portals
  - **Kill Ledger, Ascendancy and Vessel of Souls**, which have (or will have) their own pages; Vessel of Souls is now `vessel-of-souls.html`
- **Kept:** Secret recipes (they were public on the old page) and the player-facing "Corrupt / Anoint / Sanctify an item" steps.
- **Categories** keep the old page's anchor ids (`#sec`, `#dst`, `#for`, …) and section intros.

## Front end

Pages share `site.css` and the nav from `site-nav.js`: to add a page, add it to `PAGES` there (a `description` gives it a card on the home page; also add it to the `<noscript>` list in `index.html`) and give the page the same header markup. The home page shows which game commit the live site was built from (`build-info.json`; hidden over `file://`). `site-nav.js` also adds the scroll jumps: once the page is scrolled down, a fixed "Top" button plus every `<section id>` in `<main>` (by its `h2`), as a "Sections" menu, or as a rail in the right margin when the window is ≥ 96rem wide. They're rebuilt when `<main>` changes (filtering), and they scroll without changing the URL hash, which holds filter state. Generic components use `ui-` classes; page-specific ones use `cr-` (cube) or `sk-` (skills).

`site/assets/cube-recipes.js` builds everything with DOM APIs; only the trusted `intro` HTML from the rules file uses innerHTML. Filter state lives in the URL hash (`#q=…&cat=…&quality=…&class=…`), and plain hashes jump to category or group ids. `skills.js` works the same way (`#q=…&class=…&slvl=…&clvl=…`; plain hashes jump to `#sor`, `#sor-tree-1`, `#sor-fire-bolt`). While searching, skills whose name matches come first (whole name, then name starts with the query, then name has every term, then some), and classes and trees are ordered by their best match. It builds each skill card once and updates it in place when the levels change, and builds its level table only when opened. Keep WCAG 2.2 AA:

- text contrast ≥ 4.5:1 against the surface colours
- quality is never shown by colour alone (there is always a text label)
- labelled controls, visible focus, a live region for result counts
- the layout works at phone width

## Deployment

`deploy.yml` runs on push to `main`, on manual dispatch, and every 30 minutes. The scheduled run compares the game repo's `main` SHA (via `git ls-remote`) with `esrCommit` in the live `build-info.json`, and only builds when they differ. The build sparse-checks-out just `excel/` and `strings/` from the game repo and runs all three generators. The workflow uses Node 24 and the latest major versions of the Pages actions. GitHub pauses scheduled workflows in repos with no activity for 60 days; re-enable it from the Actions tab if the docs stop updating.
