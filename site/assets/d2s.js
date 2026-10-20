/* Reader for Eastern Sun Resurrected character saves (.d2s).
   Shared by scripts/build-character.mjs (Node, which test-parses any local saves) and the
   Character page (window.ESRD2S), which reads a save the player picks. Nothing is uploaded:
   the page parses the file in the browser.

   ESR saves use D2RLoader's extended save format (mode = "extended"), which is the retail
   D2R v105 layout (Reign of the Warlock) with wider ids so the mod's tables fit:
   - stat ids are 16 bits (9 in retail) and end with 0xFFFF, in the player stats and on items
   - item stat parameters (skill, class, tab, …) are 32 bits
   - unique and set ids, magic and charm affixes and rare names are 16 bits; rare items have
     2 more bits before their affix slots
   - every item has an extra byte (always 5 so far) after its flags
   - the runeword field holds the string id of the runeword's name (item-runes.json "id")
   The widths were worked out from real saves; D2RLoader doesn't document them. The field
   order otherwise follows the open-source d2s-rs reader (github.com/ResurrectedTrader/d2s-rs).

   parse(bytes, data) takes a Uint8Array and the generated data (window.ESR_CHAR_DATA; the
   parser uses data.stats and data.items) and returns plain objects; it throws an Error with
   a readable message for anything it can't read. data.statIds names the stats the item
   layout itself uses (armor, durability, sockets, quest difficulty) and data.paired the stats
   saved as a group (fire min damage is followed by the max, with no id). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESRD2S = factory();
})(this, function () {
  'use strict';

  var MAGIC = 0xaa55aa55;
  var EXTENDED_VERSION = 0x44520005; // bytes 05 00 'R' 'D'

  var FORMAT = { statId: 16, param: 32, unique: 16, affix: 16, rareName: 16, rareExtra: 2, itemExtra: 8 };


  var F = {
    SOCKETED: 0x800, IS_EAR: 0x10000, COMPACT: 0x200000, ETHEREAL: 0x400000,
    PERSONALIZED: 0x1000000, GAMBLE: 0x2000000, RUNEWORD: 0x4000000,
    CHRONICLE: 0x10000000, CHRONICLE_COMPACT: 0x20000000
  };

  // Item flags from the generator (data.items[code].f)
  var IF = { CHARM: 1, SCROLL: 2, BODY: 4, PLAYER_BODY: 8, GOLD: 16, QUEST_DIFF: 32 };

  var HUFFMAN = [[[[['w', 'u'], [['8', ['y', ['5', ['j', []]]]], 'h']], ['s', [['2', 'n'], 'x']]], [[['c', ['k', 'f']], 'b'], [['t', 'm'], ['9', '7']]]],
    [' ', [[[['e', 'd'], 'p'], ['g', [[['z', 'q'], '3'], ['v', '6']]]], [['r', 'l'], ['a', [['1', ['4', '0']], ['i', 'o']]]]]]];

  function fail(msg) { throw new Error(msg); }

  // Little-endian bit reader (bit 0 of each byte first), as the game writes saves.
  function Reader(bytes) {
    this.b = bytes;
    this.pos = 0; // in bits
  }
  Reader.prototype.bits = function (n) {
    var v = 0, b = this.b;
    if (this.pos + n > b.length * 8) fail('The save ends unexpectedly (at byte ' + (this.pos >> 3) + ').');
    for (var i = 0; i < n; i++, this.pos++) {
      if ((b[this.pos >> 3] >> (this.pos & 7)) & 1) v += Math.pow(2, i);
    }
    return v;
  };
  Reader.prototype.bool = function () { return this.bits(1) === 1; };
  Reader.prototype.align = function () { this.pos = (this.pos + 7) & ~7; };
  Reader.prototype.byteAt = function () { return this.pos >> 3; };
  Reader.prototype.seek = function (byte) { this.pos = byte * 8; };
  Reader.prototype.magic = function () {
    var i = this.pos >> 3;
    return String.fromCharCode(this.b[i] || 0, this.b[i + 1] || 0);
  };
  Reader.prototype.string = function () { // 8-bit chars up to a 0
    var s = [], c;
    while ((c = this.bits(8))) s.push(c);
    return utf8(s);
  };

  function utf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    return String.fromCharCode.apply(null, bytes);
  }

  function u8(b, at) { return b[at]; }
  function u16(b, at) { return b[at] | (b[at + 1] << 8); }
  function u32(b, at) { return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 0x1000000; }
  function fixedString(b, at, len) {
    var out = [];
    for (var i = at; i < at + len && b[i]; i++) out.push(b[i]);
    return utf8(out);
  }

  // ---------------------------------------------------------------------
  // Header (the v104+ character section, 16 + 387 bytes)
  // ---------------------------------------------------------------------

  var CHARACTER_END = 0x193; // quests ("Woo!") start here
  var STATS_AT = CHARACTER_END + 298 + 80 + 52; // after quests, waypoints ("WS") and NPCs ("w4")

  function readHeader(b) {
    if (b.length < STATS_AT + 4) fail('This file is too small to be a character save.');
    if (u32(b, 0) !== MAGIC) fail('This is not a Diablo II character save (.d2s).');
    var version = u32(b, 4);
    if (version !== EXTENDED_VERSION) {
      fail('This save isn’t in the format Eastern Sun Resurrected writes (version 0x' + version.toString(16) +
        '). Only ESR characters can be read here.');
    }
    if (u32(b, 8) !== b.length) fail('The file size doesn’t match the size stored in the save; the file may be incomplete.');
    var flags = u32(b, 0x14);
    return {
      name: fixedString(b, CHARACTER_END - 8 - 96, 96),
      weaponSwitch: u32(b, 0x10) !== 0, // the second weapon set (slots 11 and 12) is active
      classId: u8(b, 0x18),
      level: u8(b, 0x1b),
      numStats: u8(b, 0x19),
      numSkills: u8(b, 0x1a),
      hardcore: !!(flags & 0x04),
      died: !!(flags & 0x08),
      ladder: !!(flags & 0x40),
      progression: (flags >> 8) & 0xff,
      lastPlayed: u32(b, 0x20) ? new Date(u32(b, 0x20) * 1000) : null,
      mercType: u16(b, 0xa7),
      hasMerc: u32(b, 0xa1) !== 0
    };
  }

  // ---------------------------------------------------------------------
  // Player stats ("gf"): id, then CSvBits of value, until 0xFFFF
  // ---------------------------------------------------------------------

  function readPlayerStats(r, data) {
    if (r.magic() !== 'gf') fail('The character stats section is missing.');
    r.pos += 16;
    var out = [], end = Math.pow(2, FORMAT.statId) - 1;
    for (;;) {
      var id = r.bits(FORMAT.statId);
      if (id === end) break;
      var s = data.stats[id];
      if (!s || !s.cb) fail('Unknown character stat #' + id + ' (the game data may be newer than this save).');
      var param = s.cp ? r.bits(s.cp) : 0;
      var v = r.bits(s.cb);
      if (s.cs && s.cb < 32 && v >= Math.pow(2, s.cb - 1)) v -= Math.pow(2, s.cb);
      out.push({ id: id, param: param, value: v });
    }
    r.align();
    return out;
  }

  // ---------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------

  function huffman(r) {
    var s = '';
    for (var i = 0; i < 4; i++) {
      var n = HUFFMAN;
      while (typeof n !== 'string') {
        n = n[r.bits(1)];
        if (n === undefined || (Array.isArray(n) && !n.length)) fail('Bad item code in the save.');
      }
      s += n;
    }
    return s.trim();
  }

  function statList(r, data, item) {
    var out = [], end = Math.pow(2, FORMAT.statId) - 1;
    for (;;) {
      var id = r.bits(FORMAT.statId);
      if (id === end) return out;
      var s = data.stats[id];
      if (!s || !s.sb) fail('Unknown stat #' + id + ' on ' + item + ' (the game data may be newer than this save).');
      var param = s.pb ? r.bits(FORMAT.param) : 0;
      out.push({ id: id, param: param, value: r.bits(s.sb) - (s.sa || 0) });
      var more = data.paired[id] || []; // saved as a group: the next stats' values follow, with no ids
      for (var i = 0; i < more.length; i++) {
        var p = data.stats[more[i]];
        out.push({ id: more[i], param: 0, value: r.bits(p.sb) - (p.sa || 0) });
      }
      if (out.length > 512) fail('Too many stats on ' + item + '.');
    }
  }

  function readGold(r) {
    var v = r.bool() ? r.bits(32) : r.bits(12);
    r.bits(1); // player gold
    return v;
  }

  function realmData(r) {
    if (r.bool()) r.pos += 4 * 32;
  }

  function stashStack(r) {
    return r.bool() ? r.bits(8) : null;
  }

  function readItem(r, data, depth) {
    var start = r.byteAt();
    var flags = r.bits(32);
    var has = function (f) { return (flags & f) !== 0; };
    r.bits(FORMAT.itemExtra);
    var it = { at: start, flags: flags };
    r.bits(3); // item format version
    it.mode = r.bits(3);
    if (it.mode === 3) { r.bits(16); r.bits(16); } // on the ground
    else {
      it.slot = r.bits(4);
      it.x = r.bits(4);
      it.y = r.bits(4);
      it.page = r.bits(3) - 1;
    }
    var filled = 0;
    if (has(F.IS_EAR) && has(F.COMPACT)) {
      it.code = 'ear';
      r.bits(3); it.earLevel = r.bits(7); it.earName = r.string();
      realmData(r);
      stashStack(r);
    } else {
      it.code = huffman(r);
      var info = data.items[it.code];
      if (!info) fail('Unknown item code "' + it.code + '" at byte ' + start + ' (the game data may be newer than this save).');
      var f = info.f || 0;
      var label = '"' + (info.n || it.code) + '"';
      var ids = data.statIds;
      if (has(F.COMPACT)) {
        if (f & IF.GOLD) it.gold = readGold(r);
        if ((f & IF.QUEST_DIFF) && ids.questDiff != null) r.bits(data.stats[ids.questDiff].sb);
        realmData(r);
        it.stack = stashStack(r);
      } else if (!has(F.GAMBLE)) {
        filled = r.bits(3);
        r.bits(32); // seed
        it.ilvl = r.bits(7) || 1;
        it.q = r.bits(4);
        if (r.bool()) it.gfx = r.bits(3);
        if (r.bool()) it.auto = r.bits(FORMAT.affix);
        var q = it.q;
        if (q === 1 || q === 3) it.qid = r.bits(3);
        else if (q === 4) it.affixes = [r.bits(FORMAT.affix), r.bits(FORMAT.affix)];
        else if (q === 5 || q === 7) it.qid = r.bits(FORMAT.unique);
        else if (q === 6 || q === 8) {
          it.rare = [r.bits(FORMAT.rareName), r.bits(FORMAT.rareName)];
          r.bits(FORMAT.rareExtra);
          it.affixes = [];
          for (var i = 0; i < 6; i++) it.affixes.push(r.bool() ? r.bits(FORMAT.affix) : 0);
        } else if (q === 9) it.rare = [r.bits(8), r.bits(8)];
        else if (q === 2) {
          if (f & IF.CHARM) it.affixes = r.bool() ? [r.bits(FORMAT.affix), 0] : [0, r.bits(FORMAT.affix)];
          else if ((f & IF.BODY) && !(f & IF.PLAYER_BODY)) r.bits(10);
          else if (f & IF.SCROLL) r.bits(5);
        }
        if (has(F.RUNEWORD)) it.rw = r.bits(16);
        if (has(F.IS_EAR)) { r.bits(3); it.earLevel = r.bits(7); it.earName = r.string(); }
        else if (has(F.PERSONALIZED)) it.personalized = r.string();
        realmData(r);
        var dur = function () {
          var mx = data.stats[ids.maxDur], cur = data.stats[ids.dur];
          it.maxDur = r.bits(mx.sb) - (mx.sa || 0);
          if (it.maxDur > 0) it.dur = r.bits(cur.sb) - (cur.sa || 0);
        };
        if (info.k === 'a') {
          var ac = data.stats[ids.armor];
          it.def = r.bits(ac.sb) - (ac.sa || 0);
          dur();
        } else if (info.k === 'w') dur();
        else if (f & IF.GOLD) it.gold = readGold(r);
        if (r.bool()) it.qty = r.bits(9);
        if (has(F.SOCKETED)) it.sockets = r.bits(data.stats[ids.sockets].sb);
        var setMask = q === 5 ? r.bits(5) : 0;
        it.stats = statList(r, data, label);
        if (setMask) {
          it.setStats = [];
          // bit k: the bonus for wearing k + 2 items of the set
          for (var k = 0; k < 5; k++) if (setMask & (1 << k)) it.setStats.push({ count: k + 2, stats: statList(r, data, label) });
        }
        if (has(F.RUNEWORD)) it.rwStats = statList(r, data, label);
        if (has(F.CHRONICLE)) {
          r.bits(16);
          var compact = has(F.CHRONICLE_COMPACT);
          if (!compact) r.bits(32);
          var n = compact ? 1 : Math.min(r.bits(4), 8);
          r.pos += n * 64;
        }
        it.stack = stashStack(r);
      }
    }
    it.ethereal = has(F.ETHEREAL);
    it.identified = (flags & 0x10) !== 0;
    r.align();
    it.socketed = [];
    if (depth > 2) fail('Items nested too deeply at byte ' + start + '.');
    for (var s = 0; s < filled; s++) it.socketed.push(readItem(r, data, depth + 1));
    return it;
  }

  function readItemList(r, data, what) {
    if (r.magic() !== 'JM') fail('The ' + what + ' item list is missing.');
    r.pos += 16;
    var n = r.bits(16), out = [];
    for (var i = 0; i < n; i++) {
      try { out.push(readItem(r, data, 0)); }
      catch (e) { e.message = 'Couldn’t read ' + what + ' item ' + (i + 1) + ' of ' + n + ': ' + e.message; throw e; }
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Whole save
  // ---------------------------------------------------------------------

  function parse(bytes, data) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    var header = readHeader(bytes);
    var r = new Reader(bytes);
    r.seek(STATS_AT);
    var stats = readPlayerStats(r, data);
    if (r.magic() !== 'if') fail('The skills section is missing.');
    var skillsAt = r.byteAt() + 2;
    var skills = Array.prototype.slice.call(bytes, skillsAt, skillsAt + header.numSkills);
    r.seek(skillsAt + header.numSkills);
    var items = readItemList(r, data, 'character’s');
    // corpses: "JM", a count, then per corpse 12 bytes and an item list
    var corpse = [];
    if (r.magic() === 'JM') {
      r.pos += 16;
      var corpses = r.bits(16);
      for (var c = 0; c < corpses; c++) { r.pos += 96; corpse = corpse.concat(readItemList(r, data, 'corpse')); }
    }
    var merc = [];
    if (r.magic() === 'jf') {
      r.pos += 16;
      if (r.magic() === 'JM') merc = readItemList(r, data, 'mercenary’s');
    }
    return { header: header, stats: stats, skills: skills, items: items, corpse: corpse, merc: merc };
  }

  return { parse: parse, FORMAT: FORMAT };
});
