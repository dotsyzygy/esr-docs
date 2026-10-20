/* Item names and mod lines for items read from a save (site/assets/d2s.js), worded with the
   game's own strings the way the in-game tooltip words them.
   Shared by scripts/build-character.mjs (Node, which reports stats that show nothing) and the
   Character page (window.ESRItemText).

   create(data) takes the generated data (window.ESR_CHAR_DATA) and returns:
   - lines(stats, ctx): [{ text, id }] for a stat list ({ id, param, value }), sorted like the
     tooltip (descpriority, highest first). Stats the game doesn't describe (internal counters,
     the hidden twin of a displayed stat) are left out; ctx.skipped collects their ids.
     ctx.level is the character level, for "(Based on Character Level)" stats, and ctx.base the
     character's own stats by name, for stats based on another stat (Total Kills on kill_base).
   - name(item): { title, base, quality } with quality one of QUALITY's labels.
   - stat(stats, statName, ctx): the summed value of one stat on a list, scaled like its line. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESRItemText = factory();
})(this, function () {
  'use strict';

  var QUALITY = { 1: 'Low Quality', 2: 'Normal', 3: 'Superior', 4: 'Magic', 5: 'Set', 6: 'Rare', 7: 'Unique', 8: 'Crafted', 9: 'Tempered' };

  // Fill printf-style placeholders (%d %+d %i %s %%) in order, and %0 %1 … by position.
  function sprintf(fmt, values) {
    var i = 0;
    return String(fmt)
      .replace(/%(\d)/g, function (_, n) { return '\u0000' + n; })
      .replace(/%(\+?)([dius%])/g, function (_, plus, t) {
        if (t === '%') return '%';
        var v = values[i++];
        if (v == null) return '';
        if (plus && typeof v === 'number' && v >= 0) return '+' + v;
        return String(v);
      })
      .replace(/\u0000(\d)/g, function (_, n) { var v = values[+n]; return v == null ? '' : String(v); })
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim();
  }

  function create(data) {
    var stats = data.stats, text = data.text || {};
    var byName = {};
    Object.keys(stats).forEach(function (id) { byName[stats[id].n] = +id; });

    function skillName(id) {
      var s = data.skills[id];
      return s ? s[0] : 'Skill #' + id;
    }
    function classOnly(skillId) {
      var s = data.skills[skillId];
      var c = s && s[1] != null ? data.classes[s[1]] : null;
      return c ? c.only : '';
    }

    // "(Based on Character Level)" stats scale with the level in 2^param steps; a few scale with
    // another character stat instead (op base). Without that stat the raw value is shown.
    function shown(st, value, ctx) {
      if (!st.ob || !(st.op === 2 || st.op === 4 || st.op === 5)) return value;
      var base = st.ob === 'level' ? ctx && ctx.level : ctx && ctx.base && ctx.base[st.ob];
      if (base == null) return value;
      return Math.floor(value * base / Math.pow(2, st.opp || 0));
    }

    // One stat's line, or null when the game doesn't describe it.
    function statText(id, value, param, ctx) {
      var st = stats[id];
      if (!st) return null;
      var v = shown(st, value, ctx);
      var fn = st.fn || 0;
      var s = (v < 0 && st.g) ? st.g : st.p;
      var s2 = st.s2 || '';
      var cls;
      switch (fn) {
        case 13: // +N to <Class> Skill Levels, the class is the param
          cls = data.classes[param];
          return cls ? sprintf(cls.all, [v]) : null;
        case 14: { // +N to <Tab> Skills (<Class> Only); param = class * 8 + tab
          cls = data.classes[param >> 3];
          var tab = cls && cls.tabs[param & 7];
          return tab ? sprintf(tab, [v]) + ' ' + cls.only : null;
        }
        case 15: // N% Chance to Cast Level L <Skill> on …; param = skill << 6 | level
          return s ? sprintf(s, [v, param & 63, skillName(Math.floor(param / 64))]) : null;
        case 16: // Level N <Skill> Aura When Equipped
          return s ? sprintf(s, [v, skillName(param)]) : 'Level ' + v + ' ' + skillName(param) + ' Aura When Equipped';
        case 24: { // Level L <Skill> (cur/max Charges); value = max << 8 | cur
          var max = Math.floor(value / 256), cur = value & 255;
          return s ? sprintf(s, [param & 63, skillName(Math.floor(param / 64)), cur, max]) : null;
        }
        case 22: // N% … versus <monster type>
          return s ? sprintf(s, [v, data.montypes[param] || 'Monster type #' + param]) : null;
        case 23: // N% … <monster> (ESR also keeps item descriptions as monster names)
          return s ? sprintf(s, [v, data.monsters[param] || 'Monster #' + param]) : null;
        case 27: // +N to <Skill> (<Class> Only)
          return s ? sprintf(s, [v, skillName(param), classOnly(param)]) : null;
        case 28: // +N to <Skill>
          return s ? sprintf(s, [v, skillName(param)]) : null;
      }
      if (!s) return null;
      if (/%[+]?[dius]|%\d/.test(s)) {
        var line = sprintf(s, [v, v, v]);
        return s2 ? line + ' ' + s2 : line;
      }
      if (fn === 19) return s2 ? s + ' ' + s2 : s; // a flag such as "Indestructible"
      var dv = st.dv || 0; // empty means no value, as in the game
      var num = v, sign = v >= 0 ? '+' + v : String(v);
      switch (fn) {
        case 1: case 6: case 12: num = sign; break;
        case 2: case 7: num = v + '%'; break;
        case 4: case 8: num = sign + '%'; break;
        case 5: case 10: num = Math.floor(v * 100 / 128) + '%'; break;
        case 11: return s;
        case 20: num = -v + '%'; break;
        case 21: num = String(-v); break;
      }
      var parts = dv === 0 ? [s] : dv === 2 ? [s, num] : [num, s];
      if (s2 && (fn === 6 || fn === 7 || fn === 8 || fn === 9 || fn === 10)) parts.push(s2);
      return parts.join(' ').replace(/\s+%/g, '%').trim();
    }

    // Stats the tooltip shows as one line ("Adds 19-37 Fire Damage to Attacks").
    var DAMAGE = [
      ['firemindam', 'firemaxdam', null, 'strModFireDamage', 'strModFireDamageRange'],
      ['lightmindam', 'lightmaxdam', null, 'strModLightningDamage', 'strModLightningDamageRange'],
      ['magicmindam', 'magicmaxdam', null, 'strModMagicDamage', 'strModMagicDamageRange'],
      ['coldmindam', 'coldmaxdam', 'coldlength', 'strModColdDamage', 'strModColdDamageRange'],
      ['mindamage', 'maxdamage', null, 'strModMinDamage', 'strModMinDamageRange']
    ];
    var GROUPS = [
      { names: ['fireresist', 'lightresist', 'coldresist', 'poisonresist'], key: 'strModAllResistances' },
      { names: ['strength', 'energy', 'dexterity', 'vitality'], key: 'Moditem2allattrib' }
    ];

    // Sum stats with the same id and param (an item's own mods plus its runeword's, …).
    function merge(list) {
      var out = [], at = {};
      list.forEach(function (s) {
        var k = s.id + ':' + s.param;
        if (k in at) out[at[k]].value += s.value;
        else { at[k] = out.length; out.push({ id: s.id, param: s.param, value: s.value }); }
      });
      return out;
    }

    function lines(list, ctx) {
      var merged = merge(list || []);
      var plain = {}; // stat name -> value, for stats without a param
      merged.forEach(function (s) { if (!s.param && stats[s.id]) plain[stats[s.id].n] = s.value; });
      var used = {};
      var out = [];
      var prio = function (name) { var st = stats[byName[name]]; return (st && st.pr) || 0; };
      var add = function (t, names) {
        if (!t) return;
        out.push({ text: t, id: byName[names[0]], pr: prio(names[0]) });
        names.forEach(function (n) { used[n] = true; });
      };
      var has = function (n) { return n in plain && !used[n]; };

      // enhanced damage: equal min and max percentages
      if (has('item_maxdamage_percent') && plain.item_maxdamage_percent === plain.item_mindamage_percent && text.strModEnhancedDamage) {
        add(sprintf(text.strModEnhancedDamage, [plain.item_maxdamage_percent]), ['item_maxdamage_percent', 'item_mindamage_percent']);
      }
      DAMAGE.forEach(function (d) {
        if (!has(d[0]) || !has(d[1])) return;
        var lo = plain[d[0]], hi = plain[d[1]];
        var key = lo === hi ? d[3] : d[4];
        if (text[key]) add(sprintf(text[key], lo === hi ? [lo] : [lo, hi]), d.slice(0, d[2] ? 3 : 2));
      });
      // the two-hand and throw copies of +damage repeat it; the tooltip shows it once
      if ('mindamage' in plain || 'maxdamage' in plain) {
        ['secondary_mindamage', 'secondary_maxdamage', 'item_throw_mindamage', 'item_throw_maxdamage'].forEach(function (n) { used[n] = true; });
      }
      // poison: per frame in 256ths, over its length in frames (25 per second)
      if (has('poisonmindam') && has('poisonmaxdam') && plain.poisonlength) {
        var len = plain.poisonlength;
        var plo = Math.round(plain.poisonmindam * len / 256), phi = Math.round(plain.poisonmaxdam * len / 256);
        var secs = Math.round(len / 25);
        var pkey = plo === phi ? 'strModPoisonDamage' : 'strModPoisonDamageRange';
        if (text[pkey]) add(sprintf(text[pkey], plo === phi ? [plo, secs] : [plo, phi, secs]), ['poisonmindam', 'poisonmaxdam', 'poisonlength']);
      }
      GROUPS.forEach(function (g) {
        var v = plain[g.names[0]];
        if (!text[g.key] || !g.names.every(function (n) { return has(n) && plain[n] === v; })) return;
        add(sprintf(text[g.key], [v]), g.names);
      });

      merged.forEach(function (s) {
        var st = stats[s.id];
        if (!st || (!s.param && used[st.n])) return;
        var t = statText(s.id, s.value, s.param, ctx);
        if (t) out.push({ text: t, id: s.id, pr: st.pr || 0 });
        else if (ctx && ctx.skipped) ctx.skipped.push(s.id);
      });
      return out.sort(function (a, b) { return b.pr - a.pr; }).map(function (l) { return { text: l.text, id: l.id }; });
    }

    function stat(list, name, ctx) {
      var id = byName[name], v = 0;
      (list || []).forEach(function (s) { if (s.id === id) v += shown(stats[id], s.value, ctx); });
      return v;
    }

    function name(it) {
      var info = data.items[it.code] || {};
      var base = info.n || it.code;
      var q = it.rw != null ? 'Runeword' : QUALITY[it.q] || 'Normal';
      var title = base;
      if (it.rw != null) title = data.runewords[it.rw] || 'Runeword';
      else if (it.q === 7) title = data.uniques[it.qid] || 'Unique ' + base;
      else if (it.q === 5) title = (data.sets[it.qid] || [])[0] || 'Set ' + base;
      else if (it.q === 4) {
        var a = it.affixes || [];
        title = [data.prefixes[a[0]], base, data.suffixes[a[1]]].filter(Boolean).join(' ');
      } else if (it.q === 2 && it.affixes) { // charms that roll an affix as normal quality
        title = [data.prefixes[it.affixes[0]], base, data.suffixes[it.affixes[1]]].filter(Boolean).join(' ');
      } else if (it.q === 3) title = 'Superior ' + base;
      else if (it.q === 1) title = 'Low Quality ' + base;
      if (it.personalized) title = it.personalized + '’s ' + title;
      return { title: title, base: title === base || title.indexOf(base) >= 0 ? null : base, quality: q };
    }

    return { lines: lines, name: name, stat: stat, statText: statText, sprintf: sprintf };
  }

  return { create: create, QUALITY: QUALITY };
});
