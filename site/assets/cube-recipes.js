/* Cube Recipes: the generated, searchable recipe view.
   Data comes from data/cube-recipes.<lang>.js (window.ESR_CUBE_DATA), produced by
   scripts/build-cube-recipes.mjs. */
(function () {
  'use strict';

  var PREVIEW_COUNT = 6;    // variants shown per group before "Show more"
  var MATCH_COUNT = 25;     // variants shown per group while filtering
  var MORE_STEP = 100;      // variants added per "Show more" click

  var data = window.ESR_CUBE_DATA;
  var newEl = document.getElementById('cube-new');
  if (!newEl) return;
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
        else if (k === 'html') node.innerHTML = attrs[k];
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

  var QUALITY_LABEL = { uni: 'Unique', set: 'Set', rar: 'Rare', mag: 'Magic', crf: 'Crafted' };

  // ---------------------------------------------------------------------
  // Search index
  // ---------------------------------------------------------------------

  var catById = {};
  var groupsByCat = {};
  var classes = [];

  function itemText(it) {
    return [it.n, (it.q || []).join(' '), (it.m || []).join(' ')].join(' ');
  }

  function buildIndex() {
    var classSet = {};
    data.categories.forEach(function (c) { catById[c.id] = c; groupsByCat[c.id] = []; });
    data.groups.forEach(function (g) {
      var cat = catById[g.c];
      var gText = norm([g.t, cat ? cat.title : '', g.note || ''].join(' '));
      g._v = g.v.map(function (v) {
        var parts = [];
        v.i.forEach(function (it) { parts.push(itemText(it)); });
        v.o.forEach(function (it) { parts.push(itemText(it)); });
        (v.r || []).forEach(function (r) {
          parts.push(r);
          var m = /^(.+) only$/.exec(r);
          if (m) { classSet[m[1]] = true; v._cls = m[1]; }
        });
        if (v.d) parts.push(v.d);
        var kinds = {};
        v.i.concat(v.o).forEach(function (it) { kinds[it.k] = true; });
        return { v: v, text: gText + ' ' + norm(parts.join(' ')), kinds: kinds };
      });
      (groupsByCat[g.c] = groupsByCat[g.c] || []).push(g);
    });
    classes = Object.keys(classSet).sort();
  }

  // ---------------------------------------------------------------------
  // State (kept in the URL hash as #q=...&cat=... so filtered views can be linked)
  // ---------------------------------------------------------------------

  var state = { q: '', cat: '', quality: '', cls: '' };

  function readHashState() {
    var h = location.hash.slice(1);
    if (h.indexOf('=') < 0) return false;
    var p = new URLSearchParams(h);
    state.q = p.get('q') || '';
    state.cat = p.get('cat') || '';
    state.quality = p.get('quality') || '';
    state.cls = p.get('class') || '';
    return true;
  }

  function writeHashState() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('cat', state.cat);
    if (state.quality) p.set('quality', state.quality);
    if (state.cls) p.set('class', state.cls);
    var s = p.toString();
    var url = location.pathname + location.search + (s ? '#' + s : '');
    history.replaceState(null, '', url);
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  var ui = {};

  function renderNewView() {
    rendered = true;
    buildIndex();
    readHashState();

    var generated = new Date(data.generatedAt);
    var catOptions = [el('option', { value: '', text: 'All categories' })].concat(
      data.categories.map(function (c) { return el('option', { value: c.id, text: c.title }); }));
    var qualityOptions = [el('option', { value: '', text: 'Any quality' })].concat(
      Object.keys(QUALITY_LABEL).map(function (k) { return el('option', { value: k, text: QUALITY_LABEL[k] }); })
    ).concat([el('option', { value: 'rune', text: 'Runes' })]);
    var classOptions = [el('option', { value: '', text: 'All classes' })].concat(
      classes.map(function (c) { return el('option', { value: c, text: c }); }));

    ui.search = el('input', {
      id: 'cr-search', type: 'search', autocomplete: 'off', spellcheck: 'false',
      placeholder: 'Item, rune, mod, recipe…', 'aria-describedby': 'cr-status-text'
    });
    ui.cat = el('select', { id: 'cr-cat' }, catOptions);
    ui.quality = el('select', { id: 'cr-quality' }, qualityOptions);
    ui.cls = el('select', { id: 'cr-class' }, classOptions);
    ui.status = el('p', { id: 'cr-status-text', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    ui.reset = el('button', { type: 'button', class: 'ui-btn', text: 'Clear filters' });
    ui.results = el('div', { id: 'cr-results' });
    ui.toc = el('ul');

    var notes = (data.notes || []).length
      ? el('ul', { class: 'ui-notes', 'aria-label': 'General notes' },
          data.notes.map(function (n) { return el('li', { text: n }); }))
      : null;

    newEl.textContent = '';
    newEl.appendChild(el('a', { class: 'ui-skip', href: '#cr-search', text: 'Skip to recipe search' }));
    newEl.appendChild(el('h2', { class: 'ui-title', text: 'Cube Recipes' }));
    newEl.appendChild(el('p', {
      class: 'ui-meta',
      text: 'Generated from the mod’s cube recipe data on ' + generated.toLocaleDateString() + '.'
    }));
    if (notes) newEl.appendChild(notes);
    newEl.appendChild(el('div', { class: 'ui-toolbar', role: 'search', 'aria-label': 'Filter recipes' }, [
      el('div', { class: 'ui-field' }, [
        el('label', { for: 'cr-search' }, ['Search recipes', el('kbd', { 'aria-hidden': 'true', text: '/' })]),
        ui.search
      ]),
      el('div', { class: 'ui-field' }, [el('label', { for: 'cr-cat', text: 'Category' }), ui.cat]),
      el('div', { class: 'ui-field' }, [el('label', { for: 'cr-quality', text: 'Item quality' }), ui.quality]),
      el('div', { class: 'ui-field' }, [el('label', { for: 'cr-class', text: 'Usable by class' }), ui.cls])
    ]));
    newEl.appendChild(el('div', { class: 'ui-status' }, [ui.status, ui.reset]));
    newEl.appendChild(el('details', { class: 'ui-toc', open: true }, [
      el('summary', { text: 'Jump to category' }),
      el('nav', { 'aria-label': 'Recipe categories' }, [ui.toc])
    ]));
    newEl.appendChild(ui.results);

    ui.search.value = state.q;
    ui.cat.value = state.cat;
    ui.quality.value = state.quality;
    ui.cls.value = state.cls;

    var timer = null;
    ui.search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = ui.search.value.trim(); update(); }, 150);
    });
    ui.cat.addEventListener('change', function () { state.cat = ui.cat.value; update(); });
    ui.quality.addEventListener('change', function () { state.quality = ui.quality.value; update(); });
    ui.cls.addEventListener('change', function () { state.cls = ui.cls.value; update(); });
    ui.reset.addEventListener('click', function () {
      state.q = state.cat = state.quality = state.cls = '';
      ui.search.value = ''; ui.cat.value = ''; ui.quality.value = ''; ui.cls.value = '';
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

  function filtering() {
    return !!(state.q || state.quality || state.cls);
  }

  function matchVariants(g) {
    var terms = norm(state.q).split(/\s+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < g._v.length; i++) {
      var e = g._v[i];
      if (state.quality && !e.kinds[state.quality]) continue;
      if (state.cls && e.v._cls && e.v._cls !== state.cls) continue;
      var ok = true;
      for (var t = 0; t < terms.length; t++) {
        if (e.text.indexOf(terms[t]) < 0) { ok = false; break; }
      }
      if (ok) out.push(e.v);
    }
    return out;
  }

  function renderResults() {
    var frag = document.createDocumentFragment();
    var tocFrag = document.createDocumentFragment();
    var totalVariants = 0, totalGroups = 0;
    var isFiltering = filtering();

    data.categories.forEach(function (cat) {
      if (state.cat && state.cat !== cat.id) return;
      var groups = groupsByCat[cat.id] || [];
      var section = null, list = null, count = 0;
      groups.forEach(function (g) {
        var matches = matchVariants(g);
        if (!matches.length) return;
        if (!section) {
          section = el('section', { class: 'ui-section', id: cat.id, 'aria-labelledby': 'h-' + cat.id }, [
            el('h2', { id: 'h-' + cat.id, text: cat.title }),
            cat.intro ? el('p', { class: 'ui-intro', html: cat.intro }) : null
          ]);
          list = section;
        }
        list.appendChild(renderGroup(g, matches, isFiltering));
        count += matches.length;
        totalGroups++;
      });
      if (section) {
        frag.appendChild(section);
        totalVariants += count;
        tocFrag.appendChild(el('li', null, [
          el('a', { href: '#' + cat.id, text: cat.title }), ' ',
          el('span', { class: 'ui-count', text: '(' + count + ')' })
        ]));
      }
    });

    ui.results.textContent = '';
    ui.toc.textContent = '';
    if (!totalGroups) {
      ui.results.appendChild(el('p', { class: 'ui-empty', text: 'No recipes match these filters.' }));
    } else {
      ui.results.appendChild(frag);
      ui.toc.appendChild(tocFrag);
    }
    ui.status.textContent = totalVariants.toLocaleString() + ' recipe' + (totalVariants === 1 ? '' : 's') +
      ' in ' + totalGroups.toLocaleString() + ' group' + (totalGroups === 1 ? '' : 's') +
      (isFiltering || state.cat ? ' match your filters.' : '.');
    ui.reset.hidden = !(isFiltering || state.cat);
  }

  function renderGroup(g, matches, isFiltering) {
    var total = g.v.length;
    var badge = isFiltering && matches.length !== total
      ? matches.length + ' of ' + total + ' recipes'
      : total + (total === 1 ? ' recipe' : ' recipes');
    var list = el('ul', { class: 'cr-recipes', id: 'list-' + g.id });
    var shown = Math.min(matches.length, isFiltering ? MATCH_COUNT : PREVIEW_COUNT);
    appendVariants(list, matches, 0, shown);

    var art = el('article', { class: 'cr-group', id: g.id, 'aria-labelledby': 't-' + g.id }, [
      el('header', null, [
        el('h3', { id: 't-' + g.id }, [el('a', { href: '#' + g.id, text: g.t })]),
        el('span', { class: 'cr-badge', text: badge })
      ]),
      g.note ? el('p', { class: 'cr-group-note', text: g.note }) : null,
      list
    ]);

    if (shown < matches.length) {
      var more = el('div', { class: 'cr-more' });
      var btn = el('button', { type: 'button', class: 'ui-btn', 'aria-controls': list.id });
      var setLabel = function () {
        var left = matches.length - shown;
        btn.textContent = 'Show ' + Math.min(left, MORE_STEP) + ' more' + (left > MORE_STEP ? ' (' + left + ' remaining)' : '');
      };
      setLabel();
      btn.addEventListener('click', function () {
        var next = Math.min(matches.length, shown + MORE_STEP);
        var firstNew = appendVariants(list, matches, shown, next);
        shown = next;
        if (shown >= matches.length) more.remove(); else setLabel();
        if (firstNew) { firstNew.setAttribute('tabindex', '-1'); firstNew.focus({ preventScroll: false }); }
      });
      more.appendChild(btn);
      art.appendChild(more);
    }
    return art;
  }

  function appendVariants(list, variants, from, to) {
    var first = null;
    for (var i = from; i < to; i++) {
      var li = renderRecipe(variants[i]);
      if (!first) first = li;
      list.appendChild(li);
    }
    return first;
  }

  function renderItem(it, isOutput) {
    var quals = (it.q || []).slice();
    var label = QUALITY_LABEL[it.k];
    if (label && quals.indexOf(label) < 0) quals.unshift(label);
    return el('li', { class: 'k-' + it.k }, [
      it.c ? el('span', { class: 'cr-qty', text: it.c + '×' }) : null,
      el('span', { class: 'cr-name', text: it.n }),
      quals.length ? el('span', { class: 'cr-quals', text: ' (' + quals.join(', ') + ')' }) : null,
      isOutput && it.m && it.m.length
        ? el('ul', { class: 'cr-mods' }, it.m.map(function (m) { return el('li', { text: m }); }))
        : null
    ]);
  }

  function renderRecipe(v) {
    return el('li', { class: 'cr-recipe' }, [
      el('div', { class: 'cr-side' }, [
        el('h4', { text: 'Inputs' }),
        el('ul', { class: 'cr-items' }, v.i.map(function (it) { return renderItem(it, false); }))
      ]),
      el('div', { class: 'cr-arrow', 'aria-hidden': 'true', text: '→' }),
      el('div', { class: 'cr-side' }, [
        el('h4', { text: v.o.length > 1 ? 'Outputs' : 'Output' }),
        el('ul', { class: 'cr-items' }, v.o.map(function (it) { return renderItem(it, true); }))
      ]),
      v.r && v.r.length ? el('ul', { class: 'cr-reqs', 'aria-label': 'Requirements' },
        v.r.map(function (r) { return el('li', { text: r }); })) : null
    ]);
  }

  // ---------------------------------------------------------------------
  // Anchors: #sec, #dst etc. (category ids) and group ids. The view renders after load,
  // so the browser's own jump-to-anchor has nothing to land on yet.
  // ---------------------------------------------------------------------

  function scrollToAnchor() {
    var h = decodeURIComponent(location.hash.slice(1));
    if (!h || h.indexOf('=') >= 0) return;
    var target = document.getElementById(h);
    if (target && newEl.contains(target)) target.scrollIntoView();
  }

  window.addEventListener('hashchange', function () {
    if (rendered && location.hash.indexOf('=') >= 0 && readHashState()) {
      ui.search.value = state.q; ui.cat.value = state.cat; ui.quality.value = state.quality; ui.cls.value = state.cls;
      renderResults();
    } else {
      scrollToAnchor();
    }
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  if (data) {
    renderNewView();
  } else {
    newEl.textContent = '';
    newEl.appendChild(el('h2', { class: 'ui-title', text: 'Cube Recipes' }));
    newEl.appendChild(el('p', { class: 'ui-missing' }, [
      'Recipe data has not been generated. Run ',
      el('code', { text: 'node scripts/build-cube-recipes.mjs' }),
      ' and reload.'
    ]));
  }
  scrollToAnchor();
})();
