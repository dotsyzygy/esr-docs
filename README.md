# Eastern Sun Resurrected Docs

Documentation pages for the [Eastern Sun Resurrected](https://github.com/CelestialRayOne/Eastern_Sun_Resurrected) mod, generated from the mod's game data and published with GitHub Pages.

Pages so far:

- **Cube Recipes** (`site/cube-recipes.html`): a searchable list of every player-facing Horadric Cube recipe, generated from `cubemain.txt`.

## How it works

```
scripts/build-cube-recipes.mjs   reads the game data, writes site/data/cube-recipes.enUS.js
scripts/cube-rules.json          categories, hidden rows, grouping, title and requirement wording
site/                            the static site (HTML, CSS, JS); deployed as-is plus the generated data
.github/workflows/deploy.yml     builds and deploys to GitHub Pages
```

The generator resolves the codes in `cubemain.txt` through the other excel tables (`misc`, `armor`, `weapons`, `itemtypes`, `uniqueitems`, `setitems`, `properties`, `itemstatcost`, `skills`, `skilldesc`) into the game's own strings (`data/local/lng/strings/*.json`). The game repo is only read, never modified. When its data is wrong or unclear, fix the presentation in `cube-rules.json`.

### Deployment

`deploy.yml` runs on every push to `main`, on demand from the Actions tab, and every 30 minutes. The scheduled run checks the game repo's latest commit, compares it with the commit the live site was built from (`build-info.json` on the site), and only rebuilds when it changed. Each run's summary shows the generation report.

## Local preview

You need Node 18+ and a checkout of the game repo. By default the script looks for it next to this repo, at `../Eastern_Sun_Resurrected`.

```sh
node scripts/build-cube-recipes.mjs --report=cube-report.md
# or point at the game repo explicitly:
node scripts/build-cube-recipes.mjs --esr=/c/dev/repos/Eastern_Sun_Resurrected --report=cube-report.md
```

Then open `site/cube-recipes.html` in a browser. Double-clicking works, because no server is needed.

`cube-report.md` lists the following:

- rows that matched no rule (shown under "Other Recipes")
- codes that couldn't be resolved
- mods and conditions that were left out

Adjust `scripts/cube-rules.json` until those lists are empty or expected. `--strict` makes the script fail when there are unresolved tokens or uncategorized rows.

### Rules cheat sheet (`scripts/cube-rules.json`)

- `rules`: regexes matched in order against cubemain's `description` column; the first match wins. Each sets a `category`, or `hide: true`. `title` and `group` can use `$1…$n`.
- `hideOutputs` / `hideItemTypes`: drop any recipe that produces one of these outputs (e.g. portals) or uses one of these item types (e.g. removed Gem Cans).
- `titleAbbreviations`, `ingredientSuffix`, `titleReplacements`: tidy up titles taken from the developer descriptions.
- `conditionText`, `hiddenConditionStats`: wording for the "Requires:" chips.
- `propertyText`, `hiddenProperties`, `deltaProperties`: wording for mods the game strings don't cover well.

## License

The code in this repository is under the [MIT License](LICENSE). The game data the pages are generated from belongs to the Eastern Sun Resurrected mod and to Blizzard Entertainment, and is not covered by that license, nor are the generated pages and data files insofar as they reproduce it. Diablo is a trademark of Blizzard Entertainment, Inc.; this project is not affiliated with or endorsed by Blizzard.
