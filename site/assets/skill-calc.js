/* Skill formula evaluator and description-line formatter.
   Shared by scripts/build-skills.mjs (Node, which uses it to validate every line) and the
   Skills page (window.ESRSkillCalc, which re-evaluates lines for the chosen skill and
   character level). The formulas are the game's own calc strings from skills.txt,
   skilldesc.txt and missiles.txt, shipped as data by the generator.

   Assumptions, matching an unequipped character:
   - every stat('…'.accr) is 0 unless the data's `stats` sets a default
   - other skills are at level 0 (so synergies add nothing), except the basic skills every
     character has (Attack, Throw, …), which are at level 1
   - the skill's own hard points (blvl) are capped at its max level */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESRSkillCalc = factory();
})(this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Parsing. Integer arithmetic with comparisons, ?: and the game's lookups,
  // e.g. min(6,(stat('skillcontrolfire1'.accr)*3/8+3)) or skill('Fire Ball'.blvl).
  // ---------------------------------------------------------------------

  var TOKEN = /\s*(?:(\d+)|([A-Za-z_][A-Za-z0-9_]*)|'([^']*)'|(==|!=|>=|<=|&&|\|\||[-+*\/%()?:<>,.!]))/g;

  function tokenize(src) {
    var out = [], pos = 0, m;
    while (pos < src.length) {
      TOKEN.lastIndex = pos;
      m = TOKEN.exec(src);
      if (!m || m.index !== pos) {
        if (/^\s*$/.test(src.slice(pos))) break;
        throw new Error('unexpected "' + src.slice(pos, pos + 12) + '"');
      }
      pos = TOKEN.lastIndex;
      if (m[1] != null) out.push({ t: 'num', v: +m[1] });
      else if (m[2] != null) out.push({ t: 'id', v: m[2] });
      else if (m[3] != null) out.push({ t: 'str', v: m[3] });
      else out.push({ t: 'op', v: m[4] });
    }
    return out;
  }

  // Lowest precedence first; ?: sits below all of these.
  var LEVELS = [['||'], ['&&'], ['==', '!=', '<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];

  function parse(src) {
    // Cells that Excel quoted ("min(ln12,30)") keep their quotes in the .txt files.
    var toks = tokenize(String(src).replace(/^\s*"|"\s*$/g, '')), i = 0;
    function isOp(v) { var t = toks[i]; return !!t && t.t === 'op' && t.v === v; }
    function eat(v) { if (!isOp(v)) throw new Error('expected "' + v + '"'); i++; }
    function ternary() {
      var c = binary(0);
      if (!isOp('?')) return c;
      i++;
      var a = ternary();
      eat(':');
      return { k: '?', c: c, a: a, b: ternary() };
    }
    function binary(level) {
      if (level === LEVELS.length) return unary();
      var left = binary(level + 1);
      while (toks[i] && toks[i].t === 'op' && LEVELS[level].indexOf(toks[i].v) >= 0) {
        var op = toks[i++].v;
        left = { k: op, a: left, b: binary(level + 1) };
      }
      return left;
    }
    function unary() {
      if (isOp('-') || isOp('+') || isOp('!')) { var op = toks[i++].v; return { k: 'u' + op, a: unary() }; }
      return primary();
    }
    function primary() {
      var t = toks[i++];
      if (!t) throw new Error('unexpected end');
      if (t.t === 'num') return { k: 'n', v: t.v };
      if (t.t === 'op' && t.v === '(') { var e = ternary(); eat(')'); return e; }
      if (t.t !== 'id') throw new Error('unexpected "' + t.v + '"');
      var name = t.v.toLowerCase();
      if (!isOp('(')) return { k: 'id', v: name };
      i++;
      // Lookup: skill('Fire Ball'.blvl), stat('x'.accr), miss('m'.rang), sklvl('S'.lvl.edmn)
      if (toks[i] && toks[i].t === 'str') {
        var ref = { k: 'ref', f: name, name: toks[i++].v.toLowerCase(), path: [] };
        while (isOp('.')) {
          i++;
          var p = toks[i++];
          if (!p || (p.t !== 'id' && p.t !== 'num')) throw new Error('bad lookup path');
          ref.path.push(p.t === 'num' ? p.v : p.v.toLowerCase());
        }
        eat(')');
        return ref;
      }
      var args = [];
      if (!isOp(')')) {
        args.push(ternary());
        while (isOp(',')) { i++; args.push(ternary()); }
      }
      eat(')');
      return { k: 'fn', f: name, args: args };
    }
    var ast = ternary();
    if (i < toks.length) throw new Error('unexpected "' + toks[i].v + '"');
    return ast;
  }

  var parsed = {};
  function compile(src) {
    if (!Object.prototype.hasOwnProperty.call(parsed, src)) {
      try { parsed[src] = parse(src); } catch (e) { parsed[src] = { k: 'err', msg: e.message }; }
    }
    return parsed[src];
  }

  // ---------------------------------------------------------------------
  // Evaluation
  // ---------------------------------------------------------------------

  // Damage per level: [base, levels 2-8, 9-16, 17-22, 23-28, 29+]; length: [base, 2-8, 9-16, 17+].
  var DAMAGE_STEPS = [[2, 8], [9, 16], [17, 22], [23, 28], [29, Infinity]];
  var LENGTH_STEPS = [[2, 8], [9, 16], [17, Infinity]];
  function levelled(arr, off, steps, lvl) {
    if (!arr) return 0;
    var v = arr[off] || 0;
    for (var s = 0; s < steps.length; s++) {
      var lo = steps[s][0], hi = steps[s][1];
      if (lvl >= lo) v += (arr[off + s + 1] || 0) * (Math.min(lvl, hi) - lo + 1);
    }
    return v;
  }
  function div(a, b) { return b ? Math.trunc(a / b) : 0; }

  // m1en etc.: missile 1-3 damage, mapped to the skill-level damage tokens.
  var MISSILE_TOKENS = { en: 'enma', ex: 'exma', eo: 'enms', ey: 'exms', nm: 'pnma', xm: 'pxma' };

  /* db: { s: {skill key: record}, m: {missile key: record}, base: [skill keys], stats: {}, aliases: {} }
     opts: { ulvl, warn(kind, detail), character, levels }
     opts.levels sets other skills' levels for an otherwise unequipped character (the skill
     detail page's synergy points): { skill key: { blvl, lvl } }.
     opts.character evaluates for a real character instead of an unequipped one (the Character
     page): { skills: {skill key: { blvl, lvl }}, stats: {stat name: value} }, where blvl is the
     hard points and lvl the level with +skills. Skills it doesn't list are at 0. */
  function Calc(db, opts) {
    opts = opts || {};
    this.db = db;
    this.ulvl = opts.ulvl || 1;
    this.stats = db.stats || {};
    this.aliases = db.aliases || {};
    this.base = {};
    for (var i = 0; i < (db.base || []).length; i++) this.base[db.base[i]] = true;
    this.warn = opts.warn || function () {};
    this.character = opts.character || null;
    this.levels = opts.levels || null;
    this.memo = {};
    this.depth = 0;
  }

  // Evaluate a formula (string or number) for skill record `rec` at skill level `lvl`.
  Calc.prototype.run = function (rec, src, lvl) {
    if (src == null || src === '') return 0;
    if (typeof src === 'number') return src;
    var ast = compile(src);
    if (ast.k === 'err') { this.warn('parse', src + ' (' + ast.msg + ')'); return 0; }
    if (++this.depth > 60) { this.depth--; this.warn('recursion', rec.k + ': ' + src); return 0; }
    // The skill being described: other skills' formulas that read it back get its level.
    if (this.depth === 1) this.self = { k: rec.k, lvl: lvl };
    try { return this.node(ast, rec, lvl); } finally { this.depth--; }
  };

  // Cached evaluation of one of the record's own calc columns.
  Calc.prototype.cached = function (rec, key, src, lvl) {
    if (src == null || src === '') return 0;
    var id = rec.k + '\u0000' + key + '\u0000' + lvl;
    // Another skill's value may read the described skill's level (Attack's curse total).
    if (this.self && this.self.k !== rec.k) id += '\u0000' + this.self.k + '\u0000' + this.self.lvl;
    if (!(id in this.memo)) {
      this.memo[id] = 0; // breaks self-reference loops
      this.memo[id] = this.run(rec, src, lvl);
    }
    return this.memo[id];
  };

  Calc.prototype.node = function (n, rec, lvl) {
    switch (n.k) {
      case 'n': return n.v;
      case 'id': return this.token(rec, n.v, lvl);
      case 'ref': return this.ref(rec, n, lvl);
      case 'fn': return this.fn(rec, n, lvl);
      case '?': return this.node(n.c, rec, lvl) ? this.node(n.a, rec, lvl) : this.node(n.b, rec, lvl);
      case 'u-': return -this.node(n.a, rec, lvl);
      case 'u+': return this.node(n.a, rec, lvl);
      case 'u!': return this.node(n.a, rec, lvl) ? 0 : 1;
    }
    var a = this.node(n.a, rec, lvl), b = this.node(n.b, rec, lvl);
    switch (n.k) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return div(a, b);
      case '%': return b ? a % b : 0;
      case '==': return a === b ? 1 : 0;
      case '!=': return a !== b ? 1 : 0;
      case '<': return a < b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
      case '&&': return a && b ? 1 : 0;
      case '||': return a || b ? 1 : 0;
    }
    this.warn('operator', n.k);
    return 0;
  };

  Calc.prototype.fn = function (rec, n, lvl) {
    var vals = [];
    for (var i = 0; i < n.args.length; i++) vals.push(this.node(n.args[i], rec, lvl));
    if (n.f === 'min') return vals.length ? Math.min.apply(null, vals) : 0;
    if (n.f === 'max') return vals.length ? Math.max.apply(null, vals) : 0;
    this.warn('function', n.f);
    return vals[0] || 0;
  };

  function par(rec, i) { return (rec.p && rec.p[i - 1]) || 0; }

  Calc.prototype.token = function (rec, name, lvl) {
    var m;
    // Aliases fix typos in the data ("me3o" for "m3eo"); a number pins a token to a value.
    if (Object.prototype.hasOwnProperty.call(this.aliases, name)) {
      if (typeof this.aliases[name] === 'number') return this.aliases[name];
      name = this.aliases[name];
    }
    switch (name) {
      case 'lvl': return lvl;
      case 'blvl':
        if (this.character) return (this.character.skills[rec.k] || {}).blvl || 0;
        return rec.mx ? Math.min(lvl, rec.mx) : lvl;
      case 'ulvl': return this.ulvl;
      case 'len': return this.cached(rec, 'len', rec.len, lvl);
      case 'rng': return this.cached(rec, 'rng', rec.rng, lvl);
      case 'pets': return this.cached(rec, 'pet', rec.pet, lvl);
      case 'usmc': return this.manaCost(rec, lvl);
      case 'toht': return rec.th ? (rec.th[0] || 0) + (rec.th[1] || 0) * (lvl - 1) : 0;
      case 'edmn': case 'edmx': case 'edns': case 'edxs':
      case 'enma': case 'exma': case 'enms': case 'exms':
      case 'edln': case 'pnma': case 'pxma':
        return this.damage(rec, rec, name, lvl);
    }
    if ((m = /^par(\d+)$/.exec(name))) return par(rec, +m[1]);
    if ((m = /^clc(\d+)$/.exec(name))) return this.cached(rec, name, rec.c && rec.c[m[1] - 1], lvl);
    if ((m = /^ast(\d+)$/.exec(name))) return this.cached(rec, name, rec.as && rec.as[m[1] - 1], lvl);
    if ((m = /^pst(\d+)$/.exec(name))) return this.cached(rec, name, rec.ps && rec.ps[m[1] - 1], lvl);
    if ((m = /^ln(\d)(\d)$/.exec(name))) return par(rec, +m[1]) + (lvl - 1) * par(rec, +m[2]);
    if ((m = /^dm(\d)(\d)$/.exec(name))) {
      var lo = par(rec, +m[1]), hi = par(rec, +m[2]);
      return lo + div(110 * lvl * (hi - lo), 100 * (lvl + 6));
    }
    if ((m = /^m([1-3])(en|ex|eo|ey|nm|xm)$/.exec(name))) {
      var ms = rec.ms && rec.ms[m[1] - 1] && this.db.m[rec.ms[m[1] - 1]];
      if (!ms) { this.warn('missile', rec.k + ' ' + name); return 0; }
      return this.damage(ms, rec, MISSILE_TOKENS[m[2]], lvl);
    }
    this.warn('token', name);
    return 0;
  };

  // Mana cost in 256ths of a point, as skilldesc's usmc expects.
  Calc.prototype.manaCost = function (rec, lvl) {
    var mn = rec.mn;
    if (!mn) return 0;
    var cost = ((mn[0] || 0) + (mn[1] || 0) * (lvl - 1)) * Math.pow(2, mn[2] == null ? 8 : mn[2]);
    var floor = (mn[3] || 0) * 256;
    return Math.trunc(Math.max(cost, floor));
  };

  /* Damage tokens. src is the skill or missile row that holds the damage columns; rec is the
     skill whose synergy formulas apply. Suffix ..ns/..xs/..ms is in 256ths of a point
     (per frame for poison), ..mn/..mx/..ma is in points. ed.. is before synergies, en.. after. */
  Calc.prototype.damage = function (src, rec, which, lvl) {
    var scale = Math.pow(2, src.hs == null ? 8 : src.hs);
    var physical = which === 'pnma' || which === 'pxma';
    var max = which === 'edmx' || which === 'edxs' || which === 'exma' || which === 'exms' || which === 'pxma';
    if (which === 'edln') {
      var len = levelled(src.el, 0, LENGTH_STEPS, lvl);
      return div(len * (100 + this.run(rec, src.lsym, lvl)), 100);
    }
    var raw = levelled(physical ? src.pd : src.ed, max ? 6 : 0, DAMAGE_STEPS, lvl) * scale;
    var synergy = which.charAt(1) !== 'd' || physical; // en.., ex.., pnma, pxma
    if (synergy) raw = div(raw * (100 + this.run(rec, physical ? src.psym : src.esym, lvl)), 100);
    return /s$/.test(which) ? raw : div(raw, 256);
  };

  Calc.prototype.ref = function (rec, n, lvl) {
    var target, prop = n.path[n.path.length - 1];
    switch (n.f) {
      case 'stat':
        if (this.character && n.name in this.character.stats) return this.character.stats[n.name] || 0;
        return this.stats[n.name] || 0;
      case 'sksrc':
        return 0;
      case 'skill':
        if (n.name === rec.k) return this.token(rec, prop, lvl);
        if (this.character) {
          var own = this.character.skills[n.name];
          if (!own) return 0;
          if (prop === 'blvl') return own.blvl;
          if (prop === 'lvl') return own.lvl;
          target = this.db.s[n.name];
          return target ? this.token(target, prop, own.lvl) : 0;
        }
        if (this.levels && this.levels[n.name]) {
          var set = this.levels[n.name];
          if (prop === 'blvl') return set.blvl;
          if (prop === 'lvl') return set.lvl;
          target = this.db.s[n.name];
          return target ? this.token(target, prop, set.lvl) : 0;
        }
        // Read back from another skill's formula: the described skill at its own level.
        if (this.self && n.name === this.self.k) {
          target = this.db.s[n.name];
          return target ? this.token(target, prop, this.self.lvl) : 0;
        }
        // A character without the skill gets 0, except for the basic skills everyone has.
        if (!this.base[n.name]) return 0;
        target = this.db.s[n.name];
        if (!target) { this.warn('skill', n.name); return 0; }
        return this.token(target, prop, 1);
      case 'sklvl':
        // sklvl('Skill'.lvl.edmn): another skill's value at a level computed here.
        target = this.db.s[n.name];
        if (!target) { this.warn('skill', n.name); return 0; }
        var at = n.path.length > 1
          ? (typeof n.path[0] === 'number' ? n.path[0] : this.token(rec, n.path[0], lvl))
          : lvl;
        return this.token(target, prop, at);
      case 'miss':
        var ms = this.db.m[n.name];
        if (!ms) { this.warn('missile', n.name); return 0; }
        if (prop === 'rang') return ms.r || 0;
        if (prop === 'rad') return ms.rad || 0;
        var pm = /^par(\d+)$/.exec(prop);
        if (pm) return par(ms, +pm[1]);
        return this.damage(ms, rec, prop, lvl);
    }
    this.warn('function', n.f + "('" + n.name + "')");
    return 0;
  };

  // ---------------------------------------------------------------------
  // Description lines
  // ---------------------------------------------------------------------

  function num(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '0';
    return String(Math.round(v * 100) / 100);
  }

  function sprintf(tmpl, vals) {
    var i = 0;
    return String(tmpl).replace(/%(\+?)(\d*)(?:\.(\d+))?([dsif%])/g, function (all, plus, width, prec, t) {
      if (t === '%') return '%';
      var v = vals[i++];
      if (t === 's') return v == null ? '' : String(v);
      v = +v || 0;
      return (plus && v >= 0 ? '+' : '') + (prec ? v.toFixed(+prec) : num(v));
    });
  }

  function signed(v) { return (v >= 0 ? '+' : '') + num(v); }

  // Line types are skilldesc's descline/dsc2line/dsc3line numbers.
  var LINE_TYPES = {
    3: function (l, a) { return l.a + num(a) + l.b; },
    4: function (l, a) { return l.a + signed(a) + l.b; },
    5: function (l, a) { return l.a + num(a); },
    6: function (l, a) { return signed(a) + l.b + l.a; },
    13: function (l, a) { return sprintf(l.a, [a]); },
    18: function (l) { return l.a; },
    25: function (l) { return l.a + l.b; },
    // a/b as a decimal; textA when that is exactly 1 (singular), else textB.
    36: function (l, a, b) { var v = b ? a / b : a; return sprintf(v === 1 || !l.b ? l.a : l.b, [v]); },
    40: function (l) { return sprintf(l.a, [l.b]); },
    63: function (l, a) { return l.a + ': ' + signed(a) + '% ' + l.b; },
    67: function (l, a) { return l.a + ': ' + signed(a) + ' ' + l.b; },
    74: function (l, a, b, c) { return sprintf(l.a, [a, b, c]); },
    75: function (l, a, b) { return sprintf(l.a, [a, b]); },
    76: function (l, a, b) { return sprintf(l.a, [l.b, a, b]); },
    78: function (l) { return sprintf(l.a, [l.b]); },
    79: function (l, a, b) { return sprintf(l.a, [l.b, b ? a / b : a]); }
  };

  function isKnownType(t) { return t === 0 || Object.prototype.hasOwnProperty.call(LINE_TYPES, t); }

  /* line: { t: type, a: textA, b: textB, x: calcA, y: calcB, z: optional third value }. Returns the display text
     (may contain "\n" for multi-line strings), or null for hidden lines. */
  Calc.prototype.line = function (rec, line, lvl) {
    if (!line.t) return null;
    var fmt = LINE_TYPES[line.t];
    var a = this.run(rec, line.x, lvl);
    var b = line.y == null || line.y === '' ? 0 : this.run(rec, line.y, lvl);
    var c = line.z == null || line.z === '' ? 0 : this.run(rec, line.z, lvl);
    var l = { a: line.a || '', b: line.b || '' };
    var text = fmt ? fmt(l, a, b, c) : sprintf(l.a, [a, b, c]);
    // The game fills the placeholders in stored order, then draws the lines bottom up.
    text = text.split('\n').reverse().join('\n');
    // Some strings omit the space after a label ("Attack Rating:75"). StrSkill23 is " percent",
    // and its leading space is lost when strings are trimmed: "0percent" -> "0%".
    text = text.replace(/:(?=[+\-]?\d)/g, ': ')
      .replace(/(\d) ?percent ?/gi, '$1% ')
      .replace(/[ \t]+/g, ' ').trim();
    // A percentage that comes out as 0 ("Resist Magic: 0%") says nothing; hide the line.
    if (/(^|[^\d.])[+\-]?0%/.test(text)) return null;
    return text;
  };

  // Does the line's text change with skill level (or character level)? Static text never does.
  function usesCalc(line) {
    return !!(line.x || line.y || line.z) && line.t !== 18 && line.t !== 25 && line.t !== 40 && line.t !== 78;
  }

  /* Split a column of texts (one line at several levels) into a shared label and the varying
     part: "Fire Damage: 3-6" / "Fire Damage: 5-8" -> label "Fire Damage", cells "3-6", "5-8". */
  function splitColumn(texts) {
    var first = texts[0] || '', pre = first.length, suf = first.length, i, j;
    for (i = 1; i < texts.length; i++) {
      var t = texts[i];
      j = 0;
      while (j < pre && j < t.length && t[j] === first[j]) j++;
      pre = j;
      j = 0;
      while (j < suf && j < t.length && t[t.length - 1 - j] === first[first.length - 1 - j]) j++;
      suf = j;
    }
    var colon = first.lastIndexOf(':', pre);
    if (colon > 0 && colon < pre) {
      var cut = colon + 1;
      return {
        label: first.slice(0, colon).trim(),
        cells: texts.map(function (t) { return t.slice(cut).trim(); })
      };
    }
    // No shared "Label:" prefix: use a shared trailing phrase ("4 cosmic shards") if any.
    var tail = first.slice(first.length - suf);
    var sp = tail.indexOf(' ');
    if (sp >= 0 && /[A-Za-z]/.test(tail.slice(sp))) {
      tail = tail.slice(sp);
      return {
        label: tail.trim().replace(/^[a-z]/, function (c) { return c.toUpperCase(); }),
        cells: texts.map(function (t) { return t.slice(0, t.length - tail.length).trim(); })
      };
    }
    return { label: '', cells: texts.slice() };
  }

  /* Other skills a skill's numbers depend on: every skill('Name'.prop) in its record, its
     description lines and its description missiles. Returns { skill key: { blvl, lvl } } with
     true for each property used (blvl: hard points, as synergies use; lvl: with +skills). */
  var SKILL_REF = /skill\s*\(\s*'([^']+)'\s*\.\s*(\w+)\s*\)/gi;
  function skillRefs(db, rec, lines) {
    var out = {}, seen = {};
    function walk(v, texts) {
      if (typeof v === 'string') texts.push(v);
      else if (v && typeof v === 'object') for (var k in v) walk(v[k], texts);
      return texts;
    }
    // A value read from another skill (skill('Attack'.clc1)) brings that skill's references too.
    (function scan(r, extra) {
      seen[r.k] = true;
      walk([r, extra, (r.ms || []).map(function (m) { return db.m[m]; })], []).forEach(function (t) {
        var m;
        SKILL_REF.lastIndex = 0;
        var found = [];
        while ((m = SKILL_REF.exec(t))) found.push([m[1].toLowerCase(), m[2].toLowerCase()]);
        found.forEach(function (f) {
          var key = f[0], prop = f[1];
          if (prop !== 'blvl' && prop !== 'lvl' && db.s[key] && !seen[key]) scan(db.s[key]);
          if (key === rec.k) return;
          var o = out[key] || (out[key] = { blvl: false, lvl: false });
          if (prop === 'blvl') o.blvl = true;
          else o.lvl = true;
        });
      });
    })(rec, lines);
    return out;
  }

  return {
    parse: parse,
    skillRefs: skillRefs,
    compile: compile,
    Calc: Calc,
    sprintf: sprintf,
    isKnownType: isKnownType,
    usesCalc: usesCalc,
    splitColumn: splitColumn
  };
});
