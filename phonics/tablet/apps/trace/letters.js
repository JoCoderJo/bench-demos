/* tablet/apps/trace/letters.js — the stroke data for Trace It (PLAN §12 C8 / D-030). Hand-authored pen paths, no font involved.

   STYLES  one object per handwriting model, all in the same format, all read by the one interpreter below. The page never
           names a style: it draws TRACE.LETTERS, which is the default style's letters (TRACE.use(id) swaps the whole set;
           index.html?style=<id> does that for a look). A second model = a second entry in STYLES, nothing else changes.

   'zaner-bloser' (the default; Joe, 2026-11-16: "Zaner-Bloser print")
           Zaner-Bloser manuscript: vertical, no slant, written as the PEN PATH a handwriting workbook shows, in the school
           stroke order and direction. Round letters are slightly oval, start at about 1–2 o'clock and go backward
           (a c d g o q, C G O Q); the stem of a d g q is pushed up and pulled down from where the oval closes, so the
           oval runs INTO the stem (it touches it, it does not cross it). b and p: pull down, push up, circle forward out
           of the stem. h m n r: pull down, push up, and the arch branches out of the stem below the middle line. s is a
           true double curve. Capitals: pull-down strokes first, lift, then the slides and bowls from the top, crossbars
           last (the wording of each letter's comment is the chart's).

   BOX     x grows to the right, y grows DOWN, in handwriting-paper units:
             y =   0  top line        (capitals and tall letters start here: b d f h k l t)
             y =  50  middle line     (small letters are 50 tall: a c e m n o r s u v w x z)
             y = 100  base line       (every letter sits on it)
             y = 150  bottom line     (tails end here, half a space below the base line: g j p q y)
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
   The small-letter oval is 46 wide and 50 tall round (23,75); the capital oval is 90 by 100 round (45,50). A stem that
   belongs to an oval stands on the oval's own edge (x = 46, or x = 0 for b and p), so the two meet without a corner.

   window.TRACE = { BOX, ABC, CAPS, STYLES, STYLE, LETTERS, use(id), sample(stroke, step) → [[x, y], …] } — sample() is the
   one interpreter of this format; the trace screen, the picker tiles, the review sheet (index.html?sheet=1) and the test
   all draw from it. */
