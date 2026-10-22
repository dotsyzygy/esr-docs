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
  var calc = window.ESRCharCalc.create({ data: data, SkillCalc: window.ESRSkillCalc, wording: wording });

  // The loaded save and the player's choices for its effects (on/off, the weapon set a buff is
  // cast with, the stage of a stacking one). Changing a choice recomputes and redraws; choices
  // reset when another save loads.
  var current = { save: null, on: {}, from: {}, stage: {}, difficulty: null };

  function renderSave(save) {
    current = { save: save, on: {}, from: {}, stage: {}, difficulty: current.difficulty, target: current.target };
    redraw();
  }

  function redraw(focusId) {
    var save = current.save;
    var h = save.header;
    var cls = data.classes[h.classId];
    var model = calc.compute(save, { on: current.on, from: current.from, stage: current.stage });
    var base = model.base;

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
        fact('Weapons in hand', model.inHand === 'switch' ? 'Switch set' : 'Main set'),
        h.lastPlayed ? fact('Last saved', h.lastPlayed.toLocaleString()) : null
      ])
    ]));

    if (model.effects.length) ui.results.appendChild(renderEffects(model));
    ui.results.appendChild(renderAttributes(model, cls));
    ui.results.appendChild(renderAdvanced(model, cls));
    var bps = renderBreakpoints(save, model);
    if (bps) ui.results.appendChild(bps);
    if (cls) ui.results.appendChild(renderDamage(save, model, cls));
    if (cls) ui.results.appendChild(renderSkills(save, cls, model));
    renderItemSections(save, model).forEach(function (s) { ui.results.appendChild(s); });
    ui.results.appendChild(el('p', { class: 'ch-note', text: 'Not counted: charm groups where only one charm works (charm-dedup), item requirements, and the mercenary’s auras. Item damage and defense on the cards include the item’s own mods and socketed jewels.' }));

    if (focusId) {
      var f = document.getElementById(focusId);
      if (f) f.focus();
    }
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

  // ---------------------------------------------------------------------
  // Buffs, auras and passives
  // ---------------------------------------------------------------------

  var KIND_TITLES = {
    buff: 'Buffs you can cast',
    aura: 'Auras you can use',
    'item aura': 'Auras from items',
    passive: 'Passive skills'
  };
  var SET_NAMES = { main: 'main weapons', switch: 'switch weapons' };

  function duration(seconds) {
    if (!seconds) return '';
    var m = Math.floor(seconds / 60), s = seconds % 60;
    return m ? m + ' min' + (s ? ' ' + s + ' s' : '') : s + ' s';
  }

  function renderEffects(model) {
    var groups = {};
    model.effects.forEach(function (e) { (groups[e.kind] = groups[e.kind] || []).push(e); });
    var kids = [];
    ['buff', 'aura', 'item aura', 'passive'].forEach(function (kind) {
      if (!groups[kind]) return;
      kids.push(el('h3', { class: 'ch-sub', text: KIND_TITLES[kind] }));
      kids.push(el('ul', { class: 'ch-effects' }, groups[kind].map(function (e) { return renderEffect(e, model); })));
    });
    return section('effects', 'Buffs, auras and passives', kids,
      'Switch them on to add them to the attributes and skill levels below. Passives and auras from the gear in hand are on, as in game; buffs and class auras are off until you switch them on. ' +
      'Curses, debuffs and auras that land on enemies list those stats under “On enemies”: they don’t change the character, and the resistances they take off go to the target in Damage. Effects that stack show a stage to pick (default: the last that adds anything). ' +
      'A buff’s level is set when it’s cast, so it can be cast with the switch weapons and keep its level after swapping back. Buffs that add skill levels (Battle Command) raise their own next cast and every buff cast after them: the page recasts until the levels stop rising, and says how many casts that takes.');
  }

  function renderEffect(e, model) {
    var id = 'ch-eff-' + e.key.replace(/[^a-z0-9]+/gi, '-');
    var box = el('input', { type: 'checkbox', id: id });
    box.checked = e.enabled;
    box.addEventListener('change', function () {
      current.on[e.key] = box.checked;
      redraw(id);
    });
    var meta = [];
    if (e.level) meta.push('Level ' + e.level);
    if (e.kind === 'item aura') meta.push('from ' + e.item);
    if (e.seconds) meta.push(duration(e.seconds));
    var kids = [
      el('div', { class: 'ch-effect-head' }, [
        box,
        el('label', { for: id }, [el('span', { class: 'ch-effect-name', text: e.name }), el('span', { class: 'ch-from', text: meta.join(' · ') })])
      ])
    ];
    // which weapon set to cast with, when both can cast it
    if (e.cast && e.sets.length > 1) {
      var selId = id + '-set';
      var sel = el('select', { id: selId }, e.sets.map(function (s) {
        var lv = model.levelsBySet && model.levelsBySet[s] && model.levelsBySet[s][e.id];
        return el('option', { value: s, text: 'Cast with ' + SET_NAMES[s] + (lv ? ' (level ' + lv.level + ')' : '') });
      }));
      sel.value = e.set;
      sel.addEventListener('change', function () {
        current.from[e.key] = sel.value;
        redraw(selId);
      });
      kids.push(el('div', { class: 'ch-effect-set' }, [el('label', { class: 'sr-only', for: selId, text: e.name + ': weapon set' }), sel]));
    } else if (e.cast) {
      kids.push(el('p', { class: 'ch-from', text: 'Cast with ' + SET_NAMES[e.set] }));
    }
    // how many stacks a stacking effect has built up (Permafrost, Fist of the Heavens)
    if (e.stages && e.stages.length > 1) {
      var stId = id + '-stage';
      var last = e.stages[e.stages.length - 1];
      var st = el('select', { id: stId }, e.stages.map(function (n) {
        return el('option', { value: String(n), text: 'Stage ' + n + ' of ' + last });
      }));
      st.value = String(e.stage);
      st.addEventListener('change', function () {
        current.stage[e.key] = +st.value;
        redraw(stId);
      });
      kids.push(el('div', { class: 'ch-effect-set' }, [el('label', { class: 'sr-only', for: stId, text: e.name + ': stage' }), st]));
    }
    if (e.casts > 1) {
      kids.push(el('p', { class: 'ch-recast', text: 'Cast ' + e.casts + ' times to reach level ' + e.level + ' (' + e.levels.join(' → ') + ')' }));
    }
    var lines = wording.lines(e.stats, model.ctx);
    var foe = wording.lines(e.enemyStats || [], model.ctx);
    if (lines.length) kids.push(el('ul', { class: 'ch-mods' }, lines.map(function (l) { return el('li', { text: l.text }); })));
    if (foe.length) {
      kids.push(el('p', { class: 'ch-foe', text: 'On enemies:' }));
      kids.push(el('ul', { class: 'ch-mods' }, foe.map(function (l) { return el('li', { text: l.text }); })));
    }
    if (!lines.length && !foe.length) kids.push(el('p', { class: 'ch-from', text: e.missing ? 'Its formulas aren’t in the data.' : 'Nothing that shows on this page.' }));
    return el('li', { class: 'ch-effect' + (e.enabled ? ' ch-on' : '') }, kids);
  }

  // ---------------------------------------------------------------------
  // Attributes
  // ---------------------------------------------------------------------

  // Character stats: life, mana and stamina are saved in 256ths.
  var ATTRIBUTES = [
    ['strength', 'Strength'], ['dexterity', 'Dexterity'], ['vitality', 'Vitality'], ['energy', 'Energy'],
    ['statpts', 'Unspent stat points'], ['newskills', 'Unspent skill points'],
    ['maxhp', 'Life', 256], ['maxmana', 'Mana', 256], ['maxstamina', 'Stamina', 256]
  ];
  var SHOWN = { hitpoints: 1, mana: 1, stamina: 1, level: 1, experience: 1, gold: 1, goldbank: 1, lastexp: 1, nextexp: 1 };

  // Final values: the base plus every stat that applies (gear in hand and the effects that are
  // on). Attributes add flat and per-level bonuses, then their % bonus; vitality and energy above
  // the base add life, stamina and mana at the class's per-point rates (charstats.txt, in
  // quarters), then flat and per-level life/mana, then max life/mana % (and skill_staminapercent).
  function finalAttributes(model, cls) {
    var base = model.base;
    var list = model.stats.map(function (a) { return a.stat; });
    var v = function (n) { return n ? wording.stat(list, n, model.ctx) : 0; };
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
    f.maxstamina = pool('maxstamina', vit * (per.stamina || 0) / 4, 'maxstamina', 'item_stamina_perlevel', 'skill_staminapercent');
    return f;
  }

  function renderAttributes(model, cls) {
    var base = model.base;
    var known = {};
    var baseValue = function (a) { var x = base[a[0]] || 0; return a[2] ? Math.floor(x / a[2]) : x; };
    var rows = ATTRIBUTES.map(function (a) {
      known[a[0]] = true;
      return fact(a[1], fmt(baseValue(a)));
    });
    var kids = [el('h3', { class: 'ch-sub', text: 'Base' }), el('dl', { class: 'ch-facts ch-attributes' }, rows)];
    if (cls) {
      var f = finalAttributes(model, cls);
      kids.push(el('h3', { class: 'ch-sub', text: 'Final' }));
      kids.push(el('dl', { class: 'ch-facts ch-attributes' }, ATTRIBUTES.filter(function (a) { return a[0] in f; }).map(function (a) {
        var diff = f[a[0]] - baseValue(a);
        return el('div', null, [
          el('dt', { text: a[1] }),
          el('dd', null, [fmt(f[a[0]]), diff ? el('span', { class: 'ch-plus', text: ' (' + (diff > 0 ? '+' : '') + fmt(diff) + ')' }) : null])
        ]);
      })));
      var onCount = model.effects.filter(function (e) { return e.enabled; }).length;
      kids.push(el('p', { class: 'ch-help', text: 'With the gear in hand (equipped items, charms in the charm inventory, socketed jewels, runewords and set bonuses for the set items worn) and the ' +
        onCount + ' buff' + (onCount === 1 ? '' : 's') + ', aura' + (onCount === 1 ? '' : 's') + ' and passive' + (onCount === 1 ? '' : 's') + ' switched on above. Not counted yet: full-set bonuses and socketed gems and runes.' }));
      // what the game had when it saved: current values, so a lower bound for the real maximums
      kids.push(el('h3', { class: 'ch-sub', text: 'When the game saved' }));
      kids.push(el('dl', { class: 'ch-facts ch-attributes' }, [
        fact('Life', fmt(Math.floor((base.hitpoints || 0) / 256))),
        fact('Mana', fmt(Math.floor((base.mana || 0) / 256))),
        fact('Stamina', fmt(Math.floor((base.stamina || 0) / 256)))
      ]));
      kids.push(el('p', { class: 'ch-help', text: 'Current life, mana and stamina at the moment of saving, with whatever was active then. The real maximums were at least this much.' }));
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
      'Base: the points spent on the character. Final: with the gear in hand and the buffs, auras and passives that are on.');
  }

  // ---------------------------------------------------------------------
  // Advanced stats
  // ---------------------------------------------------------------------

  // Rows of summed stats: [label, stat names added up, unit, cap]. Stats missing from the data
  // are skipped; per-level stats count at the character's level.
  var ADVANCED = [
    { title: 'Speed', rows: [
      ['Increased Attack Speed', ['item_fasterattackrate'], '%'],
      ['Faster Cast Rate', ['item_fastercastrate'], '%'],
      ['Faster Hit Recovery', ['item_fastergethitrate'], '%'],
      ['Faster Block Rate', ['item_fasterblockrate'], '%'],
      ['Faster Run/Walk', ['item_fastermovevelocity'], '%']
    ] },
    { title: 'Offense', rows: [
      ['Attack Rating', ['tohit', 'item_tohit_perlevel'], ''],
      ['Bonus to Attack Rating', ['item_tohit_percent', 'item_tohitpercent_perlevel'], '%'],
      ['Deadly Strike', ['item_deadlystrike', 'item_deadlystrike_perlevel'], '%'],
      ['Crushing Blow', ['item_crushingblow', 'item_crushingblow_perlevel'], '%'],
      ['Open Wounds', ['item_openwounds'], '%'],
      ['Life Stolen per Hit', ['lifedrainmindam'], '%'],
      ['Mana Stolen per Hit', ['manadrainmindam'], '%'],
      ['Piercing Attack', ['item_pierce'], '%']
    ] },
    { title: 'Defense', rows: [
      ['Damage Reduced by', ['normal_damage_reduction'], ''],
      ['Magic Damage Reduced by', ['magic_damage_reduction'], ''],
      ['Increased Chance of Blocking', ['toblock'], '%'],
      // ESR caps dodge, avoid and evade at 75% (dodge-avoid-evade-cap plugin)
      ['Dodge', ['passive_dodge'], '%', 75],
      ['Avoid', ['passive_avoid'], '%', 75],
      ['Evade', ['passive_evade'], '%', 75]
    ] },
    { title: 'Absorb', rows: [
      ['Fire Absorb', ['item_absorbfire_percent'], '%'], ['Fire Absorb (flat)', ['item_absorbfire'], ''],
      ['Cold Absorb', ['item_absorbcold_percent'], '%'], ['Cold Absorb (flat)', ['item_absorbcold'], ''],
      ['Lightning Absorb', ['item_absorblight_percent'], '%'], ['Lightning Absorb (flat)', ['item_absorblight'], ''],
      ['Magic Absorb', ['item_absorbmagic_percent'], '%'], ['Magic Absorb (flat)', ['item_absorbmagic'], '']
    ] },
    { title: 'Find', rows: [
      ['Magic Find', ['item_magicbonus'], '%'],
      ['Gold Find', ['item_goldbonus'], '%'],
      ['Experience Gained', ['item_addexperience'], '%']
    ] }
  ];
  var RESISTS = [
    ['Fire', 'fireresist', 'maxfireresist'], ['Cold', 'coldresist', 'maxcoldresist'],
    ['Lightning', 'lightresist', 'maxlightresist'], ['Poison', 'poisonresist', 'maxpoisonresist']
  ];
  var BASE_MAX_RESIST = 75;

  // Total defense: each armor's own defense with its own Enhanced Defense, every flat defense
  // (items, charms, skills such as Sway), a quarter of dexterity, then defense % from skills.
  function totalDefense(model, f) {
    var list = model.stats.map(function (a) { return a.stat; });
    var v = function (n) { return wording.stat(list, n, model.ctx); };
    var items = 0;
    model.items[model.inHand].forEach(function (it) {
      if (it.def == null || (data.items[it.code] || {}).k !== 'a') return;
      var own = (it.stats || []).concat(it.rwStats || []);
      items += Math.floor(it.def * (100 + wording.stat(own, 'item_armor_percent', model.ctx)) / 100);
    });
    var flat = v('armorclass') + v('item_armor_perlevel') + Math.floor((f.dexterity || 0) / 4);
    return Math.floor((items + flat) * (100 + v('skill_armor_percent') + v('item_armorpercent_perlevel')) / 100);
  }

  function renderAdvanced(model, cls) {
    var list = model.stats.map(function (a) { return a.stat; });
    var v = function (n) { return data.stats[statId(n)] ? wording.stat(list, n, model.ctx) : 0; };
    var f = cls ? finalAttributes(model, cls) : {};
    var diffs = data.difficulty || [];
    var di = current.difficulty != null ? current.difficulty : diffs.length - 1;
    var penalty = diffs[di] ? diffs[di].rp : 0;
    if (penalty > 0) penalty = 0; // ESR's Normal row says 1; there's no bonus

    var selId = 'ch-difficulty';
    var sel = el('select', { id: selId }, diffs.map(function (d, i) { return el('option', { value: String(i), text: d.n + (d.rp < 0 ? ' (' + d.rp + '% resistances)' : '') }); }));
    sel.value = String(di);
    sel.addEventListener('change', function () { current.difficulty = +sel.value; redraw(selId); });

    var res = RESISTS.map(function (r) {
      var total = v(r[1]) + penalty;
      var max = BASE_MAX_RESIST + v(r[2]);
      return el('div', null, [
        el('dt', { text: r[0] + ' Resist' }),
        el('dd', null, [Math.min(total, max) + '%', el('span', { class: 'ch-plus', text: ' (' + total + '% of max ' + max + '%)' })])
      ]);
    });
    res.push(el('div', null, [el('dt', { text: 'Magic Resist' }), el('dd', { text: v('magicresist') + '%' })]));
    res.push(el('div', null, [el('dt', { text: 'Physical Resist' }), el('dd', { text: v('damageresist') + '%' })]));

    var kids = [
      el('div', { class: 'ui-field ch-field' }, [el('label', { for: selId, text: 'Difficulty' }), sel]),
      el('h3', { class: 'ch-sub', text: 'Resistances' }),
      el('dl', { class: 'ch-facts' }, res)
    ];
    if (cls) {
      kids.push(el('h3', { class: 'ch-sub', text: 'Defense total' }));
      kids.push(el('dl', { class: 'ch-facts' }, [fact('Defense', fmt(totalDefense(model, f)))]));
    }
    ADVANCED.forEach(function (g) {
      var rows = g.rows.filter(function (r) { return r[1].some(function (n) { return data.stats[statId(n)]; }); }).map(function (r) {
        var total = r[1].reduce(function (n, name) { return n + v(name); }, 0);
        var shown = r[3] != null ? Math.min(total, r[3]) : total;
        return el('div', { class: total ? null : 'ch-zero' }, [
          el('dt', { text: r[0] }),
          el('dd', null, [fmt(shown) + r[2], r[3] != null && total > r[3] ? el('span', { class: 'ch-plus', text: ' (' + fmt(total) + r[2] + ', capped)' }) : null])
        ]);
      });
      kids.push(el('h3', { class: 'ch-sub', text: g.title }));
      kids.push(el('dl', { class: 'ch-facts' }, rows));
    });
    var all = wording.lines(list, model.ctx);
    kids.push(el('details', { class: 'ch-other' }, [
      el('summary', { text: 'Every bonus, added up (' + all.length + ')' }),
      el('ul', { class: 'ch-mods ch-all-mods' }, all.map(function (l) { return el('li', { text: l.text }); }))
    ]));
    return section('advanced', 'Advanced stats', kids,
      'Totals of everything that applies: the gear in hand, socketed gems and runes, set bonuses, and the buffs, auras and passives that are on. Resistances include the difficulty’s penalty and stop at their maximum (75% plus max resist bonuses).');
  }

  var statIds = {};
  Object.keys(data.stats).forEach(function (id) { statIds[data.stats[id].n] = +id; });
  function statId(n) { return statIds[n]; }

  // ---------------------------------------------------------------------
  // Breakpoints
  // ---------------------------------------------------------------------

  function renderBreakpoints(save, model) {
    var bp = calc.breakpoints(save, model);
    if (!bp || !bp.modes.length) return null;
    var STAT = { attack: 'IAS', cast: 'FCR', hit: 'FHR', block: 'FBR' };
    var cards = bp.modes.map(function (m) {
      var perSecond = (25 / m.frames).toFixed(2);
      var current = m.table.filter(function (t) { return t[0] <= m.value; }).pop();
      return el('li', { class: 'ch-bp' }, [
        el('h3', { text: m.label }),
        el('p', { class: 'ch-bp-now' }, [String(m.frames), el('span', { class: 'ch-from', text: ' frames at ' + m.value + '% ' + STAT[m.key] })]),
        m.key === 'attack' || m.key === 'cast' ? el('p', { class: 'ch-from', text: '≈ ' + perSecond + ' per second' }) : null,
        el('p', { class: 'ch-from', text: m.next ? 'Next: ' + m.next[1] + ' frames at ' + m.next[0] + '% ' + STAT[m.key] + ' (' + (m.next[0] - m.value) + ' more)' : 'At the last breakpoint' }),
        el('table', { class: 'ch-bp-table' }, [
          el('caption', { class: 'sr-only', text: m.label + ' breakpoints' }),
          el('thead', null, [el('tr', null, [el('th', { scope: 'col', text: STAT[m.key] }), el('th', { scope: 'col', text: 'Frames' })])]),
          el('tbody', null, m.table.map(function (t) {
            return el('tr', { class: t === current ? 'ch-bp-here' : null }, [el('td', { text: t[0] + '%' }), el('td', { text: String(t[1]) })]);
          }))
        ])
      ]);
    });
    return section('breakpoints', 'Breakpoints', [el('ul', { class: 'ch-bps' }, cards)],
      'Frames per action for the ' + data.classes[save.header.classId].name + ' with ' + (bp.weapon ? bp.weapon + ' (' + bp.wclass.toLowerCase() + ', weapon speed ' + (bp.wsm > 0 ? '+' : '') + bp.wsm + ')' : 'no weapon') +
      ', from the mod’s animation data. Attack speed also counts skill attack speed' + (bp.sias ? ' (+' + bp.sias + '%)' : '') + ' and stops at +75% speed; cast rate stops where ESR’s cap puts it (' + (data.fcrCap || 200) + '% FCR). ' +
      'Attacks are the basic attack animation; skills with their own animations (Strafe, Multiple Shot, …) differ. 25 frames make a second.');
  }

  // ---------------------------------------------------------------------
  // Damage
  // ---------------------------------------------------------------------

  function numberField(id, label, value, max, onChange) {
    var input = el('input', { id: id, type: 'number', min: 0, max: max, step: 1, inputmode: 'numeric', value: value });
    input.addEventListener('change', function () {
      var n = Math.max(0, Math.min(max, Math.floor(+input.value || 0)));
      onChange(n);
      redraw(id);
    });
    return el('div', { class: 'ui-field ch-field' }, [el('label', { for: id, text: label }), input]);
  }

  var TARGET_TYPES = [
    ['monster', 'Monster'], ['champion', 'Champion'], ['minion', 'Minion of a unique or champion'],
    ['unique', 'Unique monster'], ['super_unique', 'Super unique'], ['act_boss', 'Act boss']
  ];

  function pct(x) { return (Math.round(x * 1000) / 10) + '%'; }

  function renderDamage(save, model, cls) {
    var target = current.target || (current.target = { res: 0, phys: 0, type: 'monster', life: 100000 });
    var dmg = calc.skillDamage(save, model, finalAttributes(model, cls), target);
    var typeId = 'ch-target-type';
    var typeSel = el('select', { id: typeId }, TARGET_TYPES.map(function (t) {
      return el('option', { value: t[0], text: t[1] });
    }));
    typeSel.value = target.type;
    typeSel.addEventListener('change', function () { target.type = typeSel.value; redraw(typeId); });
    var kids = [el('div', { class: 'ch-target' }, [
      el('div', { class: 'ui-field ch-field' }, [el('label', { for: typeId, text: 'Target' }), typeSel]),
      numberField('ch-target-life', 'Target life', target.life, 1e12, function (n) { target.life = n; }),
      numberField('ch-target-res', 'Target elemental resistance (%)', target.res, 95, function (n) { target.res = n; }),
      numberField('ch-target-phys', 'Target physical resistance (%)', target.phys, 95, function (n) { target.phys = n; })
    ])];
    if (dmg.phys) {
      var p = dmg.phys.parts;
      kids.push(el('p', { class: 'ch-help', text: 'Weapon damage: ' + fmt(dmg.phys.min) + '–' + fmt(dmg.phys.max) + ' (' + dmg.weapon + ' ' + p.weapon[0] + '–' + p.weapon[1] +
        ', then +' + p.otherED + '% enhanced damage from other gear, +' + p.skillED + '% from skills, +' + p.attr + '% from attributes). ' +
        'Deadly strike: ' + dmg.dsTotal + '% in Advanced stats, so ' + pct(dmg.critChance) + ' of hits deal ×' + dmg.critMult.toFixed(2) + ' weapon damage. ' +
        'Crushing blow: ' + dmg.cbTotal + '% in Advanced stats, so ' + pct(dmg.crushChance) + ' of hits, and against this target (' + TARGET_TYPES.filter(function (t) { return t[0] === target.type; })[0][1] + ') each removes ' + data.crush.targets[target.type] + '% of the target’s current life (ranged: ×' + (data.crush.ranged / 100) + ', less physical resistance).' }));
    }
    if (model.enemy.length) {
      var lowered = [['fire', 'Fire'], ['cold', 'Cold'], ['light', 'Lightning'], ['poison', 'Poison'], ['magic', 'Magic']]
        .filter(function (r) { return dmg.res[r[0]] !== (target.res || 0); })
        .map(function (r) { return r[1] + ' ' + dmg.res[r[0]] + '%'; });
      if (dmg.physRes !== Math.min(95, target.phys || 0)) lowered.push('Physical ' + dmg.physRes + '%');
      if (lowered.length) kids.push(el('p', { class: 'ch-help', text: 'Target resistances with the effects on enemies that are on, before pierce: ' + lowered.join(', ') + '.' }));
    }
    if (!dmg.skills.length) {
      kids.push(el('p', { class: 'ui-empty', text: 'None of the skills this character can use deals damage that the page can work out yet.' }));
    } else {
      kids.push(el('ul', { class: 'ch-dmg' }, dmg.skills.map(function (s) {
        var notes = [];
        if (s.attack && dmg.critChance) {
          notes.push('Deadly strike averaged in: ' + pct(dmg.critChance) + ' of hits deal ×' + dmg.critMult.toFixed(2) + ' weapon damage' + (s.conversion ? ', converted damage included.' : '.'));
        }
        if (s.crush && s.crush.chance) {
          notes.push('Crushing blow: ' + pct(s.crush.chance) + ' of hits remove ' + pct(s.crush.share) + ' of the target’s current life' + (s.crush.ranged ? ' (ranged)' : '') + '.');
        }
        var kids2 = [
          el('h3', { text: s.name }),
          el('p', { class: 'ch-from', text: 'Level ' + s.level + ' · ' + (s.attack ? Math.round(s.srcdam * 100 / 128) + '% weapon damage' : 'spell') + ' · ' + s.mode + ' animation' }),
          el('p', { class: 'ch-bp-now' }, [s.dps ? fmt(Math.round(s.dps)) : '–', el('span', { class: 'ch-from', text: ' damage per second' })]),
          el('p', { class: 'ch-from', text: fmt(s.min) + '–' + fmt(s.max) + ' per hit, ' + fmt(Math.round(s.avg)) + ' on average' + (s.frames ? ' · ' + s.frames + ' frames (' + s.perSecond.toFixed(2) + ' per second)' : '') }),
          el('ul', { class: 'ch-mods' }, s.parts.map(function (part) { return el('li', { text: part.label + ': ' + fmt(part.min) + '–' + fmt(part.max) }); }))
        ];
        if (s.kill && s.crush && s.crush.chance) {
          kids2.push(el('p', { class: 'ch-kill' }, [
            el('strong', { text: fmt(Math.round(s.kill.dps)) }),
            ' damage per second with crushing blow, against this target: ' + fmt(s.kill.hits) + ' hits, ' + s.kill.seconds.toFixed(1) + ' s to kill ' + fmt(target.life) + ' life.'
          ]));
        }
        notes.forEach(function (n) { kids2.push(el('p', { class: 'ch-from', text: n })); });
        return el('li', { class: 'ch-bp' }, kids2);
      })));
    }
    return section('damage', 'Damage', kids,
      'An estimate for one hit of one missile on one target that it always hits, with the gear in hand and the buffs and auras that are on, and the target’s resistances lowered by the effects on enemies that are on. ' +
      'Each hit is averaged: deadly strike counts at its chance (on all weapon damage, converted or not), damage converted by the skill’s missile goes to its element (and its resistance and mastery), and the target’s resistances apply, less the character’s pierce. ' +
      'Crushing blow takes a share of the target’s current life, so it can’t be a fixed number per second: the second figure averages it over a whole kill of the target above, using ESR’s crushing blow shares per target type. ' +
      'Not counted: several missiles or hits per attack (Multiple Shot, Strafe, Magic Arrow’s shards), splash and area damage, damage over time, open wounds, chance to hit, and summons.');
  }

  // ---------------------------------------------------------------------
  // Skills
  // ---------------------------------------------------------------------

  var sum = calc.sum;

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

  function renderSkills(save, cls, model) {
    var b = model.bonuses;
    var levels = model.skills;
    var trees = cls.trees.map(function (t) { return { title: t, skills: [] }; });
    var spent = 0;
    var own = {};
    cls.skills.forEach(function (id, i) {
      var s = data.skills[id];
      var tree = (s && s[2] ? s[2] : 1) - 1;
      spent += save.skills[i] || 0;
      own[id] = true;
      if (trees[tree]) trees[tree].skills.push({ name: s ? s[0] : 'Skill #' + id, lv: levels[id] || null });
    });

    var groups = trees.map(function (t) {
      return el('div', { class: 'ch-tree' }, [
        el('h3', { text: t.title }),
        el('ul', null, t.skills.map(function (s) {
          // +skills only raise skills the character can use: hard points, or an oskill
          var lv = s.lv;
          var extra = lv ? lv.level - lv.hard : 0;
          var label = lv ? lv.hard + ' hard point' + (lv.hard === 1 ? '' : 's') + (extra ? ', plus ' + extra + ' from items and buffs: level ' + lv.level : '') : 'no points';
          return el('li', { class: lv ? null : 'ch-zero' }, [
            el('a', { href: skillLink(s.name, lv ? lv.level : 1, cls.id), text: s.name }),
            el('span', { class: 'ch-pts', 'aria-label': label }, lv ? [
              String(lv.level),
              extra ? el('span', { class: 'ch-plus', text: ' (' + lv.hard + '+' + extra + ')' }) : null
            ] : ['–'])
          ]);
        }))
      ]);
    });

    // what the bonuses add up to, and where they come from
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

    // skills from other classes that items grant (the class's own are in the trees above)
    var oskills = Object.keys(levels).filter(function (id) { return !own[id]; })
      .map(function (id) { return { s: data.skills[id] || ['Skill #' + id], lv: levels[id], list: b.oskill[id] || [] }; })
      .sort(function (x, y) { return y.lv.level - x.lv.level || x.s[0].localeCompare(y.s[0]); });

    var kids = [el('div', { class: 'ch-trees' }, groups)];
    if (totals.length) {
      kids.push(el('h3', { class: 'ch-sub', text: 'Skill bonuses' }));
      kids.push(el('ul', { class: 'ch-bonuses' }, totals));
    }
    if (oskills.length) {
      kids.push(el('h3', { class: 'ch-sub', text: 'Skills granted by items (' + oskills.length + ')' }));
      kids.push(el('ul', { class: 'ch-oskills' }, oskills.map(function (o) {
        var c = o.s[1] != null ? data.classes[o.s[1]] : null;
        var extra = o.lv.level - o.lv.oskill;
        return el('li', null, [
          el('a', { href: skillLink(o.s[0], o.lv.level, c && c.id), text: o.s[0] }),
          c ? el('span', { class: 'ch-from', text: '(' + c.name + ')' }) : null,
          el('span', { class: 'ch-pts' }, ['Level ' + o.lv.level, extra ? el('span', { class: 'ch-plus', text: ' (' + o.lv.oskill + '+' + extra + ')' }) : null]),
          el('span', { class: 'ch-from ch-oskill-from', text: sources(o.list) })
        ]);
      })));
    }
    return section('skills', 'Skills', kids,
      fmt(spent) + ' hard points in ' + cls.name + ' skills. Levels include +skills from the gear in hand and the buffs that are on, shown as (hard + bonus). ' +
      'Bonuses only raise skills the character can use: ones with hard points or granted by an item. +All skills also raise skills granted by items; class and tree bonuses only raise the class’s own.');
  }

  // ---------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------

  var SLOTS = { 1: 'Head', 2: 'Amulet', 3: 'Body', 4: 'Right Hand', 5: 'Left Hand', 6: 'Right Ring', 7: 'Left Ring', 8: 'Belt', 9: 'Feet', 10: 'Gloves', 11: 'Right Hand (switch)', 12: 'Left Hand (switch)' };
  var SLOT_ORDER = [4, 5, 11, 12, 1, 3, 10, 8, 9, 2, 6, 7];

  // Only the items that count towards the character's stats: what's equipped (both weapon sets,
  // the inactive one is marked) and the charms in the charm inventory. Inventory, belt, cube,
  // stash and mercenary items add nothing, so they aren't shown.
  function renderItemSections(save, model) {
    var ctx = model.ctx;
    var active = model.items[model.inHand];
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
