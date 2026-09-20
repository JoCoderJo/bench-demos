// callsheet.js — the call sheet (request #163): saved plays in a grid, formation down the side and
// situation across the top, like a Madden play-call screen. Tap a play to put it on the board.
// Plays live on the iPad (localStorage); Export writes them to a file and Import reads one back,
// because clearing Safari's data would otherwise lose the playbook.
//
// The store is { v:1, seq:<last sheet number>, plays:[play, ...] }. Only legal plays get in:
// savePlay and importJSON both run rules.js first.
(function (root) {
  'use strict';
  var node = typeof module !== 'undefined' && module.exports;
  var M = node ? require('./model.js') : root.PBModel;
  var R = node ? require('./rules.js') : root.PBRules;

  var KEY = 'playbook.sheet.v1';
  var ANY = 'Any down';                                 // the column for plays with no situation

  function empty() { return { v: 1, seq: 0, plays: [] }; }
  function load(storage) {
    try {
      var s = JSON.parse(storage.getItem(KEY) || 'null');
      if (s && s.v === 1 && Array.isArray(s.plays)) return s;
    } catch (e) { /* a damaged store starts over; the export file is the backup */ }
    return empty();
  }
  function persist(storage, store) { storage.setItem(KEY, JSON.stringify(store)); }

  function find(store, id) { for (var i = 0; i < store.plays.length; i++) if (store.plays[i].id === id) return store.plays[i]; return null; }

  // Returns { ok:true, play } or { ok:false, errors:[...] }. A play with an id is updated in place.
  function savePlay(store, play) {
    var res = R.check(play);
    if (!res.legal) return { ok: false, errors: res.errors };
    var copy = M.clone(play);
    copy.name = M.playName(copy);
    if (!copy.name) return { ok: false, errors: [{ code: 'name', msg: 'Give the play a call first.', ids: [] }] };
    var old = copy.id ? find(store, copy.id) : null;
    if (old) { copy.no = old.no; store.plays[store.plays.indexOf(old)] = copy; }
    else { store.seq += 1; copy.no = store.seq; copy.id = 'p' + store.seq + '-' + Date.now().toString(36); store.plays.push(copy); }
    copy.saved = new Date().toISOString();
    return { ok: true, play: copy };
  }
  // A copy to adjust: same picture and slots, new sheet number, "adj" in the tags.
  function duplicate(store, id) {
    var src = find(store, id); if (!src) return null;
    var copy = M.clone(src);
    copy.id = ''; copy.call.tags = (copy.call.tags ? copy.call.tags + ' ' : '') + 'adj';
    if (copy.nameEdited) copy.name = copy.name + ' adj';
    return savePlay(store, copy).play;
  }
  function remove(store, id) { store.plays = store.plays.filter(function (p) { return p.id !== id; }); }

  // rows: one per formation, in the order the presets list them, then anything else by name.
  function grid(store) {
    var cols = M.SITUATIONS.concat([ANY]), order = Object.keys(M.FORMATIONS), rows = {};
    store.plays.forEach(function (p) {
      var row = rows[p.formation] || (rows[p.formation] = { formation: p.formation, cells: {}, count: 0 });
      var slots = p.situations && p.situations.length ? p.situations : [ANY];
      slots.forEach(function (s) { if (cols.indexOf(s) === -1) s = ANY; (row.cells[s] || (row.cells[s] = [])).push(p); });
      row.count += 1;
    });
    var list = Object.keys(rows).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    }).map(function (k) { return rows[k]; });
    list.forEach(function (row) { cols.forEach(function (c) { (row.cells[c] || []).sort(function (a, b) { return a.no - b.no; }); }); });
    return { cols: cols, rows: list };
  }

  function exportJSON(store) { return JSON.stringify({ app: 'the-playbook', v: 1, exported: new Date().toISOString(), plays: store.plays }, null, 1); }
  // Merges a file into the store: a play with a known id is replaced, a new one is added. A play
  // that is not legal under its own rule set is skipped and named in the report.
  function importJSON(store, text) {
    var report = { added: 0, updated: 0, skipped: [] }, data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('That file is not a playbook export (not JSON).'); }
    if (!data || data.app !== 'the-playbook' || !Array.isArray(data.plays)) throw new Error('That file is not a playbook export.');
    data.plays.forEach(function (p) {
      var name = (p && p.name) || 'unnamed';
      if (!p || !Array.isArray(p.players) || !p.call) { report.skipped.push({ name: name, reason: 'not a play' }); return; }
      var res = R.check(p);
      if (!res.legal) { report.skipped.push({ name: name, reason: res.errors[0].msg }); return; }
      var old = p.id ? find(store, p.id) : null, copy = M.clone(p);
      if (old) { copy.no = old.no; store.plays[store.plays.indexOf(old)] = copy; report.updated += 1; }
      else { store.seq += 1; copy.no = store.seq; if (!copy.id) copy.id = 'p' + store.seq + '-' + Date.now().toString(36); store.plays.push(copy); report.added += 1; }
    });
    return report;
  }

  // ---- play art: a small picture of the play, as an SVG string ----------------------------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  // defense = true draws the scheme with it (#166): zones, man lines and the defenders, all faint.
  function artSVG(play, defense) {
    var W = 44, top = 20, bottom = -9, xs = [];
    play.players.forEach(function (p) { xs.push(M.snapPos(p).x); xs.push(p.x); });
    var mid = xs.length ? (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2 : 0;
    function X(x) { return (x - mid + W / 2).toFixed(2); }
    function Y(y) { return (top - Math.min(y, top - 0.5)).toFixed(2); }
    var s = '<svg class="art" viewBox="0 0 ' + W + ' ' + (top - bottom) + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<line x1="0" x2="' + W + '" y1="' + Y(0) + '" y2="' + Y(0) + '" class="a-los"/>';
    if (defense && play.defense && play.defense.length) {
      var jobs = M.coverage(play), spot = {};
      play.players.forEach(function (p) { spot[p.id] = M.snapPos(p); });
      play.defense.forEach(function (d) {
        var job = jobs[d.id], z = job.shape, t = job.target && spot[job.target];
        if (z) s += '<rect class="a-zone" x="' + X(z.x - z.w / 2) + '" y="' + (top - z.y - z.h / 2).toFixed(2) + '" width="' + z.w.toFixed(2) + '" height="' + z.h.toFixed(2) + '" rx="2"/>';
        if (t) s += '<line class="a-manline" x1="' + X(d.x) + '" y1="' + Y(d.y) + '" x2="' + X(t.x) + '" y2="' + Y(t.y) + '"/>';
      });
      play.defense.forEach(function (d) {
        var x = +X(d.x), y = +Y(d.y);
        s += '<path class="a-def" d="M' + (x - 0.8).toFixed(2) + ' ' + (y - 0.7).toFixed(2) + 'L' + (x + 0.8).toFixed(2) + ' ' + (y - 0.7).toFixed(2) + 'L' + x.toFixed(2) + ' ' + (y + 0.8).toFixed(2) + 'Z"/>';
      });
    }
    play.players.forEach(function (p) {
      var sp = M.snapPos(p);
      function poly(ox, oy, pts, cls) {
        return '<polyline class="' + cls + '" points="' + [[0, 0]].concat(pts).map(function (q) { return X(ox + q[0]) + ',' + Y(oy + q[1]); }).join(' ') + '"/>';
      }
      if (p.motion && p.motion.pts.length) s += poly(p.x, p.y, p.motion.pts, 'a-motion');
      if (p.route && p.route.pts.length) s += poly(sp.x, sp.y, p.route.pts, p.route.end === 'block' ? 'a-block' : 'a-route');
    });
    play.players.forEach(function (p) {
      s += '<circle class="a-man" cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="' + (p.num >= 50 && p.num <= 79 ? 0.7 : 0.95) + '"/>';
    });
    return s + '</svg>';
  }

  // ---- the sheet on screen (browser only) -------------------------------------------------------
  // handlers: { open(play), duplicate(play), remove(play) }; defense = draw each play's scheme on its card
  function render(container, store, editing, handlers, defense) {
    var g = grid(store);
    if (!g.rows.length) {
      container.innerHTML = '<p class="sheet-empty">No plays yet. Build one on the board and press <b>Save to sheet</b>.</p>';
      return;
    }
    var h = '<table class="sheet"><thead><tr><th>Formation</th>' + g.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
    g.rows.forEach(function (row) {
      h += '<tr><th class="form">' + esc(row.formation) + '<small>' + row.count + ' play' + (row.count === 1 ? '' : 's') + '</small></th>';
      g.cols.forEach(function (c) {
        h += '<td>' + (row.cells[c] || []).map(function (p) {
          return '<div class="tile" data-id="' + esc(p.id) + '"><button class="open" data-act="open">' + artSVG(p, defense) +
            '<span class="no">' + esc(p.no) + '</span><span class="nm">' + esc(p.name) + '</span>' +
            '<span class="lv">' + esc(M.LEVELS[p.level === 'college' ? 'college' : 'hs'].book) + '</span></button>' +
            (editing ? '<span class="tools"><button data-act="duplicate">Duplicate</button><button data-act="remove">Delete</button></span>' : '') + '</div>';
        }).join('') + '</td>';
      });
      h += '</tr>';
    });
    container.innerHTML = h + '</tbody></table>';
    container.onclick = function (e) {
      var b = e.target.closest('button[data-act]'), t = b && b.closest('.tile'); if (!t) return;
      var p = find(store, t.getAttribute('data-id')); if (p && handlers[b.getAttribute('data-act')]) handlers[b.getAttribute('data-act')](p);
    };
  }

  var api = { KEY: KEY, ANY: ANY, empty: empty, load: load, persist: persist, find: find, savePlay: savePlay, duplicate: duplicate,
    remove: remove, grid: grid, exportJSON: exportJSON, importJSON: importJSON, artSVG: artSVG, render: render };
  if (node) module.exports = api;
  root.PBSheet = api;
})(typeof window !== 'undefined' ? window : globalThis);
