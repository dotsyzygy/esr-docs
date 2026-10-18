/* Site navigation, shared by every page. Each page has an empty
   <nav id="site-nav"> in its header followed by this script, which fills it in
   synchronously (so there is no layout shift). The home page also has an empty
   <ul id="site-pages">, which gets a card for every page with a description.
   To add a page, add it to PAGES. */
(function () {
  'use strict';

  var PAGES = [
    { href: 'index.html', title: 'Home' },
    {
      href: 'cube-recipes.html', title: 'Cube Recipes',
      description: 'Every Horadric Cube recipe: crafting, rerolls, upgrades, forging, sockets, runes and gems, searchable by item, rune or mod.'
    },
    {
      href: 'skills.html', title: 'Skills',
      description: 'Every class skill tree plus the oskills items grant, with values at any skill level and character level up to 110.'
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
})();
