# CLAUDE.md

Docs site for the Eastern Sun Resurrected (ESR) Diablo II Resurrected mod. The site is generated from the mod's game data and deployed to GitHub Pages at https://dotsyzygy.github.io/esr-docs/. So far it has a home page, three docs pages (Cube Recipes, Skills with a per-skill detail page, Vessel of Souls), a Skill Planner and a Character page that reads a player's save in the browser. Other pages from the old site will be migrated in over time.

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
scripts/build-classes.mjs        Classes page generator (Warlock Consume effects from monpet.txt)
scripts/class-rules.json         classes presentation decisions (see below)
scripts/lib/stat-text.mjs        shared stat wording (item-style templates, statText rules)
scripts/build-character.mjs      Character page data (stat save widths and wording, item bases, names, class skills, buff/aura/passive formulas)
scripts/lib/skill-records.mjs    skill/missile formula records, shared by build-skills and build-character
build.sh                         local build + checks (see Commands)
site/index.html                  home page: intro + a card per page (assets/home.css)
site/cube-recipes.html           cube page
site/skills.html                 skills page
site/skill.html                  skill detail page (one skill in full, synergy points adjustable)
site/skill-planner.html          Skill Planner: hard points per class skill, tooltips from the whole plan (assets/skill-planner.js/.css)
site/vessel-of-souls.html        Vessel of Souls page (styled after the old vessel_of_souls.htm)
site/classes.html                Classes page: class mechanics the skill trees don't show (Warlock Consume)
site/character.html              Character page: pick a .d2s, see attributes, skills, items
site/assets/site.css             shared tokens, header, nav, .page and ui-* components
site/assets/site-nav.js          the nav bar and home page cards, from one PAGES list
site/assets/                     cube-recipes.js/.css; skills.js/.css (skills.css also styles skill.html); skill.js; vessel-of-souls.js/.css; character.js/.css; home.css; skill-calc.js (formula evaluator); d2s.js (save reader), item-text.js (item wording) and char-calc.js (totals, buffs), all UMD; icon
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
node scripts/build-classes.mjs --report=classes-report.md            # same --esr/--strict options
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
- **Synergies** (for the detail page): `e.sy` lists the class skills shown on the page that a skill's formulas read by hard points (`skill('X'.blvl)`), `e.sl` those read only by level with +skills (`.lvl`, `.clcN`). `skillRefs` in `skill-calc.js` finds them in the record, its lines and missiles, following values read from other skills (`skill('Attack'.clc1)`, the curse total). A reference is kept only if maxing it changes a line, so ones that only count alongside an item effect (Zap for Fire Ball needs the Eschuta Temper passive) are dropped. Skills whose synergy lines got nothing adjustable (bonuses through passive stats read back with `stat()`: Elemental Nova, Venom, …) are listed in `skills-report.md`. The generator also validates every line with all synergies maxed (`synergyPoints`, default 20, shipped as `levels.synergy`).
- **Hard points** (`e.hp`): skills whose own numbers read their hard points (`blvl`, e.g. Dodge's `dm12*(100+blvl*3)/100`) are marked by comparing every line with the default (hard points = level, up to `maxlvl`) and with `hardPoints: 0`; they get a "Scales with hard points" tag. `opts.hardPoints` in `skill-calc.js` caps the described skill's own `blvl` (only that skill's, via `this.self`), so a level 30 skill with 12 hard points has 18 from +skills; in the level table each level gets min(hard points, level). Both pages have a "Hard points" select (`hp=` in the hash; empty = "Skill level (to 20)", the cap shared with synergies, `levels.synergy`); the skill page shows it only for `e.hp` skills. The generator also validates `e.hp` skills at 0 hard points.
- **"On striking"** (`e.os` 1/0 + `e.osr` reason; shown with its reason on the detail page, searchable on the Skills page): whether the skill triggers items' "chance to cast on striking" (`item_skillonhit`, on `domeleedamage`/`domissiledamage`). There's no data column for it, so it's inferred (`strikes()` in the generator, `onStriking` in the rules): spells don't count (confirmed by the user). Yes when `srvdofunc` is a melee attack routine (`meleeRoutines`, names and meanings from the D2R Data Guide, locbones.github.io/D2R_DataGuide/#Skills) with `SrcDam` (or a routine in `withoutSrcDam`: Smite, the claw charge-ups), or when a missile the skill fires (or one it spawns) carries weapon damage (`SrcDam` on the skill, `SrcDamage` on the missile). No for skills that deal damage without weapon damage. Nothing for passives, auras, summons, buffs that fire nothing, `noHitRoutines` (116, the shapeshifts) and skills that don't deal damage. Unclear cases (weapon damage on an unknown routine: Cleave 164, Mirrored Blades 166; attack-speed melee attacks with no weapon damage: Twin Fangs, …) show nothing and are listed in `skills-report.md`; settle them with `onStriking.skills`. ESR's whirlwind plugin (`ctc_while_uninterruptible`) lets procs fire during Whirlwind, unlike vanilla (`notes`).
- **"On cast"** (`e.oc` 1/0 + `e.ocr`; shown and searchable like "on striking"): whether items' "chance to cast … on cast" (`item_skilloncast`, `cast-skill`) fire. ESR's cast-on-cast plugin (`celestialrayone.cast-on-cast.toml`) fires it after a real cast in the cast animation (mode 10) of a non-aura skill, so it's yes when `skills.txt` `anim` is `SC` (`casts()` in the generator), no for other animations (attack, throw, kick, sequence: Frenzy, Whirlwind; special: the traps), nothing for passives and auras.
- **Assumptions** (an unequipped character): own hard points equal the skill level up to `maxlvl` unless the page's Hard points choice caps them, `stat(…)` is 0, other skills are level 0 (synergies add nothing; `opts.levels` sets them on the detail page), except that a formula of another skill reading the described skill back (Attack's curse total) gets its level, the basic skills (Attack, Throw, …) are level 1, and own `blvl` is capped at `maxlvl`. Integer maths; `/` truncates. Damage is per level bracket (2-8, 9-16, 17-22, 23-28, 29+), shifted by `HitShift`. A line whose percentage comes out as 0 (usually because it depends on another skill's points) is hidden, and the game's " percent" string (`StrSkill23`) shows as "%". `ed*` tokens are before synergies, `en*`/`ex*` after, and `..ns/..ms` values are in 256ths.

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

## How the Classes page works

- **Consume (Warlock):** every demon gives Consume's own aura stats (its skilldesc lines: attributes, life/mana, duration). Each `monpet.txt` row adds its own `consumestat1-5`/`consumecalc1-5`. In the calcs, `sksrc('Consume'.lvl)` becomes `lvl` and `sksrc('Consume'.x)` becomes `skill('consume'.x)`, so `skill-calc.js` evaluates them against Consume's record; `clc2` is `stat('consumeeffect'.accr)`, set from the page's "+% Consume Effect" input.
- **Who:** rows with a `bindchancecalc` can be bound (sections: Monsters, Super Uniques (`superuniques.txt` names), Bosses (`monstats` `boss`)); rows without one are shown only if a Warlock skill summons them (`summon` column). Other classes' summons and hirelings are hidden (listed in `classes-report.md`). A bind calc that checks `sksrc('Bind Demon'.clcN)` names the item whose stat unlocks it (`clc0` is calc10): the Prime Evils need the elite Ars books. Demons with identical lines merge into one card.
- **Wording:** item-style templates from `lib/stat-text.mjs`; `statText` in `class-rules.json` folds min/max/length stats into the game's "Adds X-Y … Damage" strings (`with`, calc templates `x`/`y`/`z` over `{1}{2}{3}`), hides duplicates, and words the Ars flag stats; `calcText` gives fixed text for formulas the page can't evaluate (Mephisto's 2% regen from `Player Stats`). Lines may carry a third value `z` (skill-calc line type 74). The goal in `classes-report.md` is 0 undescribed stats, formula warnings, unformatted lines and unnamed monsters.

## How the Character page works

- **Nothing is uploaded.** `character.js` reads the picked file with FileReader, `d2s.js` parses it, `item-text.js` words it. Saves are personal: `*.d2s` is gitignored; put test saves in the repo root and `build-character.mjs` (and so `build.sh`) test-parses them with the page's own code (`--strict` fails on a save that doesn't parse). `character-report.md` lists hidden stats and unnamed items.
- **Save format:** ESR uses D2RLoader's extended save format (version bytes `05 00 'R' 'D'`), which is retail v105 with wider fields. The widths were reverse-engineered from a real save (D2RLoader doesn't document them) and are listed at the top of `d2s.js` (`FORMAT`): 16-bit stat ids ending in 0xFFFF, 32-bit item stat params, 16-bit unique/set ids, affixes and rare names, 2 extra bits before rare affix slots, an extra byte after the item flags. The runeword field is the **string id** of the runeword's name. Field order otherwise follows d2s-rs (github.com/ResurrectedTrader/d2s-rs). Weapon/armor is decided by the item-type tree (`weap`/`armo`), not the file (quivers are in weapons.txt but have no durability).
- **Wording:** the tooltip's own strings by `descfunc`; an empty `descval` means no value; descfunc 19 without placeholders is a flag ("Indestructible"); text coloured black (`ÿc6`) is the game hiding it (`clean(..., { dropHidden })`). Per-level stats scale with the character level, or with the stat named in `op base` (Total Kills on `kill_base`). descfunc 23 names a monster by `*hcIdx`; ESR keeps item descriptions there (`item_mythicaldesc`). Stats with no description (e.g. `item_nonclassskill`/`item_aura`, whose `_display` twins carry the text) are hidden.
- **Picking the file:** a page can't choose the folder the Open dialog starts in, so the page shows ESR's Windows save folder (`SAVE_FOLDER` in `character.js`) with a Copy button to paste into the dialog's File name box. Where `showOpenFilePicker` exists (Chrome, Edge) it replaces the plain input, and its `id` makes the dialog reopen in the last folder used.
- **Totals live in `char-calc.js`** (UMD, also run by the generator on local saves). Gear per weapon set (`itemsFor`: equipped minus the other set's weapons, plus charms in the charm inventory, since ESR sets `allow_inventory_charms = false`), with runewords, socketed jewels and partial set bonuses for the set items worn. Charm-dedup groups and item requirements are ignored.
- **Skill levels:** hard points + +skills. A skill is usable with hard points or an oskill (`item_nonclassskill`); +all skills raise every usable skill (oskills too), class/tree/single bonuses only the class's own skills with hard points. An oskill doesn't add to hard points: the level is the higher of hard points + every bonus and oskill + all skills (checked in game: DorkTheSorc's Elemental Fury, 1 hard point + Insight's 20 shows 48, not 65).
- **Buffs, auras, passives** (`data.effects`, from skills.txt: `passive` + passivestats, `aura` + aurastats, or aurastats + `auralencalc` + `aurastate` for a cast buff, or `auratargetstate` for a curse, or a stance toggled with `srvdofunc` 116 and no duration (Elemental Fury; stances sharing a state replace each other); the same aura from two items stacks (DorkTheSorc's two Meditations: the in-game cold pierce only adds up with both); plus `item_aura` on gear). Their stats come from the skills' own formulas: the generator ships slim formula records (`data.calc`, built with `lib/skill-records.mjs`, shared with build-skills) and `skill-calc.js` evaluates them with `opts.character` (real hard points as `blvl`, levels with +skills, character stats). Defaults: passives and item auras of the gear in hand on, cast buffs and class auras off; each cast buff can be cast with the main or switch set (default: the higher level). **Self-buffing:** a buff's level is fixed at cast; `compute` recasts every buff that's on until no level changes (Battle Command raises itself and everything cast after it), and the page says how many casts that takes. The report lists effect formula warnings (currently `edma` in Venom and `rand()`). **On enemies:** a skill whose `aurafilter` targets enemies (ignores allies, 0x8000, or is just 2/3; not with 0x40000000, the caster's own stacks, nor `srvstfunc` 39, a state on the caster during the skill) puts its aura stats on them (`t` on the effect): Conviction, curses, Permafrost, Super Teleport. Those stats don't touch the character (its passive stats still do: Sanctuary's magic damage); they show under "On enemies" and are `model.enemy`, which lowers the Damage target's resistances before pierce. **Stages:** an aura stat whose formula reads itself back is a stack counter (`sc`); the page offers each stage where the effect changes (the counter after N applications, default the last), e.g. Permafrost 1–10.
- **Attributes:** Base (saved points; life/mana/stamina are saved in 256ths) and Final (`finalAttributes` over every stat that applies: flat + per-level, then % bonus; vitality/energy above the base add life, stamina and mana at the class's charstats rates in quarters, `classes[].per`; then max life/mana %). The save's current life/mana/stamina are shown as a lower bound; for PewPewPew, Final with Battle Command + Battle Orders on clears it, without them it doesn't.
- **Items shown:** only what counts towards stats: Equipped (both weapon sets; the inactive one is labelled) and the Charm Inventory. Inventory, belt, cube, stash and mercenary items aren't shown (the parser still reads them).
- **Gems, runes and sets:** `lib/property-stats.mjs` turns item properties into stats (properties.txt funcs; random ones are reported). `data.gems` holds each gem/rune's weapon/helm/shield bonuses (shields by the `shie` type, weapons by `weap`, everything else uses the helm list); `data.setBonuses` the sets.txt bonuses per items worn and for the full set.
- **Advanced stats:** resistances after the difficulty's penalty (`difficultylevels.txt` ResistPenalty: ESR uses -80/-150) capped at 75 + max resist, never above 95 (the engine's ceiling, noted in ESR's summon-resist-cap plugin config), speeds, offense, defense total (each armor's own ED, flat defense, dex/4, then defense %), absorbs, find, and every bonus added up. Dodge/avoid/evade are capped at 75 (ESR plugin).
- **Breakpoints:** `AnimData.d2` (standard format, 160-byte records) gives frames and speed per class token + mode + weapon class; frames = ceil(256 × frames / floor(speed × rate / 100)) - 1, rate = 100 + 120x/(120+x) (attack: + skill IAS - weapon speed, max +75; cast: capped at the rate for `fcr_cap` from ESR's cast-rate-cap plugin config). The mod's AnimData has no Warlock animations, so no breakpoints for Warlocks.
- **Damage:** `skillDamage` in char-calc: weapon base × the weapon's own ED + its flat damage, × (other ED + skill ED + Str/Dex × weapons.txt StrBonus/DexBonus), + other flat; × the skill's SrcDam/128 (or ESR's calc10 formula, the skill-srcdam-calc plugin); + item elemental damage × SrcDam; + the skill's own damage (pnma/pxma, enma/exma with elemental mastery). **Conversion** is on the missile the skill fires (`srvmissile` with `pSrvDmgFunc` 1: `DmgCalc1` is the % of physical damage converted to the missile's `EType`, `dl12` = dParam1 + dParam2 per level; shipped as `cv` on the skill record): the converted part takes that element's resistance and pierce, and its mastery when the missile has `ApplyMastery`. **Deadly strike** is averaged in at its chance (1 + chance × (multiplier − 1)) on all weapon damage, converted damage included (it applies before conversion), at ESR's multiplier (200 + `criticaldamage`, the critical-strike-damage plugin). The deadly strike and crushing blow chances are the Advanced stats totals (gear, sockets, set bonuses, passives, buffs), capped at 100% as chances; `item_deadlystrike_cap`/`item_crushingblow_cap` are crafting limits checked by cube recipes, not combat caps. **Crushing blow** (also unaffected by conversion) removes a share of the target's current life, so it isn't added to the per-hit DPS: it's averaged over a whole kill (each hit: average damage + chance × share × life left; effective DPS = life ÷ time to kill), with the target type and life set on the page and the shares from ESR's crushing-blow plugin config (`data.crush`: vanilla share × the plugin's percent; ranged × `[attack] ranged`; reduced by physical resistance). Rate from the skill's own animation at the character's IAS/FCR. Resistances have no -100% floor (the user has seen ESR's Monster Display plugin, which shows the resistances hits really meet, go far below -100). Single missile, single target, always hits. Buffs/auras aren't listed as attacks, nor is a skill with a timed state on the caster that fires no missile (`srvmissile`/`a`–`c`), has no SrcDam and describes no damage (`descdam`): Energy Shield, Bone Armor (`nd` on the record), whose damage columns hold other values. The formula records for all class skills and item-granted skills (+ missiles) are in `data.calc`.
- **Not yet:** multiple missiles/hits, splash, damage over time, conversion, chance to hit (ESR replaces the AR formula: attack-rating plugin), summons, open wounds, the mercenary's auras, charm-dedup, item requirements. Nothing has been checked against the in-game advanced stats screen yet.
- **Also:** rare names (ESR has no rareprefix/raresuffix data) show as the base name. The shared stash (.d2i) isn't read.

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

`site/assets/cube-recipes.js` builds everything with DOM APIs; only the trusted `intro` HTML from the rules file uses innerHTML. Filter state lives in the URL hash (`#q=…&cat=…&quality=…&class=…`), and plain hashes jump to category or group ids. `skills.js` works the same way (`#q=…&class=…&slvl=…&clvl=…&hp=…`; plain hashes jump to `#sor`, `#sor-tree-1`, `#sor-fire-bolt`). While searching, skills whose name matches come first (whole name, then name starts with the query, then name has every term, then some), and classes and trees are ordered by their best match. It builds each skill card once and updates it in place when the levels change, and builds its level table only when opened. A card's title and its "Full details" link open `skill.html#skill=<id>[&slvl=…&clvl=…&hp=…]`.

Trees are listed in the game's order, last `SkillPage` first (Amazon: Javelin, Passive, Bow), on the Skills, Character and Skill Planner pages; the data keeps page order.

`skill-planner.js` (the Skill Planner) shows one class's trees as tabs (opening on the first listed), each skill on its `row`/`col` (6×3 grid; a list at phone width) with a 0–`maxlvl` hard-point stepper. The budget is (character level − 1) × charstats `SkillsPerLevel` + the quest points (misc.txt items with `stat1` `newskills`, the Elixirs of Skill, × difficulties when `questdiffcheck`; shipped as `data.points` and `classes[].perLevel` by build-skills). A first point also puts a point in each missing prerequisite; points over budget, levels below `reqlevel` + points − 1 and missing prerequisites are listed as problems, not blocked. +All/class/tree skills from items raise skills with hard points. The tooltip (current and next level, synergies with each named skill's points, "Gives bonuses to") evaluates the plan with `skill-calc`'s `opts.character` (hard points as `blvl`, levels with +skills; basic skills at 1). The hash holds the plan (`#class=sor&clvl=…&quest=…&all=…&cs=…&t1=…&tree=…&skill=…&p=fire-bolt.20_fire-ball.20`); "Full details" opens `skill.html` with the plan's levels and synergy points.

`skill.js` (the detail page) shows one skill: breadcrumb, levels, values, its "Receives Bonuses From" lines with a hard-points field (0–20) beside each skill they name, fields for the other `sy` skills (curses' "Any Other Curse") and the `sl` skills (level, up to 110), the table at every level with the synergies applied, related skills (requires, leads to, gives bonuses to) and sources. The hash holds the state (`#skill=sor-fire-ball&slvl=…&clvl=…&sor-fire-bolt=20`; plain `#sor-fire-ball` works); links between skills change the hash and keep the levels. In `PAGES` it has `parent: 'skills.html'`, so it gets no nav link of its own and Skills shows as current. Keep WCAG 2.2 AA:

- text contrast ≥ 4.5:1 against the surface colours
- quality is never shown by colour alone (there is always a text label)
- labelled controls, visible focus, a live region for result counts
- the layout works at phone width

## Deployment

`deploy.yml` runs on push to `main`, on manual dispatch, and every 30 minutes. The scheduled run compares the game repo's `main` SHA (via `git ls-remote`) with `esrCommit` in the live `build-info.json`, and only builds when they differ. The build sparse-checks-out `excel/`, `strings/`, `AnimData.d2` and `d2rloader/config/` from the game repo (non-cone patterns, since AnimData.d2 is a file) and runs all three generators. The workflow uses Node 24 and the latest major versions of the Pages actions. GitHub pauses scheduled workflows in repos with no activity for 60 days; re-enable it from the Actions tab if the docs stop updating.
