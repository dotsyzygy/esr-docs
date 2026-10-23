/* Character totals for a parsed save (site/assets/d2s.js): which items count, skill levels with
   +skills, and the effects of buffs, auras and passive skills, evaluated with the skills' own
   formulas (site/assets/skill-calc.js and the Skills page's data).
   Shared by scripts/build-character.mjs (Node, which test-runs local saves) and the Character
   page (window.ESRCharCalc).

   create({ data, SkillCalc, wording, warn }): data is window.ESR_CHAR_DATA (its calc holds the
   effect skills' formula records), SkillCalc window.ESRSkillCalc, wording an ESRItemText, and
   warn(kind, detail) an optional callback for formula problems.
   compute(save, options) returns the model the page shows. options:
     on:   { effect key: true/false } to switch effects on or off (defaults: passives and auras
           from the gear in hand on, cast buffs and class auras off)
     from: { effect key: 'main' | 'switch' } the weapon set a buff is cast with (default: the one
           that gives it the higher level)
     stage: { effect key: n } the stage of a stacking effect (default: the last that adds anything)
   An effect whose skill targets enemies (data.effects[id].t) puts its aura stats on them, not on
   the character (its passive stats stay the caster's): model.enemy, and skillDamage takes their
   resistances off the target's.

   How buffs settle: a buff's level is fixed when it's cast, with the gear in hand then (the main
   or switch weapons) plus whatever buffs are already up. A buff that adds skill levels (Battle
   Command) raises its own level for the next cast, and the level of everything cast after it.
   So the model recasts every buff that's on until no level changes, as a player would: each
   round is one more cast. Only buffs that raise their own level report their casts (c.casts);
   the rest are cast once, after those. Levels only go up and the +skills from a buff grow slowly with its
   level, so it settles in a few rounds (capped at MAX_ROUNDS). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESRCharCalc = factory();
})(this, function () {
  'use strict';

  var MAX_ROUNDS = 12;
  var MAX_STAGES = 1000; // applications of a stacking effect (Sigils count by 2 up to (9 + level) x 10)
  var SETS = ['main', 'switch'];
  var CHARM_PAGE = 6; // ESR's charm inventory; charms elsewhere give nothing

  function create(env) {
    var data = env.data, wording = env.wording, SkillCalc = env.SkillCalc;
    var db = data.calc;
    var statId = {};
    Object.keys(data.stats).forEach(function (id) { statId[data.stats[id].n] = +id; });
    var statName = function (id) { return data.stats[id] ? data.stats[id].n : null; };
    var skillKey = function (id) { return data.skillKeys[id] || (data.skills[id] ? data.skills[id][0].toLowerCase() : ''); };

    // ---------------------------------------------------------------------
    // Gear
    // ---------------------------------------------------------------------

    // Items whose stats count with a weapon set in hand: equipped items minus the other set's
    // weapons, and charms in the charm inventory. Mercenary items never count.
    function itemsFor(save, set) {
      var off = set === 'switch' ? [4, 5] : [11, 12];
      return save.items.filter(function (it) {
        if (it.mode === 1) return off.indexOf(it.slot) < 0;
        return it.mode === 0 && it.page === CHARM_PAGE && ((data.items[it.code] || {}).f & 1);
      });
    }

    // Every stat that applies, with its source: the item's mods, its runeword, socketed jewels,
    // the socket bonuses of gems and runes (gems.txt, by the kind of item they're in), the item's
    // own set bonuses for as many items of its set as are worn, and the set's bonuses (sets.txt:
    // per number of items worn, and for the full set).
    function gearStats(items) {
      var setOf = function (it) { return it.q === 5 && data.sets[it.qid] ? data.sets[it.qid][2] : null; };
      var worn = {};
      items.forEach(function (it) { var s = setOf(it); if (s) worn[s] = (worn[s] || 0) + 1; });
      var out = [];
      var unpack = function (st) { return { id: st[0], value: st[1], param: st[2] || 0 }; };
      items.forEach(function (it) {
        var from = wording.name(it).title;
        var add = function (list, src) { (list || []).forEach(function (st) { out.push({ stat: st, from: src || from }); }); };
        add(it.stats);
        add(it.rwStats);
        var info = data.items[it.code] || {};
        var kind = info.k === 'w' ? 0 : (info.f & 64) ? 2 : 1; // weapon, shield, anything else
        (it.socketed || []).forEach(function (s) {
          add(s.stats);
          var gem = data.gems[s.code];
          if (gem) add(gem[kind].map(unpack), wording.name(s).title + ' in ' + from);
        });
        var count = setOf(it) ? worn[setOf(it)] : 0;
        (it.setStats || []).forEach(function (b) { if (count >= b.count) add(b.stats); });
      });
      Object.keys(worn).forEach(function (key) {
        var b = data.setBonuses[key];
        if (!b) return;
        var name = (data.sets[Object.keys(data.sets).filter(function (id) { return data.sets[id][2] === key; })[0]] || [])[1] || key;
        for (var n = 2; n <= worn[key]; n++) {
          (b.p[n] || []).forEach(function (st) { out.push({ stat: unpack(st), from: name + ' (' + n + ' items)' }); });
        }
        if (worn[key] >= b.n) b.f.forEach(function (st) { out.push({ stat: unpack(st), from: name + ' (full set)' }); });
      });
      return out;
    }

    // ---------------------------------------------------------------------
    // Skill levels
    // ---------------------------------------------------------------------

    // +skills in a stat list: all skills, class skills, a tree, one class skill and oskills.
    function bonuses(list, classId) {
      var b = { all: [], cls: [], tab: [[], [], []], single: {}, oskill: {} };
      var push = function (map, key, x) { (map[key] = map[key] || []).push(x); };
      list.forEach(function (a) {
        var n = statName(a.stat.id), p = a.stat.param, x = { v: a.stat.value, from: a.from };
        if (n === 'item_allskills') b.all.push(x);
        else if (n === 'item_addclassskills' && p === classId) b.cls.push(x);
        else if (n === 'item_addskill_tab' && (p >> 3) === classId && b.tab[p & 7]) b.tab[p & 7].push(x);
        else if (n === 'item_singleskill') push(b.single, p, x);
        else if (n === 'item_nonclassskill') push(b.oskill, p, x);
      });
      return b;
    }
    function sum(list) { return (list || []).reduce(function (n, x) { return n + x.v; }, 0); }

    // Level of every skill the character can use, from hard points and the +skills in a stat
    // list: { id: { hard, oskill, plus, level } }. A skill is usable with hard points or an
    // oskill; +all skills raise every usable skill, class and tree bonuses only the class's own.
    function skillLevels(save, classId, list) {
      var b = bonuses(list, classId);
      var cls = data.classes[classId];
      var out = {};
      var add = function (id, hard, tree) {
        var oskill = sum(b.oskill[id]);
        if (!hard && !oskill) return;
        var plus = sum(b.all) + oskill + (tree != null ? sum(b.cls) + sum(b.tab[tree]) + sum(b.single[id]) : 0);
        out[id] = { hard: hard, oskill: oskill, plus: plus - oskill, level: hard + plus };
      };
      if (cls) {
        cls.skills.forEach(function (id, i) {
          var s = data.skills[id];
          add(id, save.skills[i] || 0, (s && s[2] ? s[2] : 1) - 1);
        });
      }
      Object.keys(b.oskill).forEach(function (id) { if (!out[id] && !(cls && cls.skills.indexOf(+id) >= 0)) add(+id, 0, null); });
      return { levels: out, bonuses: b };
    }

    // ---------------------------------------------------------------------
    // Effects: buffs, auras, passives
    // ---------------------------------------------------------------------

    // The character's stats for formulas (stat('vitality'.accr) …): saved base plus gear, raw.
    function formulaStats(base, list) {
      var out = {};
      Object.keys(base).forEach(function (n) { out[n] = base[n]; });
      list.forEach(function (a) { var n = statName(a.stat.id); if (n) out[n] = (out[n] || 0) + a.stat.value; });
      return out;
    }

    // The stats an effect gives at a level, evaluated with the character's skills and stats.
    // A stacking effect (eff.sc: the aura stat that counts its stacks by reading itself back,
    // Permafrost, Fist of the Heavens) is evaluated at a stage: its counter after that many
    // applications. stages lists the stages where what it gives changes, up to the last one
    // that adds anything; the default stage is that last one.
    function effectStats(eff, level, levels, clvl, stats, stage) {
      var rec = db && db.s[eff.k];
      if (!rec) return null;
      var skills = {};
      Object.keys(levels).forEach(function (id) {
        skills[skillKey(id)] = { blvl: levels[id].hard, lvl: levels[id].level };
      });
      var own = levels[eff.id] || { hard: 0 };
      skills[eff.k] = { blvl: own.hard || 0, lvl: level };
      var counter = eff.sc != null && rec.as && rec.as[eff.sc] ? eff.as[eff.sc] : null;
      if (counter) {
        var copy = {};
        Object.keys(stats).forEach(function (n) { copy[n] = stats[n]; });
        stats = copy;
      }
      var calc = new SkillCalc.Calc(db, { ulvl: clvl, character: { skills: skills, stats: stats }, warn: env.warn });
      var take = function (names, calcs, into) {
        (names || []).forEach(function (n, i) {
          if (!n || statId[n] == null || !calcs || !calcs[i]) return;
          var v = calc.run(rec, calcs[i], level);
          if (v) into.push({ id: statId[n], param: 0, value: v });
        });
      };
      var stages = null;
      if (counter) {
        // the counter after k applications, and what the effect gives then
        var at = [], sig = [];
        var others = eff.as.map(function (n, i) { return i === eff.sc ? '' : n; });
        stats[counter] = 0;
        for (var k = 1; k <= MAX_STAGES; k++) {
          var c = calc.run(rec, rec.as[eff.sc], level);
          if (k > 1 && c === stats[counter]) break;
          stats[counter] = at[k] = c;
          calc.memo = {}; // calcs (clcN) may read the counter
          var given = [];
          take(others, rec.as, given);
          take(eff.ps, rec.ps, given);
          sig[k] = JSON.stringify(given);
        }
        stages = [];
        for (var j = 1; j < at.length; j++) if (j === 1 || sig[j] !== sig[j - 1]) stages.push(j);
        if (stages.indexOf(stage) < 0) stage = stages[stages.length - 1];
        stats[counter] = at[stage];
        calc.memo = {};
      }
      // aura stats land on the skill's targets (enemies when eff.enemy); passive stats stay on the caster
      var out = [], foe = [];
      take(eff.as, rec.as, eff.enemy ? foe : out);
      take(eff.ps, rec.ps, out);
      // a buff's poison length is its own stat; word it like an item's poison (total over time)
      out.forEach(function (st) { if (statName(st.id) === 'skill_poison_override_length' && statId.poisonlength != null) st.id = statId.poisonlength; });
      // without a length the poison values are per frame in 256ths and mean nothing as a line
      if (!out.some(function (st) { return statName(st.id) === 'poisonlength'; })) {
        out = out.filter(function (st) { return !/^poison(min|max)dam$/.test(statName(st.id)); });
      }
      var len = rec.len ? calc.run(rec, rec.len, level) : 0;
      return { stats: out, enemy: foe, frames: len, stages: stages, stage: stages ? stage : null };
    }

    function compute(save, options) {
      options = options || {};
      var on = options.on || {}, from = options.from || {}, stage = options.stage || {};
      var h = save.header;
      var classId = h.classId;
      var inHand = h.weaponSwitch ? 'switch' : 'main';
      var base = {};
      save.stats.forEach(function (s) { if (data.stats[s.id]) base[data.stats[s.id].n] = s.value; });
      var ctx = { level: h.level, base: base };

      var gear = {};
      SETS.forEach(function (set) { gear[set] = gearStats(itemsFor(save, set)); });

      // Effects that could apply: skills the character can use with either set, and auras on items.
      var candidates = {};
      SETS.forEach(function (set) {
        var lv = skillLevels(save, classId, gear[set]).levels;
        Object.keys(lv).forEach(function (id) {
          var e = data.effects[id];
          if (!e) return;
          var key = 'skill:' + id;
          var c = candidates[key] || (candidates[key] = { key: key, id: +id, k: e.k, kind: e.kind, as: e.as, ps: e.ps, sc: e.sc, enemy: !!e.t, sets: [] });
          c.sets.push(set);
        });
        gear[set].forEach(function (a) {
          if (statName(a.stat.id) !== 'item_aura' || !data.effects[a.stat.param]) return;
          var key = 'item:' + a.stat.param + ':' + a.from;
          var e = data.effects[a.stat.param];
          var c = candidates[key] || (candidates[key] = { key: key, id: a.stat.param, k: e.k, kind: 'item aura', as: e.as, ps: e.ps, sc: e.sc, enemy: !!e.t, sets: [], fixed: a.stat.value, item: a.from });
          if (c.sets.indexOf(set) < 0) c.sets.push(set);
        });
      });
      var list = Object.keys(candidates).map(function (k) { return candidates[k]; });
      // passives and item auras only work with their gear in hand
      list = list.filter(function (c) { return c.kind === 'buff' || c.kind === 'aura' || c.sets.indexOf(inHand) >= 0; });
      list.forEach(function (c) {
        // passives and item auras work while their gear is in hand; buffs and class auras are cast
        c.cast = c.kind === 'buff' || c.kind === 'aura';
        c.available = c.cast ? c.sets.length > 0 : c.sets.indexOf(inHand) >= 0;
        if (!c.available) return;
        var dflt = !c.cast && c.available;
        c.enabled = c.available && (c.key in on ? !!on[c.key] : dflt);
        c.levels = [];
      });

      // Recast until nothing changes. extra = the stats of the effects that are on.
      var extra = [], rounds = 0, signature = '';
      var state = null;
      for (; rounds < MAX_ROUNDS; rounds++) {
        var lv = {};
        SETS.forEach(function (set) { lv[set] = skillLevels(save, classId, gear[set].concat(extra)).levels; });
        var stats = formulaStats(base, gear[inHand].concat(extra));
        var next = [];
        list.forEach(function (c) {
          var pick = c.cast ? (from[c.key] && c.sets.indexOf(from[c.key]) >= 0 ? from[c.key] : null) : inHand;
          if (c.cast && !pick) {
            pick = c.sets.slice().sort(function (x, y) { return ((lv[y][c.id] || {}).level || 0) - ((lv[x][c.id] || {}).level || 0); })[0];
          }
          c.set = pick;
          c.level = c.fixed != null ? c.fixed : ((lv[pick] || {})[c.id] || {}).level || 0;
          if (!c.levels.length || c.levels[c.levels.length - 1] !== c.level) c.levels.push(c.level);
          var r = c.level > 0 ? effectStats(c, c.level, lv[pick] || {}, h.level, stats, stage[c.key]) : null;
          c.missing = !r;
          c.stats = r ? r.stats : [];
          c.enemyStats = r ? r.enemy : [];
          c.stages = r && r.stages; c.stage = r && r.stage;
          c.seconds = r && r.frames ? Math.floor(r.frames / 25) : 0;
          if (c.enabled) c.stats.forEach(function (st) { next.push({ stat: st, from: c.name || c.k }); });
        });
        var sig = list.map(function (c) { return c.key + '=' + c.level + ':' + c.enabled; }).join('|');
        extra = next;
        state = lv;
        if (sig === signature) break;
        signature = sig;
      }
      // whether a buff's own stats add levels to the buff itself
      function raisesItself(c) {
        var g = gear[c.set] || [];
        var mine = c.stats.map(function (st) { return { stat: st }; });
        var lvl = function (l) { return (skillLevels(save, classId, l).levels[c.id] || {}).level || 0; };
        return lvl(g.concat(mine)) > lvl(g);
      }
      list.forEach(function (c) {
        var s = data.skills[c.id];
        c.name = s ? s[0] : c.k;
        // only a buff that raises its own level (Battle Command) gains from being recast; the
        // others reach their level in one cast, after the buffs that add skill levels
        var own = c.kind === 'buff' && c.enabled && c.levels.length > 1 && raisesItself(c);
        c.casts = own ? c.levels.length : 0;
      });
      // name the sources of the effects' stats now that names are known; stats put on enemies
      // (curses, Conviction, Super Teleport) don't change the character, they go to the target
      extra = [];
      var onEnemy = [];
      list.forEach(function (c) {
        if (!c.enabled) return;
        var from = c.name + (c.kind === 'item aura' ? ' (aura on ' + c.item + ')' : '');
        c.stats.forEach(function (st) { extra.push({ stat: st, from: from }); });
        c.enemyStats.forEach(function (st) { onEnemy.push({ stat: st, from: from }); });
      });

      var active = gear[inHand].concat(extra);
      var skills = skillLevels(save, classId, active);
      return {
        ctx: ctx, base: base, inHand: inHand,
        items: { main: itemsFor(save, 'main'), switch: itemsFor(save, 'switch') },
        effects: list.sort(function (a, b) { return order(a) - order(b) || a.name.localeCompare(b.name); }),
        stats: active, // every stat that applies with the weapons in hand and the effects that are on
        enemy: onEnemy, // the stats the effects that are on put on enemies
        skills: skills.levels, bonuses: skills.bonuses,
        rounds: rounds, levelsBySet: state
      };
    }
    // ---------------------------------------------------------------------
    // Breakpoints
    // ---------------------------------------------------------------------

    // Frames for one animation (AnimData.d2: frames, speed in 256ths) at a rate in percent:
    // ceil(256 * frames / floor(speed * rate / 100)) - 1, the game's frames per action.
    function framesAt(a, rate) {
      var step = Math.floor(a[1] * rate / 100);
      return step > 0 ? Math.ceil(256 * a[0] / step) - 1 : Infinity;
    }
    // FCR/FHR/FBR/IAS have diminishing returns: 120 * x / (120 + x).
    function effective(x) { return x > 0 ? Math.floor(120 * x / (120 + x)) : 0; }

    // For each animation the character has with the weapon in hand: the frames now, and every
    // stat value where it drops a frame. Attack speed also counts skill IAS (attackrate, e.g.
    // Burst of Speed) and the weapon's speed modifier, and stops at +75; cast rate stops at the
    // rate ESR's cast-rate-cap plugin allows (data.fcrCap).
    function breakpoints(save, model) {
      var cls = data.classes[save.header.classId];
      if (!cls || !cls.token) return null;
      var list = model.stats.map(function (a) { return a.stat; });
      var v = function (n) { return wording.stat(list, n, model.ctx); };
      var hands = model.inHand === 'switch' ? [11, 12] : [4, 5];
      var weapon = model.items[model.inHand].filter(function (it) {
        return it.mode === 1 && hands.indexOf(it.slot) >= 0 && (data.items[it.code] || {}).k === 'w';
      })[0];
      var info = weapon ? data.items[weapon.code] : {};
      var wc = (info.wc || 'hth').toUpperCase();
      var find = function (mode) { return data.anim[cls.token + mode + wc] || data.anim[cls.token + mode + 'HTH']; };
      var wsm = info.sp || 0, sias = v('attackrate');
      var castCap = 100 + effective(data.fcrCap || 200);
      var modes = [
        { key: 'attack', label: 'Attack', stat: 'item_fasterattackrate', anim: find('A1'), max: 400,
          rate: function (x) { return 100 + Math.max(-85, Math.min(75, effective(x) + sias - wsm)); } },
        { key: 'cast', label: 'Cast', stat: 'item_fastercastrate', anim: find('SC'), max: data.fcrCap || 200,
          rate: function (x) { return Math.min(castCap, 100 + effective(x)); } },
        { key: 'hit', label: 'Hit recovery', stat: 'item_fastergethitrate', anim: find('GH'), max: 400,
          rate: function (x) { return 100 + effective(x); } },
        { key: 'block', label: 'Block', stat: 'item_fasterblockrate', anim: find('BL'), max: 400,
          rate: function (x) { return 100 + effective(x); } }
      ];
      return {
        weapon: weapon ? wording.name(weapon).title : null, wclass: wc, wsm: wsm, sias: sias,
        modes: modes.filter(function (m) { return m.anim; }).map(function (m) {
          var have = v(m.stat);
          var table = [], last = null;
          for (var x = 0; x <= m.max; x++) {
            var fr = framesAt(m.anim, m.rate(x));
            if (fr !== last) { table.push([x, fr]); last = fr; }
          }
          var now = framesAt(m.anim, m.rate(have));
          var next = table.filter(function (t) { return t[0] > have; })[0] || null;
          return { key: m.key, label: m.label, value: have, frames: now, next: next, table: table };
        })
      };
    }

    // ---------------------------------------------------------------------
    // Damage
    // ---------------------------------------------------------------------

    var ELEMENTS = [
      { key: 'fire', label: 'Fire', et: 'fire', min: 'firemindam', max: 'firemaxdam', mastery: 'passive_fire_mastery', pierce: 'passive_fire_pierce', res: 'fireresist' },
      { key: 'cold', label: 'Cold', et: 'cold', min: 'coldmindam', max: 'coldmaxdam', mastery: 'passive_cold_mastery', pierce: 'passive_cold_pierce', res: 'coldresist' },
      { key: 'light', label: 'Lightning', et: 'ltng', min: 'lightmindam', max: 'lightmaxdam', mastery: 'passive_ltng_mastery', pierce: 'passive_ltng_pierce', res: 'lightresist' },
      { key: 'magic', label: 'Magic', et: 'mag', min: 'magicmindam', max: 'magicmaxdam', mastery: 'passive_mag_mastery', pierce: 'passive_mag_pierce', res: 'magicresist' },
      { key: 'poison', label: 'Poison', et: 'pois', min: 'poisonmindam', max: 'poisonmaxdam', mastery: 'passive_pois_mastery', pierce: 'passive_pois_pierce', res: 'poisonresist' }
    ];
    var ATTACK_ANIMS = { A1: 1, A2: 1, S1: 1, S2: 1, S3: 1, S4: 1, SQ: 1, TH: 1, KK: 1 };

    // Damage per hit and per second for every skill the character can use that deals damage, against
    // one target: { res: elemental resistance %, phys: physical resistance % } (pierce is taken
    // off the resistance). attrs are the final attributes (for the weapon's Strength/Dexterity
    // bonus). Attack skills use the weapon in hand: (base damage x (100 + the weapon's own ED) +
    // its flat damage) x (100 + other ED + skill ED + attribute bonus) + other flat damage, then
    // the skill's % weapon damage (SrcDam, or ESR's calc10 formula), plus elemental damage from
    // items, plus the skill's own damage. Weapon damage gets deadly strike at its chance and ESR's
    // multiplier (200% + criticaldamage), converted or not. Spells use the skill's own damage with elemental mastery.
    // The rate is frames per action from the skill's animation at the character's IAS/FCR.
    // One hit of one missile on one target that it always hits: no multiple missiles, splash,
    // pierce, damage over time or chance to hit.
    function skillDamage(save, model, attrs, target) {
      target = target || {};
      var cls = data.classes[save.header.classId];
      var list = model.stats.map(function (a) { return a.stat; });
      var v = function (n) { return statId[n] != null ? wording.stat(list, n, model.ctx) : 0; };
      var bp = breakpoints(save, model);
      var hands = model.inHand === 'switch' ? [11, 12] : [4, 5];
      var weapon = model.items[model.inHand].filter(function (it) {
        return it.mode === 1 && hands.indexOf(it.slot) >= 0 && (data.items[it.code] || {}).k === 'w';
      })[0];
      var info = weapon ? data.items[weapon.code] : null;

      // weapon damage with everything that multiplies it
      var phys = null;
      if (info) {
        var own = (weapon.stats || []).concat(weapon.rwStats || []);
        (weapon.socketed || []).forEach(function (s) {
          own = own.concat(s.stats || []);
          var gem = data.gems[s.code];
          if (gem) own = own.concat(gem[0].map(function (st) { return { id: st[0], value: st[1], param: st[2] || 0 }; }));
        });
        var ov = function (n) { return statId[n] != null ? wording.stat(own, n, model.ctx) : 0; };
        var base = info.d2 || info.d1 || info.dt;
        if (base) {
          var eth = function (x) { return weapon.ethereal ? Math.floor(x * 3 / 2) : x; };
          var sec = info.d2 && !info.d1;
          var flatMin = sec ? 'secondary_mindamage' : 'mindamage', flatMax = sec ? 'secondary_maxdamage' : 'maxdamage';
          var wMin = Math.floor(eth(base[0]) * (100 + ov('item_mindamage_percent')) / 100) + ov(flatMin);
          var wMax = Math.floor(eth(base[1]) * (100 + ov('item_maxdamage_percent')) / 100) + ov(flatMax) + ov('item_maxdamage_perlevel');
          var attrBonus = Math.floor(((attrs.strength || 0) * (info.sb || 0) + (attrs.dexterity || 0) * (info.db || 0)) / 100);
          var otherED = v('item_maxdamage_percent') - ov('item_maxdamage_percent');
          var skillED = v('damagepercent');
          var mult = 100 + otherED + skillED + attrBonus;
          var flat = function (n) { return v(n) - ov(n); };
          phys = {
            min: Math.floor(wMin * mult / 100) + flat(flatMin),
            max: Math.floor(wMax * mult / 100) + flat(flatMax) + flat('item_maxdamage_perlevel'),
            parts: { weapon: [wMin, wMax], otherED: otherED, skillED: skillED, attr: attrBonus }
          };
        }
      }
      // deadly strike and crushing blow chances: the same totals as Advanced stats (gear, sockets,
      // set bonuses, passives such as Critical Strike, buffs); a chance stops at 100%
      var dsTotal = v('item_deadlystrike') + v('item_deadlystrike_perlevel');
      var cbTotal = v('item_crushingblow') + v('item_crushingblow_perlevel');
      var critChance = Math.min(100, dsTotal) / 100;
      var critMult = (200 + v('criticaldamage')) / 100;
      var cbChance = Math.min(100, cbTotal) / 100;
      var itemElem = {};
      ELEMENTS.forEach(function (e) {
        var lo = v(e.min), hi = v(e.max);
        if (e.key === 'poison') { var len = v('poisonlength') || 0; lo = Math.round(lo * len / 256); hi = Math.round(hi * len / 256); }
        if (lo || hi) itemElem[e.key] = [lo, Math.max(lo, hi)];
      });
      // the target's resistances, lowered by the effects on enemies that are on (curses,
      // Conviction, Super Teleport); the character's pierce comes off after that
      var enemyList = (model.enemy || []).map(function (a) { return a.stat; });
      var onTarget = function (n) { return statId[n] != null ? wording.stat(enemyList, n, model.ctx) : 0; };
      var res = {};
      ELEMENTS.forEach(function (e) { res[e.key] = (target.res || 0) + onTarget(e.res); });
      var physRes = Math.min(95, (target.phys || 0) + onTarget('damageresist'));
      var effRes = function (e) { return Math.min(95, res[e.key] - v(e.pierce)); };

      var stats = formulaStats(model.base, model.stats);
      var out = [];
      Object.keys(model.skills).forEach(function (id) {
        var lv = model.skills[id];
        var rec = db.s[skillKey(id)];
        if (!rec || !lv.level) return;
        if (rec.nd || (data.effects[id] && data.effects[id].kind !== 'passive')) return; // buffs and auras add to attacks, they aren't attacks
        var attack = !!(rec.sd || (rec.c && rec.c[9])) && !!phys;
        var spellDamage = rec.ed || rec.pd;
        if (!attack && !spellDamage) return;
        var skills = {};
        Object.keys(model.skills).forEach(function (sid) { skills[skillKey(sid)] = { blvl: model.skills[sid].hard, lvl: model.skills[sid].level }; });
        var calc = new SkillCalc.Calc(db, { ulvl: save.header.level, character: { skills: skills, stats: stats }, warn: env.warn });
        var run = function (src) { try { return calc.run(rec, src, lv.level) || 0; } catch (e) { return 0; } };

        var parts = [];
        var srcdam = 0, conversion = 0;
        if (attack) {
          srcdam = rec.sd || 0;
          var fromCalc = rec.c && rec.c[9] ? run(rec.c[9]) : 0;
          if (fromCalc > 0) srcdam = Math.min(255, fromCalc);
          var pct = srcdam / 128;
          var pMin = Math.floor(phys.min * pct), pMax = Math.floor(phys.max * pct);
          // deadly strike, at its chance of ESR's multiplier, averaged in. It multiplies the
          // weapon's physical damage before any conversion, so converted damage keeps it.
          var crit = 1 + critChance * (critMult - 1);
          // conversion: the missile turns a % of the physical damage into its element (dl12 in
          // its formula is dParam1 + dParam2 per level above 1); the converted part takes the
          // element's resistance, and its mastery when the missile applies masteries.
          if (rec.cv) {
            var cvSrc = rec.cv.c.replace(/\bdl(\d)(\d)\b/g, function (_, a, b) {
              return String((rec.cv.p[a - 1] || 0) + (lv.level - 1) * (rec.cv.p[b - 1] || 0));
            });
            conversion = Math.max(0, Math.min(100, run(cvSrc)));
            var cvEl = ELEMENTS.filter(function (e) { return e.et === rec.cv.et; })[0];
            if (conversion && cvEl) {
              var cMin = Math.floor(pMin * conversion / 100), cMax = Math.floor(pMax * conversion / 100);
              pMin -= cMin; pMax -= cMax;
              var cMastery = rec.cv.am ? v(cvEl.mastery) : 0;
              cMin = Math.floor(cMin * (100 + cMastery) / 100); cMax = Math.floor(cMax * (100 + cMastery) / 100);
              parts.push({ label: cvEl.label + ' (' + conversion + '% converted)', min: cMin, max: cMax, avg: (cMin + cMax) / 2 * crit * (100 - effRes(cvEl)) / 100 });
            }
          }
          if (pMin || pMax) parts.unshift({ label: 'Physical', min: pMin, max: pMax, avg: (pMin + pMax) / 2 * crit * (100 - physRes) / 100 });
          ELEMENTS.forEach(function (e) {
            if (!itemElem[e.key]) return;
            var lo = Math.floor(itemElem[e.key][0] * pct), hi = Math.floor(itemElem[e.key][1] * pct);
            parts.push({ label: e.label + ' (items)', min: lo, max: hi, avg: (lo + hi) / 2 * (100 - effRes(e)) / 100 });
          });
        }
        // the skill's own damage: physical (pnma/pxma) and its element (enma/exma; poison over its length)
        if (rec.pd) {
          var sMin = run('pnma'), sMax = run('pxma');
          if (sMin || sMax) parts.push({ label: 'Physical (skill)', min: sMin, max: sMax, avg: (sMin + sMax) / 2 * (100 - physRes) / 100 });
        }
        if (rec.ed && rec.et) {
          var el = ELEMENTS.filter(function (e) { return e.et === rec.et; })[0];
          var eMin = run('enma'), eMax = run('exma');
          if (el && el.key === 'poison') { eMin = Math.round(run('enms') * run('edln') / 256); eMax = Math.round(run('exms') * run('edln') / 256); }
          if (el && (eMin || eMax)) {
            var mastery = v(el.mastery);
            eMin = Math.floor(eMin * (100 + mastery) / 100); eMax = Math.floor(eMax * (100 + mastery) / 100);
            parts.push({ label: el.label + ' (skill)', min: eMin, max: eMax, avg: (eMin + eMax) / 2 * (100 - effRes(el)) / 100 });
          }
        }
        if (!parts.length) return;
        var hitMin = parts.reduce(function (n, p) { return n + p.min; }, 0);
        var hitMax = parts.reduce(function (n, p) { return n + p.max; }, 0);
        var avg = parts.reduce(function (n, p) { return n + p.avg; }, 0);
        if (!avg) return;

        // rate: the skill's animation with the weapon in hand, at the character's IAS or FCR
        var mode = rec.an || (attack ? 'A1' : 'SC');
        var frames = null;
        if (bp && cls && cls.token) {
          var wc = bp.wclass;
          var a = data.anim[cls.token + mode + wc] || data.anim[cls.token + mode + 'HTH'];
          if (a) {
            var isCast = !ATTACK_ANIMS[mode];
            var have = isCast ? v('item_fastercastrate') : v('item_fasterattackrate');
            var m = bp.modes.filter(function (x) { return x.key === (isCast ? 'cast' : 'attack'); })[0];
            frames = m ? framesFor(a, isCast, have, bp) : null;
          }
        }
        // crushing blow: a chance per attack to remove a share of the target's CURRENT life, so
        // its damage per second depends on the target's life and shrinks as it dies. Averaged
        // over a whole kill: each hit removes the average damage plus chance x share x the life
        // left, and the effective DPS is the life over the time to kill.
        var kill = null;
        var ranged = bp && (bp.wclass === 'BOW' || bp.wclass === 'XBW' || mode === 'TH');
        var cbShare = attack ? ((data.crush.targets[target.type || 'monster'] || 0) / 100) * (ranged ? data.crush.ranged / 100 : 1) * (100 - physRes) / 100 : 0;
        var cbPerHit = cbChance * cbShare;
        if (frames && target.life > 0) {
          var life = target.life, hits = 0;
          if (!cbPerHit) hits = Math.ceil(target.life / avg);
          else while (life > 0 && hits < 100000) { life = life * (1 - cbPerHit) - avg; hits++; }
          if (life <= 0 || !cbPerHit) {
            var seconds = hits * frames / 25;
            kill = { hits: hits, seconds: seconds, dps: target.life / seconds, crushAtFull: cbPerHit * target.life };
          }
        }
        var s = data.skills[id] || [skillKey(id)];
        out.push({
          id: +id, name: s[0], level: lv.level, attack: attack, srcdam: srcdam, mode: mode, conversion: conversion,
          parts: parts, min: hitMin, max: hitMax, avg: avg, frames: frames,
          perSecond: frames ? 25 / frames : null, dps: frames ? avg * 25 / frames : null,
          crush: attack ? { chance: cbChance, share: cbShare, ranged: !!ranged } : null, kill: kill
        });
      });
      return {
        weapon: weapon ? wording.name(weapon).title : null, phys: phys, res: res, physRes: physRes, critChance: critChance, critMult: critMult, crushChance: cbChance, dsTotal: dsTotal, cbTotal: cbTotal,
        skills: out.sort(function (a, b) { return (b.dps || 0) - (a.dps || 0) || b.avg - a.avg; })
      };
    }
    function framesFor(a, isCast, have, bp) {
      var rate = isCast
        ? Math.min(100 + effective(data.fcrCap || 200), 100 + effective(have))
        : 100 + Math.max(-85, Math.min(75, effective(have) + bp.sias - bp.wsm));
      return framesAt(a, rate);
    }

    var ORDER = { buff: 0, aura: 1, 'item aura': 2, passive: 3 };
    function order(c) { return ORDER[c.kind]; }

    return { compute: compute, breakpoints: breakpoints, skillDamage: skillDamage, itemsFor: itemsFor, sum: sum };
  }

  return { create: create, MAX_ROUNDS: MAX_ROUNDS };
});
