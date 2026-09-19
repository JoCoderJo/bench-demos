// sim.js — simulator v1 (request #163): play the drawing back. Everyone holds the set for a full
// second, the motion man goes, the ball is snapped as he gets to the end of his motion line, then
// every player runs his line. One speed per kind of player for now: bad / good / better / best
// ratings and matchup wins are the next card, and they plug in at speedOf().
//
// Time t is seconds from the snap: t < 0 is before it (set, then motion), t >= 0 is the play.
(function (root) {
  'use strict';
  var M = (typeof module !== 'undefined' && module.exports) ? require('./model.js') : root.PBModel;

  var SPEED = { skill: 6.5, qb: 4.5, line: 2.5, motion: 5 };   // yards per second
  var SET = 1, MIN_PLAY = 3, MAX_PLAY = 8, TAIL = 0.6;          // seconds

  function speedOf(p) {
    if ((p.num >= 50 && p.num <= 79) || (p.route && p.route.end === 'block')) return SPEED.line;
    return p.label === 'Q' ? SPEED.qb : SPEED.skill;
  }
  function hasMotion(p) { return !!(p.motion && p.motion.pts && p.motion.pts.length); }

  function timeline(play) {
    var motion = 0, post = 0;
    play.players.forEach(function (p) {
      if (hasMotion(p)) motion = Math.max(motion, M.pathLength(p.motion.pts) / SPEED.motion);
      if (p.route && p.route.pts.length) post = Math.max(post, M.pathLength(p.route.pts) / speedOf(p));
    });
    post = Math.min(Math.max(post + TAIL, MIN_PLAY), MAX_PLAY);
    return { set: SET, motion: motion, pre: SET + motion, post: post };
  }
  function phase(play, t) { var tl = timeline(play); return t >= 0 ? 'live' : (t < -tl.motion ? 'set' : 'motion'); }

  function positionsAt(play, t) {                       // { id: {x, y} } for the offense
    var out = {};
    play.players.forEach(function (p) {
      var x = p.x, y = p.y, q;
      if (hasMotion(p)) {
        // he leaves so that he ARRIVES at the snap, whatever the longest motion on the board is
        var len = M.pathLength(p.motion.pts), start = -len / SPEED.motion;
        q = M.pointAt(p.motion.pts, t >= 0 ? len : Math.max(0, (t - start) * SPEED.motion));
        x += q[0]; y += q[1];
      }
      if (t > 0 && p.route && p.route.pts.length) {
        q = M.pointAt(p.route.pts, t * speedOf(p));
        x += q[0]; y += q[1];
      }
      out[p.id] = { x: x, y: y };
    });
    return out;
  }

  // ---- the play button, the scrubber and the clock (browser only) -------------------------------
  // opts: { getPlay(), onFrame(positions|null, t), button, scrub, clock }
  function attach(opts) {
    var t = null, playing = false, last = 0, raf = 0;
    function tl() { return timeline(opts.getPlay()); }
    function label(time) {
      var ph = phase(opts.getPlay(), time);
      return ph === 'live' ? time.toFixed(1) + ' s' : ph === 'set' ? 'SET' : 'MOTION';
    }
    function show() {
      var T = tl();
      opts.scrub.min = String(-T.pre); opts.scrub.max = String(T.post); opts.scrub.step = '0.02';
      opts.scrub.value = String(t == null ? -T.pre : t);
      opts.clock.textContent = t == null ? 'SET' : label(t);
      opts.button.textContent = playing ? 'Pause' : 'Play';
      opts.onFrame(t == null ? null : positionsAt(opts.getPlay(), t), t);
    }
    function tick(now) {
      if (!playing) return;
      var T = tl();
      t = Math.min(t + (now - last) / 1000, T.post); last = now;
      if (t >= T.post) playing = false;
      show();
      if (playing) raf = root.requestAnimationFrame(tick);
    }
    function play() {
      var T = tl();
      if (t == null || t >= T.post) t = -T.pre;
      playing = true; last = root.performance.now(); show();
      raf = root.requestAnimationFrame(tick);
    }
    function pause() { playing = false; root.cancelAnimationFrame(raf); show(); }
    function reset() { playing = false; root.cancelAnimationFrame(raf); t = null; show(); }
    opts.button.addEventListener('click', function () { if (playing) pause(); else play(); });
    opts.scrub.addEventListener('input', function () { playing = false; root.cancelAnimationFrame(raf); t = parseFloat(opts.scrub.value); show(); });
    show();
    return { reset: reset, pause: pause, play: play, refresh: show, active: function () { return t != null; } };
  }

  var api = { SPEED: SPEED, timeline: timeline, phase: phase, positionsAt: positionsAt, speedOf: speedOf, attach: attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PBSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
