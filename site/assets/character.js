/* Character: shows a character save (.d2s) the player picks: attributes, skills and every item,
   worded like the in-game tooltips. The file is read in the browser by assets/d2s.js and never
   leaves it. Game data comes from data/character.<lang>.js (window.ESR_CHAR_DATA), produced by
   scripts/build-character.mjs; item wording is assets/item-text.js. */
(function () {
  'use strict';

  var data = window.ESR_CHAR_DATA;
  var root = document.getElementById('character-page');
  if (!root) return;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (attrs[k] == null || attrs[k] === false) continue;
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'class') node.className = attrs[k];
        else node.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c == null || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function fmt(n) { return Number(n).toLocaleString(); }

  if (!data) {
    root.textContent = '';
    root.appendChild(el('h2', { class: 'ui-title', text: 'Character' }));
    root.appendChild(el('p', { class: 'ui-missing' }, [
      'Character data has not been generated. Run ',
      el('code', { text: 'node scripts/build-character.mjs' }),
      ' and reload.'
    ]));
    return;
  }

  var wording = window.ESRItemText.create(data);
  var statByName = {};
  Object.keys(data.stats).forEach(function (id) { statByName[data.stats[id].n] = +id; });

  // ---------------------------------------------------------------------
  // Page shell: intro and the file picker
  // ---------------------------------------------------------------------

  var ui = {};

  // Where ESR keeps its saves on Windows. A web page can't make the Open dialog start in a given
  // folder, so the page offers the path to copy: the dialog's File name box accepts it, with the
  // %USERNAME% variable, and Enter goes there.
  var SAVE_FOLDER = 'C:\\Users\\%USERNAME%\\Saved Games\\Diablo II Resurrected\\mods\\Eastern_Sun_Resurrected';

  function renderShell() {
    ui.file = el('input', { id: 'ch-file', type: 'file', accept: '.d2s', 'aria-describedby': 'ch-file-help' });
    ui.status = el('p', { id: 'ch-status', class: 'ch-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    ui.error = el('div', { class: 'ch-error', role: 'alert' });
    ui.results = el('div', { id: 'ch-results' });
    ui.copy = el('button', { type: 'button', class: 'ui-btn', text: 'Copy path' });
    ui.copied = el('span', { class: 'ch-copied', role: 'status', 'aria-live': 'polite' });
    ui.drop = el('div', { class: 'ch-drop' }, [
      el('label', { for: 'ch-file', text: 'Character save (.d2s)' }),
      ui.file,
      el('p', { id: 'ch-file-help', class: 'ch-help', text: 'Or drop the file anywhere on this box.' }),
      el('div', { class: 'ch-folder' }, [
        el('p', { class: 'ch-help', text: 'On Windows, ESR saves are in:' }),
        el('code', { id: 'ch-folder-path', text: SAVE_FOLDER }),
        ui.copy,
        ui.copied,
        el('p', { class: 'ch-help', text: 'Paste it into the File name box of the Open dialog and press Enter to go there.' +
          (window.showOpenFilePicker ? ' This browser reopens the dialog in the folder you used last.' : '') })
      ])
    ]);

    var generated = new Date(data.generatedAt);
    root.textContent = '';
    root.appendChild(el('h2', { class: 'ui-title', text: 'Character' }));
    root.appendChild(el('p', {
      class: 'ui-meta',
      text: 'Uses the mod’s game data from ' + generated.toLocaleDateString() + '.'
    }));
    root.appendChild(el('div', { class: 'ch-intro' }, [
      el('p', { text: 'Pick one of your Eastern Sun Resurrected characters to see its attributes, skills and the equipped items and charms that make them up, worded like the game’s tooltips.' }),
      el('p', null, [
        el('strong', { text: 'Your save stays on your computer: ' }),
        'the file is read by this page in your browser and is never uploaded.'
      ]),
      el('p', { text: 'Character saves are the .d2s files named after your characters.' })
    ]));
    root.appendChild(ui.drop);
    root.appendChild(ui.status);
    root.appendChild(ui.error);
    root.appendChild(ui.results);

    ui.file.addEventListener('change', function () {
      if (ui.file.files && ui.file.files[0]) load(ui.file.files[0]);
    });
    // Where the File System Access picker exists (Chrome, Edge), use it instead: its id makes the
    // dialog reopen in the folder the player picked from last time.
    if (window.showOpenFilePicker) {
      ui.file.addEventListener('click', function (e) {
        e.preventDefault();
        window.showOpenFilePicker({
          id: 'esr-saves',
          types: [{ description: 'Character saves', accept: { 'application/octet-stream': ['.d2s'] } }]
        }).then(function (handles) { return handles[0].getFile(); })
          .then(load)
          .catch(function (err) { if (err && err.name !== 'AbortError') showError('the file', err.message); });
      });
    }
    ui.copy.addEventListener('click', function () {
      var done = function () { ui.copied.textContent = 'Copied.'; setTimeout(function () { ui.copied.textContent = ''; }, 3000); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(SAVE_FOLDER).then(done, selectPath);
      } else selectPath();
    });
    ['dragenter', 'dragover'].forEach(function (type) {
      ui.drop.addEventListener(type, function (e) { e.preventDefault(); ui.drop.classList.add('ch-dragging'); });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      ui.drop.addEventListener(type, function () { ui.drop.classList.remove('ch-dragging'); });
    });
    ui.drop.addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) load(f);
    });
  }

  // Without clipboard access, select the path so it can be copied by hand.
  function selectPath() {
    var range = document.createRange();
    range.selectNodeContents(document.getElementById('ch-folder-path'));
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    ui.copied.textContent = 'Selected: press Ctrl+C to copy.';
  }

  function load(file) {
    ui.error.textContent = '';
    ui.status.textContent = 'Reading ' + file.name + '…';
    var reader = new FileReader();
    reader.onerror = function () { showError(file.name, 'The file couldn’t be read.'); };
    reader.onload = function () {
      var save;
      try { save = window.ESRD2S.parse(new Uint8Array(reader.result), data); }
      catch (e) { showError(file.name, e.message); return; }
      renderSave(save);
      ui.status.textContent = 'Showing ' + (save.header.name || file.name) + '.';
    };
    reader.readAsArrayBuffer(file);
  }

  function showError(name, message) {
    ui.results.textContent = '';
    ui.status.textContent = '';
    ui.error.textContent = '';
    ui.error.appendChild(el('p', null, [el('strong', { text: 'Couldn’t read ' + name + '. ' }), message]));
  }



  // ---------------------------------------------------------------------
  // The character
  // ---------------------------------------------------------------------

  var DIFFICULTY_DONE = ['', 'Normal', 'Nightmare', 'Hell'];

  function renderSave(save) {
    var h = save.header;
    var cls = data.classes[h.classId];
    var base = {};
    save.stats.forEach(function (s) { base[data.stats[s.id].n] = s.value; });
    var ctx = { level: h.level, base: base };

    ui.results.textContent = '';
    var tags = [];
    if (h.hardcore) tags.push('Hardcore');
    if (h.ladder) tags.push('Ladder');
    var done = Math.min(3, Math.floor(h.progression / 5));
    if (done) tags.push(DIFFICULTY_DONE[done] + ' completed');

    ui.results.appendChild(el('section', { class: 'ch-summary', 'aria-labelledby': 'ch-name' }, [
      el('h2', { id: 'ch-name', text: h.name || 'Unnamed character' }),
      el('p', { class: 'ch-class', text: 'Level ' + h.level + ' ' + (cls ? cls.name : 'class #' + h.classId) }),
      tags.length ? el('ul', { class: 'ch-tags', 'aria-label': 'Status' }, tags.map(function (t) { return el('li', { text: t }); })) : null,
      el('dl', { class: 'ch-facts' }, [
        fact('Experience', fmt(base.experience || 0)),
        fact('Gold', fmt(base.gold || 0)),
        fact('Gold in stash', fmt(base.goldbank || 0)),
        h.lastPlayed ? fact('Last saved', h.lastPlayed.toLocaleString()) : null
      ])
    ]));

    ui.results.appendChild(renderAttributes(save, cls, base, ctx));
    if (cls) ui.results.appendChild(renderSkills(save, cls));
    renderItemSections(save, ctx).forEach(function (s) { ui.results.appendChild(s); });
    ui.results.appendChild(el('p', { class: 'ch-note', text: 'Not counted yet: the bonuses of socketed gems and runes (socketed jewels are), and the totals your gear, skills and auras add up to. Item damage and defense include the item’s own mods and socketed jewels.' }));
  }

  function fact(term, value) {
    return el('div', null, [el('dt', { text: term }), el('dd', { text: value })]);
  }

  function section(id, title, children, intro) {
    return el('section', { class: 'ui-section', id: id, 'aria-labelledby': 'h-' + id }, [
      el('h2', { id: 'h-' + id, text: title }),
      intro ? el('p', { class: 'ui-intro', text: intro }) : null
    ].concat(children));
  }

  // Character stats: life, mana and stamina are saved in 256ths.
  var ATTRIBUTES = [
    ['strength', 'Strength'], ['dexterity', 'Dexterity'], ['vitality', 'Vitality'], ['energy', 'Energy'],
    ['statpts', 'Unspent stat points'], ['newskills', 'Unspent skill points'],
    ['maxhp', 'Life', 256], ['maxmana', 'Mana', 256], ['maxstamina', 'Stamina', 256]
  ];
  var SHOWN = { hitpoints: 1, mana: 1, stamina: 1, level: 1, experience: 1, gold: 1, goldbank: 1, lastexp: 1, nextexp: 1 };

  // Final values: the base plus active gear (see activeStats). Attributes add flat and per-level
  // bonuses, then their % bonus; vitality from gear adds life and stamina and energy adds mana at
  // the class's per-point rates (charstats.txt, in quarters), then flat and per-level life/mana,
  // then max life/mana %.
  function finalAttributes(save, cls, base, ctx) {
    var list = activeStats(save).map(function (a) { return a.stat; });
    var v = function (n) { return wording.stat(list, n, ctx); };
    var attr = function (n) {
      var total = (base[n] || 0) + v(n) + v('item_' + n + '_perlevel');
      return Math.floor(total * (100 + v(n + 'percent')) / 100);
    };
    var f = { strength: attr('strength'), dexterity: attr('dexterity'), vitality: attr('vitality'), energy: attr('energy') };
    var per = cls.per || {};
    var pool = function (saved, extra, flat, perLevel, pct) {
      var total = Math.floor((base[saved] || 0) / 256) + Math.floor(extra) + v(flat) + v(perLevel);
      return Math.floor(total * (100 + v(pct)) / 100);
    };
    var vit = f.vitality - (base.vitality || 0), en = f.energy - (base.energy || 0);
    f.maxhp = pool('maxhp', vit * (per.life || 0) / 4, 'maxhp', 'item_hp_perlevel', 'item_maxhp_percent');
    f.maxmana = pool('maxmana', en * (per.mana || 0) / 4, 'maxmana', 'item_mana_perlevel', 'item_maxmana_percent');
    f.maxstamina = pool('maxstamina', vit * (per.stamina || 0) / 4, 'maxstamina', 'item_stamina_perlevel', null);
    return f;
  }

  function renderAttributes(save, cls, base, ctx) {
    var known = {};
    var baseValue = function (a) { var x = base[a[0]] || 0; return a[2] ? Math.floor(x / a[2]) : x; };
    var rows = ATTRIBUTES.map(function (a) {
      known[a[0]] = true;
      return fact(a[1], fmt(baseValue(a)));
    });
    var kids = [el('h3', { class: 'ch-sub', text: 'Base' }), el('dl', { class: 'ch-facts ch-attributes' }, rows)];
    if (cls) {
      var f = finalAttributes(save, cls, base, ctx);
      kids.push(el('h3', { class: 'ch-sub', text: 'Final (with gear)' }));
      kids.push(el('dl', { class: 'ch-facts ch-attributes' }, ATTRIBUTES.filter(function (a) { return a[0] in f; }).map(function (a) {
        var diff = f[a[0]] - baseValue(a);
        return el('div', null, [
          el('dt', { text: a[1] }),
          el('dd', null, [fmt(f[a[0]]), diff ? el('span', { class: 'ch-plus', text: ' (' + (diff > 0 ? '+' : '') + fmt(diff) + ')' }) : null])
        ]);
      })));
      kids.push(el('p', { class: 'ch-help', text: 'From the equipped items (active weapon set), charms in the charm inventory, socketed jewels, runewords and set bonuses for the set items worn. Not counted yet: skills, auras, full-set bonuses and socketed gems and runes, so these can be lower than in game.' }));
      // what the game had when it saved: current values, so a lower bound for the real maximums
      kids.push(el('h3', { class: 'ch-sub', text: 'When the game saved' }));
      kids.push(el('dl', { class: 'ch-facts ch-attributes' }, [
        fact('Life', fmt(Math.floor((base.hitpoints || 0) / 256))),
        fact('Mana', fmt(Math.floor((base.mana || 0) / 256))),
        fact('Stamina', fmt(Math.floor((base.stamina || 0) / 256)))
      ]));
      kids.push(el('p', { class: 'ch-help', text: 'Current life, mana and stamina at the moment of saving, with everything active then. The real maximums are at least this much.' }));
    }
    var other = Object.keys(base).filter(function (n) { return !known[n] && !SHOWN[n]; });
    if (other.length) {
      kids.push(el('details', { class: 'ch-other' }, [
        el('summary', { text: 'Other saved stats (' + other.length + ')' }),
        el('p', { class: 'ch-help', text: 'Mod counters saved on the character, by their internal names.' }),
        el('dl', { class: 'ch-facts' }, other.map(function (n) { return fact(n, fmt(base[n])); }))
      ]));
    }
    return section('attributes', 'Attributes', kids,
      'Base: the points spent on the character. Final: with the bonuses from gear added.');
  }

  // ---------------------------------------------------------------------
  // Skill bonuses from gear
  // ---------------------------------------------------------------------

  // The items whose stats count: equipped (the active weapon set only), and charms in the charm
  // inventory (ESR's CharmInv: charms elsewhere give nothing). Mercenary items don't count.
  function activeItems(save) {
    var off = save.header.weaponSwitch ? [4, 5] : [11, 12];
    return save.items.filter(function (it) {
      if (it.mode === 1) return off.indexOf(it.slot) < 0;
      return it.mode === 0 && PAGES[it.page] === 'charms' && ((data.items[it.code] || {}).f & 1);
    });
  }

  // Every stat that applies, with the item it comes from: the item's own mods, its runeword,
  // socketed jewels, and its set bonuses for as many items of its set as are worn.
  function activeStats(save) {
    var items = activeItems(save);
    var setOf = function (it) { return it.q === 5 && data.sets[it.qid] ? data.sets[it.qid][1] : null; };
    var worn = {};
    items.forEach(function (it) { var s = setOf(it); if (s) worn[s] = (worn[s] || 0) + 1; });
    var out = [];
    items.forEach(function (it) {
      var name = wording.name(it).title;
      var add = function (list) { (list || []).forEach(function (st) { out.push({ stat: st, from: name }); }); };
      add(it.stats);
      add(it.rwStats);
      (it.socketed || []).forEach(function (s) { add(s.stats); });
      var count = setOf(it) ? worn[setOf(it)] : 0;
      (it.setStats || []).forEach(function (b) { if (count >= b.count) add(b.stats); });
    });
    return out;
  }

  // +skills from gear: all skills, class skills, a tree, one class skill (item_singleskill) and
  // oskills (item_nonclassskill, which also make a skill usable without hard points).
  function skillBonuses(save, classId) {
    var b = { all: [], cls: [], tab: [[], [], []], single: {}, oskill: {} };
    var push = function (map, key, x) { (map[key] = map[key] || []).push(x); };
    activeStats(save).forEach(function (a) {
      var n = data.stats[a.stat.id] && data.stats[a.stat.id].n;
      var p = a.stat.param, x = { v: a.stat.value, from: a.from };
      if (n === 'item_allskills') b.all.push(x);
      else if (n === 'item_addclassskills' && p === classId) b.cls.push(x);
      else if (n === 'item_addskill_tab' && (p >> 3) === classId && b.tab[p & 7]) b.tab[p & 7].push(x);
      else if (n === 'item_singleskill') push(b.single, p, x);
      else if (n === 'item_nonclassskill') push(b.oskill, p, x);
    });
    return b;
  }

  function sum(list) { return (list || []).reduce(function (n, x) { return n + x.v; }, 0); }

  function sources(list) {
    var names = [];
    list.forEach(function (x) { if (names.indexOf(x.from) < 0) names.push(x.from); });
    return names.join(', ');
  }

  function skillLink(name, level, clsId) {
    var q = { q: name, slvl: String(Math.max(1, level)) };
    if (clsId) q.class = clsId;
    return 'skills.html#' + new URLSearchParams(q).toString();
  }

  function renderSkills(save, cls) {
    var b = skillBonuses(save, data.classes.indexOf(cls));
    var trees = cls.trees.map(function (t) { return { title: t, skills: [] }; });
    var spent = 0;
    var own = {};
    cls.skills.forEach(function (id, i) {
      var s = data.skills[id];
      var pts = save.skills[i] || 0;
      var tree = (s && s[2] ? s[2] : 1) - 1;
      spent += pts;
      own[id] = true;
      if (!trees[tree]) return;
      trees[tree].skills.push({
        name: s ? s[0] : 'Skill #' + id, pts: pts,
        plus: sum(b.all) + sum(b.cls) + sum(b.tab[tree]) + sum(b.single[id]), oskill: sum(b.oskill[id])
      });
    });

    var groups = trees.map(function (t) {
      return el('div', { class: 'ch-tree' }, [
        el('h3', { text: t.title }),
        el('ul', null, t.skills.map(function (s) {
          // +skills only raise skills the character can use: hard points, or an oskill
          var usable = s.pts > 0 || s.oskill > 0;
          var extra = usable ? s.plus + s.oskill : 0;
          var level = s.pts + extra;
          var label = s.pts + ' hard point' + (s.pts === 1 ? '' : 's') + (extra ? ', plus ' + extra + ' from items: level ' + level : '');
          return el('li', { class: usable ? null : 'ch-zero' }, [
            el('a', { href: skillLink(s.name, level, cls.id), text: s.name }),
            el('span', { class: 'ch-pts', 'aria-label': label }, usable ? [
              String(level),
              extra ? el('span', { class: 'ch-plus', text: ' (' + s.pts + '+' + extra + ')' }) : null
            ] : ['–'])
          ]);
        }))
      ]);
    });

    // what the bonuses add up to, and the items they come from
    var totals = [];
    var line = function (text, list) {
      if (!sum(list)) return;
      totals.push(el('li', null, ['+' + sum(list) + ' to ' + text + ' ', el('span', { class: 'ch-from', text: '(' + sources(list) + ')' })]));
    };
    line('All Skills', b.all);
    line(cls.name + ' Skills', b.cls);
    cls.trees.forEach(function (t, i) { line(t, b.tab[i]); });
    Object.keys(b.single).forEach(function (id) { if (own[id]) line(data.skills[id][0], b.single[id]); });
    Object.keys(b.oskill).forEach(function (id) { if (own[id]) line(data.skills[id][0] + ' (oskill)', b.oskill[id]); });

    // oskills of skills the class doesn't have (its own are in the trees above)
    var oskills = Object.keys(b.oskill).filter(function (id) { return !own[id] && sum(b.oskill[id]) > 0; })
      .map(function (id) { return { s: data.skills[id] || ['Skill #' + id], v: sum(b.oskill[id]), list: b.oskill[id] }; })
      .sort(function (x, y) { return y.v - x.v || x.s[0].localeCompare(y.s[0]); });

    var kids = [el('div', { class: 'ch-trees' }, groups)];
    if (totals.length) {
      kids.push(el('h3', { class: 'ch-sub', text: 'Skill bonuses from gear' }));
      kids.push(el('ul', { class: 'ch-bonuses' }, totals));
    }
    if (oskills.length) {
      kids.push(el('h3', { class: 'ch-sub', text: 'Skills granted by items (' + oskills.length + ')' }));
      kids.push(el('ul', { class: 'ch-oskills' }, oskills.map(function (o) {
        var c = o.s[1] != null ? data.classes[o.s[1]] : null;
        return el('li', null, [
          el('a', { href: skillLink(o.s[0], o.v, c && c.id), text: o.s[0] }),
          c ? el('span', { class: 'ch-from', text: '(' + c.name + ')' }) : null,
          el('span', { class: 'ch-pts', text: 'Level ' + o.v }),
          el('span', { class: 'ch-from ch-oskill-from', text: sources(o.list) })
        ]);
      })));
    }
    return section('skills', 'Skills', kids,
      fmt(spent) + ' hard points in ' + cls.name + ' skills; levels include +skills from gear, shown as (hard + items). ' +
      'Items only raise skills the character can use: ones with hard points or granted by an item. Counted: equipped items (the active weapon set), ' +
      'charms in the charm inventory, socketed jewels, runewords and the set bonuses for the set items worn. Not counted yet: full-set bonuses and socketed gems and runes.');
  }

  // ---------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------

  var SLOTS = { 1: 'Head', 2: 'Amulet', 3: 'Body', 4: 'Right Hand', 5: 'Left Hand', 6: 'Right Ring', 7: 'Left Ring', 8: 'Belt', 9: 'Feet', 10: 'Gloves', 11: 'Right Hand (switch)', 12: 'Left Hand (switch)' };
  var SLOT_ORDER = [4, 5, 11, 12, 1, 3, 10, 8, 9, 2, 6, 7];
  var PAGES = { 0: 'inventory', 3: 'cube', 4: 'stash', 6: 'charms' };

  // Only the items that count towards the character's stats: what's equipped (both weapon sets,
  // the inactive one is marked) and the charms in the charm inventory. Inventory, belt, cube,
  // stash and mercenary items add nothing, so they aren't shown.
  function renderItemSections(save, ctx) {
    var active = activeItems(save);
    var equipped = save.items.filter(function (it) { return it.mode === 1; });
    var charms = active.filter(function (it) { return it.mode === 0; });
    equipped.sort(function (a, b) { return SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot); });
    charms.sort(function (a, b) { return a.y - b.y || a.x - b.x; });

    var out = [];
    var add = function (id, title, list, intro) {
      if (!list.length) return;
      out.push(section(id, title + ' (' + list.length + ')', [
        el('ul', { class: 'ch-items' }, list.map(function (it) {
          return renderItem(it, ctx, id === 'equipped', active.indexOf(it) < 0);
        }))
      ], intro));
    };
    add('equipped', 'Equipped', equipped);
    add('charms', 'Charm Inventory', charms, 'Only charms in the charm inventory give their bonuses in ESR.');
    return out;
  }

  var QUALITY_CLASS = { Unique: 'uni', Set: 'set', Rare: 'rar', Magic: 'mag', Crafted: 'crf', Runeword: 'rune', 'Low Quality': 'low', Tempered: 'crf' };

  function allStats(it) {
    var list = (it.stats || []).concat(it.rwStats || []);
    (it.socketed || []).forEach(function (s) { list = list.concat(s.stats || []); });
    return list;
  }

  // The tooltip's base lines: damage or defense, durability, quantity, sockets.
  function baseLines(it, ctx) {
    var info = data.items[it.code] || {};
    var out = [];
    var stats = allStats(it);
    var v = function (n) { return wording.stat(stats, n, ctx); };
    var eth = function (x) { return it.ethereal ? Math.floor(x * 3 / 2) : x; };
    if (info.k === 'w') {
      var edMin = v('item_mindamage_percent'), edMax = v('item_maxdamage_percent');
      var dmg = function (label, d, minName, maxName) {
        if (!d) return;
        var lo = Math.floor(eth(d[0]) * (100 + edMin) / 100) + v(minName);
        var hi = Math.floor(eth(d[1]) * (100 + edMax) / 100) + v(maxName) + v('item_maxdamage_perlevel');
        if (hi <= lo) hi = lo + 1;
        out.push(label + ': ' + lo + ' to ' + hi);
      };
      dmg('One-Hand Damage', info.d1, 'mindamage', 'maxdamage');
      dmg('Two-Hand Damage', info.d2, 'secondary_mindamage', 'secondary_maxdamage');
      dmg('Throw Damage', info.dt, 'item_throw_mindamage', 'item_throw_maxdamage');
    }
    if (info.k === 'a' && it.def != null) {
      var def = Math.floor(it.def * (100 + v('item_armor_percent')) / 100) + v('armorclass') + v('item_armor_perlevel');
      out.push('Defense: ' + fmt(def));
    }
    if (it.maxDur > 0) out.push('Durability: ' + it.dur + ' of ' + it.maxDur);
    if (it.qty != null && it.qty > 0) out.push('Quantity: ' + it.qty);
    if (it.ilvl) out.push('Item Level: ' + it.ilvl);
    return out;
  }

  function modList(lines, cls) {
    if (!lines.length) return null;
    return el('ul', { class: cls }, lines.map(function (l) { return el('li', { text: l.text }); }));
  }

  function renderItem(it, ctx, equipped, inactive) {
    var n = wording.name(it);
    var qc = QUALITY_CLASS[n.quality];
    var label = [n.quality === 'Normal' ? null : n.quality];
    if (it.q === 5 && data.sets[it.qid]) label = ['Set item: ' + data.sets[it.qid][1]];
    if (it.ethereal) label.push('Ethereal');
    if (equipped && SLOTS[it.slot]) label.unshift(SLOTS[it.slot]);
    if (inactive) label.push('Inactive weapon set: not counted');
    var kids = [
      el('p', { class: 'ch-item-name' + (qc ? ' ch-q-' + qc : '') }, [n.title]),
      n.base ? el('p', { class: 'ch-base', text: n.base }) : null,
      el('p', { class: 'ch-label', text: label.filter(Boolean).join(' · ') || 'Normal' }),
      el('p', { class: 'ch-props', text: baseLines(it, ctx).join('\n') }),
      modList(wording.lines((it.stats || []).concat(it.rwStats || []), ctx), 'ch-mods')
    ];
    if (it.sockets) {
      kids.push(el('p', { class: 'ch-props', text: 'Socketed (' + (it.socketed || []).length + '/' + it.sockets + ')' }));
    }
    (it.setStats || []).forEach(function (s) {
      var lines = wording.lines(s.stats, ctx);
      if (!lines.length) return;
      kids.push(el('p', { class: 'ch-set-count', text: 'With ' + s.count + ' set items:' }));
      kids.push(modList(lines, 'ch-mods ch-set-mods'));
    });
    if ((it.socketed || []).length) {
      kids.push(el('ul', { class: 'ch-socketed', 'aria-label': 'Socketed' }, it.socketed.map(function (s) {
        var sn = wording.name(s);
        var sq = QUALITY_CLASS[sn.quality];
        return el('li', null, [
          el('span', { class: sq ? 'ch-q-' + sq : null, text: sn.title }),
          sn.quality !== 'Normal' ? el('span', { class: 'ch-label', text: ' (' + sn.quality + ')' }) : null,
          modList(wording.lines(s.stats || [], ctx), 'ch-mods')
        ]);
      })));
    }
    return el('li', { class: 'ch-item' }, kids);
  }

  renderShell();
})();
