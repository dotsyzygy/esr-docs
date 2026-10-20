/* Site navigation, shared by every page (the nav bar, home page cards and the scroll jumps
   at the bottom of this file). Each page has an empty
   <nav id="site-nav"> in its header followed by this script, which fills it in
   synchronously (so there is no layout shift). The home page also has an empty
   <ul id="site-pages">, which gets a card for every page with a description.
   To add a page, add it to PAGES. */
(function () {
  'use strict';

  var PAGES = [
    { href: 'index.html', title: 'Home' },
    {
      href: 'character.html', title: 'Character',
      description: 'Open one of your character saves to see its base and final attributes, skill levels with gear, and the items and charms behind them. The save is read in your browser and never uploaded.'
    },
    {
      href: 'classes.html', title: 'Classes',
      description: 'Class mechanics the skill trees don’t show. So far: the Warlock’s Consume bonus for every demon, at any Consume level and Consume Effect bonus.'
    },
    {
      href: 'cube-recipes.html', title: 'Cube Recipes',
      description: 'Every Horadric Cube recipe: crafting, rerolls, upgrades, forging, sockets, runes and gems, searchable by item, rune or mod.'
    },
    {
      href: 'skills.html', title: 'Skills',
      description: 'Every class skill tree plus the skills items grant (oskills, chance to cast, charges), with values at any skill level and character level up to 110.'
    },
    {
      href: 'vessel-of-souls.html', title: 'Vessel of Souls',
      description: 'The mythical amulet that consumes organs: every tier bonus and its soul cost, the weapon transforms and the anointments.'
    }
  ];

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    for (var k in attrs || {}) node.setAttribute(k, attrs[k]);
    if (text) node.textContent = text;
    return node;
  }

  var here = decodeURIComponent(location.pathname.split('/').pop() || 'index.html');

  var nav = document.getElementById('site-nav');
  if (nav) {
    var list = el('ul');
    PAGES.forEach(function (p) {
      var a = el('a', { href: p.href }, p.title);
      if (p.href === here) a.setAttribute('aria-current', 'page');
      var li = el('li');
      li.appendChild(a);
      list.appendChild(li);
    });
    nav.appendChild(list);
  }

  // Home page cards. Runs when the script is included after <ul id="site-pages">, or on load.
  function renderCards() {
    var cards = document.getElementById('site-pages');
    if (!cards || cards.childNodes.length) return;
    PAGES.forEach(function (p) {
      if (!p.description) return;
      var li = el('li', { class: 'home-card' });
      var h = el('h3');
      h.appendChild(el('a', { href: p.href }, p.title));
      li.appendChild(h);
      li.appendChild(el('p', null, p.description));
      cards.appendChild(li);
    });
  }
  renderCards();
  document.addEventListener('DOMContentLoaded', renderCards);

  // ---------------------------------------------------------------------
  // Scroll jumps: once the page is scrolled down, a "Top" button and the page's sections
  // (every <section id> in <main>, by its h2). On wide screens the sections are a rail in the
  // right margin; otherwise a "Sections" menu next to the Top button. Pages re-render their
  // sections when filtering, so the list is rebuilt whenever <main> changes.
  // Jumps scroll without touching the URL hash, which holds the pages' filter state.
  // ---------------------------------------------------------------------

  function initJumps() {
    var main = document.querySelector('main');
    if (!main || document.getElementById('ui-jump')) return;
    var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var behavior = reduceMotion ? 'auto' : 'smooth';

    var top = el('button', { type: 'button', class: 'ui-jump-top' }, 'Top');
    top.insertBefore(el('span', { 'aria-hidden': 'true' }, '↑ '), top.firstChild);
    var menuList = el('ul');
    var menu = el('div', { class: 'ui-jump-menu' });
    var toggle = el('button', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'ui-jump-list' }, 'Sections');
    var menuNav = el('nav', { id: 'ui-jump-list', 'aria-label': 'Page sections', hidden: '' });
    menuNav.appendChild(menuList);
    menu.appendChild(toggle);
    menu.appendChild(menuNav);
    var dock = el('div', { id: 'ui-jump', class: 'ui-jump', hidden: '' });
    dock.appendChild(menu);
    dock.appendChild(top);

    var railList = el('ul');
    var rail = el('nav', { class: 'ui-rail', 'aria-label': 'Page sections', hidden: '' });
    rail.appendChild(el('p', { class: 'ui-rail-title' }, 'On this page'));
    rail.appendChild(railList);

    document.body.appendChild(rail);
    document.body.appendChild(dock);

    function setOpen(open) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      menuNav.hidden = !open;
    }
    toggle.addEventListener('click', function () { setOpen(menuNav.hidden); });

    var sections = [], signature = '', dirty = true, shown = false, ticking = false;

    function headingOf(sec) {
      var h = sec.querySelector('h2');
      // drop a trailing count, e.g. "Tier 1 (12)"
      return h ? h.textContent.replace(/\s*\(\d+\)\s*$/, '').trim() : '';
    }

    function collect() {
      dirty = false;
      var found = [];
      main.querySelectorAll('section[id]').forEach(function (sec) {
        var title = headingOf(sec);
        if (title && sec.offsetParent !== null) found.push({ el: sec, id: sec.id, title: title });
      });
      var sig = found.map(function (s) { return s.id + '\u0000' + s.title; }).join('\u0001');
      sections = found;
      if (sig === signature) return;
      signature = sig;
      [menuList, railList].forEach(function (list) {
        list.textContent = '';
        found.forEach(function (s) {
          var li = el('li');
          li.appendChild(el('a', { href: '#' + s.id, 'data-id': s.id }, s.title));
          list.appendChild(li);
        });
      });
    }

    function current() {
      var line = 140, cur = null;
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].el.getBoundingClientRect().top <= line) cur = sections[i].id;
        else break;
      }
      return cur;
    }

    function update() {
      ticking = false;
      if (dirty) collect();
      var show = window.scrollY > Math.max(400, window.innerHeight * 0.75);
      if (show !== shown) {
        shown = show;
        dock.hidden = !show;
        if (!show) setOpen(false);
      }
      rail.hidden = !show || !sections.length;
      menu.hidden = !sections.length;
      if (!show) return;
      var cur = current();
      [menuList, railList].forEach(function (list) {
        list.querySelectorAll('a').forEach(function (a) {
          if (a.getAttribute('data-id') === cur) a.setAttribute('aria-current', 'location');
          else a.removeAttribute('aria-current');
        });
      });
    }

    function schedule() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    function jumpTo(id) {
      var target = document.getElementById(id);
      if (!target) return;
      target.scrollIntoView({ behavior: behavior, block: 'start' });
      var h = target.querySelector('h2') || target;
      if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }

    function onLinkClick(e) {
      var a = e.target.closest('a[data-id]');
      if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      setOpen(false);
      jumpTo(a.getAttribute('data-id'));
    }
    menuList.addEventListener('click', onLinkClick);
    railList.addEventListener('click', onLinkClick);

    top.addEventListener('click', function () {
      setOpen(false);
      window.scrollTo({ top: 0, behavior: behavior });
      var name = document.querySelector('.site-name');
      if (name) {
        if (!name.hasAttribute('tabindex')) name.setAttribute('tabindex', '-1');
        name.focus({ preventScroll: true });
      }
    });

    // close the menu on Escape or a click elsewhere
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menuNav.hidden) { setOpen(false); toggle.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (!menuNav.hidden && !menu.contains(e.target)) setOpen(false);
    });

    if (window.MutationObserver) {
      new MutationObserver(function () { dirty = true; schedule(); })
        .observe(main, { childList: true, subtree: true });
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', function () { dirty = true; schedule(); });
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initJumps);
  else initJumps();
})();
