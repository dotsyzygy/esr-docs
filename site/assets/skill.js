/* Skill detail page: one skill from the Skills page in full, with its synergies adjustable.
   skill.html#skill=sor-fire-ball&slvl=20&clvl=110&sor-fire-bolt=20 (a plain #sor-fire-ball
   works too). Synergy points are hard points, so each is capped at data.levels.synergy (20);
   skills a formula reads by level with +skills (e.sl) go up to the max level instead.
   Data comes from data/skills.<lang>.js (window.ESR_SKILL_DATA), produced by
   scripts/build-skills.mjs; formulas are evaluated by assets/skill-calc.js (window.ESRSkillCalc). */
(function () {
  'use strict';

  var data = window.ESR_SKILL_DATA;
  var SkillCalc = window.ESRSkillCalc;
  var root = document.getElementById('skill-page');
  if (!root) return;

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

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

  // Multi-line game strings keep their line breaks.
  function multiline(text) {
    var out = [];
    String(text).split('\n').forEach(function (line, i) {
      if (i) out.push(el('br'));
      out.push(line);
    });
    return out;
  }

  function missing(message) {
    root.textContent = '';
    root.appendChild(el('h2', { class: 'ui-title', text: 'Skill' }));
    root.appendChild(el('p', { class: 'ui-missing' }, message));
  }

  if (!data || !SkillCalc) {
    missing(['Skill data has not been generated. Run ', el('code', { text: 'node scripts/build-skills.mjs' }), ' and reload.']);
    return;
  }

  // ---------------------------------------------------------------------
  // Index
  // ---------------------------------------------------------------------

  var MAX = data.levels.max;
  var DEFAULT_SLVL = data.levels.skill;
  var DEFAULT_CLVL = data.levels.character;
  var SYNERGY_CAP = data.levels.synergy || 20;

  var classById = {}, skillById = {};
  data.classes.forEach(function (c) { classById[c.id] = c; });
  data.skills.forEach(function (s) { skillById[s.id] = s; });

  function treeOf(s) {
    var cls = classById[s.c];
    return cls && cls.trees ? cls.trees.filter(function (t) { return t.n === s.tr; })[0] : null;
  }

  // ---------------------------------------------------------------------
  // State, kept in the URL hash so a view (synergies included) can be linked
  // ---------------------------------------------------------------------

  var state = { id: '', slvl: DEFAULT_SLVL, clvl: DEFAULT_CLVL, hp: null, syn: {} };
  var skill = null;   // the entry shown
  var inputs = [];    // { id, kind: 'sy' | 'sl', max }

  function clamp(v, lo, hi, fallback) {
    v = parseInt(v, 10);
    if (!(v >= lo)) return fallback;
    return Math.min(hi, v);
  }

  function readHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    var id = p.get('skill');
    if (!id) p.forEach(function (v, k) { if (!id && v === '' && skillById[k]) id = k; });
    state.id = id || '';
    state.slvl = clamp(p.get('slvl'), 1, MAX, DEFAULT_SLVL);
    state.clvl = clamp(p.get('clvl'), 1, MAX, DEFAULT_CLVL);
    // Hard points: null is "same as the skill level, up to the cap".
    state.hp = p.get('hp') == null || p.get('hp') === '' ? null : clamp(p.get('hp'), 0, SYNERGY_CAP, null);
    state.syn = {};
    var s = skillById[state.id];
    if (s) synergyInputs(s).forEach(function (x) { state.syn[x.id] = clamp(p.get(x.id), 0, x.max, 0); });
  }

  function writeHash() {
    var p = new URLSearchParams();
    p.set('skill', state.id);
    if (state.slvl !== DEFAULT_SLVL) p.set('slvl', state.slvl);
    if (state.clvl !== DEFAULT_CLVL) p.set('clvl', state.clvl);
    if (state.hp != null) p.set('hp', state.hp);
    inputs.forEach(function (x) { if (state.syn[x.id]) p.set(x.id, state.syn[x.id]); });
    history.replaceState(null, '', location.pathname + location.search + '#' + p.toString());
  }

  function synergyInputs(s) {
    return (s.sy || []).map(function (id) { return { id: id, kind: 'sy', max: SYNERGY_CAP }; })
      .concat((s.sl || []).map(function (id) { return { id: id, kind: 'sl', max: MAX }; }));
  }

  // ---------------------------------------------------------------------
  // Evaluation
  // ---------------------------------------------------------------------

  var calc = null;
  function getCalc() {
    if (calc) return calc;
    var levels = {};
    inputs.forEach(function (x) {
      var v = state.syn[x.id];
      if (!v) return;
      var target = skillById[x.id];
      levels[target.k] = x.kind === 'sy' ? { blvl: v, lvl: v } : { blvl: Math.min(v, SYNERGY_CAP), lvl: v };
    });
    calc = new SkillCalc.Calc(data.db, { ulvl: state.clvl, levels: levels, hardPoints: state.hp });
    return calc;
  }

  function lineText(line, lvl) {
    return getCalc().line(data.db.s[skill.k], line, lvl);
  }

  // Lines whose values differ between character level 1 and the max scale with character level.
  function scalesWithCharacter(s) {
    var rec = data.db.s[s.k];
    var low = new SkillCalc.Calc(data.db, { ulvl: 1 }), high = new SkillCalc.Calc(data.db, { ulvl: MAX });
    return (s.g || []).concat(s.l || [], s.s || []).some(function (line) {
      if (!SkillCalc.usesCalc(line)) return false;
      return [1, 20, MAX].some(function (lv) { return low.line(rec, line, lv) !== high.line(rec, line, lv); });
    });
  }

  // ---------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------

  var ui = {};

  // Another skill at the same skill and character levels (its synergies start at 0).
  function link(s, text) {
    function href() {
      var p = new URLSearchParams();
      p.set('skill', s.id);
      if (state.slvl !== DEFAULT_SLVL) p.set('slvl', state.slvl);
      if (state.clvl !== DEFAULT_CLVL) p.set('clvl', state.clvl);
      if (state.hp != null) p.set('hp', state.hp);
      return '#' + p.toString();
    }
    var a = el('a', { href: href(), text: text || s.n });
    ['mousedown', 'focus', 'click'].forEach(function (ev) { a.addEventListener(ev, function () { a.href = href(); }); });
    return a;
  }

  function skillsPageLink(hash, text) {
    return el('a', { href: 'skills.html' + (hash ? '#' + hash : ''), text: text });
  }

  function render() {
    readHash();
    skill = skillById[state.id] || null;
    calc = null;
    window.scrollTo(0, 0);
    if (!skill) {
      document.title = 'Skill - Eastern Sun Resurrected';
      missing([state.id ? 'There is no skill “' + state.id + '”. ' : 'No skill chosen. ',
        'Pick one on the ', el('a', { href: 'skills.html', text: 'Skills' }), ' page.']);
      return;
    }
    var s = skill, cls = classById[s.c], tree = treeOf(s), other = s.c === 'other';
    inputs = synergyInputs(s);
    s._ulvl = scalesWithCharacter(s);
    document.title = s.n + ' - Skills - Eastern Sun Resurrected';

    root.textContent = '';
    var crumbs = [el('li', null, [skillsPageLink('', 'Skills')])];
    if (cls) crumbs.push(el('li', null, [skillsPageLink(cls.id, cls.title)]));
    if (tree) crumbs.push(el('li', null, [skillsPageLink(tree.id, tree.title)]));
    crumbs.push(el('li', null, [el('a', { href: 'skills.html#' + s.id, 'aria-current': 'page', text: s.n })]));
    root.appendChild(el('nav', { class: 'sk-crumbs', 'aria-label': 'Breadcrumb' }, [el('ol', null, crumbs)]));

    root.appendChild(el('h2', { class: 'ui-title', text: s.n }));
    if (!other && cls) root.appendChild(el('p', { class: 'sk-where', text: cls.title + ' · ' + (tree ? tree.title : '') }));

    var tags = [el('li', { text: 'Required level ' + (s.r || 1) })];
    if (s.pas) tags.push(el('li', { text: 'Passive' }));
    if (s.aur) tags.push(el('li', { text: 'Aura' }));
    if (s._ulvl) tags.push(el('li', { text: 'Scales with character level' }));
    if (s.hp) tags.push(el('li', { text: 'Scales with hard points' }));
    if (s.os != null) tags.push(el('li', { text: s.os ? 'Triggers “on striking”' : 'Doesn’t trigger “on striking”' }));
    root.appendChild(el('ul', { class: 'sk-tags', 'aria-label': 'About this skill' }, tags));
    if (s.d) root.appendChild(el('p', { class: 'sk-desc' }, multiline(s.d)));
    // Why, for items' "chance to cast … on striking".
    if (s.os != null) {
      root.appendChild(el('p', { class: 'sk-note sk-strike-note' }, [
        s.os ? 'Items’ “chance to cast … on striking” can fire when this skill hits. ' : 'Items’ “chance to cast … on striking” don’t fire from this skill. ',
        s.osr || ''
      ]));
    }

    ui.slvl = levelInput('sk-slvl', state.slvl, 1, MAX);
    ui.clvl = levelInput('sk-clvl', state.clvl, 1, MAX);
    // Only skills whose numbers depend on their own hard points (Dodge) get the choice.
    ui.hp = null;
    if (s.hp) {
      ui.hp = el('select', { id: 'sk-hp', 'aria-describedby': 'sk-hp-help' },
        [el('option', { value: '', text: 'Skill level (to ' + SYNERGY_CAP + ')' })].concat(
          Array.from({ length: SYNERGY_CAP + 1 }, function (_, i) { return el('option', { value: String(i), text: String(i) }); })));
      ui.hp.value = state.hp == null ? '' : String(state.hp);
      ui.hp.addEventListener('change', function () {
        state.hp = ui.hp.value === '' ? null : +ui.hp.value;
        changed();
      });
    }
    root.appendChild(el('div', { class: 'ui-toolbar sk-detail-toolbar' + (s.hp ? ' sk-has-hp' : ''), role: 'group', 'aria-label': 'Levels' }, [
      // The bar stays at the top while scrolling; the name says which skill these levels are for.
      el('p', { class: 'sk-toolbar-name', 'aria-hidden': 'true', text: s.n }),
      el('div', { class: 'ui-field' }, [el('label', { for: 'sk-slvl', text: 'Skill level (1–' + MAX + ')' }), ui.slvl]),
      el('div', { class: 'ui-field' }, [el('label', { for: 'sk-clvl', text: 'Character level (1–' + MAX + ')' }), ui.clvl]),
      ui.hp ? el('div', { class: 'ui-field' }, [el('label', { for: 'sk-hp', text: 'Hard points' }), ui.hp]) : null
    ]));
    if (ui.hp) {
      root.appendChild(el('p', { id: 'sk-hp-help', class: 'sk-note sk-hp-help', text: 'This skill gives more for each hard point: a point you put in yourself, not +skills from items. Hard points are capped at ' +
        SYNERGY_CAP + ', and can’t be more than the skill level.' }));
    }
    watch(ui.slvl, function () { return state.slvl; }, function (v) { state.slvl = v; }, 1, MAX);
    watch(ui.clvl, function () { return state.clvl; }, function (v) { state.clvl = v; }, 1, MAX);

    // Sections (the site nav lists them as jumps).
    ui.values = el('div');
    root.appendChild(section('sk-values', 'Values', [ui.values]));
    if (s.s || inputs.length) root.appendChild(synergySection(s));
    if ((s.l || []).concat(s.g || []).some(SkillCalc.usesCalc)) {
      ui.table = el('div');
      root.appendChild(section('sk-by-level', 'Values by level', [ui.table]));
    }
    var related = relatedSection(s);
    if (related) root.appendChild(related);
    if (s.src) root.appendChild(sourcesSection(s));

    refresh();
  }

  function section(id, title, children) {
    return el('section', { class: 'ui-section sk-detail-section', id: id, 'aria-labelledby': id + '-h' },
      [el('h2', { id: id + '-h', text: title })].concat(children));
  }

  function levelInput(id, value, min, max) {
    return el('input', { id: id, type: 'number', min: min, max: max, step: 1, inputmode: 'numeric', value: value });
  }

  // Typing updates after a pause; leaving the field puts a clamped value back.
  function watch(input, get, set, min, max) {
    var t = null;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        if (input.value === '') return;
        var v = clamp(input.value, min, max, get());
        if (v !== get()) { set(v); changed(); }
      }, 200);
    });
    input.addEventListener('change', function () {
      clearTimeout(t);
      var v = clamp(input.value, min, max, get());
      input.value = v;
      if (v !== get()) { set(v); changed(); }
    });
  }

  function changed() {
    calc = null;
    writeHash();
    refresh();
  }

  // ---------------------------------------------------------------------
  // Synergies: the skill's "Receives Bonuses From" lines, each with a points field for the
  // skill it names, then any other skill whose points change the values.
  // ---------------------------------------------------------------------

  function synergyInput(x) {
    var target = skillById[x.id];
    var input = levelInput('syn-' + x.id, state.syn[x.id] || 0, 0, x.max);
    input.setAttribute('aria-label', target.n + (x.kind === 'sy' ? ' hard points (0–' + x.max + ')' : ' level (0–' + x.max + ')'));
    watch(input, function () { return state.syn[x.id] || 0; }, function (v) { state.syn[x.id] = v; }, 0, x.max);
    x.input = input;
    return el('span', { class: 'sk-syn-field' }, [input, el('span', { class: 'sk-syn-max', 'aria-hidden': 'true', text: '/ ' + x.max })]);
  }

  function synergySection(s) {
    var byName = {};
    inputs.forEach(function (x) { byName[skillById[x.id].n.toLowerCase()] = x; });
    var used = {};
    var rows = [];
    ui.synRows = [];
    (s.s || []).forEach(function (line) {
      var x = (line.t === 76 || line.t === 79) && line.b ? byName[String(line.b).toLowerCase()] : null;
      if (x && used[x.id]) x = null;
      if (x) used[x.id] = true;
      var r = { line: line, x: x, text: el('span', { class: 'sk-syn-text' }) };
      r.el = el('li', { class: line.t === 40 ? 'sk-line-head' : x ? 'sk-syn-row' : null }, [r.text, x ? synergyInput(x) : null]);
      ui.synRows.push(r);
      rows.push(r.el);
    });

    var children = [];
    if (inputs.length) {
      children.push(el('p', { class: 'ui-intro', text: 'Synergies count hard points only, not +skills from items, so each is capped at ' +
        SYNERGY_CAP + '. The values on this page include the points set here.' }));
    }
    if (rows.length) children.push(el('ul', { class: 'sk-lines sk-synergies sk-syn-list' }, rows));

    // Skills the formulas read that no line names ("Any Other Curse" lists none of them).
    var rest = inputs.filter(function (x) { return !used[x.id] && x.kind === 'sy'; });
    if (rest.length) {
      children.push(el('h3', { class: 'sk-sub', text: rows.length ? 'Other skills that add to this one' : 'Skills that add to this one' }));
      children.push(el('ul', { class: 'sk-lines sk-syn-list' }, rest.map(function (x) {
        return el('li', { class: 'sk-syn-row' }, [el('span', { class: 'sk-syn-text' }, [link(skillById[x.id])]), synergyInput(x)]);
      })));
    }
    var byLevel = inputs.filter(function (x) { return !used[x.id] && x.kind === 'sl'; });
    if (byLevel.length) {
      children.push(el('h3', { class: 'sk-sub', text: 'Skills that count by level (with +skills, up to ' + MAX + ')' }));
      children.push(el('ul', { class: 'sk-lines sk-syn-list' }, byLevel.map(function (x) {
        return el('li', { class: 'sk-syn-row' }, [el('span', { class: 'sk-syn-text' }, [link(skillById[x.id])]), synergyInput(x)]);
      })));
    }
    if (inputs.length) {
      var maxBtn = el('button', { type: 'button', class: 'ui-btn', text: 'Max all synergies' });
      var clearBtn = el('button', { type: 'button', class: 'ui-btn', text: 'Clear synergies' });
      maxBtn.addEventListener('click', function () { setAll(true); });
      clearBtn.addEventListener('click', function () { setAll(false); });
      ui.synStatus = el('p', { class: 'sk-syn-status', role: 'status', 'aria-live': 'polite' });
      children.push(el('div', { class: 'ui-status sk-syn-actions' }, [maxBtn, clearBtn, ui.synStatus]));
    } else if (s.s) {
      children.push(el('p', { class: 'sk-note', text: 'These bonuses work through effects this page can’t model, so the values above don’t include them.' }));
    }
    return section('sk-synergies', 'Synergies', children);
  }

  function setAll(max) {
    inputs.forEach(function (x) {
      state.syn[x.id] = max ? Math.min(x.max, SYNERGY_CAP) : 0;
      if (x.input) x.input.value = state.syn[x.id];
    });
    changed();
  }

  // ---------------------------------------------------------------------
  // Values at the chosen level, and the table of every level
  // ---------------------------------------------------------------------

  function lineList(lines, lvl, cls) {
    var list = el('ul', { class: 'sk-lines' + (cls ? ' ' + cls : '') });
    lines.forEach(function (line) {
      var t = lineText(line, lvl);
      if (t == null || t === '') return;
      list.appendChild(el('li', { class: line.t === 40 ? 'sk-line-head' : null }, multiline(t)));
    });
    return list;
  }

  function synergyPoints() {
    return inputs.reduce(function (n, x) { return n + (state.syn[x.id] || 0); }, 0);
  }

  // Hard points at a skill level: they can't exceed it.
  function hardAt(lvl) {
    return state.hp == null ? Math.min(lvl, SYNERGY_CAP) : Math.min(state.hp, lvl);
  }

  function levelSummary() {
    var parts = ['skill level ' + state.slvl];
    if (skill.hp) parts.push(hardAt(state.slvl) + ' hard point' + (hardAt(state.slvl) === 1 ? '' : 's'));
    if (skill._ulvl) parts.push('character level ' + state.clvl);
    var pts = synergyPoints();
    if (inputs.length) parts.push(pts ? pts + ' synergy point' + (pts === 1 ? '' : 's') : 'no synergies');
    return parts.join(', ');
  }

  function refresh() {
    var s = skill;
    ui.values.textContent = '';
    if (s.g) ui.values.appendChild(lineList(s.g, state.slvl, 'sk-general'));
    if (s.l) {
      ui.values.appendChild(el('div', { class: 'sk-block' }, [
        el('h3', { class: 'sk-sub', text: 'At ' + levelSummary() }),
        lineList(s.l, state.slvl)
      ]));
    }
    if (!s.g && !s.l) ui.values.appendChild(el('p', { class: 'sk-none', text: s.d ? 'The game data gives no values for this skill.' : 'The game data describes nothing for this skill.' }));
    if (ui.synStatus) {
      var pts = synergyPoints();
      ui.synStatus.textContent = pts ? pts + ' synergy point' + (pts === 1 ? '' : 's') + ' set.' : 'No synergy points set.';
    }
    fillSynergyRows();
    if (ui.table) buildTable();
  }

  // Synergy lines can hold values too (per-level bonuses from params); the skill each one
  // names links to that skill's page.
  function fillSynergyRows() {
    (ui.synRows || []).forEach(function (r) {
      var text = lineText(r.line, state.slvl);
      r.el.hidden = text == null || text === '';
      r.text.textContent = '';
      if (r.el.hidden) return;
      var target = r.x && skillById[r.x.id];
      var parts = target && text.indexOf(target.n) === 0 ? [link(target), text.slice(target.n.length)] : multiline(text);
      parts.forEach(function (n) { r.text.appendChild(typeof n === 'string' ? document.createTextNode(n) : n); });
    });
  }

  function buildTable() {
    var s = skill;
    var levels = [];
    for (var i = 1; i <= MAX; i++) levels.push(i);
    var cols = [];
    (s.l || []).concat(s.g || []).forEach(function (line) {
      if (!SkillCalc.usesCalc(line)) return;
      var texts = levels.map(function (lv) { return (lineText(line, lv) || '').replace(/\n/g, ' / '); });
      for (var j = 1; j < texts.length; j++) {
        if (texts[j] !== texts[0]) { cols.push(SkillCalc.splitColumn(texts)); return; }
      }
    });
    var scroll = ui.table.querySelector('.sk-table-wrap');
    var top = scroll ? scroll.scrollTop : null;
    ui.table.textContent = '';
    if (!cols.length) {
      ui.table.appendChild(el('p', { class: 'sk-none', text: 'These values don’t change with skill level.' }));
      return;
    }
    var thead = el('tr', null, [el('th', { scope: 'col', text: 'Level' })].concat(cols.map(function (col) {
      return el('th', { scope: 'col', text: col.label || 'Value' });
    })));
    var body = levels.map(function (lv) {
      var cur = lv === state.slvl;
      return el('tr', { class: cur ? 'sk-cur' : null }, [
        el('th', { scope: 'row' }, [String(lv), cur ? el('span', { class: 'sk-cur-label', text: ' (selected)' }) : null])
      ].concat(cols.map(function (col) { return el('td', { text: col.cells[lv - 1] }); })));
    });
    var others = [];
    if (s.hp) others.push(state.hp == null ? 'hard points equal to the level (up to ' + SYNERGY_CAP + ')' : 'up to ' + state.hp + ' hard point' + (state.hp === 1 ? '' : 's'));
    if (s._ulvl) others.push('character level ' + state.clvl);
    var pts = synergyPoints();
    if (inputs.length) others.push(pts ? pts + ' synergy point' + (pts === 1 ? '' : 's') : 'no synergies');
    var label = s.n + ' values by skill level' + (others.length ? ', at ' + others.join(' and ') : '');
    var wrap = el('div', { class: 'sk-table-wrap sk-table-tall', role: 'region', 'aria-label': label, tabindex: 0 }, [
      el('table', { class: 'sk-table' }, [
        el('caption', { class: 'sk-visually-hidden', text: label }),
        el('thead', null, [thead]),
        el('tbody', null, body)
      ])
    ]);
    ui.table.appendChild(wrap);
    if (top != null) wrap.scrollTop = top;
    if (others.length) ui.table.appendChild(el('p', { class: 'sk-note', text: 'At ' + others.join(' and ') + '.' }));
  }

  // ---------------------------------------------------------------------
  // Related skills and sources
  // ---------------------------------------------------------------------

  function relatedSection(s) {
    var groups = [];
    var pre = (s.pre || []).map(function (name) {
      return data.skills.filter(function (x) { return x.c === s.c && x.n === name; })[0] || name;
    });
    if (pre.length) groups.push(['Requires', pre]);
    var leads = data.skills.filter(function (x) { return x.c === s.c && x.c !== 'other' && (x.pre || []).indexOf(s.n) >= 0; });
    if (leads.length) groups.push(['Leads to', leads]);
    var gives = data.skills.filter(function (x) { return (x.sy || []).concat(x.sl || []).indexOf(s.id) >= 0; });
    if (gives.length) groups.push(['Gives bonuses to', gives]);
    if (!groups.length) return null;
    var dl = el('dl', { class: 'sk-related' });
    groups.forEach(function (g) {
      dl.appendChild(el('dt', { text: g[0] }));
      dl.appendChild(el('dd', null, [el('ul', null, g[1].map(function (x) {
        return el('li', null, [typeof x === 'string' ? x : link(x)]);
      }))]));
    });
    return section('sk-related', 'Related skills', [dl]);
  }

  function sourcesSection(s) {
    var items = s.src.map(function (x) {
      if (x.k === 'Cube recipe') {
        return el('li', null, [
          el('a', { href: 'cube-recipes.html#q=' + encodeURIComponent(s.n), text: 'Cube recipes' }),
          x.c ? ' (' + x.c + ')' : null
        ]);
      }
      if (x.k === 'Vessel of Souls') {
        return el('li', null, [
          el('a', { href: 'vessel-of-souls.html#q=' + encodeURIComponent(s.n), text: x.k }),
          x.v ? el('span', { class: 'sk-src-lvl', text: ' (' + x.v + ')' }) : null
        ]);
      }
      return el('li', null, [
        el('span', { class: 'sk-src-kind', text: x.k + ': ' }),
        el('span', { class: 'sk-src-name', text: x.n }),
        x.v ? el('span', { class: 'sk-src-lvl', text: ' (' + x.v + ')' }) : null
      ]);
    });
    var title = 'Granted by ' + s.src.length + (s.src.length === 1 ? ' item or recipe' : ' items and recipes');
    return section('sk-sources', 'Granted by', [el('p', { class: 'ui-intro', text: title + '.' }), el('ul', { class: 'sk-sources' }, items)]);
  }

  // ---------------------------------------------------------------------
  // Init. Links between skills change the hash, which shows the other skill.
  // ---------------------------------------------------------------------

  window.addEventListener('hashchange', function () {
    var shown = state.id;
    readHash();
    if (state.id !== shown) { render(); if (skill) writeHash(); return; }
    if (!skill) return;
    ui.slvl.value = state.slvl; ui.clvl.value = state.clvl;
    if (ui.hp) ui.hp.value = state.hp == null ? '' : String(state.hp);
    inputs.forEach(function (x) { if (x.input) x.input.value = state.syn[x.id] || 0; });
    calc = null;
    refresh();
  });
  render();
  if (skill) writeHash();
})();
