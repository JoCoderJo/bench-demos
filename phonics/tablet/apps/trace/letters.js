/* tablet/apps/trace/letters.js — the stroke data for Trace It (PLAN §12 C8 / D-030). Hand-authored, no font involved.

   STYLE   plain vertical manuscript ("ball and stick" print), the continuous-stroke school order used by the common US
           handwriting charts: round letters start like a c and circle back, a stem that carries a bowl or an arch is
           retraced ("pull down, push up, curve forward") instead of lifting, crossbars and dots come last.

   BOX     x grows to the right, y grows DOWN, in handwriting-paper units:
             y =   0  top line        (tall letters start here: b d f h k l t)
             y =  50  middle line     (small letters are 50 tall: a c e m n o r s u v w x z)
             y = 100  base line       (every letter sits on it)
             y = 150  bottom line     (tails end here: g j p q y)
           x = 0 is the letter's own left edge; the page centres each letter on its bounding box.

   STROKE  a list of segments, drawn in the order written (= the order the child traces):
             ['M', x, y]                     pen down here (first segment of a stroke)
             ['L', x, y]                     straight line to
             ['A', cx, cy, rx, ry, a0, a1]   part of a circle/ellipse round (cx,cy) from angle a0 to a1, in degrees:
                                             0 = 3 o'clock, 90 = 6 o'clock, 180 = 9 o'clock, 270 or -90 = 12 o'clock.
                                             a1 < a0 turns counter-clockwise ("circle back"), a1 > a0 clockwise ("circle
                                             forward"). As the first segment it is also the pen-down point; later the
                                             pen must already be at its a0 point (tests/trace_dom.py checks for gaps).
             ['Q', cx, cy, x, y]             quadratic curve to        ['C', x1, y1, x2, y2, x, y]   cubic curve to
             ['D', x, y]                     a dot (a tap, not a drag) — the whole stroke
   The numbers 22 / 28.36 / 63.13 that repeat below: a bowl is a circle of radius 25 whose centre sits 22 from its stem, so
   it meets the stem 28.36° above and below the middle, at y = 63.13 and y = 86.87.

   window.TRACE = { BOX, ABC, LETTERS, sample(stroke, step) → [[x, y], …] } — sample() is the one interpreter of this format;
   the trace screen, the picker tiles, the review sheet (index.html?sheet=1) and the test all draw from it. */
