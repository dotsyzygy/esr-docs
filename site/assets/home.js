/* Home page: the current and upcoming terror zones, worked out in the browser (terror-zones.js)
   from the generated rotation data, so they stay right however long ago the site was built. */
(function () {
  'use strict';

  var UPCOMING = 6;
  var section = document.getElementById('tz-section');
  var data = window.ESR_TZ_DATA;
  if (!section || !data || !window.ESRTerrorZones) return;

  var now = document.getElementById('tz-now');
  var countdown = document.getElementById('tz-countdown');
  var next = document.getElementById('tz-next');
  var endsAt = null; // when the page has to work the schedule out again

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  function seconds() { return Math.floor(Date.now() / 1000); }

  function timeOf(unix, withDay) {
    var opts = { hour: 'numeric', minute: '2-digit' };
    if (withDay) opts.weekday = 'short';
    var node = el('time', null, new Date(unix * 1000).toLocaleString([], opts));
    node.dateTime = new Date(unix * 1000).toISOString();
    return node;
  }

  function areaList(zone, cls) {
    var list = el('ul', cls);
    zone.areas.forEach(function (name) { list.appendChild(el('li', null, name)); });
    return list;
  }

  function tick() {
    if (endsAt === null) return;
    var left = endsAt - seconds();
    if (left <= 0) { render(); return; }
    var h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
    countdown.textContent = (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + s + 's';
  }

  function render() {
    var t = seconds();
    var windows = window.ESRTerrorZones.schedule(data.configs, t, UPCOMING + 1);
    var current = windows[0] && windows[0].start <= t ? windows.shift() : null;
    endsAt = current ? current.end : windows.length ? windows[0].start : null;

    now.textContent = '';
    if (current) {
      now.appendChild(areaList(current.zone, 'tz-areas'));
    } else {
      now.appendChild(el('p', null, 'No terror zone right now.'));
    }
    var label = document.getElementById('tz-until');
    label.textContent = '';
    if (endsAt !== null) {
      label.appendChild(document.createTextNode((current ? 'Until ' : 'Starts ')));
      label.appendChild(timeOf(endsAt));
      label.appendChild(document.createTextNode(' · '));
      label.appendChild(countdown);
      label.appendChild(document.createTextNode(' left'));
    }

    next.textContent = '';
    windows.slice(0, UPCOMING).forEach(function (w) {
      var row = el('li');
      row.appendChild(timeOf(w.start, true));
      row.appendChild(areaList(w.zone, 'tz-inline'));
      next.appendChild(row);
    });
    tick();
  }

  section.hidden = false;
  render();
  setInterval(tick, 1000);
})();
