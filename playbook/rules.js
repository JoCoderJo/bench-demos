// rules.js — is this a legal offense at the snap? (request #163)
// Two rule sets: 'hs' = NFHS (high school), 'college' = NCAA. Scrimmage downs only — the numbering
// exception for scrimmage-kick formations is not modelled, and the defense only gets a head count.
// NOT YET CHECKED AGAINST THE BOOKS: #163 ran without web access, so the rules and the rule numbers
// below are from memory of the 2024-25 editions (README, "Rules"). Read them against the current
// NFHS and NCAA books before trusting a cite.
//
// check(play) never throws on a drawing: it returns
//   { legal, errors:[{code,msg,ids}], warnings:[{code,msg,ids}], eligible:{id:bool}, why:{id:text},
//     line:[ids left to right], backs:[ids], snapper:id|null }
// errors stop a play from going on the call sheet; warnings do not.
//
// What is checked, judged where everyone is AT THE SNAP (after any motion):
//   count     no more than 11 on offense (both books). Fewer than 11 is legal football, but a play
//             on the sheet has to say where all 11 go, so the board asks for 11.
//   line      every player is a lineman (on the line) or a back (clearly off it); in between is
//             nobody's land (NFHS 2-32-3, 7-2-3; NCAA 2-27-4). Nobody is beyond the ball.
//   backs     no more than 4 backs (NFHS 7-2-5a, NCAA 7-1-4-a) — with 11 that is 7 on the line.
//   numbers   at least 5 on the line numbered 50-79 (NFHS 7-2-5b, NCAA 7-1-4-a).
//   snapper   somebody is on the line over the ball.
//   motion    one man at most, not moving toward the line at the snap, and a back when it is
//             snapped (NFHS 7-2-7, NCAA 7-1-4-b). A man who was set ON the line: NFHS lets him go
//             if he is 5 yards deep at the snap; NCAA does not — he has to re-set as a back first.
//             Two men moving is a shift: all 11 then have to be set again for a full second
//             (NFHS 7-2-6, NCAA 7-1-2-b). The simulator always holds that second before motion.
//   bounds    everyone is inbounds for the hash the ball is on.
//   eligible  by position the two ends of the line and the backs, by number anything but 50-79
//             (NFHS 7-5-6, NCAA 7-3-3). A covered receiver is marked, and warned if he has a route.
(function (root) {
  'use strict';
  var M = (typeof module !== 'undefined' && module.exports) ? require('./model.js') : root.PBModel;

  var ON_LINE = -0.5;      // y at or above this = on the line (his head breaks the snapper's waist)
  var BACK = -1;           // y at or below this = clearly a back
  var UNDER_CENTER = 0.75; // a man this close behind the snapper is the quarterback under center
  var NFHS_MOTION_DEPTH = 5;

  function lineNumber(n) { return n >= 50 && n <= 79; }
  function names(ps) { return ps.map(function (p) { return p.label; }).join(', '); }

  function check(play) {
    var level = play.level === 'college' ? 'college' : 'hs';
    var book = M.LEVELS[level].book;
    var errors = [], warnings = [], eligible = {}, why = {};
    function err(code, msg, ps) { errors.push({ code: code, msg: msg, ids: (ps || []).map(function (p) { return p.id; }) }); }
    function warn(code, msg, ps) { warnings.push({ code: code, msg: msg, ids: (ps || []).map(function (p) { return p.id; }) }); }

    var ps = (play.players || []).map(function (p) {
      var s = M.snapPos(p);
      return { id: p.id, label: p.label, num: p.num, set: { x: p.x, y: p.y }, x: s.x, y: s.y,
               motion: !!(p.motion && p.motion.pts && p.motion.pts.length), src: p };
    });

    // count
    if (ps.length > 11) err('count', ps.length + ' players on offense. 11 is the most either book allows.', []);
    else if (ps.length < 11) err('count', 'Only ' + ps.length + ' on offense. The sheet needs all 11 placed.', []);

    // lineman, back or neither
    var beyond = ps.filter(function (p) { return p.y > 0.05 || p.set.y > 0.05; });
    if (beyond.length) err('beyond', names(beyond) + (beyond.length > 1 ? ' are' : ' is') + ' past the ball. Everyone starts behind the line.', beyond);
    var onLine = ps.filter(function (p) { return p.y >= ON_LINE; }).sort(function (a, b) { return a.x - b.x; });
    var snapper = null;
    onLine.forEach(function (p) { if (Math.abs(p.x) <= UNDER_CENTER && (!snapper || Math.abs(p.x) < Math.abs(snapper.x))) snapper = p; });
    if (!snapper) err('snapper', 'Nobody is on the line over the ball to snap it.', []);
    function underCenter(p) { return snapper && Math.abs(p.x - snapper.x) <= UNDER_CENTER && p.y < ON_LINE; }
    var backs = ps.filter(function (p) { return p.y <= BACK || (p.y < ON_LINE && underCenter(p)); });
    var nowhere = ps.filter(function (p) { return p.y < ON_LINE && p.y > BACK && !underCenter(p); });
    if (nowhere.length) err('noman', names(nowhere) + ': neither on the line nor a yard off it. Step up onto the line or back off it (' +
      (level === 'hs' ? 'NFHS 7-2-3' : 'NCAA 2-27-4, 7-1-4') + ').', nowhere);

    // backs and numbers
    if (backs.length > 4) err('backs', backs.length + ' in the backfield (' + names(backs) + '). 4 backs is the most, so put ' +
      (backs.length - 4) + ' on the line (' + (level === 'hs' ? 'NFHS 7-2-5' : 'NCAA 7-1-4') + ').', backs);
    var numbered = onLine.filter(function (p) { return lineNumber(p.num); });
    if (numbered.length < 5) err('numbers', 'Only ' + numbered.length + ' on the line wearing 50-79. ' + book + ' needs 5.', onLine.filter(function (p) { return !lineNumber(p.num); }));

    // motion
    var movers = ps.filter(function (p) { return p.motion; });
    if (movers.length > 1) err('motion-count', names(movers) + ' are all moving at the snap. Only one man can be in motion; more is a shift, and then all 11 must be set again for a full second.', movers);
    movers.forEach(function (p) {
      var pts = p.src.motion.pts, last = pts[pts.length - 1], prev = pts.length > 1 ? pts[pts.length - 2] : [0, 0];
      if (last[1] - prev[1] > 0.25) err('motion-forward', p.label + ' is moving toward the line at the snap. Motion has to be flat or backward.', [p]);
      if (p.y > BACK) err('motion-line', p.label + ' ends his motion on the line. The man in motion has to be a back at the snap.', [p]);
      if (p.set.y >= ON_LINE) {
        if (level === 'college') err('motion-lineman', p.label + ' starts on the line. NCAA: a lineman cannot go in motion. Start him off the line (7-1-4-b).', [p]);
        else if (p.y > -NFHS_MOTION_DEPTH) err('motion-lineman', p.label + ' starts on the line. NFHS: he must be 5 yards deep at the snap, or start off the line (7-2-7).', [p]);
      }
    });

    // bounds
    var bx = M.ballX(level, play.ball);
    var out = ps.filter(function (p) { return bx + p.x < 0 || bx + p.x > M.FIELD.width || bx + p.set.x < 0 || bx + p.set.x > M.FIELD.width; });
    if (out.length) err('bounds', names(out) + (out.length > 1 ? ' are' : ' is') + ' out of bounds from this hash.', out);

    // eligibility: ends of the line and backs, numbered anything but 50-79
    ps.forEach(function (p) {
      var isBack = backs.indexOf(p) !== -1, i = onLine.indexOf(p), isEnd = i === 0 || (i !== -1 && i === onLine.length - 1);
      if (lineNumber(p.num)) { eligible[p.id] = false; why[p.id] = 'number ' + p.num; }
      else if (isBack || isEnd) eligible[p.id] = true;
      else if (i !== -1) { eligible[p.id] = false; why[p.id] = 'covered'; }
      else { eligible[p.id] = false; why[p.id] = 'not set'; }
    });
    var covered = ps.filter(function (p) { return why[p.id] === 'covered'; });
    covered.forEach(function (p) {
      var outside = p.x < 0 ? onLine[0] : onLine[onLine.length - 1];
      var runs = p.src.route && p.src.route.end !== 'block';
      warn('covered', p.label + ' is covered by ' + outside.label + ', so he is not eligible' +
        (runs ? ' and cannot go downfield on a pass' : '') + '. Step one of them off the line.', [p]);
    });

    // defense: a head count only in this card
    var d = (play.defense || []).length;
    if (d > 11) err('defense', d + ' on defense. 11 is the most.', []);
    else if (d > 0 && d < 11) warn('defense', d + ' on defense, ' + (11 - d) + ' short of 11.', []);

    return { legal: errors.length === 0, errors: errors, warnings: warnings, eligible: eligible, why: why,
             line: onLine.map(function (p) { return p.id; }), backs: backs.map(function (p) { return p.id; }),
             snapper: snapper ? snapper.id : null, book: book };
  }

  // Dragging: a drop close to the line snaps onto it, anything else is at least a yard off, so the
  // board never leaves a man in nobody's land by accident.
  function snapDepth(y) { if (y > -0.75) return 0; return Math.min(y, BACK); }

  var api = { check: check, snapDepth: snapDepth, ON_LINE: ON_LINE, BACK: BACK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PBRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
