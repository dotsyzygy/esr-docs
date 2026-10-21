/* Skills: the class skill trees and the oskills items grant, with descriptions evaluated for
   the chosen skill level and character level.
   Data comes from data/skills.<lang>.js (window.ESR_SKILL_DATA), produced by
   scripts/build-skills.mjs; formulas are evaluated by assets/skill-calc.js (window.ESRSkillCalc). */
(function () {
  'use strict';

  var data = window.ESR_SKILL_DATA;
  var SkillCalc = window.ESRSkillCalc;
  var root = document.getElementById('skills-page');
  if (!root) return;
  var rendered = false;

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

  function norm(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
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

  // ---------------------------------------------------------------------
  // Levels and formula evaluation
  // ---------------------------------------------------------------------

  var MAX = data ? data.levels.max : 110;
  var DEFAULT_SLVL = data ? data.levels.skill : 20;
  var DEFAULT_CLVL = data ? data.levels.character : MAX;

  function clampLevel(v, fallback) {
    v = parseInt(v, 10);
    if (!(v >= 1)) return fallback;
    return Math.min(MAX, v);
  }

  var calc = null;
  function getCalc() {
    if (!calc || calc.ulvl !== state.clvl) calc = new SkillCalc.Calc(data.db, { ulvl: state.clvl });
    return calc;
  }

  function lineText(s, line, lvl) {
    return getCalc().line(data.db.s[s.k], line, lvl);
  }

  // ---------------------------------------------------------------------
  // Index
  // ---------------------------------------------------------------------

  var classById = {};
  var SOURCE_LABEL = { 'Cube recipe': 'Cube recipes' };

  function templateText(line) {
    return [line.a, line.b].filter(Boolean).join(' ').replace(/%\+?\d*(?:\.\d+)?[dsif]/g, ' ').replace(/%%/g, '%');
  }

  function buildIndex() {
    data.classes.forEach(function (c) { classById[c.id] = c; });
    // Lines whose values differ between character level 1 and the max scale with character level.
    var low = new SkillCalc.Calc(data.db, { ulvl: 1 });
    var high = new SkillCalc.Calc(data.db, { ulvl: MAX });
    data.skills.forEach(function (s) {
      var cls = classById[s.c];
      var tree = cls && cls.trees ? cls.trees.filter(function (t) { return t.n === s.tr; })[0] : null;
      s._tree = tree ? tree.title : '';
      var lines = (s.g || []).concat(s.l || [], s.s || []);
      var rec = data.db.s[s.k];
      s._ulvl = lines.some(function (line) {
        if (!SkillCalc.usesCalc(line)) return false;
        return [1, 20, MAX].some(function (lv) { return low.line(rec, line, lv) !== high.line(rec, line, lv); });
      });
      s._name = norm(s.n);
      s._text = norm([
        s.n, cls ? cls.title : '', s._tree, s.d || '', (s.pre || []).join(' '),
        s.pas ? 'passive' : '', s.aur ? 'aura' : '', s.c === 'other' ? 'oskill item skill' : '',
        lines.map(templateText).join(' '),
        (s.src || []).map(function (x) { return x.k + ' ' + (x.n || '') + ' ' + (x.v || ''); }).join(' ')
      ].join(' '));
    });
  }

  // ---------------------------------------------------------------------
  // State (kept in the URL hash as #q=...&class=...&slvl=...&clvl=... so views can be linked)
  // ---------------------------------------------------------------------

  var state = { q: '', cls: '', slvl: DEFAULT_SLVL, clvl: DEFAULT_CLVL };

  function readHashState() {
    var h = location.hash.slice(1);
    if (h.indexOf('=') < 0) return false;
    var p = new URLSearchParams(h);
    state.q = p.get('q') || '';
    state.cls = p.get('class') || '';
    state.slvl = clampLevel(p.get('slvl'), DEFAULT_SLVL);
    state.clvl = clampLevel(p.get('clvl'), DEFAULT_CLVL);
    return true;
  }

  function writeHashState() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cls) p.set('class', state.cls);
    if (state.slvl !== DEFAULT_SLVL) p.set('slvl', state.slvl);
    if (state.clvl !== DEFAULT_CLVL) p.set('clvl', state.clvl);
    var s = p.toString();
    history.replaceState(null, '', location.pathname + location.search + (s ? '#' + s : ''));
  }

  // ---------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------

  var ui = {};

  function levelInput(id, value) {
    return el('input', { id: id, type: 'number', min: 1, max: MAX, step: 1, inputmode: 'numeric', value: value });
  }

  function renderPage() {
    rendered = true;
    buildIndex();
    readHashState();

    ui.search = el('input', {
      id: 'sk-search', type: 'search', autocomplete: 'off', spellcheck: 'false',
      placeholder: 'Skill, effect, item…', 'aria-describedby': 'sk-status-text'
    });
    ui.cls = el('select', { id: 'sk-class' }, [el('option', { value: '', text: 'All classes' })].concat(
      data.classes.map(function (c) { return el('option', { value: c.id, text: c.title }); })));
    ui.slvl = levelInput('sk-slvl', state.slvl);
    ui.clvl = levelInput('sk-clvl', state.clvl);
    ui.status = el('p', { id: 'sk-status-text', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    ui.reset = el('button', { type: 'button', class: 'ui-btn', text: 'Clear filters' });
    ui.results = el('div', { id: 'sk-results' });
    ui.toc = el('ul');

    var generated = new Date(data.generatedAt);
    root.textContent = '';
    root.appendChild(el('a', { class: 'ui-skip', href: '#sk-search', text: 'Skip to skill search' }));
    root.appendChild(el('h2', { class: 'ui-title', text: 'Skills' }));
    root.appendChild(el('p', {
      class: 'ui-meta',
      text: 'Generated from the mod’s skill data on ' + generated.toLocaleDateString() + '.'
    }));
    if ((data.notes || []).length) {
      root.appendChild(el('ul', { class: 'ui-notes', 'aria-label': 'General notes' },
        data.notes.map(function (n) { return el('li', { text: n }); })));
    }
    root.appendChild(el('div', { class: 'ui-toolbar', role: 'search', 'aria-label': 'Filter skills' }, [
      el('div', { class: 'ui-field' }, [
        el('label', { for: 'sk-search' }, ['Search skills', el('kbd', { 'aria-hidden': 'true', text: '/' })]),
        ui.search
      ]),
      el('div', { class: 'ui-field' }, [el('label', { for: 'sk-class', text: 'Class' }), ui.cls]),
      el('div', { class: 'ui-field' }, [el('label', { for: 'sk-slvl', text: 'Skill level (1–' + MAX + ')' }), ui.slvl]),
      el('div', { class: 'ui-field' }, [el('label', { for: 'sk-clvl', text: 'Character level (1–' + MAX + ')' }), ui.clvl])
    ]));
    root.appendChild(el('div', { class: 'ui-status' }, [ui.status, ui.reset]));
    root.appendChild(el('details', { class: 'ui-toc', open: true }, [
      el('summary', { text: 'Jump to class' }),
      el('nav', { 'aria-label': 'Skill classes' }, [ui.toc])
    ]));
    root.appendChild(ui.results);

    ui.search.value = state.q;
    ui.cls.value = state.cls;

    var timer = null;
    ui.search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = ui.search.value.trim(); update(); }, 150);
    });
    ui.cls.addEventListener('change', function () { state.cls = ui.cls.value; update(); });
    [['slvl', ui.slvl, DEFAULT_SLVL], ['clvl', ui.clvl, DEFAULT_CLVL]].forEach(function (f) {
      var key = f[0], input = f[1], fallback = f[2], t = null;
      input.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () {
          if (input.value === '') return;
          var v = clampLevel(input.value, fallback);
          if (v !== state[key]) { state[key] = v; updateLevels(); }
        }, 200);
      });
      input.addEventListener('change', function () {
        state[key] = clampLevel(input.value, state[key]);
        input.value = state[key];
        updateLevels();
      });
    });
    ui.reset.addEventListener('click', function () {
      state.q = state.cls = '';
      ui.search.value = ''; ui.cls.value = '';
      update();
      ui.search.focus();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      ui.search.focus();
    });

    renderResults();
  }

  function update() {
    writeHashState();
    renderResults();
  }

  function updateLevels() {
    writeHashState();
    data.skills.forEach(function (s) { if (s._card) s._card.stale = true; });
    shown.forEach(function (s) { refreshCard(s); });
  }

  function matches(s, terms) {
    if (state.cls && s.c !== state.cls) return false;
    for (var i = 0; i < terms.length; i++) if (s._text.indexOf(terms[i]) < 0) return false;
    return true;
  }

  // Search rank, lower first: the whole name, a name that starts with the query, a name with
  // every term, a name with some of them, then matches elsewhere (descriptions, items, …).
  function rank(s, query, terms) {
    if (!terms.length) return 0;
    if (s._name === query) return 0;
    if (s._name.indexOf(query) === 0) return 1;
    var hits = terms.filter(function (t) { return s._name.indexOf(t) >= 0; }).length;
    return hits === terms.length ? 2 : hits ? 3 : 4;
  }

  // Stable sort by rank (the data's order breaks ties), and the best rank in a group.
  function byRank(list) {
    return list.map(function (s, i) { return { s: s, i: i }; })
      .sort(function (a, b) { return a.s._rank - b.s._rank || a.i - b.i; })
      .map(function (x) { return x.s; });
  }
  function bestRank(list) {
    return list.reduce(function (m, s) { return Math.min(m, s._rank); }, Infinity);
  }

  var shown = [];

  function renderResults() {
    var query = norm(state.q).trim().replace(/\s+/g, ' ');
    var terms = query.split(' ').filter(Boolean);
    var frag = document.createDocumentFragment();
    var tocFrag = document.createDocumentFragment();
    var filtering = !!(terms.length || state.cls);
    shown = [];

    // While searching, classes and trees with the best name matches come first.
    var groups = data.classes.map(function (cls, i) {
      var skills = data.skills.filter(function (s) { return s.c === cls.id && matches(s, terms); });
      skills.forEach(function (s) { s._rank = rank(s, query, terms); });
      return { cls: cls, skills: byRank(skills), best: bestRank(skills), i: i };
    }).filter(function (g) { return g.skills.length; })
      .sort(function (a, b) { return a.best - b.best || a.i - b.i; });

    groups.forEach(function (group) {
      var cls = group.cls, skills = group.skills;
      var section = el('section', { class: 'ui-section sk-class', id: cls.id, 'aria-labelledby': 'h-' + cls.id }, [
        el('h2', { id: 'h-' + cls.id, text: cls.title }),
        cls.intro ? el('p', { class: 'ui-intro', text: cls.intro }) : null
      ]);
      var tocTrees = [];
      if (cls.trees && cls.trees.length) {
        cls.trees.map(function (tree) {
          var inTree = skills.filter(function (s) { return s.tr === tree.n; });
          return { tree: tree, inTree: inTree, best: bestRank(inTree) };
        }).filter(function (t) { return t.inTree.length; })
          .sort(function (a, b) { return a.best - b.best || a.tree.n - b.tree.n; })
          .forEach(function (t) {
          var tree = t.tree, inTree = t.inTree;
          section.appendChild(el('h3', { class: 'sk-tree-title', id: tree.id, text: tree.title }));
          section.appendChild(skillList(inTree));
          tocTrees.push(el('li', null, [el('a', { href: '#' + tree.id, text: tree.title })]));
        });
      } else {
        section.appendChild(skillList(skills));
      }
      frag.appendChild(section);
      tocFrag.appendChild(el('li', null, [
        el('a', { href: '#' + cls.id, text: cls.title }), ' ',
        el('span', { class: 'ui-count', text: '(' + skills.length + ')' }),
        tocTrees.length ? el('ul', { class: 'sk-toc-trees' }, tocTrees) : null
      ]));
    });

    ui.results.textContent = '';
    ui.toc.textContent = '';
    if (!shown.length) {
      ui.results.appendChild(el('p', { class: 'ui-empty', text: 'No skills match these filters.' }));
    } else {
      ui.results.appendChild(frag);
      ui.toc.appendChild(tocFrag);
    }
    ui.status.textContent = shown.length.toLocaleString() + ' skill' + (shown.length === 1 ? '' : 's') +
      (filtering ? ' match your filters.' : '.');
    ui.reset.hidden = !filtering;
  }

  function skillList(skills) {
    var list = el('div', { class: 'sk-list' });
    skills.forEach(function (s) {
      shown.push(s);
      list.appendChild(card(s).el);
      if (s._card.stale) refreshCard(s);
    });
    return list;
  }

  // ---------------------------------------------------------------------
  // Skill cards (built once, reused across filter changes so open tables stay open)
  // ---------------------------------------------------------------------

  function card(s) {
    if (s._card) return s._card;
    var other = s.c === 'other';
    var hTitle = other ? 'h3' : 'h4', hSub = other ? 'h4' : 'h5';
    var cls = classById[s.c];

    var tags = ['Required level ' + (s.r || 1)];
    if (s.pre) tags.push('Requires ' + s.pre.join(', '));
    if (s.pas) tags.push('Passive');
    if (s.aur) tags.push('Aura');
    if (s._ulvl) tags.push('Scales with character level');

    var c = { stale: true, showAll: false };
    c.general = s.g ? el('ul', { class: 'sk-lines sk-general' }) : null;
    c.levelHead = el(hSub, { class: 'sk-sub' });
    c.current = el('ul', { class: 'sk-lines' });
    c.synergies = s.s ? el('ul', { class: 'sk-lines sk-synergies' }) : null;
    c.tableBox = el('div', { class: 'sk-table-box' });
    c.scaling = el('details', { class: 'sk-details sk-scaling' }, [
      el('summary', { text: 'Values by level (1–' + MAX + ')' }),
      c.tableBox
    ]);
    c.scaling.addEventListener('toggle', function () { if (c.scaling.open) buildTable(s); });

    c.titleLink = el('a', { href: detailHref(s), text: s.n });
    var more = s.sy || s.sl ? 'Full details and synergies' : 'Full details';
    c.moreLink = el('a', { class: 'sk-more', href: detailHref(s), 'aria-label': more + ': ' + s.n, text: more });
    c.el = el('article', { class: 'sk-skill', id: s.id, 'aria-labelledby': 't-' + s.id }, [
      el('header', null, [
        el(hTitle, { id: 't-' + s.id }, [c.titleLink]),
        !other && cls ? el('p', { class: 'sk-where', text: cls.title + ' · ' + s._tree }) : null
      ]),
      el('ul', { class: 'sk-tags', 'aria-label': 'Requirements' }, tags.map(function (t) { return el('li', { text: t }); })),
      s.d ? el('p', { class: 'sk-desc' }, multiline(s.d)) : null,
      c.general,
      s.l ? el('div', { class: 'sk-block' }, [c.levelHead, c.current]) : null,
      c.synergies ? el('div', { class: 'sk-block' }, [el(hSub, { class: 'sk-sub', text: 'Synergies and bonuses' }), c.synergies]) : null,
      (s.l || []).concat(s.g || []).some(SkillCalc.usesCalc) ? c.scaling : null,
      s.src ? sources(s) : null,
      c.moreLink
    ]);
    s._card = c;
    return c;
  }

  // The skill's own page (skill.html), at the levels chosen here.
  function detailHref(s) {
    var p = new URLSearchParams();
    p.set('skill', s.id);
    if (state.slvl !== DEFAULT_SLVL) p.set('slvl', state.slvl);
    if (state.clvl !== DEFAULT_CLVL) p.set('clvl', state.clvl);
    return 'skill.html#' + p.toString();
  }

  function fillLines(list, s, lines, lvl) {
    list.textContent = '';
    lines.forEach(function (line) {
      var t = lineText(s, line, lvl);
      if (t == null || t === '') return;
      list.appendChild(el('li', { class: line.t === 40 ? 'sk-line-head' : null }, multiline(t)));
    });
  }

  function refreshCard(s) {
    var c = s._card;
    if (!c || !c.stale) return;
    c.stale = false;
    c.titleLink.href = c.moreLink.href = detailHref(s);
    c.levelHead.textContent = 'At skill level ' + state.slvl + (s._ulvl ? ', character level ' + state.clvl : '');
    if (c.general) fillLines(c.general, s, s.g, state.slvl);
    if (s.l) fillLines(c.current, s, s.l, state.slvl);
    if (c.synergies) fillLines(c.synergies, s, s.s, state.slvl);
    if (c.scaling.open) buildTable(s);
    else c.tableBox.textContent = '';
  }

  // Collapsed by default: some skills come from dozens of items.
  function sources(s) {
    var items = s.src.map(function (x) {
      if (x.k === 'Cube recipe') {
        return el('li', null, [
          el('a', { href: 'cube-recipes.html#q=' + encodeURIComponent(s.n), text: SOURCE_LABEL[x.k] }),
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
    var list = el('ul', { class: 'sk-sources' }, items);
    var title = 'Granted by ' + s.src.length + (s.src.length === 1 ? ' item or recipe' : ' items and recipes');
    return el('details', { class: 'sk-details' }, [el('summary', { text: title }), list]);
  }

  // Rows: every level up to 20, then every 5th, plus the chosen level; or every level.
  function buildTable(s) {
    var c = s._card;
    var rec = data.db.s[s.k];
    var levels = [];
    for (var i = 1; i <= MAX; i++) levels.push(i);
    var cols = [];
    (s.l || []).concat(s.g || []).forEach(function (line) {
      if (!SkillCalc.usesCalc(line)) return;
      var texts = levels.map(function (lv) { return (lineText(s, line, lv) || '').replace(/\n/g, ' / '); });
      for (var j = 1; j < texts.length; j++) {
        if (texts[j] !== texts[0]) { cols.push(SkillCalc.splitColumn(texts)); return; }
      }
    });
    c.tableBox.textContent = '';
    if (!cols.length) {
      c.tableBox.appendChild(el('p', { class: 'sk-none', text: 'These values don’t change with skill level.' }));
      return;
    }
    var rows = c.showAll ? levels : levels.filter(function (lv) { return lv <= 20 || lv % 5 === 0 || lv === state.slvl; });
    var thead = el('tr', null, [el('th', { scope: 'col', text: 'Level' })].concat(cols.map(function (col) {
      return el('th', { scope: 'col', text: col.label || 'Value' });
    })));
    var body = rows.map(function (lv) {
      var cur = lv === state.slvl;
      return el('tr', { class: cur ? 'sk-cur' : null }, [
        el('th', { scope: 'row' }, [String(lv), cur ? el('span', { class: 'sk-cur-label', text: ' (selected)' }) : null])
      ].concat(cols.map(function (col) { return el('td', { text: col.cells[lv - 1] }); })));
    });
    var label = s.n + ' values by skill level' + (s._ulvl ? ' at character level ' + state.clvl : '');
    c.tableBox.appendChild(el('div', { class: 'sk-table-wrap', role: 'region', 'aria-label': label, tabindex: 0 }, [
      el('table', { class: 'sk-table' }, [
        el('caption', { class: 'sk-visually-hidden', text: label }),
        el('thead', null, [thead]),
        el('tbody', null, body)
      ])
    ]));
    var toggle = el('button', {
      type: 'button', class: 'ui-btn sk-rows-btn', 'aria-expanded': c.showAll ? 'true' : 'false',
      text: c.showAll ? 'Show fewer levels' : 'Show every level'
    });
    toggle.addEventListener('click', function () {
      c.showAll = !c.showAll;
      buildTable(s);
      var again = c.tableBox.querySelector('.sk-rows-btn');
      if (again) again.focus();
    });
    c.tableBox.appendChild(toggle);
    if (s._ulvl) {
      c.tableBox.appendChild(el('p', { class: 'sk-note', text: 'At character level ' + state.clvl + '. This skill also scales with character level.' }));
    }
  }

  // ---------------------------------------------------------------------
  // Anchors: #sor (class), #sor-tree-1 (tree) and skill ids. The view renders after load,
  // so the browser's own jump-to-anchor has nothing to land on yet.
  // ---------------------------------------------------------------------

  function scrollToAnchor() {
    var h = decodeURIComponent(location.hash.slice(1));
    if (!h || h.indexOf('=') >= 0) return;
    var target = document.getElementById(h);
    if (target && root.contains(target)) target.scrollIntoView();
  }

  window.addEventListener('hashchange', function () {
    if (rendered && location.hash.indexOf('=') >= 0 && readHashState()) {
      ui.search.value = state.q; ui.cls.value = state.cls;
      ui.slvl.value = state.slvl; ui.clvl.value = state.clvl;
      data.skills.forEach(function (s) { if (s._card) s._card.stale = true; });
      renderResults();
    } else {
      scrollToAnchor();
    }
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  if (data && SkillCalc) {
    renderPage();
  } else {
    root.textContent = '';
    root.appendChild(el('h2', { class: 'ui-title', text: 'Skills' }));
    root.appendChild(el('p', { class: 'ui-missing' }, [
      'Skill data has not been generated. Run ',
      el('code', { text: 'node scripts/build-skills.mjs' }),
      ' and reload.'
    ]));
  }
  scrollToAnchor();
})();
