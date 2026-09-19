// board.js — the whiteboard (request #163): the field, the 11 and the defense as things you drag,
// routes and motion as lines with points you bend, the play call, and the glue to rules.js (checked
// on every change), callsheet.js and sim.js. Pointer events throughout, so a finger, the Apple
// Pencil and a mouse all draw. Units on the field are yards (see model.js for the axes).
(function () {
  'use strict';
  var M = window.PBModel, R = window.PBRules, S = window.PBSim, C = window.PBSheet;
  var TOP = 27, BOTTOM = -13;                           // yards of field shown past and behind the line
  var CURRENT = 'playbook.current.v1';
  var ADD_LABELS = ['H', 'R', 'S', 'A', 'B', 'W'];

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function n(v) { return (+v).toFixed(2); }

  var store = C.load(localStorage);
  var play = loadCurrent() || M.newPlay('Trips Left', 'hs', 'M');
  var sel = null;                                       // { kind:'o'|'d', id }
  var mode = null;                                      // 'draw' while a freehand route is being drawn
  var drag = null, lastTap = { h: '', at: 0 };
  var simPos = null, res = R.check(play), editingSheet = false, sim;

  var svg = el('field');
  svg.setAttribute('viewBox', '0 0 ' + n(M.FIELD.width) + ' ' + (TOP - BOTTOM));
  svg.innerHTML = '<g id="g-field"></g><g id="g-lines"></g><g id="g-def"></g><g id="g-men"></g><g id="g-handles"></g>';

  function loadCurrent() {
    try { var p = JSON.parse(localStorage.getItem(CURRENT) || 'null'); return p && Array.isArray(p.players) && p.call ? p : null; } catch (e) { return null; }
  }
  function keep() { try { localStorage.setItem(CURRENT, JSON.stringify(play)); } catch (e) { /* private mode: the board still works */ } }
  function bx() { return M.ballX(play.level, play.ball); }
  function X(x) { return n(bx() + x); }
  function Y(y) { return n(TOP - y); }
  function man(id) { for (var i = 0; i < play.players.length; i++) if (play.players[i].id === id) return play.players[i]; return null; }
  function defender(id) { for (var i = 0; i < play.defense.length; i++) if (play.defense[i].id === id) return play.defense[i]; return null; }
  function selMan() { return sel && sel.kind === 'o' ? man(sel.id) : null; }

  // ---- drawing ----------------------------------------------------------------------------------
  function drawField() {
    var W = M.FIELD.width, h = M.LEVELS[play.level].hash, s = '', y;
    for (y = Math.ceil(BOTTOM / 5) * 5; y <= TOP; y += 5)
      s += '<line class="yl' + (y === 0 ? ' los' : '') + '" x1="0" x2="' + n(W) + '" y1="' + Y(y) + '" y2="' + Y(y) + '"/>';
    for (y = BOTTOM + 1; y < TOP; y++) [h, W - h].forEach(function (hx) {
      s += '<line class="hash" x1="' + n(hx - 0.35) + '" x2="' + n(hx + 0.35) + '" y1="' + Y(y) + '" y2="' + Y(y) + '"/>';
    });
    for (y = -10; y <= TOP; y += 10) [M.FIELD.numbers, W - M.FIELD.numbers].forEach(function (nx) {
      s += '<line class="hash" x1="' + n(nx) + '" x2="' + n(nx) + '" y1="' + Y(y + 0.6) + '" y2="' + Y(y - 0.6) + '"/>';
    });
    s += '<rect class="side" x="0.17" y="0.17" width="' + n(W - 0.34) + '" height="' + n(TOP - BOTTOM - 0.34) + '"/>';
    s += '<text class="fnote" x="0.8" y="' + Y(0.4) + '">line of scrimmage</text>';
    s += '<text class="fnote" x="0.8" y="1.6">' + esc(M.LEVELS[play.level].book + ' hash marks · ' + M.SPOTS[play.ball].toLowerCase()) + '</text>';
    s += '<ellipse cx="' + X(0) + '" cy="' + Y(0.45) + '" rx="0.32" ry="0.5" fill="#7c4a21"/>';
    el('g-field').innerHTML = s;
  }

  function polyline(ox, oy, pts, cls) {
    return '<polyline class="route ' + cls + '" points="' + [[0, 0]].concat(pts).map(function (q) { return X(ox + q[0]) + ',' + Y(oy + q[1]); }).join(' ') + '"/>';
  }
  function tip(ox, oy, pts, end, cls) {                 // arrowhead, or the bar of a block
    var e = pts[pts.length - 1], p = pts.length > 1 ? pts[pts.length - 2] : [0, 0];
    var dx = e[0] - p[0], dy = e[1] - p[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    var ex = ox + e[0], ey = oy + e[1];
    if (end === 'block')
      return '<line class="route block" x1="' + X(ex - uy * 0.9) + '" y1="' + Y(ey + ux * 0.9) + '" x2="' + X(ex + uy * 0.9) + '" y2="' + Y(ey - ux * 0.9) + '"/>';
    return '<path class="tip ' + cls + '" d="M' + X(ex + ux * 0.9) + ' ' + Y(ey + uy * 0.9) + 'L' + X(ex - uy * 0.55) + ' ' + Y(ey + ux * 0.55) +
      'L' + X(ex + uy * 0.55) + ' ' + Y(ey - ux * 0.55) + 'Z"/>';
  }
  function manShape(p, x, y, cls, hit) {
    var lineman = p.num >= 50 && p.num <= 79, r = lineman ? 0.75 : 0.95;
    var body = p.id === 'C' ? '<rect x="' + n(+X(x) - 0.75) + '" y="' + n(+Y(y) - 0.75) + '" width="1.5" height="1.5"/>'
                            : '<circle cx="' + X(x) + '" cy="' + Y(y) + '" r="' + r + '"/>';
    return '<g class="man ' + cls + '">' + body + '<text x="' + X(x) + '" y="' + Y(y) + '">' + esc(p.label) + '</text>' +
      (hit ? '<text class="num" x="' + X(x) + '" y="' + n(+Y(y) + 1.45) + '">' + esc(p.num) + '</text>' +
             '<circle class="hit" data-id="' + esc(p.id) + '" cx="' + X(x) + '" cy="' + Y(y) + '" r="1.6"/>' : '') + '</g>';
  }

  function drawPlay() {
    var lines = '', men = '', defs = '', handles = '', bad = {};
    res.errors.forEach(function (e) { e.ids.forEach(function (id) { bad[id] = 1; }); });
    play.players.forEach(function (p) {
      var sp = M.snapPos(p), moving = p.motion && p.motion.pts.length;
      if (moving) lines += polyline(p.x, p.y, p.motion.pts, 'motion') + tip(p.x, p.y, p.motion.pts, 'arrow', 'motion');
      if (p.route && p.route.pts.length) lines += polyline(sp.x, sp.y, p.route.pts, p.route.end === 'block' ? 'block' : '') + tip(sp.x, sp.y, p.route.pts, p.route.end, '');
      var cls = (bad[p.id] ? 'bad ' : '') + (res.why[p.id] === 'covered' ? 'cov ' : '') + (sel && sel.kind === 'o' && sel.id === p.id ? 'sel' : '');
      if (simPos) men += manShape(p, simPos[p.id].x, simPos[p.id].y, cls, false);
      else {
        if (moving) men += manShape(p, sp.x, sp.y, 'shadow', false);   // where he is at the snap
        men += manShape(p, p.x, p.y, cls, true);
      }
    });
    play.defense.forEach(function (d) {
      var x = +X(d.x), y = +Y(d.y);
      defs += '<g class="def' + (sel && sel.kind === 'd' && sel.id === d.id ? ' sel' : '') + '"><path d="M' + n(x - 0.95) + ' ' + n(y - 0.8) + 'L' + n(x + 0.95) + ' ' + n(y - 0.8) + 'L' + n(x) + ' ' + n(y + 0.95) + 'Z"/>' +
        '<text x="' + n(x) + '" y="' + n(y - 0.2) + '" style="font-size:.8px">' + esc(d.label) + '</text>' +
        '<circle class="hit" data-d="' + esc(d.id) + '" cx="' + n(x) + '" cy="' + n(y) + '" r="1.5"/></g>';
    });
    var p = selMan();
    if (p && !simPos) {
      var sp = M.snapPos(p);
      var dots = function (ox, oy, pts, tag, cls) {
        var px = 0, py = 0;
        pts.forEach(function (q, i) {
          handles += '<circle class="handle mid" cx="' + X(ox + (px + q[0]) / 2) + '" cy="' + Y(oy + (py + q[1]) / 2) + '" r="0.36"/>' +
            '<circle class="hit" data-h="' + tag + 'm:' + i + '" cx="' + X(ox + (px + q[0]) / 2) + '" cy="' + Y(oy + (py + q[1]) / 2) + '" r="0.9"/>';
          px = q[0]; py = q[1];
        });
        pts.forEach(function (q, i) {
          handles += '<circle class="handle ' + cls + '" cx="' + X(ox + q[0]) + '" cy="' + Y(oy + q[1]) + '" r="0.55"/>' +
            '<circle class="hit" data-h="' + tag + ':' + i + '" cx="' + X(ox + q[0]) + '" cy="' + Y(oy + q[1]) + '" r="1.3"/>';
        });
      };
      if (p.route && p.route.pts.length) dots(sp.x, sp.y, p.route.pts, 'r', '');
      if (p.motion && p.motion.pts.length) dots(p.x, p.y, p.motion.pts, 'm', 'motion');
    }
    if (drag && drag.kind === 'stroke') lines += '<polyline class="route ghost" points="' + drag.pts.map(function (q) { return X(q[0]) + ',' + Y(q[1]); }).join(' ') + '"/>';
    el('g-lines').innerHTML = lines; el('g-men').innerHTML = men; el('g-def').innerHTML = defs; el('g-handles').innerHTML = handles;
    svg.classList.toggle('illegal', !res.legal);
    svg.classList.toggle('drawing', mode === 'draw');
  }

  function drawLegal() {
    var box = el('legal'), byId = {};
    play.players.forEach(function (p) { byId[p.id] = p.label; });
    box.className = 'tray ' + (res.legal ? 'ok' : 'no');
    var elig = play.players.filter(function (p) { return res.eligible[p.id]; }).map(function (p) { return p.label; }).join(' ');
    box.innerHTML = '<div class="verdict">' + (res.legal ? '&#10003; Legal formation' : '&#10005; Illegal: cannot go on the sheet') + ' <small>' + esc(res.book) + '</small></div>' +
      (res.errors.length || res.warnings.length ? '<ul>' + res.errors.map(function (e) { return '<li>' + esc(e.msg) + '</li>'; }).join('') +
        res.warnings.map(function (w) { return '<li class="w">' + esc(w.msg) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="count">' + res.line.length + ' on the line &middot; ' + res.backs.length + ' backs &middot; eligible: ' + esc(elig || 'nobody') +
      (play.defense.length ? ' &middot; ' + play.defense.length + ' on defense' : '') + '</div>';
    el('save').disabled = !res.legal;
    el('save').textContent = play.id ? 'Save changes' : 'Save to sheet';
  }

  function drawCall() {
    var built = M.callString(play.call);
    el('callbig').textContent = M.playName(play) || 'No call yet';
    el('c-name').placeholder = built || 'built from the four above';
  }
  function fillCall() {
    el('c-formation').value = play.call.formation || ''; el('c-motion').value = play.call.motion || '';
    el('c-play').value = play.call.play || ''; el('c-tags').value = play.call.tags || '';
    el('c-name').value = play.nameEdited ? play.name : '';
    el('situations').innerHTML = M.SITUATIONS.map(function (s) {
      return '<button data-s="' + esc(s) + '" class="' + (play.situations.indexOf(s) !== -1 ? 'on' : '') + '">' + esc(s) + '</button>';
    }).join('');
    drawCall();
  }
  function fillBar() {
    [].forEach.call(el('level').children, function (b) { b.classList.toggle('on', b.getAttribute('data-v') === play.level); });
    [].forEach.call(el('spot').children, function (b) { b.classList.toggle('on', b.getAttribute('data-v') === play.ball); });
    el('formation').value = M.FORMATIONS[play.formation] ? play.formation : '';
    el('defense').value = play.defenseName || (play.defense.length ? '' : 'None');
    el('sheetcount').textContent = store.plays.length ? '(' + store.plays.length + ')' : '';
  }

  function drawInspector() {
    var box = el('inspector'), p = selMan(), d = sel && sel.kind === 'd' ? defender(sel.id) : null, h;
    if (p) {
      var onLine = res.line.indexOf(p.id) !== -1;
      var status = res.eligible[p.id] ? 'eligible' : 'not eligible (' + (res.why[p.id] || '') + ')';
      h = '<h2>Player ' + esc(p.label) + ' <small>' + esc(status) + '</small></h2>' +
        '<div class="field2"><span>Letter</span><input type="text" id="i-label" maxlength="2" value="' + esc(p.label) + '">' +
        '<span>Number</span><input type="number" id="i-num" min="0" max="99" inputmode="numeric" value="' + esc(p.num) + '"></div>' +
        '<div class="rowbtns"><button data-a="online" class="' + (onLine ? 'on' : '') + '">On the line</button>' +
        '<button data-a="offline" class="' + (onLine ? '' : 'on') + '">Off the line</button></div>' +
        '<h2 style="margin-top:12px">Route tree <small>' + esc(M.routeName(p.route) || 'no route') + '</small></h2><div class="tree">' +
        M.ROUTES.filter(function (r) { return /^\d$/.test(r.key); }).map(function (r) {
          return '<button data-r="' + r.key + '" class="' + (p.route && p.route.type === r.key ? 'on' : '') + '"><b>' + r.key + '</b>' + esc(r.name) + '</button>';
        }).join('') + '</div><div class="tree wide">' +
        ['flat', 'wheel', 'block'].map(function (k) { return '<button data-r="' + k + '" class="' + (p.route && p.route.type === k ? 'on' : '') + '">' + esc(M.routeDef(k).name) + '</button>'; }).join('') +
        '<button data-a="motion" class="' + (p.motion ? 'on' : '') + '">Motion</button>' +
        '<button data-a="draw" class="' + (mode === 'draw' ? 'on' : '') + '">Draw it</button>' +
        '<button data-a="fliproute"' + (p.route ? '' : ' disabled') + '>Flip route</button>' +
        '<button data-a="clearroute"' + (p.route ? '' : ' disabled') + '>Clear route</button>' +
        '<button data-a="clearmotion"' + (p.motion ? '' : ' disabled') + '>Clear motion</button>' +
        '<button data-a="removeman">Remove player</button></div>' +
        '<p class="hint">' + (mode === 'draw' ? 'Draw the route on the field with your finger or the Pencil, starting at ' + esc(p.label) + '.'
          : 'Drag a gold dot to bend a line, drag a small dot to add a bend, double-tap a dot to take it out.') + '</p>';
    } else if (d) {
      h = '<h2>Defender</h2><div class="field2"><span>Letter</span><input type="text" id="i-dlabel" maxlength="2" value="' + esc(d.label) + '"></div>' +
        '<div class="rowbtns"><button data-a="removedef">Remove defender</button></div>';
    } else {
      h = '<h2>Players</h2><p class="hint" style="margin-top:0">Tap a player to give him a route or motion. Drag anyone to move him: the rules are checked as you drag.</p>' +
        '<div class="rowbtns"><button data-a="addman">Add player</button><button data-a="adddef">Add defender</button></div>';
    }
    box.innerHTML = h;
  }

  function refresh() { res = R.check(play); drawPlay(); drawLegal(); drawCall(); keep(); }        // cheap: safe while typing or dragging
  function renderAll() { res = R.check(play); drawField(); drawPlay(); drawLegal(); fillBar(); fillCall(); drawInspector(); if (sim) sim.refresh(); keep(); }
  function say(text, bad) { var m = el('msg'); m.textContent = text || ''; m.className = bad ? 'bad' : ''; }
  function setPlay(p) { play = p; if (!play.defense) play.defense = []; if (!play.situations) play.situations = []; sel = null; mode = null; if (sim) sim.reset(); renderAll(); }

  // ---- pointer: drag players, bend lines, draw freehand -----------------------------------------
  function at(e) {
    var q = svg.createSVGPoint(); q.x = e.clientX; q.y = e.clientY;
    q = q.matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x - bx(), y: TOP - q.y };
  }
  function inView(x, y) { return [Math.min(Math.max(x, 0.5 - bx()), M.FIELD.width - 0.5 - bx()), Math.min(Math.max(y, BOTTOM + 0.5), TOP - 0.5)]; }

  svg.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return;
    e.preventDefault();
    if (sim.active()) sim.reset();
    var q = at(e), t = e.target.closest ? e.target.closest('[data-h],[data-id],[data-d]') : null, p = selMan();
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* old Safari */ }
    if (mode === 'draw' && p) { drag = { kind: 'stroke', pts: [[q.x, q.y]] }; return; }
    if (t && t.hasAttribute('data-h')) {                 // in a bunch a handle can sit on a teammate: the man under the finger wins
      var under = play.players.filter(function (m) { return m !== p && Math.hypot(q.x - m.x, q.y - m.y) < 1; })[0];
      if (under) t = svg.querySelector('[data-id="' + under.id + '"]');
    }
    if (t && t.hasAttribute('data-h') && p) {
      var h = t.getAttribute('data-h'), parts = h.split(':'), i = +parts[1], which = parts[0].charAt(0) === 'r' ? 'route' : 'motion';
      if (parts[0].length === 2) {                       // a small dot: put a new point in and drag it
        var base = which === 'route' ? M.snapPos(p) : p;
        p[which].pts.splice(i, 0, [q.x - base.x, q.y - base.y]);
      } else if (lastTap.h === h && Date.now() - lastTap.at < 400) {   // double-tap: take the point out
        p[which].pts.splice(i, 1);
        if (!p[which].pts.length) p[which] = null;
        lastTap.h = ''; renderAll(); return;
      }
      lastTap = { h: h, at: Date.now() };
      drag = { kind: 'handle', which: which, i: i };
    } else if (t && t.hasAttribute('data-id')) {
      var m = man(t.getAttribute('data-id'));
      sel = { kind: 'o', id: m.id }; drag = { kind: 'man', id: m.id, dx: q.x - m.x, dy: q.y - m.y };
      drawInspector();
    } else if (t && t.hasAttribute('data-d')) {
      var d = defender(t.getAttribute('data-d'));
      sel = { kind: 'd', id: d.id }; drag = { kind: 'def', id: d.id, dx: q.x - d.x, dy: q.y - d.y };
      drawInspector();
    } else { sel = null; drawInspector(); }
    drawPlay();
  });
  svg.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var q = at(e), p;
    if (drag.kind === 'stroke') { drag.pts.push(inView(q.x, q.y)); drawPlay(); return; }
    if (drag.kind === 'man') {
      p = man(drag.id);
      p.x = M.clampX(q.x - drag.dx, play.level, play.ball);
      p.y = Math.max(R.snapDepth(Math.min(q.y - drag.dy, 0)), BOTTOM + 1);
    } else if (drag.kind === 'def') {
      var d = defender(drag.id), v = inView(q.x - drag.dx, Math.max(q.y - drag.dy, 0.8));
      d.x = v[0]; d.y = v[1]; play.defenseName = '';
    } else if (drag.kind === 'handle') {
      p = selMan(); if (!p || !p[drag.which]) return;
      var base = drag.which === 'route' ? M.snapPos(p) : p, w = inView(q.x, q.y);
      if (drag.which === 'motion') w[1] = Math.min(w[1], 0);          // motion stays behind the line
      p[drag.which].pts[drag.i] = [w[0] - base.x, w[1] - base.y];
    }
    refresh();
  });
  function finish() {
    if (!drag) return;
    var p = selMan();
    if (drag.kind === 'stroke' && p) {
      var sp = M.snapPos(p), pts = M.simplify(drag.pts, 0.6).map(function (q) { return [q[0] - sp.x, q[1] - sp.y]; });
      if (pts.length && Math.hypot(pts[0][0], pts[0][1]) < 2) pts.shift();      // he started on the player
      if (pts.length && M.pathLength(pts) > 1.5) p.route = { type: 'free', end: 'arrow', pts: pts };
      mode = null;
    }
    drag = null; renderAll();
  }
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);

  // ---- the inspector ----------------------------------------------------------------------------
  el('inspector').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    var p = selMan(), a = b.getAttribute('data-a'), r = b.getAttribute('data-r');
    sim.reset();
    if (r && p) { p.route = M.buildRoute(p, r); mode = null; }
    else if (a === 'motion' && p) {
      if (!p.motion) { p.motion = M.defaultMotion(p); if (!play.call.motion) play.call.motion = M.suggestMotion(play); }
    }
    else if (a === 'draw' && p) mode = mode === 'draw' ? null : 'draw';
    else if (a === 'fliproute' && p && p.route) p.route.pts = p.route.pts.map(function (q) { return [-q[0], q[1]]; });
    else if (a === 'clearroute' && p) p.route = null;
    else if (a === 'clearmotion' && p) { if (play.call.motion === M.suggestMotion(play)) play.call.motion = ''; p.motion = null; }
    else if (a === 'online' && p) p.y = 0;
    else if (a === 'offline' && p) { if (p.y > R.BACK) p.y = R.BACK; }
    else if (a === 'removeman' && p) { play.players = play.players.filter(function (m) { return m !== p; }); sel = null; }
    else if (a === 'removedef' && sel) { play.defense = play.defense.filter(function (d) { return d.id !== sel.id; }); play.defenseName = ''; sel = null; }
    else if (a === 'addman') {
      var label = ADD_LABELS.filter(function (l) { return !man(l); })[0] || 'P' + (play.players.length + 1);
      play.players.push({ id: label, label: label, num: 80 + play.players.length % 10, x: M.clampX(6, play.level, play.ball), y: -3, route: null, motion: null });
      sel = { kind: 'o', id: label };
    }
    else if (a === 'adddef') {
      var k = 1; while (defender('D' + k)) k++;
      play.defense.push({ id: 'D' + k, label: 'D', x: 0, y: 6 }); play.defenseName = ''; sel = { kind: 'd', id: 'D' + k };
    }
    renderAll();
  });
  el('inspector').addEventListener('input', function (e) {
    var p = selMan(), d = sel && sel.kind === 'd' ? defender(sel.id) : null;
    if (e.target.id === 'i-label' && p) p.label = e.target.value.toUpperCase().slice(0, 2) || p.id;
    if (e.target.id === 'i-num' && p) p.num = Math.min(Math.max(parseInt(e.target.value, 10) || 0, 0), 99);
    if (e.target.id === 'i-dlabel' && d) d.label = e.target.value.toUpperCase().slice(0, 2);
    refresh();
  });

  // ---- the bar and the call ---------------------------------------------------------------------
  el('formation').innerHTML = '<option value="">Custom</option>' + Object.keys(M.FORMATIONS).map(function (f) { return '<option>' + esc(f) + '</option>'; }).join('');
  el('defense').innerHTML = '<option value="">Custom</option>' + Object.keys(M.DEFENSES).map(function (f) { return '<option>' + esc(f) + '</option>'; }).join('');
  el('level').addEventListener('click', function (e) { var v = e.target.getAttribute('data-v'); if (v) { sim.reset(); M.moveBall(play, v, play.ball); renderAll(); } });
  el('spot').addEventListener('click', function (e) { var v = e.target.getAttribute('data-v'); if (v) { sim.reset(); M.moveBall(play, play.level, v); renderAll(); } });
  el('formation').addEventListener('change', function () { if (this.value) { sim.reset(); sel = null; M.setFormation(play, this.value); renderAll(); } });
  el('defense').addEventListener('change', function () {
    if (!M.DEFENSES[this.value]) return;
    sim.reset(); sel = null; play.defenseName = this.value;
    play.defense = M.clone(M.DEFENSES[this.value]).map(function (d) { d.x = M.clampX(d.x, play.level, play.ball); return d; });
    renderAll();
  });
  el('flip').addEventListener('click', function () { sim.reset(); M.flipPlay(play); renderAll(); });
  el('new').addEventListener('click', function () { setPlay(M.newPlay(M.FORMATIONS[play.formation] ? play.formation : 'Trips Left', play.level, play.ball)); say('New play.'); });

  ['formation', 'motion', 'play', 'tags'].forEach(function (k) {
    el('c-' + k).addEventListener('input', function () { play.call[k] = this.value; if (k === 'formation') play.formation = this.value.trim() || play.formation; drawCall(); keep(); });
  });
  el('c-name').addEventListener('input', function () { play.name = this.value; play.nameEdited = !!this.value.trim(); drawCall(); keep(); });
  el('situations').addEventListener('click', function (e) {
    var s = e.target.getAttribute('data-s'); if (!s) return;
    var i = play.situations.indexOf(s); if (i === -1) play.situations.push(s); else play.situations.splice(i, 1);
    fillCall(); keep();
  });
  el('save').addEventListener('click', function () {
    var out = C.savePlay(store, play);
    if (!out.ok) { say(out.errors[0].msg, true); return; }
    C.persist(localStorage, store); play.id = out.play.id; play.no = out.play.no;
    renderAll(); say('Saved as #' + out.play.no + ' on the call sheet.');
  });
  el('dupe').addEventListener('click', function () {
    play.id = ''; delete play.no; play.call.tags = (play.call.tags ? play.call.tags + ' ' : '') + 'adj';
    if (play.nameEdited) play.name += ' adj';
    renderAll(); say('This is a copy. Adjust it, then save it as a new play.');
  });

  // ---- the call sheet ---------------------------------------------------------------------------
  function drawSheet(note) {
    el('sheetsum').textContent = note || (store.plays.length + ' play' + (store.plays.length === 1 ? '' : 's') + ' on this iPad');
    el('sheetedit').classList.toggle('on', editingSheet);
    C.render(el('sheetbody'), store, editingSheet, {
      open: function (p) { setPlay(M.clone(p)); showSheet(false); say('Loaded #' + p.no + '.'); },
      duplicate: function (p) {
        var copy = C.duplicate(store, p.id); C.persist(localStorage, store);
        setPlay(M.clone(copy)); showSheet(false); say('Copy of #' + p.no + ' saved as #' + copy.no + '. Adjust it and save the changes.');
      },
      remove: function (p) {
        if (!window.confirm('Delete #' + p.no + ' ' + p.name + ' from the call sheet?')) return;
        C.remove(store, p.id); C.persist(localStorage, store); if (play.id === p.id) { play.id = ''; delete play.no; }
        renderAll(); drawSheet();
      }
    });
  }
  function showSheet(open) { el('sheet').classList.toggle('open', open); el('sheet').setAttribute('aria-hidden', open ? 'false' : 'true'); if (open) { sim.pause(); drawSheet(); } }
  el('opensheet').addEventListener('click', function () { showSheet(true); });
  el('closesheet').addEventListener('click', function () { showSheet(false); });
  el('sheetedit').addEventListener('click', function () { editingSheet = !editingSheet; drawSheet(); });
  el('export').addEventListener('click', function () {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([C.exportJSON(store)], { type: 'application/json' }));
    a.download = 'playbook-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  });
  el('import').addEventListener('click', function () { el('importfile').click(); });
  el('importfile').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    var rd = new FileReader(), input = this;
    rd.onload = function () {
      try {
        var rep = C.importJSON(store, String(rd.result)); C.persist(localStorage, store); fillBar();
        drawSheet(rep.added + ' added, ' + rep.updated + ' updated' + (rep.skipped.length ? ', ' + rep.skipped.length + ' skipped (' +
          rep.skipped.map(function (s) { return s.name + ': ' + s.reason; }).join('; ') + ')' : ''));
      } catch (err) { drawSheet(err.message); }
      input.value = '';
    };
    rd.readAsText(f);
  });

  // ---- the simulator ----------------------------------------------------------------------------
  sim = S.attach({ getPlay: function () { return play; }, button: el('simplay'), scrub: el('simscrub'), clock: el('clock'),
    onFrame: function (pos) { simPos = pos; drawPlay(); } });
  el('simreset').addEventListener('click', function () { sim.reset(); });

  renderAll();
  window.PBBoard = { play: function () { return play; }, setPlay: setPlay, store: function () { return store; } };   // for the console and for tests
})();
