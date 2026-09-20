// sim.js — simulator v1 (request #163): play the drawing back. Everyone holds the set for a full
// second, the motion man goes, the ball is snapped as he gets to the end of his motion line, then
// every player runs his line. One speed per kind of player for now: bad / good / better / best
// ratings and matchup wins are the next card, and they plug in at speedOf() and defSpeedOf().
//
// #167: the defense moves too (defensePositionsAt). Before the snap the man defender on the motion
// man travels with him, a defender whose man changed with the motion slides over to the new one, zone
// defenders slide a yard or two toward the motion and rushers hold. After the snap rushers go at the
// quarterback (slowed while a blocker has them), zone defenders drop to their landmark and shade to
// the route nearest their box, and man defenders react after 0.3 s and run with their receiver. No
// ball, no throw, no tackle yet.
//
// Time t is seconds from the snap: t < 0 is before it (set, then motion), t >= 0 is the play.
(function (root) {
  'use strict';
  var M = (typeof module !== 'undefined' && module.exports) ? require('./model.js') : root.PBModel;

  var SPEED = { skill: 6.5, qb: 4.5, line: 2.5, motion: 5 };   // yards per second
  var DSPEED = { DL: 4.5, LB: 5.8, DB: 6.4 };                   // the defense, yards per second
  var SET = 1, MIN_PLAY = 3, MAX_PLAY = 8, TAIL = 0.6;          // seconds
  var DT = 0.05, REACT = 0.3, LEAD = 20;                        // the defense's step; a man defender's reaction; how many steps ahead he may aim
  var BLOCKED = 0.2, REACH = 2;                                 // a rusher within REACH yards of a blocker goes at a fifth of his speed
  var SLIDE = 0.25, MAX_SLIDE = 2, NEAR = 5;                    // zones slide a quarter of the motion, 2 yd at most; a route within NEAR yards of a zone pulls its defender

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

  // ---- the defense (#167) -----------------------------------------------------------------------
  function defSpeedOf(d) {                              // no pos (an added defender, a play saved before #167): judged by where he stands
    var pos = d.pos || (d.cover && d.cover.type === 'rush' && d.y <= 2 ? 'DL' : d.y >= 6.5 || Math.abs(d.x) >= 12 ? 'DB' : 'LB');
    return DSPEED[pos] || DSPEED.LB;
  }
  function within(v, lim) { return Math.max(-lim, Math.min(lim, v)); }
  function isBlocker(p) { return (p.num >= 50 && p.num <= 79) || !!(p.route && p.route.end === 'block'); }

  // Every defender's position at every step of the play, worked out once per drawing. A step moves
  // each defender toward what he is after, never farther than his speed allows, so nobody teleports
  // and the scrubber shows the same picture at the same t.
  var cache = null;
  function defenseTrack(play) {
    var key = JSON.stringify([play.level, play.ball, play.players, play.defense || []]);
    if (cache && cache.key === key) return cache;
    var tl = timeline(play), defs = play.defense || [], bx = M.ballX(play.level, play.ball);
    var k0 = -Math.ceil(tl.pre / DT - 1e-9), k1 = Math.ceil(tl.post / DT - 1e-9), off = [], k;
    for (k = k0; k <= k1 + LEAD; k++) off.push(positionsAt(play, k * DT));
    var jobs = M.coverage(play), byId = {};
    play.players.forEach(function (p) { byId[p.id] = p; });
    // who had whom before anybody went in motion: the same count, from where they first get set
    var setJobs = M.coverage({ level: play.level, ball: play.ball, defense: defs, players: play.players.map(function (p) {
      return { id: p.id, label: p.label, num: p.num, x: p.x, y: p.y, motion: null }; }) });
    var mover = play.players.filter(hasMotion).sort(function (a, b) {
      return Math.abs(M.snapPos(b).x - b.x) - Math.abs(M.snapPos(a).x - a.x); })[0] || null;
    var threats = M.receivers(play).filter(function (p) { return p.route && p.route.pts.length && !isBlocker(p); });
    var blockers = play.players.filter(isBlocker);
    var qb = play.players.filter(function (p) { return p.id === 'Q'; })[0] || play.players.filter(function (p) { return p.label === 'Q'; })[0];
    var lo = 0.5 - bx, hi = M.FIELD.width - 0.5 - bx;

    function aimBefore(d, job, now, t) {                // before the snap: only sideways, and only for motion
      if (job.type === 'zone') return mover ? { x: d.x + within((now[mover.id].x - mover.x) * SLIDE, MAX_SLIDE), y: d.y } : null;
      if (job.type !== 'man' || !job.target) return null;
      var was = setJobs[d.id] && setJobs[d.id].target;
      if (was === job.target) return { x: d.x + now[job.target].x - byId[job.target].x, y: d.y };   // his man moves, he moves
      if (t < -tl.motion) return null;
      var lev = was ? Math.min(Math.max(Math.abs(d.x - byId[was].x), 1), 4) : 2, sx = M.snapPos(byId[job.target]).x;
      return { x: sx + within(d.x - sx, lev), y: d.y };  // the motion gave him a new man: he slides over to him
    }
    function aimZone(d, job, c, now) {
      var z = job.shape, deep = d.cover.zone !== 'flat' && d.cover.zone !== 'hook', top = deep ? 2 : 1, best = null;
      var mark = { x: z.x, y: deep ? z.y - z.h / 2 + 3 : z.y };
      threats.forEach(function (p) {
        var r = now[p.id], px = r.x, py = r.y + top;     // he plays over the top of the route
        var qx = Math.min(Math.max(px, z.x - z.w / 2), z.x + z.w / 2), qy = Math.min(Math.max(py, z.y - z.h / 2), z.y + z.h / 2);
        var gap = Math.hypot(px - qx, py - qy), tie = deep ? -r.y : Math.hypot(r.x - c.x, r.y - c.y);
        if (!best || gap < best.gap - 1e-9 || (gap < best.gap + 1e-9 && tie < best.tie)) best = { gap: gap, tie: tie, x: qx, y: qy };
      });
      if (!best || best.gap >= NEAR) return mark;
      var w = 1 - best.gap / NEAR;                       // the nearer the route, the more of the way he goes
      return { x: mark.x + (best.x - mark.x) * w, y: mark.y + (best.y - mark.y) * w };
    }
    function aimMan(d, job, c, i, t) {
      if (t - DT < REACT - 1e-9 || !job.target) return null;   // the step that ends at t started at t - DT
      var now = off[i][job.target], spd = defSpeedOf(d);
      var ahead = off[i + Math.min(LEAD, Math.round(Math.hypot(now.x - c.x, now.y - c.y) / spd / DT))][job.target];
      // a receiver still coming up at him: he keeps his depth and stays over him until the cushion is gone
      if (now.y + 1.5 < c.y && off[i + 1][job.target].y > now.y + 1e-6) return { x: ahead.x, y: c.y };
      return { x: ahead.x, y: ahead.y, stop: 0.8 };
    }

    var cur = {}, frames = [], i;
    defs.forEach(function (d) { cur[d.id] = { x: d.x, y: d.y }; });
    frames.push(cur);
    for (i = 1; i <= k1 - k0; i++) {
      var t = (k0 + i) * DT, now = off[i], next = {};
      defs.forEach(function (d) {
        var c = cur[d.id], job = jobs[d.id], max = defSpeedOf(d) * DT, aim = null;
        if (!job || !job.type) aim = null;               // no tag: he stands still
        else if (t <= 0) aim = aimBefore(d, job, now, t);
        else if (job.type === 'rush') {
          aim = qb ? { x: now[qb.id].x, y: now[qb.id].y, stop: 1 } : { x: 0, y: -5, stop: 1 };
          if (blockers.some(function (b) { return Math.hypot(now[b.id].x - c.x, now[b.id].y - c.y) < REACH; })) max *= BLOCKED;
        }
        else if (job.type === 'zone') aim = aimZone(d, job, c, now);
        else aim = aimMan(d, job, c, i, t);
        if (!aim) { next[d.id] = c; return; }
        var dx = aim.x - c.x, dy = aim.y - c.y, dist = Math.hypot(dx, dy), go = Math.min(max, Math.max(dist - (aim.stop || 0), 0));
        if (dist < 1e-9 || go <= 0) { next[d.id] = c; return; }
        var nx = c.x + dx / dist * go;
        if (c.x >= lo && c.x <= hi) nx = Math.min(Math.max(nx, lo), hi);      // nobody runs out of bounds
        next[d.id] = { x: nx, y: c.y + dy / dist * go };
      });
      cur = next; frames.push(cur);
    }
    cache = { key: key, k0: k0, frames: frames };
    return cache;
  }
  function defensePositionsAt(play, t) {                // { id: {x, y} } for the defense
    var tr = defenseTrack(play), f = Math.min(Math.max(t / DT - tr.k0, 0), tr.frames.length - 1);
    var i = Math.min(Math.floor(f), tr.frames.length - 2), k = f - i, out = {};
    (play.defense || []).forEach(function (d) {
      var a = tr.frames[i][d.id], b = tr.frames[i + 1][d.id];
      out[d.id] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
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

  var api = { SPEED: SPEED, DSPEED: DSPEED, defSpeedOf: defSpeedOf, defensePositionsAt: defensePositionsAt, timeline: timeline, phase: phase, positionsAt: positionsAt, speedOf: speedOf, attach: attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PBSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