(function () {
  'use strict';
  const ZB_SMALL = {
    // a — circle back all the way around; push up straight to the middle line. Pull down straight. One stroke.
    a: [[['A', 23, 75, 23, 25, -40, -360], ['L', 46, 50], ['L', 46, 100]]],
    // b — pull down straight from the top. Push up. Circle forward. One stroke.
    b: [[['M', 0, 0], ['L', 0, 100], ['L', 0, 75], ['A', 23, 75, 23, 25, 180, 512]]],
    // c — circle back, stop before it closes. One stroke.
    c: [[['A', 23, 75, 23, 25, -42, -318]]],
    // d — circle back all the way around; push up straight to the top line. Pull down straight. One stroke.
    d: [[['A', 23, 75, 23, 25, -40, -360], ['L', 46, 0], ['L', 46, 100]]],
    // e — slide right through the middle. Circle back. One stroke.
    e: [[['M', 0, 75], ['L', 46, 75], ['A', 23, 75, 23, 25, 0, -318]]],
    // f — curve back from under the top line; pull down straight. Lift. Slide right on the middle line. Two strokes.
    f: [[['M', 36, 9], ['C', 33, 3, 29, 0, 25, 0], ['C', 18, 0, 14, 6, 14, 16], ['L', 14, 100]],
        [['M', 0, 50], ['L', 30, 50]]],
    // g — circle back all the way around; push up straight. Pull down straight below the base line; curve back. One stroke.
    g: [[['A', 23, 75, 23, 25, -40, -360], ['L', 46, 50], ['L', 46, 126], ['A', 23, 126, 23, 24, 0, 155]]],
    // h — pull down straight from the top. Push up. Curve forward; pull down straight. One stroke.
    h: [[['M', 0, 0], ['L', 0, 100], ['L', 0, 67], ['C', 1, 57, 10, 50, 21, 50], ['C', 33, 50, 40, 58, 40, 72], ['L', 40, 100]]],
    // i — pull down straight. Lift. Dot. Two strokes.
    i: [[['M', 0, 50], ['L', 0, 100]],
        [['D', 0, 28]]],
    // j — pull down straight below the base line; curve back. Lift. Dot. Two strokes.
    j: [[['M', 26, 50], ['L', 26, 127], ['A', 13, 127, 13, 23, 0, 155]],
        [['D', 26, 28]]],
    // k — pull down straight from the top. Lift. Slant left to the stem. Slant right to the base line. Two strokes.
    k: [[['M', 0, 0], ['L', 0, 100]],
        [['M', 36, 50], ['L', 0, 77], ['L', 38, 100]]],
    // l — pull down straight from the top. One stroke.
    l: [[['M', 0, 0], ['L', 0, 100]]],
    // m — pull down straight. Push up. Curve forward; pull down straight. Push up. Curve forward; pull down straight. One stroke.
    m: [[['M', 0, 50], ['L', 0, 100], ['L', 0, 67], ['C', 1, 57, 9, 50, 19, 50], ['C', 30, 50, 36, 58, 36, 72], ['L', 36, 100], ['L', 36, 67],
         ['C', 37, 57, 45, 50, 55, 50], ['C', 66, 50, 72, 58, 72, 72], ['L', 72, 100]]],
    // n — pull down straight. Push up. Curve forward; pull down straight. One stroke.
    n: [[['M', 0, 50], ['L', 0, 100], ['L', 0, 67], ['C', 1, 57, 10, 50, 21, 50], ['C', 33, 50, 40, 58, 40, 72], ['L', 40, 100]]],
    // o — circle back all the way around. One stroke.
    o: [[['A', 23, 75, 23, 25, -50, -410]]],
    // p — pull down straight below the base line. Push up. Circle forward all the way around. One stroke.
    p: [[['M', 0, 50], ['L', 0, 150], ['L', 0, 75], ['A', 23, 75, 23, 25, 180, 512]]],
    // q — circle back all the way around; push up straight. Pull down straight below the base line; curve forward. One stroke.
    q: [[['A', 23, 75, 23, 25, -40, -360], ['L', 46, 50], ['L', 46, 137], ['A', 59, 137, 13, 13, 180, 35]]],
    // r — pull down straight. Push up. Curve forward and stop. One stroke.
    r: [[['M', 0, 50], ['L', 0, 100], ['L', 0, 67], ['C', 1, 57, 9, 50, 19, 50], ['Q', 28, 50, 32, 58]]],
    // s — curve back. Curve forward. One stroke, a double curve.
    s: [[['M', 35, 59], ['C', 31, 53, 26, 50, 19, 50], ['C', 9, 50, 3, 55, 3, 63], ['C', 3, 71, 12, 73, 19, 75], ['C', 27, 77, 35, 80, 35, 88],
         ['C', 35, 96, 27, 100, 18, 100], ['C', 11, 100, 5, 97, 1, 91]]],
    // t — pull down straight from the top. Lift. Slide right on the middle line. Two strokes.
    t: [[['M', 16, 0], ['L', 16, 100]],
        [['M', 0, 50], ['L', 32, 50]]],
    // u — pull down straight; curve forward; push up. Pull down straight. One stroke.
    u: [[['M', 0, 50], ['L', 0, 78], ['C', 0, 92, 8, 100, 19, 100], ['C', 30, 100, 39, 93, 40, 83], ['L', 40, 50], ['L', 40, 100]]],
    // v — slant right. Slant up. One stroke.
    v: [[['M', 0, 50], ['L', 20, 100], ['L', 40, 50]]],
    // w — slant right. Slant up. Slant right. Slant up. One stroke.
    w: [[['M', 0, 50], ['L', 15, 100], ['L', 30, 50], ['L', 45, 100], ['L', 60, 50]]],
    // x — slant right. Lift. Slant left. Two strokes.
    x: [[['M', 0, 50], ['L', 38, 100]],
        [['M', 38, 50], ['L', 0, 100]]],
    // y — slant right to the base line. Lift. Slant left through it to the bottom line. Two strokes.
    y: [[['M', 0, 50], ['L', 20, 100]],
        [['M', 40, 50], ['L', 0, 150]]],
    // z — slide right. Slant left. Slide right. One stroke.
    z: [[['M', 0, 50], ['L', 38, 50], ['L', 0, 100], ['L', 38, 100]]],
  };

  const ZB_CAPITAL = {
    // A — slant left. Lift. Slant right. Lift. Slide right on the middle line. Three strokes.
    A: [[['M', 38, 0], ['L', 0, 100]],
        [['M', 38, 0], ['L', 76, 100]],
        [['M', 19, 50], ['L', 57, 50]]],
    // B — pull down straight. Lift. Slide right; curve forward; slide left. Slide right; curve forward; slide left. Two strokes.
    B: [[['M', 0, 0], ['L', 0, 100]],
        [['M', 0, 0], ['L', 24, 0], ['C', 37, 0, 48, 11, 48, 25], ['C', 48, 39, 37, 50, 24, 50], ['L', 0, 50], ['L', 27, 50],
         ['C', 41, 50, 52, 61, 52, 75], ['C', 52, 89, 41, 100, 27, 100], ['L', 0, 100]]],
    // C — circle back, stop before it closes. One stroke.
    C: [[['A', 45, 50, 45, 50, -40, -320]]],
    // D — pull down straight. Lift. Slide right; curve forward; slide left. Two strokes.
    D: [[['M', 0, 0], ['L', 0, 100]],
        [['M', 0, 0], ['L', 22, 0], ['C', 48, 0, 68, 22, 68, 50], ['C', 68, 78, 48, 100, 22, 100], ['L', 0, 100]]],
    // E — pull down straight. Lift. Slide right. Lift. Slide right; stop short. Lift. Slide right. Four strokes.
    E: [[['M', 0, 0], ['L', 0, 100]],
        [['M', 0, 0], ['L', 50, 0]],
        [['M', 0, 50], ['L', 40, 50]],
        [['M', 0, 100], ['L', 50, 100]]],
    // F — pull down straight. Lift. Slide right. Lift. Slide right; stop short. Three strokes.
    F: [[['M', 0, 0], ['L', 0, 100]],
        [['M', 0, 0], ['L', 50, 0]],
        [['M', 0, 50], ['L', 40, 50]]],
    // G — circle back round to the middle line. Slide left. One stroke.
    G: [[['A', 45, 50, 45, 50, -40, -360], ['L', 50, 50]]],
    // H — pull down straight. Lift. Pull down straight. Lift. Slide right on the middle line. Three strokes.
    H: [[['M', 0, 0], ['L', 0, 100]],
        [['M', 62, 0], ['L', 62, 100]],
        [['M', 0, 50], ['L', 62, 50]]],
    // I — pull down straight. Lift. Slide right on the top line. Lift. Slide right on the base line. Three strokes.
    I: [[['M', 20, 0], ['L', 20, 100]],
        [['M', 0, 0], ['L', 40, 0]],
        [['M', 0, 100], ['L', 40, 100]]],
    // J — pull down straight; curve back. Lift. Slide right on the top line. Two strokes.
    J: [[['M', 44, 0], ['L', 44, 72], ['C', 44, 89, 35, 100, 22, 100], ['C', 10, 100, 2, 92, 0, 79]],
        [['M', 22, 0], ['L', 66, 0]]],
    // K — pull down straight. Lift. Slant left to the stem. Slant right to the base line. Two strokes.
    K: [[['M', 0, 0], ['L', 0, 100]],
        [['M', 54, 0], ['L', 0, 54], ['L', 56, 100]]],
    // L — pull down straight. Slide right. One stroke.
    L: [[['M', 0, 0], ['L', 0, 100], ['L', 48, 100]]],
    // M — pull down straight. Lift. Slant right. Slant up. Pull down straight. Two strokes.
    M: [[['M', 0, 0], ['L', 0, 100]],
        [['M', 0, 0], ['L', 40, 100], ['L', 80, 0], ['L', 80, 100]]],
    // N — pull down straight. Lift. Slant right. Push up straight. Two strokes.
    N: [[['M', 0, 0], ['L', 0, 100]],
        [['M', 0, 0], ['L', 62, 100], ['L', 62, 0]]],
    // O — circle back all the way around. One stroke.
    O: [[['A', 45, 50, 45, 50, -55, -415]]],
    // P — pull down straight. Lift. Slide right; curve forward; slide left to the stem on the middle line. Two strokes.
    P: [[['M', 0, 0], ['L', 0, 100]],
        [['M', 0, 0], ['L', 24, 0], ['C', 38, 0, 50, 11, 50, 25], ['C', 50, 39, 38, 50, 24, 50], ['L', 0, 50]]],
    // Q — circle back all the way around. Lift. Slant right. Two strokes.
    Q: [[['A', 45, 50, 45, 50, -55, -415]],
        [['M', 54, 66], ['L', 86, 100]]],
    // R — pull down straight. Lift. Slide right; curve forward; slide left. Slant right to the base line. Two strokes.
    R: [[['M', 0, 0], ['L', 0, 100]],
        [['M', 0, 0], ['L', 24, 0], ['C', 38, 0, 50, 11, 50, 25], ['C', 50, 39, 38, 50, 24, 50], ['L', 0, 50], ['L', 52, 100]]],
    // S — curve back. Curve forward. One stroke, a double curve.
    S: [[['M', 61, 17], ['C', 55, 6, 46, 0, 33, 0], ['C', 16, 0, 5, 10, 5, 25], ['C', 5, 41, 20, 46, 33, 50], ['C', 47, 54, 63, 60, 63, 76],
         ['C', 63, 91, 49, 100, 32, 100], ['C', 19, 100, 8, 94, 2, 82]]],
    // T — pull down straight. Lift. Slide right on the top line. Two strokes.
    T: [[['M', 33, 0], ['L', 33, 100]],
        [['M', 0, 0], ['L', 66, 0]]],
    // U — pull down straight; curve forward; push up. One stroke.
    U: [[['M', 0, 0], ['L', 0, 68], ['C', 0, 88, 13, 100, 31, 100], ['C', 49, 100, 62, 88, 62, 68], ['L', 62, 0]]],
    // V — slant right. Slant up. One stroke.
    V: [[['M', 0, 0], ['L', 36, 100], ['L', 72, 0]]],
    // W — slant right. Slant up. Slant right. Slant up. One stroke.
    W: [[['M', 0, 0], ['L', 24, 100], ['L', 48, 0], ['L', 72, 100], ['L', 96, 0]]],
    // X — slant right. Lift. Slant left. Two strokes.
    X: [[['M', 0, 0], ['L', 62, 100]],
        [['M', 62, 0], ['L', 0, 100]]],
    // Y — slant right to the middle. Lift. Slant left to the middle. Pull down straight. Two strokes.
    Y: [[['M', 0, 0], ['L', 33, 50]],
        [['M', 66, 0], ['L', 33, 50], ['L', 33, 100]]],
    // Z — slide right. Slant left. Slide right. One stroke.
    Z: [[['M', 0, 0], ['L', 62, 0], ['L', 0, 100], ['L', 62, 100]]],
  };

  const STYLES = {
    'zaner-bloser': { name: 'Zaner-Bloser manuscript', letters: Object.assign({}, ZB_SMALL, ZB_CAPITAL) },
  };
  const DEFAULT = 'zaner-bloser';

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
    // a curve in n even steps of t. `fastest` is the most the pen can move over t = 0..1 (degree × the longest leg of the
    // control polygon), so two neighbouring points are never more than `step` apart — the same promise a line and an arc keep.
    const curve = (f, fastest) => { const n = Math.max(4, Math.ceil(fastest / step)); for (let i = 1; i <= n; i++) { const p = f(i / n); put(p[0], p[1]); } };
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
          2 * Math.max(Math.hypot(g[1] - x0, g[2] - y0), Math.hypot(g[3] - g[1], g[4] - g[2])));
      } else if (c === 'C') {
        const x0 = x, y0 = y;
        curve(t => { const u = 1 - t; return [u * u * u * x0 + 3 * u * u * t * g[1] + 3 * u * t * t * g[3] + t * t * t * g[5], u * u * u * y0 + 3 * u * u * t * g[2] + 3 * u * t * t * g[4] + t * t * t * g[6]]; },
          3 * Math.max(Math.hypot(g[1] - x0, g[2] - y0), Math.hypot(g[3] - g[1], g[4] - g[2]), Math.hypot(g[5] - g[3], g[6] - g[4])));
      }
    }
    return pts;
  }

  const TRACE = {
    BOX: { top: 0, mid: 50, base: 100, bottom: 150 },
    ABC: 'abcdefghijklmnopqrstuvwxyz'.split(''),
    CAPS: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    STYLES, DEFAULT, STYLE: DEFAULT, LETTERS: STYLES[DEFAULT].letters, sample,
    // swap the whole set; an unknown id changes nothing. Returns the id in use.
    use(id) { if (STYLES[id]) { TRACE.STYLE = id; TRACE.LETTERS = STYLES[id].letters; } return TRACE.STYLE; },
  };
  window.TRACE = TRACE;
})();
