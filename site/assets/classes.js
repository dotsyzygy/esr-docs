/* Classes: class mechanics the Skills page can't show. So far the Warlock's Consume: the bonus
   every demon gives plus each kind of demon's own bonus, evaluated for the chosen Consume level
   and +% Consume Effect.
   Data comes from data/classes.<lang>.js (window.ESR_CLASS_DATA), produced by
   scripts/build-classes.mjs; formulas are evaluated by assets/skill-calc.js (window.ESRSkillCalc). */
(function () {
  'use strict';

  var data = window.ESR_CLASS_DATA;
  var SkillCalc = window.ESRSkillCalc;
  var root = document.getElementById('classes-page');
  if (!root) return;

  if (!data || !SkillCalc) {
    root.textContent = '';
    var miss = document.createElement('p');
    miss.className = 'ui-missing';
    miss.innerHTML = 'The class data hasn’t been generated. Run <code>node scripts/build-classes.mjs</code> (or <code>./build.sh</code>).';
    root.appendChild(miss);
    return;
  }

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

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function templateText(line) {
    return String(line.a || '').replace(/%\+?\d*(?:\.\d+)?[dsif]/g, ' ').replace(/%%/g, '%');
  }

  // ---------------------------------------------------------------------
  // State (kept in the URL hash as #q=...&lvl=...&eff=... so views can be linked)
  // ---------------------------------------------------------------------

  var war = data.classes[0];
  var C = war.consume;
  var MAX = C.levels.max;
  var DEFAULT_LVL = C.levels.def;
  var MAX_EFFECT = 1000;
  var state = { q: '', lvl: DEFAULT_LVL, eff: 0 };

  function clamp(v, lo, hi, fallback) {
    v = parseInt(v, 10);
    if (!(v >= lo)) return fallback;
    return Math.min(hi, v);
  }

  function readHashState() {
    var h = location.hash.slice(1);
    if (h.indexOf('=') < 0) return false;
    var p = new URLSearchParams(h);
    state.q = p.get('q') || '';
    state.lvl = clamp(p.get('lvl'), 1, MAX, DEFAULT_LVL);
    state.eff = clamp(p.get('eff'), 0, MAX_EFFECT, 0);
    return true;
  }

  function writeHashState() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.lvl !== DEFAULT_LVL) p.set('lvl', state.lvl);
    if (state.eff) p.set('eff', state.eff);
    var s = p.toString();
    history.replaceState(null, '', location.pathname + location.search + (s ? '#' + s : ''));
  }

  // ---------------------------------------------------------------------
  // Formula evaluation: Consume's record, with the +% Consume Effect stat set
  // ---------------------------------------------------------------------

  var rec = data.db.s.consume;
  function lineText(line) {
    var calc = new SkillCalc.Calc(data.db, {});
    calc.stats = { consumeeffect: state.eff };
    var t = calc.line(rec, line, state.lvl);
    return t == null ? null : t.replace(/\b1 seconds\b/g, '1 second');
  }

  // ---------------------------------------------------------------------
  // Index
  // ---------------------------------------------------------------------

  C.sections.forEach(function (s) {
    s.effects.forEach(function (e) {
      e._id = 'war-' + slug(e.id);
      e._text = norm([s.title, e.l.map(templateText).join(' '),
        e.m.map(function (m) { return m.n + ' ' + (m.r || ''); }).join(' ')].join(' '));
    });
  });

  // ---------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------

  var ui = {};

  function lineList(lines, cls) {
    var ul = el('ul', { class: 'cl-lines' + (cls ? ' ' + cls : '') });
    lines.forEach(function (l) {
      var t = lineText(l);
      if (t) ul.appendChild(el('li', { text: t }));
    });
    return ul;
  }

  function demonList(e, sectionId) {
    var items = e.m.map(function (m) {
      var li = el('li', null, [el('span', { class: 'cl-demon', text: m.n })]);
      if (m.r) {
        li.appendChild(document.createTextNode(' '));
        li.appendChild(el('span', { class: 'cl-req', text: sectionId === 'summons' ? '(' + m.r + ')' : '(needs ' + m.r + ')' }));
      }
      return li;
    });
    return el('ul', { class: 'cl-demons', 'aria-label': 'Demons' }, items);
  }

  function card(e, s) {
    return el('article', { class: 'cl-card', id: e._id }, [
      demonList(e, s.id),
      lineList(e.l)
    ]);
  }

  function renderPage() {
    readHashState();

    ui.search = el('input', {
      id: 'cl-search', type: 'search', autocomplete: 'off', spellcheck: 'false',
      placeholder: 'Monster or bonus…', 'aria-describedby': 'cl-status-text'
    });
    ui.lvl = el('input', { id: 'cl-lvl', type: 'number', min: 1, max: MAX, step: 1, inputmode: 'numeric', value: state.lvl });
    ui.eff = el('input', { id: 'cl-eff', type: 'number', min: 0, max: MAX_EFFECT, step: 1, inputmode: 'numeric', value: state.eff });
    ui.status = el('p', { id: 'cl-status-text', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    ui.reset = el('button', { type: 'button', class: 'ui-btn', text: 'Clear search' });
    ui.base = el('div');
    ui.results = el('div', { id: 'cl-results' });

    var generated = new Date(data.generatedAt);
    root.textContent = '';
    root.appendChild(el('a', { class: 'ui-skip', href: '#cl-search', text: 'Skip to demon search' }));
    root.appendChild(el('h2', { class: 'ui-title', text: 'Classes' }));
    root.appendChild(el('p', {
      class: 'ui-meta',
      text: 'Generated from the mod’s monster and skill data on ' + generated.toLocaleDateString() + '.'
    }));
    root.appendChild(el('div', { class: 'ui-toolbar', role: 'search', 'aria-label': 'Filter demons' }, [
      el('div', { class: 'ui-field' }, [
        el('label', { for: 'cl-search' }, ['Search demons', el('kbd', { 'aria-hidden': 'true', text: '/' })]),
        ui.search
      ]),
      el('div', { class: 'ui-field' }, [el('label', { for: 'cl-lvl', text: C.title + ' level (1–' + MAX + ')' }), ui.lvl]),
      el('div', { class: 'ui-field' }, [el('label', { for: 'cl-eff', text: '+% Consume Effect' }), ui.eff])
    ]));
    root.appendChild(el('div', { class: 'ui-status' }, [ui.status, ui.reset]));

    root.appendChild(el('section', { class: 'ui-section', id: war.id, 'aria-labelledby': 'h-' + war.id }, [
      el('h2', { id: 'h-' + war.id, text: war.title + ': ' + C.title })
    ].concat(C.intro.map(function (p) { return el('p', { class: 'ui-intro', text: p }); }), [ui.base])));
    root.appendChild(ui.results);

    ui.search.value = state.q;

    var timer = null;
    ui.search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = ui.search.value.trim(); update(); }, 150);
    });
    [['lvl', ui.lvl, 1, MAX, DEFAULT_LVL], ['eff', ui.eff, 0, MAX_EFFECT, 0]].forEach(function (f) {
      var key = f[0], input = f[1], lo = f[2], hi = f[3], fallback = f[4], t = null;
      input.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () {
          if (input.value === '') return;
          var v = clamp(input.value, lo, hi, fallback);
          if (v !== state[key]) { state[key] = v; update(); }
        }, 200);
      });
      input.addEventListener('change', function () {
        state[key] = clamp(input.value, lo, hi, state[key]);
        input.value = state[key];
        update();
      });
    });
    ui.reset.addEventListener('click', function () {
      state.q = '';
      ui.search.value = '';
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

    // A plain hash (#war-mephisto, #war-bosses) jumps to that card or section.
    var h = location.hash.slice(1);
    if (h && h.indexOf('=') < 0) {
      var target = document.getElementById(decodeURIComponent(h));
      if (target) target.scrollIntoView();
    }
  }

  function update() {
    writeHashState();
    renderResults();
  }

  function renderResults() {
    var terms = norm(state.q).trim().split(/\s+/).filter(Boolean);
    var frag = document.createDocumentFragment();
    var count = 0, demons = 0;

    ui.base.textContent = '';
    ui.base.appendChild(el('article', { class: 'cl-card cl-base' }, [
      el('h3', { text: 'Every demon' }),
      lineList(C.base)
    ]));

    C.sections.forEach(function (s) {
      var list = s.effects.filter(function (e) {
        for (var i = 0; i < terms.length; i++) if (e._text.indexOf(terms[i]) < 0) return false;
        return true;
      });
      if (!list.length) return;
      count += list.length;
      list.forEach(function (e) { demons += e.m.length; });
      var id = 'war-' + s.id;
      frag.appendChild(el('section', { class: 'ui-section', id: id, 'aria-labelledby': 'h-' + id }, [
        el('h2', { id: 'h-' + id, text: s.title }),
        s.intro ? el('p', { class: 'ui-intro', text: s.intro }) : null,
        el('div', { class: 'cl-list' }, list.map(function (e) { return card(e, s); }))
      ]));
    });

    ui.results.textContent = '';
    if (!count) ui.results.appendChild(el('p', { class: 'ui-empty', text: 'No demons match this search.' }));
    else ui.results.appendChild(frag);
    ui.status.textContent = count + ' bonus' + (count === 1 ? '' : 'es') + ' from ' + demons + ' demon' + (demons === 1 ? '' : 's') +
      ', at ' + C.title + ' level ' + state.lvl + (state.eff ? ' with +' + state.eff + '% Consume Effect' : '') + '.';
    ui.reset.hidden = !state.q;
  }

  renderPage();
})();
