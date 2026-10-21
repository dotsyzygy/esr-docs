// Turns an item property (properties.txt code + param/min/max, as gems.txt, sets.txt and the
// other item tables use them) into the stats it puts on an item: [{ id, param, value }], the same
// shape site/assets/d2s.js reads from saves. Properties with a fixed value only (gem and set
// bonuses); for a range the max is used. Returns null for properties it can't resolve (random
// skills, by-time stats, …) so callers can report them.
//
// properties.txt lists up to 7 stats per property, each with a func: 1/2/8 value, 3/9 same as the
// previous stat, 5/6/7 min/max/% damage (the stats are implied), 10 skill tab, 11 chance to cast,
// 15 min only, 16 max only, 17 param as the value (per-level stats), 19 charges, 20 a flag,
// 21 class skills (the class in val), 22 one skill (param), 24 param (a number or a skill) + value.

const DAMAGE = {
  5: ['mindamage', 'secondary_mindamage', 'item_throw_mindamage'],
  6: ['maxdamage', 'secondary_maxdamage', 'item_throw_maxdamage'],
  7: ['item_maxdamage_percent', 'item_mindamage_percent'],
};

export function createPropertyResolver({ readTsv }) {
  const props = new Map(readTsv('properties.txt').filter(r => r.code).map(r => [r.code, r]));
  const statId = new Map(readTsv('itemstatcost.txt').filter(r => r['*ID'] !== '').map(r => [r.Stat, +r['*ID']]));
  const skillId = new Map();
  for (const r of readTsv('skills.txt')) {
    if (r['*Id'] === '') continue;
    if (r.skill && !skillId.has(r.skill.toLowerCase())) skillId.set(r.skill.toLowerCase(), +r['*Id']);
  }
  const skill = p => (/^\d+$/.test(String(p)) ? +p : skillId.get(String(p).toLowerCase()));
  const num = v => (v === '' || v == null ? 0 : +v || 0);

  return function resolve(code, param, min, max) {
    const row = props.get(code);
    if (!row) return null;
    const lo = num(min), hi = max === '' || max == null ? lo : num(max);
    const out = [];
    let prev = null;
    for (let k = 1; k <= 7; k++) {
      const func = num(row[`func${k}`]);
      if (!func) continue;
      const add = (name, value, p = 0) => {
        const id = statId.get(name);
        if (id == null) return false;
        prev = { id, param: p, value };
        out.push(prev);
        return true;
      };
      const name = row[`stat${k}`];
      switch (func) {
        case 1: case 2: case 8: case 13: if (!add(name, hi, /^\d+$/.test(String(param)) ? +param : 0)) return null; break;
        case 3: case 9: if (!prev || !add(name, prev.value, prev.param)) return null; break;
        case 5: DAMAGE[5].forEach(n => add(n, lo)); break;
        case 6: DAMAGE[6].forEach(n => add(n, hi)); break;
        case 7: DAMAGE[7].forEach(n => add(n, hi)); break;
        case 10: { // skilltab param = class * 3 + tab; the stat's param is class * 8 + tab
          const p = num(param);
          if (!add(name, hi, (Math.floor(p / 3) << 3) | (p % 3))) return null;
          break;
        }
        case 11: { // chance to cast: min = chance, max = skill level
          const s = skill(param);
          if (s == null || !add(name, lo, (s << 6) | hi)) return null;
          break;
        }
        case 15: if (!add(name, lo)) return null; break;
        case 16: if (!add(name, hi)) return null; break;
        case 17: if (!add(name, num(param))) return null; break;
        case 19: { // charges: min = charges, max = skill level
          const s = skill(param);
          if (s == null || !add(name, (lo << 8) | lo, (s << 6) | hi)) return null;
          break;
        }
        case 20: if (name && !add(name, 1)) return null; break; // a flag; some (indestruct) have no stat
        case 21: if (!add(name, hi, num(row[`val${k}`]))) return null; break;
        case 22: {
          const s = skill(param);
          if (s == null || !add(name, hi, s)) return null;
          break;
        }
        case 24: { // param is a number (monster, type) or a skill (the _display twin of oskill/aura)
          const p = /^\d+$/.test(String(param)) ? +param : skill(param);
          if (p == null || !add(name, hi, p)) return null;
          break;
        }
        default: return null;
      }
    }
    return out;
  };
}
