/* Vessel of Souls: the vessel's tier recipes, completion transforms and anointment outcomes.
   Data comes from data/vessel-of-souls.<lang>.js (window.ESR_VESSEL_DATA), produced by
   scripts/build-vessel.mjs. */
(function () {
  'use strict';

  var data = window.ESR_VESSEL_DATA;
  var root = document.getElementById('vessel-page');
  if (!root) return;
  var rendered = false;

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

  function souls(n) { return n + ' Soul' + (n === 1 ? '' : 's'); }

  // "Vessel of Souls" is highlighted in running text, as on the old page.
  function highlightName(text) {
    var parts = String(text).split(/(Vessel of Souls)/);
    return parts.map(function (p) { return p === 'Vessel of Souls' ? el('span', { class: 'vs-name', text: p }) : p; });
  }

  // ---------------------------------------------------------------------
  // Index
  // ---------------------------------------------------------------------

  function itemText(it) {
    return [it.n, (it.q || []).join(' '), (it.m || []).join(' ')].join(' ');
  }

  function buildIndex() {
    data.sections.forEach(function (s) {
      s.groups.forEach(function (g) {
        g.v.forEach(function (v) {
          v._text = norm([s.title, g.t || '', v.n || '', v.i.map(itemText).join(' '), v.o.map(itemText).join(' '),
            (v.r || []).join(' '), v.cost ? souls(v.cost) : ''].join(' '));
        });
      });
    });
  }

  // ---------------------------------------------------------------------
  // State (#q=...&tier=... in the URL hash; plain hashes jump to #tier1 ... #completion)
  // ---------------------------------------------------------------------

  var state = { q: '', tier: '' };

  function readHashState() {
    var h = location.hash.slice(1);
    if (h.indexOf('=') < 0) return false;
    var p = new URLSearchParams(h);
    state.q = p.get('q') || '';
    state.tier = p.get('tier') || '';
    return true;
  }

  function writeHashState() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.tier) p.set('tier', state.tier);
    var s = p.toString();
    history.replaceState(null, '', location.pathname + location.search + (s ? '#' + s : ''));
  }

  // ---------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------

  var ui = {};

  function renderPage() {
    rendered = true;
    buildIndex();
    readHashState();

    ui.search = el('input', {
      id: 'vs-search', type: 'search', autocomplete: 'off', spellcheck: 'false',
      placeholder: 'Organ, skill, mod…', 'aria-describedby': 'vs-status-text'
    });
    ui.tier = el('select', { id: 'vs-tier' }, [el('option', { value: '', text: 'All tiers' })].concat(
      data.sections.map(function (s) { return el('option', { value: s.id, text: s.title }); })));
    ui.status = el('p', { id: 'vs-status-text', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    ui.reset = el('button', { type: 'button', class: 'ui-btn', text: 'Clear filters' });
    ui.results = el('div', { id: 'vs-results' });

    var generated = new Date(data.generatedAt);
    root.textContent = '';
    root.appendChild(el('a', { class: 'ui-skip', href: '#vs-search', text: 'Skip to recipe search' }));
    root.appendChild(el('h2', { class: 'ui-title', text: 'Vessel of Souls' }));
    root.appendChild(el('p', {
      class: 'ui-meta',
      text: 'Generated from the mod’s cube recipe data on ' + generated.toLocaleDateString() + '.'
    }));
    root.appendChild(el('div', { class: 'vs-intro' }, data.intro.map(function (p) {
      return el('p', null, highlightName(p));
    })));
    root.appendChild(el('div', { class: 'ui-toolbar vs-toolbar', role: 'search', 'aria-label': 'Filter recipes' }, [
      el('div', { class: 'ui-field' }, [
        el('label', { for: 'vs-search' }, ['Search recipes', el('kbd', { 'aria-hidden': 'true', text: '/' })]),
        ui.search
      ]),
      el('div', { class: 'ui-field' }, [el('label', { for: 'vs-tier', text: 'Tier' }), ui.tier])
    ]));
    root.appendChild(el('div', { class: 'ui-status' }, [ui.status, ui.reset]));
    root.appendChild(el('nav', { class: 'vs-jump', 'aria-label': 'Tiers' }, [el('ul', null,
      data.sections.map(function (s) { return el('li', null, [el('a', { href: '#' + s.id, text: '[' + s.title + ']' })]); }))]));
    root.appendChild(ui.results);

    ui.search.value = state.q;
    ui.tier.value = state.tier;

    var timer = null;
    ui.search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = ui.search.value.trim(); update(); }, 150);
    });
    ui.tier.addEventListener('change', function () { state.tier = ui.tier.value; update(); });
    ui.reset.addEventListener('click', function () {
      state.q = state.tier = '';
      ui.search.value = ''; ui.tier.value = '';
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

  function renderResults() {
    var terms = norm(state.q).split(/\s+/).filter(Boolean);
    var filtering = !!(terms.length || state.tier);
    var frag = document.createDocumentFragment();
    var total = 0;

    data.sections.forEach(function (s) {
      if (state.tier && state.tier !== s.id) return;
      var groups = [];
      s.groups.forEach(function (g) {
        var matches = g.v.filter(function (v) {
          for (var i = 0; i < terms.length; i++) if (v._text.indexOf(terms[i]) < 0) return false;
          return true;
        });
        if (matches.length) groups.push({ g: g, v: matches });
      });
      if (!groups.length) return;
      var count = groups.reduce(function (n, x) { return n + x.v.length; }, 0);
      total += count;
      var outcomes = s.id === 'anointments';
      var section = el('section', { class: 'vs-section', id: s.id, 'aria-labelledby': 'h-' + s.id }, [
        el('div', { class: 'vs-band' }, [
          el('h2', { id: 'h-' + s.id }, [s.title, el('span', { class: 'vs-count', text: ' (' + count + ')' })]),
          s.intro ? el('p', null, highlightName(s.intro)) : null,
          s.need ? el('p', { class: 'vs-need', text: 'Requires: ' + s.need + (s.id === 'completion' ? '' : ' (unless stated otherwise)') }) : null
        ])
      ]);
      groups.forEach(function (x) {
        if (x.g.t) section.appendChild(el('h3', { class: 'vs-group', id: x.g.id, text: x.g.t + ' (' + x.v.length + ')' }));
        section.appendChild(el('ul', { class: 'vs-rows' + (outcomes ? ' vs-outcomes' : '') },
          x.v.map(function (v) { return outcomes ? renderOutcome(v) : renderRecipe(v); })));
      });
      frag.appendChild(section);
    });

    ui.results.textContent = '';
    if (!total) ui.results.appendChild(el('p', { class: 'ui-empty', text: 'No recipes match these filters.' }));
    else ui.results.appendChild(frag);
    ui.status.textContent = total.toLocaleString() + ' recipe' + (total === 1 ? '' : 's') + (filtering ? ' match your filters.' : '.');
    ui.reset.hidden = !filtering;
  }

  function renderItem(it) {
    return el('li', { class: it.col ? 'vs-c-' + it.col : null }, [
      it.c ? it.c + 'x ' : null,
      el('span', { class: 'vs-item', text: it.n })
    ]);
  }

  function renderOutput(o) {
    var quals = (o.q || []).filter(function (q) { return q !== 'Keeps Mods'; });
    var keeps = (o.q || []).indexOf('Keeps Mods') >= 0;
    return [
      el('p', { class: 'vs-out-name' }, [o.c ? o.c + 'x ' : null, o.n, quals.length ? ' (' + quals.join(', ') + ')' : null]),
      keeps ? el('p', { class: 'vs-keeps', text: 'All Applied Bonuses' }) : null,
      o.m && o.m.length ? el('ul', { class: 'vs-mods' }, o.m.map(function (m) { return el('li', { text: m }); })) : null
    ];
  }

  function renderRecipe(v) {
    var result = el('div', { class: 'vs-cell vs-result' }, [el('span', { class: 'sr-only', text: 'Result: ' })]);
    v.o.forEach(function (o) { renderOutput(o).forEach(function (n) { if (n) result.appendChild(n); }); });
    if (v.cost) result.appendChild(el('p', { class: 'vs-cost', text: '-' + souls(v.cost) }));
    if (v.r) {
      result.appendChild(el('ul', { class: 'vs-notes', 'aria-label': 'Requirements' },
        v.r.map(function (r) { return el('li', { text: r }); })));
    }
    return el('li', { class: 'vs-row' }, [
      el('div', { class: 'vs-cell vs-inputs' }, [
        el('span', { class: 'sr-only', text: 'Ingredients: ' }),
        el('ul', null, v.i.map(renderItem))
      ]),
      result
    ]);
  }

  function renderOutcome(v) {
    var mods = [];
    v.o.forEach(function (o) { (o.m || []).forEach(function (m) { mods.push(m); }); });
    return el('li', { class: 'vs-row' }, [
      el('div', { class: 'vs-cell vs-inputs' }, [el('span', { class: 'vs-name', text: v.n })]),
      el('div', { class: 'vs-cell vs-result' }, [el('ul', { class: 'vs-mods' }, mods.map(function (m) { return el('li', { text: m }); }))])
    ]);
  }

  // ---------------------------------------------------------------------
  // Anchors (#tier1 … #completion, as on the old page)
  // ---------------------------------------------------------------------

  function scrollToAnchor() {
    var h = decodeURIComponent(location.hash.slice(1));
    if (!h || h.indexOf('=') >= 0) return;
    var target = document.getElementById(h);
    if (target && root.contains(target)) target.scrollIntoView();
  }

  window.addEventListener('hashchange', function () {
    if (rendered && location.hash.indexOf('=') >= 0 && readHashState()) {
      ui.search.value = state.q; ui.tier.value = state.tier;
      renderResults();
    } else {
      scrollToAnchor();
    }
  });

  if (data) {
    renderPage();
  } else {
    root.textContent = '';
    root.appendChild(el('h2', { class: 'ui-title', text: 'Vessel of Souls' }));
    root.appendChild(el('p', { class: 'ui-missing' }, [
      'Vessel of Souls data has not been generated. Run ',
      el('code', { text: 'node scripts/build-vessel.mjs' }),
      ' and reload.'
    ]));
  }
  scrollToAnchor();
})();
