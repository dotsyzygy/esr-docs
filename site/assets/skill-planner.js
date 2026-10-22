/* Skill Planner: hard points for every skill of one class, as the skill trees lay them out, and
   the chosen skill's tooltip worked out from the whole plan. The plan is evaluated as a character
   (skill-calc's opts.character): synergies read the other skills' hard points, skills that scale
   with their own hard points (Dodge) get them, and +skills from items raise the levels of skills
   with points, as in game.
   skill-planner.html#class=sor&clvl=110&quest=12&all=0&cs=0&t1=0&t2=0&t3=0&tree=1&skill=sor-fire-ball
   &p=fire-bolt.20_fire-ball.20 (p lists the hard points, by skill id without the class prefix).
   Data comes from data/skills.<lang>.js (window.ESR_SKILL_DATA), produced by
   scripts/build-skills.mjs: the class skills and their tree positions, skill points per level
   (charstats SkillsPerLevel) and the quest skill points (the Elixirs of Skill in misc.txt). */
(function () {
  'use strict';

  var data = window.ESR_SKILL_DATA;
  var SkillCalc = window.ESRSkillCalc;
  var root = document.getElementById('planner');
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

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function clamp(v, lo, hi, fallback) {
    v = parseInt(v, 10);
    if (!(v >= lo)) return fallback;
    return Math.min(hi, v);
  }

  if (!data || !SkillCalc || !data.points) {
    root.appendChild(el('h2', { class: 'ui-title', text: 'Skill Planner' }));
    root.appendChild(el('p', { class: 'ui-missing' }, ['Skill data has not been generated. Run ', el('code', { text: 'node scripts/build-skills.mjs' }), ' and reload.']));
    return;
  }

  // ---------------------------------------------------------------------
  // Index
  // ---------------------------------------------------------------------

  var MAX = data.levels.max;
  var CAP = data.levels.synergy || 20;
  var QUEST = data.points.quest || 0;
  var BONUS_MAX = 50;

  var classes = data.classes.filter(function (c) { return c.id !== 'other' && c.trees && c.trees.length; });
  var classById = {}, skillById = {}, skillsOf = {}, byName = {};
  classes.forEach(function (c) { classById[c.id] = c; skillsOf[c.id] = []; byName[c.id] = {}; });
  data.skills.forEach(function (s) {
    if (!classById[s.c]) return;
    skillById[s.id] = s;
    skillsOf[s.c].push(s);
    byName[s.c][s.n.toLowerCase()] = s;
  });
  classes.forEach(function (c) {
    skillsOf[c.id].sort(function (a, b) { return a.tr - b.tr || a.row - b.row || a.col - b.col; });
  });

  // The game lists a class's trees last page first (Amazon: Javelin, Passive, Bow); the planner
  // opens on the first one listed.
  function gameTrees(c) { return c.trees.slice().reverse(); }
  function defaultTree() { return gameTrees(classById[state.cls])[0].n; }

  function maxOf(s) { var rec = data.db.s[s.k]; return (rec && rec.mx) || CAP; }
  function shortId(s) { return s.id.slice(s.c.length + 1); }
  function sameClass(name, cls) { return byName[cls || state.cls][String(name).toLowerCase()] || null; }
  function perLevel() { var c = classById[state.cls]; return c.perLevel == null ? 1 : c.perLevel; }

  // ---------------------------------------------------------------------
  // State. The hash holds the class shown; other classes' plans stay in memory.
  // ---------------------------------------------------------------------

  var state = { cls: classes[0].id, clvl: MAX, quest: QUEST, all: 0, cs: 0, tab: [0, 0, 0], tree: 1, sel: '', plans: {} };

  function plan() { return state.plans[state.cls] || (state.plans[state.cls] = {}); }
  function hard(s) { return plan()[s.id] || 0; }
  function bonus(s) { return state.all + state.cs + (state.tab[s.tr - 1] || 0); }
  // +skills only raise skills with hard points.
  function level(s) { var h = hard(s); return h ? h + bonus(s) : 0; }
  function spent() { return skillsOf[state.cls].reduce(function (n, s) { return n + hard(s); }, 0); }
  function available() { return Math.max(0, state.clvl - 1) * perLevel() + state.quest; }
  function remaining() { return available() - spent(); }

  // The lowest character level the plan fits: enough points, and each skill's nth point
  // comes no earlier than its required level + n - 1.
  function neededLevel() {
    var pts = Math.max(0, spent() - state.quest);
    var lv = 1 + (perLevel() ? Math.ceil(pts / perLevel()) : 0);
    skillsOf[state.cls].forEach(function (s) {
      var h = hard(s);
      if (h) lv = Math.max(lv, (s.r || 1) + h - 1);
    });
    return lv;
  }

  function readHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    var cls = p.get('class');
    if (cls && classById[cls]) state.cls = cls;
    state.clvl = clamp(p.get('clvl'), 1, MAX, MAX);
    state.quest = clamp(p.get('quest'), 0, QUEST, QUEST);
    state.all = clamp(p.get('all'), 0, BONUS_MAX, 0);
    state.cs = clamp(p.get('cs'), 0, BONUS_MAX, 0);
    state.tab = [1, 2, 3].map(function (n) { return clamp(p.get('t' + n), 0, BONUS_MAX, 0); });
    var tree = +p.get('tree');
    state.tree = classById[state.cls].trees.some(function (t) { return t.n === tree; }) ? tree : defaultTree();
    var sel = skillById[p.get('skill')];
    state.sel = sel && sel.c === state.cls ? sel.id : '';
    if (p.has('p')) {
      var pl = state.plans[state.cls] = {};
      (p.get('p') || '').split('_').forEach(function (pair) {
        var m = /^([a-z0-9-]+)\.(\d+)$/.exec(pair);
        var s = m && skillById[state.cls + '-' + m[1]];
        if (s) pl[s.id] = clamp(m[2], 0, maxOf(s), 0);
      });
    }
  }

  function writeHash() {
    var p = new URLSearchParams();
    p.set('class', state.cls);
    if (state.clvl !== MAX) p.set('clvl', state.clvl);
    if (state.quest !== QUEST) p.set('quest', state.quest);
    if (state.all) p.set('all', state.all);
    if (state.cs) p.set('cs', state.cs);
    state.tab.forEach(function (v, i) { if (v) p.set('t' + (i + 1), v); });
    if (state.tree !== defaultTree()) p.set('tree', state.tree);
    if (state.sel) p.set('skill', state.sel);
    var pts = skillsOf[state.cls].filter(hard).map(function (s) { return shortId(s) + '.' + hard(s); });
    if (pts.length) p.set('p', pts.join('_'));
    history.replaceState(null, '', location.pathname + location.search + '#' + p.toString());
  }

  // ---------------------------------------------------------------------
  // Evaluation: the plan as a character. over = { skill id: hard points } evaluates a variant
  // (the next level, or a first point in an unlearned skill).
  // ---------------------------------------------------------------------

  function calcFor(over) {
    var skills = {};
    // The basic skills every character has (Attack, Throw, …) are level 1.
    (data.db.base || []).forEach(function (k) { skills[k] = { blvl: 1, lvl: 1 }; });
    skillsOf[state.cls].forEach(function (s) {
      var h = over && s.id in over ? over[s.id] : hard(s);
      if (h) skills[s.k] = { blvl: h, lvl: h + bonus(s) };
    });
    return new SkillCalc.Calc(data.db, { ulvl: state.clvl, character: { skills: skills, stats: {} } });
  }

  function lineList(calc, s, lines, lvl, cls) {
    var list = el('ul', { class: 'sk-lines' + (cls ? ' ' + cls : '') });
    lines.forEach(function (line) {
      var t = calc.line(data.db.s[s.k], line, lvl);
      if (t == null || t === '') return;
      list.appendChild(el('li', { class: line.t === 40 ? 'sk-line-head' : null }, multiline(t)));
    });
    return list.childNodes.length ? list : null;
  }

  // ---------------------------------------------------------------------
  // Problems: points over budget, levels too low, missing prerequisites
  // ---------------------------------------------------------------------

  function skillProblems(s) {
    var out = [], h = hard(s);
    if (!h) return out;
    var need = (s.r || 1) + h - 1;
    if (need > state.clvl) out.push(plural(h, 'point') + ' need character level ' + need);
    (s.pre || []).forEach(function (name) {
      var p = sameClass(name);
      if (p && !hard(p)) out.push('needs a point in ' + p.n);
    });
    return out;
  }

  function missingPrereqs(s, out) {
    (s.pre || []).forEach(function (name) {
      var p = sameClass(name);
      if (p && !hard(p) && out.indexOf(p) < 0) { out.push(p); missingPrereqs(p, out); }
    });
    return out;
  }

  // ---------------------------------------------------------------------
  // Changing points. A first point also puts a point in each missing prerequisite.
  // ---------------------------------------------------------------------

  function setPoints(s, v) {
    var h = hard(s), mx = maxOf(s);
    v = Math.max(0, Math.min(mx, v));
    if (v > h) {
      var pre = h ? [] : missingPrereqs(s, []);
      var room = remaining() - pre.length;
      if (room < 1) {
        say(pre.length ? 'Not enough skill points left for ' + s.n + ' and the skills it requires.' : 'No skill points left.');
        return false;
      }
      if (v - h > room) { v = h + room; say('Only ' + plural(room, 'point') + ' left: ' + s.n + ' gets ' + v + '.'); }
      pre.forEach(function (p) { plan()[p.id] = 1; });
      if (pre.length) say('Also put a point in ' + pre.map(function (p) { return p.n; }).join(', ') + ', which ' + s.n + ' requires.');
    }
    if (v) plan()[s.id] = v; else delete plan()[s.id];
    return true;
  }

  // ---------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------

  var ui = {};

  function section(id, title, children, cls) {
    return el('section', { class: 'ui-section ' + (cls || ''), id: id, 'aria-labelledby': id + '-h' },
      [el('h2', { id: id + '-h', text: title })].concat(children));
  }

  function numberInput(id, value, min, max) {
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
        if (v !== get()) set(v);
      }, 250);
    });
    input.addEventListener('change', function () {
      clearTimeout(t);
      var v = clamp(input.value, min, max, get());
      if (v !== get()) set(v);
      input.value = get();
    });
  }

  function say(text) { if (ui.msg) ui.msg.textContent = text; }

  function changed() {
    writeHash();
    refresh();
  }

  function build() {
    root.textContent = '';
    root.appendChild(el('h2', { class: 'ui-title', text: 'Skill Planner' }));
    root.appendChild(el('p', { class: 'ui-intro', text: 'Put hard points in a class’s skills and see each skill’s tooltip as the plan makes it: ' +
      'synergies from the other skills’ hard points, skills that grow with their own hard points, and +skills from items. ' +
      'A skill takes up to ' + CAP + ' hard points. Shift-click + or − to go straight to the most or to 0.' }));

    // Toolbar: class, character level, quest points
    ui.cls = el('select', { id: 'sp-class' }, classes.map(function (c) { return el('option', { value: c.id, text: c.title }); }));
    ui.cls.value = state.cls;
    ui.cls.addEventListener('change', function () {
      state.cls = ui.cls.value;
      state.tree = defaultTree();
      state.sel = '';
      writeHash();
      buildClass();
      refresh();
    });
    ui.clvl = numberInput('sp-clvl', state.clvl, 1, MAX);
    watch(ui.clvl, function () { return state.clvl; }, function (v) { state.clvl = v; changed(); }, 1, MAX);
    ui.quest = numberInput('sp-quest', state.quest, 0, QUEST);
    watch(ui.quest, function () { return state.quest; }, function (v) { state.quest = v; changed(); }, 0, QUEST);
    root.appendChild(el('div', { class: 'ui-toolbar sp-toolbar', role: 'group', 'aria-label': 'Character' }, [
      el('div', { class: 'ui-field' }, [el('label', { for: 'sp-class', text: 'Class' }), ui.cls]),
      el('div', { class: 'ui-field' }, [el('label', { for: 'sp-clvl', text: 'Character level (1–' + MAX + ')' }), ui.clvl]),
      el('div', { class: 'ui-field' }, [el('label', { for: 'sp-quest', text: 'Quest skill points (0–' + QUEST + ')' }), ui.quest])
    ]));

    // +skills from items
    ui.bonus = {};
    ui.bonusBox = el('details', { class: 'sp-bonus' });
    ui.bonusSummary = el('summary');
    ui.bonusBox.appendChild(ui.bonusSummary);
    ui.bonusFields = el('div', { class: 'sp-bonus-fields' });
    ui.bonusBox.appendChild(ui.bonusFields);
    ui.bonusBox.appendChild(el('p', { class: 'sk-note', text: '+Skills raise only skills with at least one hard point, and synergies don’t count them: ' +
      'they read hard points. Skills that a formula reads by level (with +skills) do count them.' }));
    root.appendChild(ui.bonusBox);

    // Points, messages and problems
    ui.points = el('p', { class: 'sp-points' });
    ui.msg = el('p', { class: 'sp-msg', role: 'status', 'aria-live': 'polite' });
    var resetTree = el('button', { type: 'button', class: 'ui-btn', text: 'Reset this tree' });
    var resetAll = el('button', { type: 'button', class: 'ui-btn', text: 'Reset all points' });
    resetTree.addEventListener('click', function () {
      skillsOf[state.cls].forEach(function (s) { if (s.tr === state.tree) delete plan()[s.id]; });
      say('Points in ' + treeOf(state.tree).title + ' cleared.');
      changed();
    });
    resetAll.addEventListener('click', function () {
      state.plans[state.cls] = {};
      say('All ' + classById[state.cls].title + ' points cleared.');
      changed();
    });
    root.appendChild(el('div', { class: 'ui-status sp-status' }, [ui.points, resetTree, resetAll]));
    root.appendChild(ui.msg);
    ui.problems = el('ul', { class: 'sp-problems', 'aria-label': 'Problems with this plan' });
    root.appendChild(ui.problems);

    // Trees and the tooltip
    ui.trees = el('div', { class: 'sp-trees' });
    ui.tip = el('div', { class: 'sp-tip' });
    ui.tipSection = section('sp-tooltip', 'Tooltip', [ui.tip], 'sp-tip-section');
    root.appendChild(el('div', { class: 'sp-layout' }, [section('sp-plan', 'Skill trees', [ui.trees], 'sp-plan-section'), ui.tipSection]));

    buildClass();
  }

  function treeOf(n) {
    return classById[state.cls].trees.filter(function (t) { return t.n === n; })[0] || classById[state.cls].trees[0];
  }

  function bonusField(id, label, get, set) {
    var input = numberInput(id, get(), 0, BONUS_MAX);
    watch(input, get, function (v) { set(v); changed(); }, 0, BONUS_MAX);
    ui.bonus[id] = { input: input, get: get };
    return el('div', { class: 'ui-field' }, [el('label', { for: id, text: label }), input]);
  }

  // The class's trees as tabs, each a 6×3 grid of skills as the game lays them out.
  function buildClass() {
    var c = classById[state.cls];
    ui.cls.value = state.cls;

    ui.bonus = {};
    ui.bonusFields.textContent = '';
    ui.bonusFields.appendChild(bonusField('sp-all', '+All Skills', function () { return state.all; }, function (v) { state.all = v; }));
    ui.bonusFields.appendChild(bonusField('sp-cs', '+' + c.title + ' Skills', function () { return state.cs; }, function (v) { state.cs = v; }));
    gameTrees(c).forEach(function (t) {
      ui.bonusFields.appendChild(bonusField('sp-t' + t.n, '+' + t.title, function () { return state.tab[t.n - 1]; }, function (v) { state.tab[t.n - 1] = v; }));
    });

    ui.trees.textContent = '';
    ui.cards = {};
    ui.tabs = [];
    var tablist = el('div', { class: 'sp-tabs', role: 'tablist', 'aria-label': c.title + ' skill trees' });
    ui.trees.appendChild(tablist);
    var trees = gameTrees(c);
    trees.forEach(function (t, i) {
      var tab = el('button', { type: 'button', role: 'tab', id: 'sp-tab-' + t.n, 'aria-controls': 'sp-tree-' + t.n, class: 'sp-tab' });
      tab.addEventListener('click', function () { showTree(t.n); });
      tab.addEventListener('keydown', function (e) {
        var n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: trees.length - 1 }[e.key];
        if (n == null) return;
        e.preventDefault();
        n = (n + trees.length) % trees.length;
        showTree(trees[n].n);
        ui.tabs[n].tab.focus();
      });
      tablist.appendChild(tab);
      var grid = el('div', { class: 'sp-grid' });
      var panel = el('div', { role: 'tabpanel', id: 'sp-tree-' + t.n, 'aria-labelledby': 'sp-tab-' + t.n, class: 'sp-panel' }, [grid]);
      ui.trees.appendChild(panel);
      ui.tabs.push({ n: t.n, tab: tab, panel: panel, title: t.title });
      skillsOf[state.cls].forEach(function (s) { if (s.tr === t.n) grid.appendChild(card(s)); });
    });
    showTree(state.tree, true);
  }

  function showTree(n, quiet) {
    state.tree = n;
    ui.tabs.forEach(function (t) {
      var on = t.n === n;
      t.tab.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tab.tabIndex = on ? 0 : -1;
      t.panel.hidden = !on;
    });
    if (!quiet) writeHash();
  }

  function card(s) {
    var mx = maxOf(s);
    var c = { s: s };
    c.name = el('button', { type: 'button', class: 'sp-name', text: s.n, 'aria-controls': 'sp-tooltip' });
    c.name.addEventListener('click', function () { select(s, true); });
    c.input = numberInput('sp-pts-' + s.id, hard(s), 0, mx);
    c.input.setAttribute('aria-label', s.n + ' hard points (0–' + mx + ')');
    watch(c.input, function () { return hard(s); }, function (v) { setPoints(s, v); state.sel = s.id; changed(); }, 0, mx);
    c.minus = el('button', { type: 'button', class: 'sp-step', 'aria-label': 'Remove a point from ' + s.n, text: '−' });
    c.plus = el('button', { type: 'button', class: 'sp-step', 'aria-label': 'Add a point to ' + s.n, text: '+' });
    c.minus.addEventListener('click', function (e) { setPoints(s, e.shiftKey ? 0 : hard(s) - 1); state.sel = s.id; changed(); });
    c.plus.addEventListener('click', function (e) { setPoints(s, e.shiftKey ? mx : hard(s) + 1); state.sel = s.id; changed(); });
    c.level = el('p', { class: 'sp-level' });
    c.warn = el('p', { class: 'sp-warn' });
    c.el = el('div', { class: 'sp-skill', style: 'grid-row:' + (s.row || 'auto') + ';grid-column:' + (s.col || 'auto') }, [
      c.name,
      el('div', { class: 'sp-stepper' }, [c.minus, c.input, c.plus]),
      c.level, c.warn
    ]);
    ui.cards[s.id] = c;
    return c.el;
  }

  // From a tree card, focus stays on the card unless the tooltip is below the trees (narrow
  // screens); from a link in the tooltip, which is redrawn, it moves to the tooltip.
  function select(s, fromCard) {
    state.sel = s.id;
    if (s.tr !== state.tree && ui.tabs) showTree(s.tr, true);
    changed();
    var narrow = window.matchMedia && window.matchMedia('(max-width: 60rem)').matches;
    if (narrow) ui.tipSection.scrollIntoView({ block: 'start' });
    if (narrow || !fromCard) ui.tipHeading.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------
  // Refresh: cards, points, problems and the tooltip
  // ---------------------------------------------------------------------

  function refresh() {
    var c = classById[state.cls];
    var left = remaining();
    ui.clvl.value = state.clvl;
    ui.quest.value = state.quest;
    Object.keys(ui.bonus).forEach(function (id) { ui.bonus[id].input.value = ui.bonus[id].get(); });
    var bonusParts = [];
    if (state.all) bonusParts.push('+' + state.all + ' all');
    if (state.cs) bonusParts.push('+' + state.cs + ' ' + c.title);
    gameTrees(c).forEach(function (t) { if (state.tab[t.n - 1]) bonusParts.push('+' + state.tab[t.n - 1] + ' ' + t.title); });
    ui.bonusSummary.textContent = '+Skills from items: ' + (bonusParts.length ? bonusParts.join(', ') : 'none');

    var used = spent();
    ui.points.textContent = '';
    ui.points.appendChild(el('strong', { text: used + ' of ' + available() }));
    ui.points.appendChild(document.createTextNode(' skill points spent, ' + (left >= 0 ? left + ' left' : -left + ' too many') +
      (used ? '. This plan needs character level ' + neededLevel() + '.' : '.')));

    // problems
    ui.problems.textContent = '';
    if (left < 0) ui.problems.appendChild(el('li', { text: plural(-left, 'point') + ' more than the ' + available() + ' available at character level ' + state.clvl + '.' }));
    skillsOf[state.cls].forEach(function (s) {
      skillProblems(s).forEach(function (p) { ui.problems.appendChild(el('li', { text: s.n + ': ' + p + '.' })); });
    });
    ui.problems.hidden = !ui.problems.childNodes.length;

    // tabs and cards
    ui.tabs.forEach(function (t) {
      var pts = skillsOf[state.cls].reduce(function (n, s) { return n + (s.tr === t.n ? hard(s) : 0); }, 0);
      t.tab.textContent = '';
      t.tab.appendChild(document.createTextNode(t.title));
      t.tab.appendChild(el('span', { class: 'sp-tab-pts', text: ' ' + pts }));
      t.tab.setAttribute('aria-label', t.title + ', ' + plural(pts, 'point'));
    });
    skillsOf[state.cls].forEach(function (s) {
      var card = ui.cards[s.id], h = hard(s), b = bonus(s), mx = maxOf(s);
      if (document.activeElement !== card.input) card.input.value = h;
      card.minus.disabled = !h;
      card.plus.disabled = h >= mx || left <= 0;
      card.el.classList.toggle('sp-has', !!h);
      card.el.classList.toggle('sp-sel', s.id === state.sel);
      card.name.setAttribute('aria-pressed', s.id === state.sel ? 'true' : 'false');
      card.level.textContent = h ? 'Level ' + (h + b) + (b ? ' (' + h + ' + ' + b + ')' : '') : 'Required level ' + (s.r || 1);
      var probs = skillProblems(s);
      card.warn.textContent = probs.length ? '⚠ ' + probs.join('; ') : '';
      card.warn.hidden = !probs.length;
    });

    renderTip();
  }

  // The chosen skill's tooltip: the current level and the next, as in game, then its synergies
  // with the points the plan puts in each.
  function renderTip() {
    ui.tip.textContent = '';
    var s = skillById[state.sel];
    ui.tipHeading = el('h3', { class: 'sp-tip-name', tabindex: '-1', text: s ? s.n : 'No skill chosen' });
    ui.tip.appendChild(ui.tipHeading);
    if (!s) {
      ui.tip.appendChild(el('p', { class: 'sk-note', text: 'Pick a skill’s name in the trees to see its tooltip here.' }));
      return;
    }
    var h = hard(s), b = bonus(s), lv = level(s), mx = maxOf(s);
    var calc = calcFor();
    ui.tip.appendChild(el('p', { class: 'sk-where', text: treeOf(s.tr).title }));
    var tags = [el('li', { text: 'Required level ' + (s.r || 1) })];
    if (s.pas) tags.push(el('li', { text: 'Passive' }));
    if (s.aur) tags.push(el('li', { text: 'Aura' }));
    if (s.hp) tags.push(el('li', { text: 'Scales with hard points' }));
    ui.tip.appendChild(el('ul', { class: 'sk-tags', 'aria-label': 'About this skill' }, tags));
    ui.tip.appendChild(el('p', { class: 'sp-tip-level' }, h
      ? [el('strong', { text: 'Level ' + lv }), b ? ': ' + plural(h, 'hard point') + ' + ' + b + ' from items' : ': ' + plural(h, 'hard point')]
      : [el('strong', { text: 'Not learned' }), b ? ' (+' + b + ' from items once it has a point)' : '']));
    if (s.pre) {
      ui.tip.appendChild(el('p', { class: 'sp-tip-pre' }, ['Requires: '].concat(join(s.pre.map(function (name) {
        var p = sameClass(name, s.c);
        return p ? skillButton(p) : name;
      })))));
    }
    if (s.d) ui.tip.appendChild(el('p', { class: 'sk-desc' }, multiline(s.d)));

    // An unlearned skill shows what its first point gives.
    var first = h ? null : (function () { var o = {}; o[s.id] = 1; return o; })();
    var lvlShown = h ? lv : 1 + b;
    var calcShown = first ? calcFor(first) : calc;
    if (s.g) { var g = lineList(calcShown, s, s.g, lvlShown, 'sk-general'); if (g) ui.tip.appendChild(g); }
    if (s.l) {
      ui.tip.appendChild(block(h ? 'Current level' : 'First level', lineList(calcShown, s, s.l, lvlShown)));
      if (h && h < mx) {
        var next = {}; next[s.id] = h + 1;
        ui.tip.appendChild(block('Next level', lineList(calcFor(next), s, s.l, lv + 1)));
      }
    }
    if (!s.g && !s.l) ui.tip.appendChild(el('p', { class: 'sk-none', text: 'The game data gives no values for this skill.' }));

    synergyBlock(s, calcShown, lvlShown);
    var gives = skillsOf[s.c].filter(function (x) { return (x.sy || []).concat(x.sl || []).indexOf(s.id) >= 0; });
    if (gives.length) ui.tip.appendChild(el('p', { class: 'sp-tip-gives' }, ['Gives bonuses to: '].concat(join(gives.map(skillButton)))));

    var link = el('a', { href: detailHref(s), text: 'Full details and values at every level' });
    ui.tip.appendChild(el('p', { class: 'sp-tip-link' }, [link]));
  }

  function block(title, list) {
    return el('div', { class: 'sk-block sp-tip-block' }, [el('h4', { class: 'sk-sub', text: title }), list || el('p', { class: 'sk-none', text: 'Nothing at this level.' })]);
  }

  function join(nodes) {
    var out = [];
    nodes.forEach(function (n, i) { if (i) out.push(', '); out.push(n); });
    return out;
  }

  function skillButton(s) {
    var btn = el('button', { type: 'button', class: 'sp-link', text: s.n });
    btn.addEventListener('click', function () { select(s, false); });
    return btn;
  }

  function pointsNote(x, byLevel) {
    var h = hard(x);
    var text = byLevel ? (h ? 'level ' + level(x) : 'not learned') : plural(h, 'hard point');
    return el('span', { class: 'sp-syn-pts' + (h ? '' : ' sp-zero'), text: text });
  }

  // "Receives Bonuses From" lines with each named skill's points, then the skills the formulas
  // read that no line names (curses' "Any Other Curse"), then the ones read by level.
  function synergyBlock(s, calc, lvl) {
    var rec = data.db.s[s.k];
    var named = {};
    var items = [];
    (s.s || []).forEach(function (line) {
      var text = calc.line(rec, line, lvl);
      if (text == null || text === '') return;
      var x = (line.t === 76 || line.t === 79) && line.b ? sameClass(line.b, s.c) : null;
      if (x) named[x.id] = true;
      var parts = x && text.indexOf(x.n) === 0 ? [skillButton(x), text.slice(x.n.length)] : multiline(text);
      if (x) parts.push(' ', pointsNote(x, (s.sl || []).indexOf(x.id) >= 0 && (s.sy || []).indexOf(x.id) < 0));
      items.push(el('li', { class: line.t === 40 ? 'sk-line-head' : null }, parts));
    });
    var rest = (s.sy || []).concat(s.sl || []).filter(function (id) { return !named[id] && skillById[id]; });
    rest.forEach(function (id) {
      var x = skillById[id], byLevel = (s.sy || []).indexOf(id) < 0;
      items.push(el('li', null, [skillButton(x), byLevel ? ' (counts by level, with +skills)' : '', ' ', pointsNote(x, byLevel)]));
    });
    if (!items.length) return;
    ui.tip.appendChild(el('div', { class: 'sk-block sp-tip-block' }, [
      el('h4', { class: 'sk-sub', text: 'Synergies' }),
      el('ul', { class: 'sk-lines sk-synergies' }, items),
      !(s.sy || s.sl) ? el('p', { class: 'sk-note', text: 'These bonuses work through effects the planner can’t model, so the values above don’t include them.' }) : null
    ]));
  }

  // The skill detail page with the plan's levels and synergy points.
  function detailHref(s) {
    var p = new URLSearchParams();
    p.set('skill', s.id);
    var h = hard(s);
    p.set('slvl', h ? level(s) : 1 + bonus(s));
    p.set('clvl', state.clvl);
    if (s.hp) p.set('hp', Math.min(h || 1, CAP));
    (s.sy || []).forEach(function (id) { var x = skillById[id]; if (x && hard(x)) p.set(id, hard(x)); });
    (s.sl || []).forEach(function (id) { var x = skillById[id]; if (x && hard(x)) p.set(id, level(x)); });
    return 'skill.html#' + p.toString();
  }

  // ---------------------------------------------------------------------
  // Init. A pasted link (hash change) shows that plan.
  // ---------------------------------------------------------------------

  window.addEventListener('hashchange', function () {
    readHash();
    buildClass();
    refresh();
  });
  document.title = 'Skill Planner - Eastern Sun Resurrected';
  readHash();
  build();
  writeHash();
  refresh();
})();
