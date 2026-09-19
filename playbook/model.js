// model.js — the play as data (request #163): field sizes, formation presets, the route tree,
// the play call string and the path helpers. No DOM in here, so node can test it (tests/).
//
// Coordinates are yards. x is measured from the ball (negative = the offense's left), y from the
// line of scrimmage (positive = downfield, negative = backfield). A play does not care which hash
// the ball is on until it is drawn: the ball spot only moves the whole picture sideways.
//
// A player's route points are relative to where he is AT THE SNAP, his motion points are relative
// to where he first gets SET, so dragging a player carries his lines with him.
(function (root) {
  'use strict';

  var FIELD = { width: 160 / 3, numbers: 9 };          // 53 1/3 yd wide; 9-yard marks (top of the numbers)
  // Hash marks, measured from each sideline. NFHS 1-2-3: the field in thirds (53 ft 4 in).
  // NCAA 1-2-1: 60 ft from the sideline, so 40 ft apart.
  var LEVELS = {
    hs:      { key: 'hs',      name: 'High school', book: 'NFHS', hash: (160 / 3) / 3 },
    college: { key: 'college', name: 'College',     book: 'NCAA', hash: 20 }
  };
  var SPOTS = { L: 'Left hash', M: 'Middle', R: 'Right hash' };
  var SITUATIONS = ['1st & 10', '2nd & long', '3rd & short', '3rd & long', 'Red zone', 'Goal line', '2-point'];
  var SIDELINE_ROOM = 2;                                // nobody lines up closer than this to the sideline

  function ballX(level, spot) {                         // yards from the LEFT sideline
    var h = (LEVELS[level] || LEVELS.hs).hash;
    return spot === 'L' ? h : spot === 'R' ? FIELD.width - h : FIELD.width / 2;
  }

  // ---- formations -------------------------------------------------------------------------------
  // The five linemen are always there (the paper sketches leave them out). Depth: 0 = on the line,
  // 1 = off the line (a back), deeper for the backfield.
  function line() {
    return [
      { id: 'LT', label: 'T', num: 75, x: -3, y: 0 }, { id: 'LG', label: 'G', num: 65, x: -1.5, y: 0 },
      { id: 'C', label: 'C', num: 55, x: 0, y: 0 },
      { id: 'RG', label: 'G', num: 66, x: 1.5, y: 0 }, { id: 'RT', label: 'T', num: 76, x: 3, y: 0 }
    ];
  }
  function sk(id, num, x, y) { return { id: id, label: id, num: num, x: x, y: y }; }
  // Each preset puts 7 on the line and 4 in the backfield, with the ends uncovered.
  var FORMATIONS = {
    'Trips Left':  [sk('X', 1, -17, -1), sk('F', 4, -12, -1), sk('Y', 88, -7, 0), sk('Z', 2, 15, 0), sk('Q', 12, 0, -5), sk('T', 22, -2, -5)],
    'Trips Right': [sk('X', 1, -15, 0), sk('Y', 88, 7, 0), sk('F', 4, 12, -1), sk('Z', 2, 17, -1), sk('Q', 12, 0, -5), sk('T', 22, 2, -5)],
    'Bunch Left':  [sk('X', 1, -9.5, -1), sk('Y', 88, -8, 0), sk('F', 4, -6.5, -1), sk('Z', 2, 15, 0), sk('Q', 12, 0, -5), sk('T', 22, 2, -5)],
    'Bunch Right': [sk('X', 1, -15, 0), sk('F', 4, 6.5, -1), sk('Y', 88, 8, 0), sk('Z', 2, 9.5, -1), sk('Q', 12, 0, -5), sk('T', 22, -2, -5)],
    'Doubles':     [sk('X', 1, -17, 0), sk('F', 4, -10, -1), sk('Y', 88, 10, -1), sk('Z', 2, 17, 0), sk('Q', 12, 0, -5), sk('T', 22, 2, -5)],
    'I Right':     [sk('X', 1, -15, 0), sk('Y', 88, 4.5, 0), sk('Z', 2, 14, -1), sk('Q', 12, 0, -1), sk('F', 44, 0, -4), sk('T', 22, 0, -7)],
    'I Left':      [sk('Z', 2, -14, -1), sk('Y', 88, -4.5, 0), sk('X', 1, 15, 0), sk('Q', 12, 0, -1), sk('F', 44, 0, -4), sk('T', 22, 0, -7)],
    'Empty':       [sk('X', 1, -18, 0), sk('F', 4, -12, -1), sk('T', 22, -7, -1), sk('Y', 88, 9, -1), sk('Z', 2, 17, 0), sk('Q', 12, 0, -5)]
  };

  // Defense, for the picture and an 11-player count only (no defensive rules in this card).
  function df(id, x, y) { return { id: id, label: id.replace(/\d+$/, ''), x: x, y: y }; }
  var DEFENSES = {
    'None': [],
    '4-3 Cover 3': [df('E1', -4.5, 1), df('T1', -1.5, 1), df('T2', 1.5, 1), df('E2', 4.5, 1), df('S', -5, 4.5), df('M', 0, 4.5), df('W', 5, 4.5),
                    df('C1', -16, 7), df('C2', 16, 7), df('SS', 7, 8), df('FS', 0, 13)],
    '4-2-5 Cover 2': [df('E1', -4.5, 1), df('T1', -1.5, 1), df('T2', 1.5, 1), df('E2', 4.5, 1), df('M', -2.5, 4.5), df('W', 2.5, 4.5),
                      df('N', -9, 4), df('C1', -16, 5), df('C2', 16, 5), df('SS', -8, 12), df('FS', 8, 12)]
  };

  // ---- the route tree ---------------------------------------------------------------------------
  // out = +1 when "outside" is the offense's right, -1 when it is the left. Distances in yards from
  // the snap position. d = how far he has to go to get 1.5 yd past the line (a back starts deep).
  var ROUTES = [
    { key: '0', name: 'Hitch',     pts: function (o) { return [[0, 6], [-o * 1, 5]]; } },
    { key: '1', name: 'Quick out', pts: function (o) { return [[0, 3], [o * 5, 3]]; } },
    { key: '2', name: 'Slant',     pts: function (o) { return [[0, 2], [-o * 7, 8]]; } },
    { key: '3', name: 'Comeback',  pts: function (o) { return [[0, 14], [o * 2.5, 11.5]]; } },
    { key: '4', name: 'Curl',      pts: function (o) { return [[0, 12], [-o * 1.5, 10]]; } },
    { key: '5', name: 'Out',       pts: function (o) { return [[0, 10], [o * 6, 10]]; } },
    { key: '6', name: 'Dig',       pts: function (o) { return [[0, 12], [-o * 10, 12]]; } },
    { key: '7', name: 'Corner',    pts: function (o) { return [[0, 10], [o * 6, 18]]; } },
    { key: '8', name: 'Post',      pts: function (o) { return [[0, 10], [-o * 6, 20]]; } },
    { key: '9', name: 'Go',        pts: function () { return [[0, 22]]; } },
    { key: 'flat',  name: 'Flat',  pts: function (o, d) { return [[o * 3, d * 0.6], [o * 10, d]]; } },
    { key: 'wheel', name: 'Wheel', pts: function (o, d) { return [[o * 4, d * 0.6], [o * 8, d], [o * 9.5, d + 14]]; } },
    { key: 'block', name: 'Block', end: 'block', pts: function () { return [[0, 1.5]]; } }
  ];
  function routeDef(key) { for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i].key === key) return ROUTES[i]; return null; }

  function snapPos(p) {                                 // where he is when the ball is snapped
    var m = p.motion && p.motion.pts && p.motion.pts.length ? p.motion.pts[p.motion.pts.length - 1] : [0, 0];
    return { x: p.x + m[0], y: p.y + m[1] };
  }
  function outSign(p) { var s = snapPos(p); return s.x < 0 ? -1 : 1; }

  function buildRoute(p, key, flip) {                   // a route object for this player, or null
    var def = routeDef(key); if (!def) return null;
    var o = outSign(p) * (flip ? -1 : 1), s = snapPos(p), d = Math.max(1.5 - s.y, 1.5);
    return { type: key, end: def.end || 'arrow', pts: def.pts(o, d) };
  }
  function defaultMotion(p) {                           // along the line toward the ball, 6 yd
    return { pts: [[-(p.x < 0 ? -1 : 1) * 6, 0]] };
  }
  function routeName(r) { if (!r) return ''; if (r.type === 'free') return 'drawn'; var d = routeDef(r.type); return d ? d.name : r.type; }

  // ---- plays ------------------------------------------------------------------------------------
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clampX(x, level, spot) {
    var bx = ballX(level, spot);
    return Math.min(Math.max(x, SIDELINE_ROOM - bx), FIELD.width - SIDELINE_ROOM - bx);
  }
  function newPlay(formation, level, spot) {
    var f = FORMATIONS[formation] ? formation : 'Trips Left';
    var players = line().concat(clone(FORMATIONS[f]));
    players.forEach(function (p) {
      p.x = clampX(p.x, level || 'hs', spot || 'M');
      p.route = p.num >= 50 && p.num <= 79 ? buildRoute(p, 'block') : null;
      p.motion = null;
    });
    return { id: '', level: level || 'hs', ball: spot || 'M', formation: f, situations: [],
             call: { formation: f, motion: '', play: '', tags: '' }, name: '', nameEdited: false,
             players: players, defense: [], notes: '' };
  }
  function setFormation(play, formation) {              // keeps the call and the sheet slots, resets the 11
    var fresh = newPlay(formation, play.level, play.ball);
    play.formation = fresh.formation; play.players = fresh.players;
    play.call.formation = fresh.formation;
    return play;
  }
  function moveBall(play, level, spot) {                // new hash or new rule set: pull everyone back inbounds
    play.level = level; play.ball = spot;
    play.players.forEach(function (p) { p.x = clampX(p.x, level, spot); });
    return play;
  }
  function flipPlay(play) {                             // mirror left/right
    function fl(pts) { return pts.map(function (q) { return [-q[0], q[1]]; }); }
    play.players.forEach(function (p) {
      p.x = -p.x;
      if (p.route) p.route.pts = fl(p.route.pts);
      if (p.motion) p.motion.pts = fl(p.motion.pts);
    });
    (play.defense || []).forEach(function (d) { d.x = -d.x; });
    var sw = function (s) { return String(s || '').replace(/\b(Left|Right)\b/g, function (m) { return m === 'Left' ? 'Right' : 'Left'; }); };
    play.formation = sw(play.formation); play.call.formation = sw(play.call.formation);
    play.ball = play.ball === 'L' ? 'R' : play.ball === 'R' ? 'L' : 'M';
    return play;
  }

  // The call: formation + motion + play + tags, e.g. "Trips Left, X-motion bunch, UNC, T flat".
  function callString(call) {
    return [call.formation, call.motion, call.play, call.tags].map(function (s) { return String(s || '').trim(); })
      .filter(Boolean).join(', ');
  }
  function playName(play) { return play.nameEdited && play.name ? play.name : callString(play.call); }
  function suggestMotion(play) {                        // "X-motion" for whoever has a motion path
    var m = play.players.filter(function (p) { return p.motion && p.motion.pts.length; });
    return m.map(function (p) { return p.label + '-motion'; }).join(' ');
  }

  // ---- paths ------------------------------------------------------------------------------------
  function pathLength(pts) {                            // pts start at the implied [0,0]
    var L = 0, px = 0, py = 0;
    for (var i = 0; i < pts.length; i++) { L += Math.hypot(pts[i][0] - px, pts[i][1] - py); px = pts[i][0]; py = pts[i][1]; }
    return L;
  }
  function pointAt(pts, dist) {                         // the point `dist` yards along the path
    var px = 0, py = 0;
    if (dist <= 0) return [0, 0];
    for (var i = 0; i < pts.length; i++) {
      var seg = Math.hypot(pts[i][0] - px, pts[i][1] - py);
      if (dist <= seg && seg > 0) { var k = dist / seg; return [px + (pts[i][0] - px) * k, py + (pts[i][1] - py) * k]; }
      dist -= seg; px = pts[i][0]; py = pts[i][1];
    }
    return [px, py];
  }
  // Ramer-Douglas-Peucker: a freehand stroke becomes a few points you can drag.
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    var a = pts[0], b = pts[pts.length - 1], worst = 0, at = 0;
    var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    for (var i = 1; i < pts.length - 1; i++) {
      var d = len ? Math.abs(dy * (pts[i][0] - a[0]) - dx * (pts[i][1] - a[1])) / len : Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst <= tol) return [a, b];
    return simplify(pts.slice(0, at + 1), tol).slice(0, -1).concat(simplify(pts.slice(at), tol));
  }

  var api = { FIELD: FIELD, LEVELS: LEVELS, SPOTS: SPOTS, SITUATIONS: SITUATIONS, SIDELINE_ROOM: SIDELINE_ROOM,
    FORMATIONS: FORMATIONS, DEFENSES: DEFENSES, ROUTES: ROUTES,
    ballX: ballX, clampX: clampX, snapPos: snapPos, outSign: outSign, buildRoute: buildRoute, defaultMotion: defaultMotion,
    routeName: routeName, routeDef: routeDef, clone: clone, newPlay: newPlay, setFormation: setFormation, moveBall: moveBall,
    flipPlay: flipPlay, callString: callString, playName: playName, suggestMotion: suggestMotion,
    pathLength: pathLength, pointAt: pointAt, simplify: simplify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PBModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
