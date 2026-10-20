// Stat wording shared by the generators that describe stats a skill grants (skills, classes):
// the way the game words a stat on an item, as a printf template for skill-calc.js line type 13.

// statByKey: Map(lowercased itemstatcost Stat -> row); str: loadStrings() lookup.
// Returns template(statKey): "%+d%% to Magic Spell Damage", or null when the stat's descfunc
// isn't one of the simple value-plus-string forms.
export function createStatTemplate(statByKey, str) {
  return function statTemplate(statKey) {
    const st = statByKey.get(statKey.toLowerCase());
    if (!st) return null;
    const s = str(st.descstrpos) || str(st.descstrneg);
    if (!s) return null;
    const pct = s.replace(/%/g, '%%');
    const before = +st.descval === 2 ? false : st.descval !== '0';
    const wrap = v => (+st.descval === 0 ? pct : before ? `${v} ${pct}` : `${pct} ${v}`);
    switch (+st.descfunc) {
      case 19: return s;
      case 1: case 12: return wrap('%+d');
      case 2: return wrap('%d%%');
      case 3: return wrap('%d');
      case 4: return wrap('%+d%%');
      default: return null;
    }
  };
}

// Rules' statText: { stat: { text, calc } } -> Map(lowercased stat -> { text, calc }).
export function statTextMap(statText) {
  return new Map(Object.entries(statText || {}).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k.toLowerCase(), v]));
}