(function () {
  'use strict';
  const LETTERS = {
    // a — circle back all the way round, push up to the middle line, pull down straight. One stroke.
    a: [[['A', 25, 75, 25, 25, -28.36, -388.36], ['L', 47, 50], ['L', 47, 100]]],
    // b — pull down straight from the top, push up, circle forward. One stroke.
    b: [[['M', 0, 0], ['L', 0, 100], ['L', 0, 63.13], ['A', 22, 75, 25, 25, 208.36, 511.64]]],
    // c — circle back, stop before it closes. One stroke.
    c: [[['A', 25, 75, 25, 25, -45, -315]]],
    // d — circle back all the way round, push up to the top line, pull down straight. One stroke.
    d: [[['A', 25, 75, 25, 25, -28.36, -388.36], ['L', 47, 0], ['L', 47, 100]]],
    // e — slide right through the middle, then circle back. One stroke.
    e: [[['M', 0, 75], ['L', 50, 75], ['A', 25, 75, 25, 25, 0, -315]]],
    // f — curve back over the top and pull down straight; lift; slide right on the middle line. Two strokes.
    f: [[['A', 31, 15, 15, 15, -35, -180], ['L', 16, 100]],
        [['M', 1, 50], ['L', 33, 50]]],
    // g — circle back all the way round, push up, pull down below the base line and curve back. One stroke.
    g: [[['A', 25, 75, 25, 25, -28.36, -388.36], ['L', 47, 50], ['L', 47, 128], ['A', 25, 128, 22, 22, 0, 150]]],
    // h — pull down straight from the top, push up, curve forward, pull down. One stroke.
    h: [[['M', 0, 0], ['L', 0, 100], ['L', 0, 71], ['A', 21, 71, 21, 21, 180, 360], ['L', 42, 100]]],
    // i — pull down straight; lift; dot. Two strokes.
    i: [[['M', 0, 50], ['L', 0, 100]],
        [['D', 0, 28]]],
    // j — pull down straight below the base line and curve back; lift; dot. Two strokes.
    j: [[['M', 32, 50], ['L', 32, 132], ['A', 14, 132, 18, 18, 0, 140]],
        [['D', 32, 28]]],
    // k — pull down straight from the top; lift; slant left to the stem, slant right to the base line. Two strokes.
    k: [[['M', 0, 0], ['L', 0, 100]],
        [['M', 38, 50], ['L', 0, 76], ['L', 40, 100]]],
    // l — pull down straight from the top. One stroke.
    l: [[['M', 0, 0], ['L', 0, 100]]],
    // m — pull down, push up, curve forward, pull down, push up, curve forward, pull down. One stroke.
    m: [[['M', 0, 50], ['L', 0, 100], ['L', 0, 69], ['A', 19, 69, 19, 19, 180, 360], ['L', 38, 100], ['L', 38, 69],
         ['A', 57, 69, 19, 19, 180, 360], ['L', 76, 100]]],
    // n — pull down, push up, curve forward, pull down. One stroke.
    n: [[['M', 0, 50], ['L', 0, 100], ['L', 0, 71], ['A', 21, 71, 21, 21, 180, 360], ['L', 42, 100]]],
    // o — circle back all the way round. One stroke.
    o: [[['A', 25, 75, 25, 25, -45, -405]]],
    // p — pull down straight below the base line, push up, circle forward. One stroke.
    p: [[['M', 0, 50], ['L', 0, 150], ['L', 0, 63.13], ['A', 22, 75, 25, 25, 208.36, 511.64]]],
    // q — circle back all the way round, push up, pull down below the base line and curve forward. One stroke.
    q: [[['A', 25, 75, 25, 25, -28.36, -388.36], ['L', 47, 50], ['L', 47, 138], ['A', 59, 138, 12, 12, 180, 20]]],
    // r — pull down, push up, curve forward and stop. One stroke.
    r: [[['M', 0, 50], ['L', 0, 100], ['L', 0, 71], ['A', 21, 71, 21, 21, 180, 315]]],
    // s — curve back, then curve forward. One stroke.
    s: [[['A', 20, 62.5, 18, 12.5, -40, -270], ['A', 20, 87.5, 18, 12.5, -90, 140]]],
    // t — pull down straight from the top; lift; slide right on the middle line. Two strokes.
    t: [[['M', 17, 0], ['L', 17, 100]],
        [['M', 0, 50], ['L', 34, 50]]],
    // u — pull down, curve forward, push up; pull down straight. One stroke.
    u: [[['M', 0, 50], ['L', 0, 79], ['A', 21, 79, 21, 21, 180, 0], ['L', 42, 50], ['L', 42, 100]]],
    // v — slant right down, slant up. One stroke.
    v: [[['M', 0, 50], ['L', 21, 100], ['L', 42, 50]]],
    // w — slant right down, slant up, slant right down, slant up. One stroke.
    w: [[['M', 0, 50], ['L', 16, 100], ['L', 32, 50], ['L', 48, 100], ['L', 64, 50]]],
    // x — slant right down; lift; slant left down. Two strokes.
    x: [[['M', 0, 50], ['L', 40, 100]],
        [['M', 40, 50], ['L', 0, 100]]],
    // y — slant right down to the base line; lift; slant left down through it to the bottom line. Two strokes.
    y: [[['M', 0, 50], ['L', 21, 100]],
        [['M', 42, 50], ['L', 0, 150]]],
    // z — slide right, slant left down, slide right. One stroke.
    z: [[['M', 0, 50], ['L', 40, 50], ['L', 0, 100], ['L', 40, 100]]],
  };

  // The one interpreter: a stroke → points about `step` units apart (the corners and the ends are always points).
  function sample(stroke, step) {
    step = step || 1;
    const pts = [];
    let x = 0, y = 0;
    const put = (px, py) => {
      const n = pts.length;
      if (!n || Math.hypot(pts[n - 1][0] - px, pts[n - 1][1] - py) > 1e-6) pts.push([px, py]);
      x = px; y = py;
    };
    const curve = (f, guess) => { const n = Math.max(4, Math.ceil(guess / step)); for (let i = 1; i <= n; i++) { const p = f(i / n); put(p[0], p[1]); } };
    for (const g of stroke) {
      const c = g[0];
      if (c === 'M' || c === 'D') put(g[1], g[2]);
      else if (c === 'L') {
        const x0 = x, y0 = y, n = Math.max(1, Math.ceil(Math.hypot(g[1] - x0, g[2] - y0) / step));
        for (let i = 1; i <= n; i++) put(x0 + (g[1] - x0) * i / n, y0 + (g[2] - y0) * i / n);
      } else if (c === 'A') {
        const cx = g[1], cy = g[2], rx = g[3], ry = g[4], a0 = g[5], a1 = g[6];
        const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * Math.PI / 180 * Math.max(rx, ry) / step));
        for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; put(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
      } else if (c === 'Q') {
        const x0 = x, y0 = y;
        curve(t => [(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * g[1] + t * t * g[3], (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * g[2] + t * t * g[4]],
          Math.hypot(g[1] - x0, g[2] - y0) + Math.hypot(g[3] - g[1], g[4] - g[2]));
      } else if (c === 'C') {
        const x0 = x, y0 = y;
        curve(t => { const u = 1 - t; return [u * u * u * x0 + 3 * u * u * t * g[1] + 3 * u * t * t * g[3] + t * t * t * g[5], u * u * u * y0 + 3 * u * u * t * g[2] + 3 * u * t * t * g[4] + t * t * t * g[6]]; },
          Math.hypot(g[1] - x0, g[2] - y0) + Math.hypot(g[3] - g[1], g[4] - g[2]) + Math.hypot(g[5] - g[3], g[6] - g[4]));
      }
    }
    return pts;
  }

  window.TRACE = { BOX: { top: 0, mid: 50, base: 100, bottom: 150 }, ABC: 'abcdefghijklmnopqrstuvwxyz'.split(''), LETTERS, sample };
})();
