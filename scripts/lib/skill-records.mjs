// Calc records: the formula inputs site/assets/skill-calc.js needs for one skill or missile row
// (params, calcs, aura/passive calcs, durations, mana, damage). Used by build-skills.mjs for the
// Skills page and by build-character.mjs for the effects of buffs, auras and passives.

const slots = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
const n = v => (v === '' || v == null ? 0 : +v || 0);
const trimEnd = arr => { let e = arr.length; while (e && (arr[e - 1] === 0 || arr[e - 1] === '')) e--; return arr.slice(0, e); };
const nonEmpty = arr => arr.some(v => v !== 0 && v !== '');

function damageColumns(row, minCol, minLev, maxCol, maxLev) {
  return [n(row[minCol]), ...slots(5, i => n(row[`${minLev}${i}`])), n(row[maxCol]), ...slots(5, i => n(row[`${maxLev}${i}`]))];
}

// desc is the skill's skilldesc.txt row (for its description missiles).
export function skillRecord(row, desc) {
  const d = desc || {};
  const rec = { k: row.skill.toLowerCase() };
  if (row.maxlvl) rec.mx = +row.maxlvl;
  const p = trimEnd(slots(20, i => n(row[`Param${i}`])));
  if (p.length) rec.p = p;
  const c = trimEnd(slots(10, i => row[`calc${i}`] || ''));
  if (c.length) rec.c = c;
  const as = trimEnd(slots(6, i => row[`aurastatcalc${i}`] || ''));
  if (as.length) rec.as = as;
  const ps = trimEnd(slots(14, i => row[`passivecalc${i}`] || ''));
  if (ps.length) rec.ps = ps;
  if (row.auralencalc) rec.len = row.auralencalc;
  if (row.aurarangecalc) rec.rng = row.aurarangecalc;
  if (row.petmax) rec.pet = row.petmax;
  if (row.mana || row.lvlmana || row.minmana) {
    rec.mn = [n(row.mana), n(row.lvlmana), row.manashift === '' ? null : n(row.manashift), n(row.minmana)];
  }
  if (row.ToHit || row.LevToHit) rec.th = [n(row.ToHit), n(row.LevToHit)];
  if (row.HitShift !== '') rec.hs = n(row.HitShift);
  const pd = damageColumns(row, 'MinDam', 'MinLevDam', 'MaxDam', 'MaxLevDam');
  if (nonEmpty(pd)) rec.pd = pd;
  if (row.DmgSymPerCalc) rec.psym = row.DmgSymPerCalc;
  const ed = damageColumns(row, 'EMin', 'EMinLev', 'EMax', 'EMaxLev');
  if (nonEmpty(ed)) rec.ed = ed;
  if (row.EDmgSymPerCalc) rec.esym = row.EDmgSymPerCalc;
  const el = [n(row.ELen), ...slots(3, i => n(row[`ELevLen${i}`]))];
  if (nonEmpty(el)) rec.el = el;
  if (row.ELenSymPerCalc) rec.lsym = row.ELenSymPerCalc;
  const ms = slots(3, i => (d[`descmissile${i}`] || '').toLowerCase());
  if (ms.some(Boolean)) rec.ms = trimEnd(ms);
  return rec;
}

export function missileRecord(row) {
  const rec = { k: row.Missile.toLowerCase() };
  if (row.Range) rec.r = n(row.Range);
  if (row.Radius) rec.rad = n(row.Radius);
  const p = trimEnd(slots(5, i => n(row[`Param${i}`])));
  if (p.length) rec.p = p;
  if (row.HitShift !== '') rec.hs = n(row.HitShift);
  const pd = damageColumns(row, 'MinDamage', 'MinLevDam', 'MaxDamage', 'MaxLevDam');
  if (nonEmpty(pd)) rec.pd = pd;
  if (row.DmgSymPerCalc) rec.psym = row.DmgSymPerCalc;
  const ed = damageColumns(row, 'EMin', 'MinELev', 'EMax', 'MaxELev');
  if (nonEmpty(ed)) rec.ed = ed;
  if (row.EDmgSymPerCalc) rec.esym = row.EDmgSymPerCalc;
  const el = [n(row.ELen), ...slots(3, i => n(row[`ELevLen${i}`]))];
  if (nonEmpty(el)) rec.el = el;
  return rec;
}

// Every formula string in a record (or line list), for following references.
export function formulas(obj) {
  const out = [];
  (function walk(v) {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  })(obj);
  return out;
}
