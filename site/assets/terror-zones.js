/* The game's terror zone rotation, worked out from desecratedzones.json.
   Shared by scripts/build-terror-zones.mjs (Node, which checks it) and the home page
   (window.ESRTerrorZones). Each roll is a SHA-1 of the slot's time XOR the seed. The pick is
   weighted: the zone picked last can't repeat, and a zone gets likelier while it waits, so every
   slot depends on the ones before it and the rotation is replayed from the config's start.

   Ported from d2r-arcane-tracker (electron/services/terrorZoneSchedule.ts):

   MIT License

   Copyright (c) 2025 Fredrik Pettersson

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all
   copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESRTerrorZones = factory();
})(this, function () {
  'use strict';

  function rotl(x, n) { return (x << n) | (x >>> (32 - n)); }

  // SHA-1 of a message of at most 55 bytes (one block). Written out because crypto.subtle is
  // async and may be missing over file://, and every page load needs thousands of these.
  function sha1(bytes) {
    var w = new Array(80).fill(0);
    bytes.forEach(function (b, i) { w[i >> 2] |= b << (24 - (i % 4) * 8); });
    w[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
    w[15] = bytes.length * 8;
    for (var i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    var a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476, e = 0xC3D2E1F0;
    var a0 = a, b0 = b, c0 = c, d0 = d, e0 = e;
    for (var t = 0; t < 80; t++) {
      var f, k;
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      var next = (rotl(a, 5) + f + e + k + w[t]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = next;
    }
    return [a + a0, b + b0, c + c0, d + d0, e + e0].flatMap(function (word) {
      return [word >>> 24, (word >>> 16) & 255, (word >>> 8) & 255, word & 255];
    });
  }

  // A fraction in [0, 1): the first 4 digest bytes (little endian) of the time XOR the seed.
  function roll(time, seed) {
    var x = BigInt.asUintN(64, BigInt(time) ^ seed), bytes = [];
    for (var i = 0; i < 8; i++) bytes.push(Number((x >> BigInt(i * 8)) & 255n));
    var h = sha1(bytes);
    return (h[0] + h[1] * 256 + h[2] * 65536 + h[3] * 16777216) / 4294967296;
  }

  // The zone index picked in every slot from 0 to lastSlot.
  function pickZones(start, period, seed, zoneCount, lastSlot) {
    var weights = new Array(zoneCount).fill(1 / (zoneCount - 1));
    // The game starts as if a zone had been picked in the slot before the first one.
    weights[Math.floor(roll(start - period, seed) * zoneCount)] = 0;
    var picks = [];
    for (var slot = 0; slot <= lastSlot; slot++) {
      var r = roll(start + period * slot, seed), sum = 0, share = 0, pick = zoneCount - 1, i;
      // Rounding can leave the sum just below 1: the last zone is picked then.
      for (i = 0; i < zoneCount; i++) {
        sum += weights[i];
        if (r < sum) { pick = i; share = weights[i] / (zoneCount - 1); break; }
      }
      for (i = 0; i < zoneCount; i++) weights[i] += share;
      weights[pick] = 0;
      picks.push(pick);
    }
    return picks;
  }

  // The windows of a config ({ start, end, zoneMinutes, breakMinutes, seed, zones }, times in Unix
  // seconds, end null if it never ends, seed a decimal string) that end after `from`, soonest
  // first, at most `count`. The first may already have started.
  function configWindows(config, from, count) {
    var period = (config.zoneMinutes + config.breakMinutes) * 60, length = config.zoneMinutes * 60;
    var slot = Math.floor((from - config.start) / period);
    if (config.start + slot * period + length <= from) slot++; // inside a break: that zone is over
    var picks = pickZones(config.start, period, BigInt(config.seed), config.zones.length, slot + count - 1);
    var windows = [];
    for (var s = slot; s < slot + count; s++) {
      var start = config.start + s * period;
      if (config.end !== null && start >= config.end) break;
      windows.push({
        start: start,
        end: config.end === null ? start + length : Math.min(start + length, config.end),
        zone: config.zones[picks[s]]
      });
    }
    return windows;
  }

  // The windows that end after `from`, soonest first, like the game schedules them: the first
  // config covering a time wins, and each rotates on its own from its start.
  function schedule(configs, from, count) {
    var windows = [], cursor = from;
    while (windows.length < count) {
      var time = cursor;
      var config = configs.find(function (c) { return c.start <= time && (c.end === null || time < c.end); });
      if (!config) {
        var later = configs.map(function (c) { return c.start; }).filter(function (s) { return s > time; });
        if (!later.length) break;
        cursor = Math.min.apply(null, later);
        continue;
      }
      windows = windows.concat(configWindows(config, cursor, count - windows.length));
      if (config.end === null) break;
      cursor = config.end;
    }
    return windows;
  }

  return { sha1: sha1, pickZones: pickZones, schedule: schedule };
});
