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

  // Defense (#166): a picture, an 11-player count, and a coverage tag on every defender, like the
  // coverage art in Madden. #167: the defenders move when the play runs (sim.js works that out from
  // the same tags), and the list of calls is built below from fronts times coverage shells.
  //   cover = { type:'rush' }
  //         | { type:'zone', zone:'flat'|'hook'|'third'|'half'|'quarter', side:'L'|'M'|'R', x?, inside? }
  //           x = a hook's landmark, from the ball; inside = the quarter next to the middle of the field
  //         | { type:'man', on:1|2|3|'back' }   the receiver counted from the sideline on the defender's own side, or a back
  //         | { type:'man', id:'X' }            a player the coach picked
  //   pos = 'DL'|'LB'|'DB': how fast he is in the simulator. A defender without one is judged by where he stands.
  // A man target is worked out from where everyone lines up when it is drawn (coverage() below), so it
  // survives a new formation, motion and a flip. A defender with no tag (an old saved play) draws plain.
  var RUSH = { type: 'rush' };
  function zone(kind, side, x) { var z = { type: 'zone', zone: kind, side: side }; if (x != null) z.x = x; return z; }
  function quarter(side, inside) { var z = zone('quarter', side); if (inside) z.inside = true; return z; }
  function manOn(n) { return { type: 'man', on: n }; }
  function df(id, x, y, cover, pos) { return { id: id, label: id.replace(/\d+$/, ''), x: x, y: y, cover: cover, pos: pos }; }
  var DEFAULT_DEFENSE = '4-3 Cover 3';

  // A front is who rushes and the three men underneath, left to right: [id, x, y, pos]. The corners and
  // the two safeties come from the shell. 3-4 and 3-3-5 send a linebacker as the fourth rusher.
  function dl(id, x) { return [id, x, 1, 'DL']; }
  var FRONTS = {
    '4-3':   { rush: [dl('E1', -4.5), dl('T1', -1.5), dl('T2', 1.5), dl('E2', 4.5)],
               under: [['S', -5, 4.5, 'LB'], ['M', 0, 4.5, 'LB'], ['W', 5, 4.5, 'LB']] },
    '3-4':   { rush: [dl('E1', -3.5), dl('NT', 0), dl('E2', 3.5), ['J', 5.5, 1.5, 'LB']],
               under: [['S', -5.5, 3, 'LB'], ['M', -1.5, 4.5, 'LB'], ['B', 1.5, 4.5, 'LB']] },
    '4-2-5': { rush: [dl('E1', -4.5), dl('T1', -1.5), dl('T2', 1.5), dl('E2', 4.5)],
               under: [['N', -9, 4.5, 'DB'], ['M', -2.5, 4.5, 'LB'], ['W', 2.5, 4.5, 'LB']] },
    '3-3-5': { rush: [dl('E1', -3.5), dl('NT', 0), dl('E2', 3.5), ['M', 0, 4.5, 'LB']],
               under: [['N', -8, 4.5, 'DB'], ['S', -3.5, 4.5, 'LB'], ['W', 3.5, 4.5, 'LB']] },
    'Dime':  { rush: [dl('E1', -4.5), dl('T1', -1.5), dl('T2', 1.5), dl('E2', 4.5)],
               under: [['N', -9, 4.5, 'DB'], ['M', 0, 4.5, 'LB'], ['D', 9, 4.5, 'DB']] }
  };
  // A shell is the job of the three underneath (left, middle, right) and where the four backs line up.
  var SHELLS = {
    'Cover 1':  { under: [manOn(2), manOn('back'), zone('hook', 'M', 0)],
                  C1: [-16, 6, manOn(1)], C2: [16, 6, manOn(1)], SS: [8, 7, manOn(2)], FS: [0, 14, zone('third', 'M')] },
    'Cover 2':  { under: [zone('hook', 'L', -8), zone('hook', 'M', 0), zone('hook', 'R', 8)],
                  C1: [-16, 5, zone('flat', 'L')], C2: [16, 5, zone('flat', 'R')], SS: [-8, 12, zone('half', 'L')], FS: [8, 12, zone('half', 'R')] },
    'Tampa 2':  { under: [zone('hook', 'L', -6), zone('third', 'M'), zone('hook', 'R', 6)],   // the Mike runs down the middle
                  C1: [-16, 5, zone('flat', 'L')], C2: [16, 5, zone('flat', 'R')], SS: [-8, 12, zone('half', 'L')], FS: [8, 12, zone('half', 'R')] },
    '2-man':    { under: [manOn(2), manOn('back'), manOn(2)],
                  C1: [-16, 4, manOn(1)], C2: [16, 4, manOn(1)], SS: [-8, 12, zone('half', 'L')], FS: [8, 12, zone('half', 'R')] },
    'Cover 3':  { under: [zone('flat', 'L'), zone('hook', 'L', -4.5), zone('hook', 'R', 4.5)],
                  C1: [-16, 7, zone('third', 'L')], C2: [16, 7, zone('third', 'R')], SS: [7, 8, zone('flat', 'R')], FS: [0, 13, zone('third', 'M')] },
    'Cover 4':  { under: [zone('hook', 'L', -8), zone('hook', 'M', 0), zone('hook', 'R', 8)],
                  C1: [-16, 7, quarter('L')], C2: [16, 7, quarter('R')], SS: [-6, 10, quarter('L', true)], FS: [6, 10, quarter('R', true)] },
    'Cover 6':  { under: [zone('hook', 'L', -8), zone('hook', 'M', 0), zone('hook', 'R', 7)],  // quarters to the left, a half to the right
                  C1: [-16, 7, quarter('L')], C2: [16, 5, zone('flat', 'R')], SS: [-6, 10, quarter('L', true)], FS: [8, 12, zone('half', 'R')] },
    'Cover 0 blitz':        { under: [manOn(2), RUSH, RUSH],
                  C1: [-16, 5, manOn(1)], C2: [16, 5, manOn(1)], SS: [7, 6, manOn(2)], FS: [-1, 8, manOn('back')] },
    'fire zone Cover 3':    { under: [RUSH, zone('hook', 'M', 0), zone('hook', 'R', 8)],       // five come, three under, three deep
                  C1: [-16, 7, zone('third', 'L')], C2: [16, 7, zone('third', 'R')], SS: [-7, 7, zone('hook', 'L', -8)], FS: [0, 13, zone('third', 'M')] },
    'Nickel blitz Cover 1': { under: [RUSH, manOn('back'), manOn(2)],
                  C1: [-16, 6, manOn(1)], C2: [16, 6, manOn(1)], SS: [-8, 7, manOn(2)], FS: [0, 14, zone('third', 'M')] }
  };
  function scheme(front, shell) {
    var f = FRONTS[front], s = SHELLS[shell];
    return f.rush.map(function (r) { return df(r[0], r[1], r[2], RUSH, r[3]); })
      .concat(f.under.map(function (u, i) { return df(u[0], u[1], u[2], s.under[i], u[3]); }))
      .concat(['C1', 'C2', 'SS', 'FS'].map(function (id) { return df(id, s[id][0], s[id][1], s[id][2], 'DB'); }));
  }
  function goalLine(fs) {                               // 6-2: six down, two linebackers, three backs up tight
    return [-5.5, -3.3, -1.1, 1.1, 3.3, 5.5].map(function (x, i) { return df((i === 0 || i === 5 ? 'E' : 'T') + (i === 5 ? 2 : i || 1), x, 1, RUSH, 'DL'); })
      .concat([df('M', -2.5, 3.5, manOn(2), 'LB'), df('W', 2.5, 3.5, manOn(2), 'LB'),
               df('C1', -12, 3, manOn(1), 'DB'), df('C2', 12, 3, manOn(1), 'DB'), df('FS', 0, 6, fs, 'DB')]);
  }
  // The list (#167), grouped by front for the picker. "Sam" only names who comes in the fire zone.
  var DEFENSES = { 'None': [] }, DEFENSE_GROUPS = [];
  [['4-3', ['Cover 1', 'Cover 2', 'Tampa 2', 'Cover 3', 'Cover 4', 'Cover 6', 'Sam fire zone Cover 3', 'Cover 0 blitz']],
   ['3-4', ['Cover 1', 'Cover 2', 'Cover 3', 'Cover 4', 'Sam fire zone Cover 3']],
   ['4-2-5', ['Cover 1', 'Cover 2', '2-man', 'Cover 3', 'Cover 4', 'Cover 6', 'Nickel blitz Cover 1']],
   ['3-3-5', ['Cover 1', 'Cover 3', 'Cover 0 blitz']],
   ['Dime', ['2-man', 'Cover 4', 'Cover 0 blitz']]].forEach(function (g) {
    DEFENSE_GROUPS.push({ front: g[0], names: g[1].map(function (call) {
      DEFENSES[g[0] + ' ' + call] = scheme(g[0], call.replace(/^Sam /, ''));
      return g[0] + ' ' + call;
    }) });
  });
  DEFENSES['Goal line Cover 0'] = goalLine(manOn('back'));
  DEFENSES['Goal line Cover 1'] = goalLine(zone('hook', 'M', 0));           // the safety is free in the short middle
  DEFENSE_GROUPS.push({ front: 'Goal line', names: ['Goal line Cover 0', 'Goal line Cover 1'] });

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
  function setDefense(play, name) {                     // a preset scheme, pulled inbounds for this hash
    play.defenseName = name;
    play.defense = clone(DEFENSES[name] || []).map(function (d) { d.x = clampX(d.x, play.level, play.ball); return d; });
    return play;
  }
  function newPlay(formation, level, spot, defense) {   // every new play starts against a scheme (#166)
    var f = FORMATIONS[formation] ? formation : 'Trips Left';
    var players = line().concat(clone(FORMATIONS[f]));
    players.forEach(function (p) {
      p.x = clampX(p.x, level || 'hs', spot || 'M');
      p.route = p.num >= 50 && p.num <= 79 ? buildRoute(p, 'block') : null;
      p.motion = null;
    });
    return setDefense({ id: '', level: level || 'hs', ball: spot || 'M', formation: f, situations: [],
             call: { formation: f, motion: '', play: '', tags: '' }, name: '', nameEdited: false,
             players: players, defense: [], notes: '' }, DEFENSES[defense] ? defense : DEFAULT_DEFENSE);
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
    (play.defense || []).forEach(function (d) {
      d.x = -d.x;
      if (d.cover && d.cover.type === 'zone') {
        d.cover.side = d.cover.side === 'L' ? 'R' : d.cover.side === 'R' ? 'L' : 'M';
        if (d.cover.x != null) d.cover.x = -d.cover.x;
      }
    });
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
  // The dynamic call (#165): "X Hitch, T Flat" for every route picked off the tree. A lineman's
  // block is the default and a drawn route has no name, so neither is a tag.
  function suggestTags(play) {
    return play.players.filter(function (p) {
      return p.route && routeDef(p.route.type) && !(p.route.type === 'block' && p.num >= 50 && p.num <= 79);
    }).map(function (p) { return p.label + ' ' + routeDef(p.route.type).name; }).join(', ');
  }
  // Call with what suggestTags() said BEFORE the change: Tags follow the routes while they are
  // empty or still what the board wrote, and are left alone once the coach typed his own.
  function keepTags(play, was) {
    var t = String(play.call.tags || '').trim();
    if (!t || t === was) play.call.tags = suggestTags(play);
    return play;
  }

  // ---- coverage (#166) ----------------------------------------------------------------------------
  var ZONES = { flat: 'Flat', hook: 'Hook', third: 'Deep third', half: 'Deep half', quarter: 'Deep quarter' };
  var SIDES = { L: 'left', M: 'middle', R: 'right' };
  function zoneName(c) {
    if (c.zone === 'third' && c.side === 'M') return 'Deep middle';
    if (c.zone === 'quarter') return (c.inside ? 'Inside quarter ' : 'Outside quarter ') + (SIDES[c.side] || '');
    return (ZONES[c.zone] || c.zone) + ' ' + (SIDES[c.side] || '');
  }
  // The box a zone covers, in yards from the ball: { x, y } is its middle. The deep zones split the
  // FIELD (thirds, halves), so they shift with the hash; the underneath zones go with the ball.
  function zoneShape(c, level, spot) {
    var W = FIELD.width, bx = ballX(level, spot), lo, hi, y0, y1, k;
    if (c.zone === 'quarter') {
      lo = (c.side === 'L' ? (c.inside ? 1 : 0) : (c.inside ? 2 : 3)) * W / 4;
      hi = lo + W / 4; y0 = 12; y1 = 26;
    } else if (c.zone === 'third' || c.zone === 'half') {
      k = c.zone === 'third' ? 3 : 2;
      lo = c.side === 'L' ? 0 : c.side === 'R' ? W - W / k : W / k;
      hi = lo + W / k; y0 = c.zone === 'third' ? 14 : 13; y1 = 26;
    } else {
      var w = c.zone === 'flat' ? 11 : 7.5;
      var mid = bx + (c.zone === 'flat' ? (c.side === 'L' ? -15.5 : 15.5) : c.x != null ? c.x : c.side === 'L' ? -5 : c.side === 'R' ? 5 : 0);
      mid = Math.min(Math.max(mid, w / 2), W - w / 2);  // a flat on the short side stops at the sideline
      lo = mid - w / 2; hi = mid + w / 2; y0 = c.zone === 'flat' ? 1 : 5; y1 = c.zone === 'flat' ? 7 : 11;
    }
    lo += 0.4; hi -= 0.4;
    return { x: (lo + hi) / 2 - bx, y: (y0 + y1) / 2, w: hi - lo, h: y1 - y0 };
  }
  // The zone a defender would take if the coach tags him from where he stands.
  function zoneFor(d, kind, level, spot) {
    var fx = ballX(level, spot) + d.x, W = FIELD.width;
    if (kind === 'third') return zone(kind, fx < W / 3 ? 'L' : fx > 2 * W / 3 ? 'R' : 'M');
    if (kind === 'quarter') return quarter(fx < W / 2 ? 'L' : 'R', fx >= W / 4 && fx <= 3 * W / 4);
    if (kind === 'hook') return zone(kind, d.x < -2 ? 'L' : d.x > 2 ? 'R' : 'M', Math.round(Math.min(Math.max(d.x, -10), 10) * 2) / 2);
    return zone(kind, (kind === 'half' ? fx < W / 2 : d.x < 0) ? 'L' : 'R');
  }
  // Who can be covered man to man: everybody but the five with a lineman's number and the quarterback.
  function receivers(play) {
    return play.players.filter(function (p) { return !(p.num >= 50 && p.num <= 79) && p.id !== 'Q'; });
  }
  // Every defender's job, worked out from the alignment: { id: { type, target, shape, text } }.
  // target = the offensive player's id (man), shape = zoneShape (zone). First the defenders who were
  // given a man by name or by count (a corner takes #1 on his side), then whoever is left takes the
  // nearest receiver nobody has yet.
  function coverage(play) {
    var out = {}, taken = {}, rec = receivers(play), defs = play.defense || [], label = {};
    var at = {}; rec.forEach(function (p) { at[p.id] = snapPos(p); label[p.id] = p.label; });
    function back(p) { return Math.abs(at[p.id].x) <= 5 && at[p.id].y <= -2; }
    function nearest(d, list) {
      return list.filter(function (p) { return !taken[p.id]; }).sort(function (a, b) {
        return Math.hypot(at[a.id].x - d.x, at[a.id].y - d.y) - Math.hypot(at[b.id].x - d.x, at[b.id].y - d.y);
      })[0] || null;
    }
    function give(d, p) { if (p) taken[p.id] = 1; out[d.id] = { type: 'man', target: p ? p.id : null, shape: null, text: p ? 'Man on ' + label[p.id] : 'Man, nobody left to take' }; }
    var men = defs.filter(function (d) { return d.cover && d.cover.type === 'man'; }), late = [];
    men.filter(function (d) { return d.cover.id; }).forEach(function (d) {
      var p = rec.filter(function (r) { return r.id === d.cover.id && !taken[r.id]; })[0];
      if (p) give(d, p); else late.push(d);
    });
    men.filter(function (d) { return !d.cover.id; }).forEach(function (d) {
      var side = d.x < 0 ? -1 : 1, p = null;
      if (d.cover.on === 'back') p = nearest(d, rec.filter(back));
      else if (d.cover.on) p = rec.filter(function (r) { return !back(r) && (at[r.id].x < 0 ? -1 : 1) === side; })
        .sort(function (a, b) { return Math.abs(at[b.id].x) - Math.abs(at[a.id].x); })[d.cover.on - 1] || null;
      if (p && !taken[p.id]) give(d, p); else late.push(d);
    });
    late.forEach(function (d) { give(d, nearest(d, rec)); });
    defs.forEach(function (d) {
      if (out[d.id]) return;
      if (d.cover && d.cover.type === 'zone') out[d.id] = { type: 'zone', target: null, shape: zoneShape(d.cover, play.level, play.ball), text: 'Zone: ' + zoneName(d.cover).trim().toLowerCase() };
      else if (d.cover && d.cover.type === 'rush') out[d.id] = { type: 'rush', target: null, shape: null, text: 'Rush' };
      else out[d.id] = { type: null, target: null, shape: null, text: 'no tag' };
    });
    return out;
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
    FORMATIONS: FORMATIONS, DEFENSES: DEFENSES, DEFENSE_GROUPS: DEFENSE_GROUPS, DEFAULT_DEFENSE: DEFAULT_DEFENSE, ZONES: ZONES, ROUTES: ROUTES,
    ballX: ballX, clampX: clampX, snapPos: snapPos, outSign: outSign, buildRoute: buildRoute, defaultMotion: defaultMotion,
    routeName: routeName, routeDef: routeDef, clone: clone, newPlay: newPlay, setFormation: setFormation, moveBall: moveBall,
    flipPlay: flipPlay, callString: callString, playName: playName, suggestMotion: suggestMotion,
    suggestTags: suggestTags, keepTags: keepTags,
    setDefense: setDefense, zoneName: zoneName, zoneShape: zoneShape, zoneFor: zoneFor, receivers: receivers, coverage: coverage,
    pathLength: pathLength, pointAt: pointAt, simplify: simplify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PBModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
