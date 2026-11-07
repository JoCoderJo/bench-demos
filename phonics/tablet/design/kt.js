/* kt.js — the kid-tier helper every tile loads (PLAN §15 D-054 / D-090). No dependencies, offline, one file.
   Include after tiers.css:  <link rel="stylesheet" href="design/tiers.css"><script src="design/kt.js"></script>
   What it does, by itself, on load (window.KT_NO_AUTO = true to opt out and call KT.init() yourself):
     tier     reads the launcher's hello (kid.tier, else kid.age → tier), or ?tier= on a laptop, sets <html data-tier>,
              data-theme, data-hand, and fires window 'kt:tier' so a tile can relayout
     tap      the forgiving touch helper (pointerdown+up within 36 px → click) the tiles used to inline, now tier-aware:
              pre-reader activates plain tappables on pointerdown (Sesame rule); anything with data-say or .kt-hear waits
              for pointerup (navigation stays on release) and a long hold on it hears the label instead of activating
     holdover ignores a touch that lands within TIERS.holdoverPx of the last activated target inside holdoverMs (Anthony 2013)
     sounds   6 structured earcons (press, success, error, navigate, time-warning, time-up) made with WebAudio; sound on
              every touch for the kid tiers; every sound adds a .kt-pulse-<name> class on its target = the visual twin
     hear     hold-to-hear: data-say="clip.mp3" plays the clip; else data-say-text / aria-label is sent to the launcher
              as {kt:'say', text} (the launcher owns the voice); the element pulses while it speaks
     focus    arrow keys (a D-pad / knob / keyboard) move focus between tappables geometrically; Enter/Space activate
     audit    KT.audit() lists what breaks the current tier (target size, bottom dead zone, 12 px type floor, no label);
              tests/tier_audit.py runs its own copy of the same rules from outside the page
   API: KT.tier, KT.TIERS, KT.tierFor(kid), KT.setTier(name), KT.apply(hello), KT.sound(name, el), KT.say(elOrText),
        KT.tappables(root), KT.audit(root), KT.init(opts), KT.version */
(function () {
  'use strict';
  if (window.KT) return;
  /*__TIERS__*/ const TIERS = {"pre-reader":{"target":112,"gap":24,"deadBottom":60,"typeMin":12,"hold":300,"motion":200,"down":true,"holdoverMs":300,"holdoverPx":117,"soundOnTouch":true,"voiceLabels":true,"labelWords":0,"drag":false,"sentences":false},"reader":{"target":75,"gap":8,"deadBottom":0,"typeMin":12,"hold":350,"motion":160,"down":false,"holdoverMs":200,"holdoverPx":80,"soundOnTouch":true,"voiceLabels":true,"labelWords":4,"drag":true,"sentences":false},"tinkerer":{"target":56,"gap":8,"deadBottom":0,"typeMin":12,"hold":400,"motion":120,"down":false,"holdoverMs":0,"holdoverPx":0,"soundOnTouch":false,"voiceLabels":false,"labelWords":12,"drag":true,"sentences":true},"maker":{"target":48,"gap":8,"deadBottom":0,"typeMin":12,"hold":500,"motion":120,"down":false,"holdoverMs":0,"holdoverPx":0,"soundOnTouch":false,"voiceLabels":false,"labelWords":999,"drag":true,"sentences":true},"_gain":{"earcon":0.25,"voice":1}}; /*__/TIERS__*/
  const NAMES = ['pre-reader', 'reader', 'tinkerer', 'maker'];
  const TAP = 'button,select,[role=button],a[href],.kt-tap,[data-kt-tap],.card,.item,.wd,.tile,.thing,.num,.shape,.opt,.fw';
  const html = document.documentElement;
  const KT = { version: '1.1.0', TIERS, tier: null, ceiling: 1, _hello: null };
  const T = () => TIERS[KT.tier] || TIERS.reader;
  const now = () => Date.now();
  const post = m => { try { if (parent !== window) parent.postMessage(m, '*'); } catch (e) { } };

  // ---------- tier
  KT.tierFor = function (kid) {
    kid = kid || {};
    if (NAMES.includes(kid.tier)) return kid.tier;
    const a = +kid.age || 0;
    if (!a) return 'reader';
    return a <= 5 ? 'pre-reader' : a <= 8 ? 'reader' : a <= 12 ? 'tinkerer' : 'maker';
  };
  KT.setTier = function (name) {
    if (!NAMES.includes(name)) name = 'reader';
    const changed = name !== KT.tier;
    KT.tier = name;
    html.dataset.tier = name;
    if (changed) {
      window.dispatchEvent(new CustomEvent('kt:tier', { detail: { tier: name, t: T() } }));
      // a tile that sizes a <canvas> or a grid from its CSS box re-fits on resize; the tier just changed that box
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
    return name;
  };
  KT.apply = function (d) {           // the launcher's hello (apps/README.md "Talking to the launcher")
    KT._hello = d;
    KT.setTier(KT.tierFor(d.kid || d.child));
    if (d.theme === 'dark' || d.theme === 'light') html.dataset.theme = d.theme; else delete html.dataset.theme;
    if (d.hand === 'left') html.dataset.hand = 'left'; else delete html.dataset.hand;
    if (d.motion === 'off') html.dataset.motion = 'off'; else delete html.dataset.motion;
    const s = d.sound;
    KT.ceiling = typeof s === 'number' ? (s > 1 ? s / 100 : s) : (s && typeof s.volume === 'number') ? (s.volume > 1 ? s.volume / 100 : s.volume) : 1;
    KT.ceiling = Math.max(0, Math.min(1, KT.ceiling));
  };

  // ---------- earcons (structured two-note motifs, musical timbre; <150 ms for press)
  const MOTIF = {
    press: [[660, 0.06, 'triangle']],
    success: [[523, 0.09, 'triangle'], [659, 0.12, 'triangle']],
    error: [[392, 0.12, 'sine'], [330, 0.16, 'sine']],
    navigate: [[880, 0.05, 'triangle'], [1046, 0.06, 'triangle']],
    'time-warning': [[660, 0.1, 'triangle'], [660, 0.1, 'triangle'], [880, 0.18, 'triangle']],
    'time-up': [[784, 0.14, 'sine'], [659, 0.14, 'sine'], [523, 0.14, 'sine'], [392, 0.26, 'sine']],
  };
  let ctx = null;
  function audio() {
    if (ctx) return ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; }
    return ctx;
  }
  KT.sound = function (name, el) {
    const m = MOTIF[name] || MOTIF.press;
    const target = el && el.classList ? el : html;
    const cls = 'kt-pulse-' + name;
    target.classList.remove(cls); void target.offsetWidth; target.classList.add(cls);     // the visual twin (D-090)
    setTimeout(() => target.classList.remove(cls), 1400);
    const c = audio();
    const gain = (TIERS._gain ? TIERS._gain.earcon : 0.25) * KT.ceiling;
    if (!c || gain <= 0) return false;
    if (c.state === 'suspended') { try { c.resume(); } catch (e) { } }
    let t = c.currentTime + 0.005;
    for (const [f, d, type] of m) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d + 0.02);
      t += d * 0.9;
    }
    return true;
  };

  // ---------- hold-to-hear
  let saying = null;
  KT.say = function (x) {
    let el = null, text = '', clip = '';
    if (x && x.nodeType === 1) { el = x; clip = el.dataset.say || ''; text = el.dataset.sayText || el.getAttribute('aria-label') || el.textContent.trim() || el.getAttribute('title') || ''; }
    else text = String(x || '');
    if (!clip && !text) return false;
    const target = el || html;
    target.classList.add('kt-pulse-say'); setTimeout(() => target.classList.remove('kt-pulse-say'), 1000);
    if (saying) { try { saying.pause(); } catch (e) { } saying = null; }
    if (clip && clip.match(/\.(mp3|wav|ogg|m4a|webm)$/i)) {
      const a = new Audio(clip); a.volume = Math.max(0, Math.min(1, (TIERS._gain ? TIERS._gain.voice : 1) * KT.ceiling));
      saying = a; const p = a.play(); if (p && p.catch) p.catch(() => post({ kt: 'say', text }));
    } else {
      post({ kt: 'say', text });
    }
    window.dispatchEvent(new CustomEvent('kt:say', { detail: { text, clip, el } }));
    return true;
  };

  // ---------- tappables + audit (the in-page copy of tests/tier_audit.py's rules)
  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0 || cs.pointerEvents === 'none') return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    return true;
  }
  KT.tappables = function (root) {
    return Array.from((root || document).querySelectorAll(TAP)).filter(el => !el.disabled && !el.hasAttribute('aria-hidden') && visible(el));
  };
  function label(el) { return (el.getAttribute('aria-label') || el.dataset.sayText || el.dataset.say || el.textContent || el.getAttribute('title') || '').trim(); }
  function describe(el) {
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
      + (label(el) ? ' "' + label(el).slice(0, 24) + '"' : '');
  }
  function inScroller(el) {   // inside an element that scrolls vertically → the list may run under the bottom edge
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 1) return true;
    }
    return false;
  }
  KT.audit = function (root) {
    const t = T(), out = [];
    for (const el of KT.tappables(root)) {
      const r = el.getBoundingClientRect(), w = Math.round(r.width), h = Math.round(r.height);
      if (Math.min(w, h) < t.target) out.push({ rule: 'target', el: describe(el), w, h, min: t.target });
      if (t.deadBottom > 0 && r.bottom > innerHeight - t.deadBottom && !inScroller(el)) out.push({ rule: 'dead-bottom', el: describe(el), bottom: Math.round(innerHeight - r.bottom), min: t.deadBottom });
      if (!label(el)) out.push({ rule: 'no-label', el: describe(el) });
    }
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (seen.has(el) || !visible(el)) continue;
      let own = false;
      for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { own = true; break; }
      if (!own) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < t.typeMin) out.push({ rule: 'type-floor', el: describe(el), px: Math.round(fs * 10) / 10, min: t.typeMin });
    }
    return out;
  };

  // ---------- touch: forgiving tap, pointerdown activation, holdover filter, hold-to-hear, sound on touch
  let installed = false;
  function install(opts) {
    if (installed) return; installed = true;
    const sel = (opts && opts.tap) ? TAP + ',' + opts.tap : TAP;
    let pt = null, lastClick = 0, lastAct = null, holdTimer = 0;
    const hears = el => !!(el.dataset.say || el.dataset.sayText || el.classList.contains('kt-hear'));
    const activate = (el, x, y) => {
      lastAct = { el, x, y, t: now() };
      lastClick = now();
      el.__ktSwallow = now() + 700;      // the browser's own click for this gesture must not fire twice
      if (el.disabled) return;
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
      ev.__kt = true;                    // our click: the capture guard below lets it through and swallows the native one
      el.dispatchEvent(ev);
    };
    document.addEventListener('click', e => {
      const b = e.target.closest ? e.target.closest(sel) : null;
      if (b && b.__ktSwallow && now() < b.__ktSwallow && !e.__kt) { b.__ktSwallow = 0; e.stopImmediatePropagation(); e.preventDefault(); return; }
      lastClick = now();
    }, true);
    document.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;        // a mouse is a laptop: native clicks are fine
      const b = e.target.closest ? e.target.closest(sel) : null;
      if (!b) return;
      const t = T();
      if (t.holdoverMs && lastAct && b !== lastAct.el && now() - lastAct.t < t.holdoverMs && Math.hypot(e.clientX - lastAct.x, e.clientY - lastAct.y) < t.holdoverPx) {
        e.preventDefault(); e.stopPropagation(); pt = null; return;   // a holdover: the finger is still where the last target was
      }
      if (t.soundOnTouch) KT.sound('press', b);
      b.classList.add('kt-press');
      pt = { b, x: e.clientX, y: e.clientY, t: now(), id: e.pointerId, heard: false };
      if (t.voiceLabels && hears(b)) {
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => { if (pt && pt.b === b) { pt.heard = true; KT.say(b); } }, t.hold);
      } else if (t.down && !b.hasAttribute('data-kt-up')) {
        activate(b, e.clientX, e.clientY); pt.done = true;
      }
    }, true);
    const up = e => {
      clearTimeout(holdTimer);
      if (!pt || e.pointerId !== pt.id) return;
      const p = pt; pt = null;
      p.b.classList.remove('kt-press');
      if (p.done || p.heard) { p.b.__ktSwallow = now() + 700; return; }   // already activated on down, or the hold was a listen
      if (now() - p.t > 750 || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 36) return;
      setTimeout(() => { if (now() - lastClick > 80) activate(p.b, e.clientX, e.clientY); }, 35);
    };
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', () => { clearTimeout(holdTimer); if (pt) pt.b.classList.remove('kt-press'); pt = null; }, true);
    // arrow keys from a D-pad / knob / keyboard: geometric focus move; Enter/Space activates (roving focus, D-090)
    document.addEventListener('keydown', e => {
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      const a = document.activeElement;
      if ((e.key === 'Enter' || e.key === ' ') && a && a.matches && a.matches(sel) && a.tagName !== 'BUTTON' && a.tagName !== 'A') { e.preventDefault(); activate(a, 0, 0); return; }
      if (!dir) return;
      const list = KT.tappables();
      if (!list.length) return;
      const cur = a && a !== document.body && list.includes(a) ? a : null;
      let best = null, bd = Infinity;
      if (!cur) best = list[0];
      else {
        const cr = cur.getBoundingClientRect(), cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
        for (const el of list) {
          if (el === cur) continue;
          const r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
          const along = dx * dir[0] + dy * dir[1], across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
          if (along <= 4) continue;
          const d = along + across * 2.5;
          if (d < bd) { bd = d; best = el; }
        }
      }
      if (best) { if (best.tabIndex < 0) best.tabIndex = 0; best.focus({ preventScroll: false }); e.preventDefault(); }
    });
  }

  // ---------- init
  KT.init = function (opts) {
    opts = opts || {};
    const q = new URLSearchParams(location.search);
    if (!KT.tier) KT.setTier(NAMES.includes(q.get('tier')) ? q.get('tier') : KT.tierFor(opts.kid));
    if (q.get('theme') === 'dark' || q.get('theme') === 'light') html.dataset.theme = q.get('theme');
    if (q.get('hand') === 'left') html.dataset.hand = 'left';
    window.addEventListener('message', e => { const d = e.data || {}; if (d.kt === 'hello') KT.apply(d); });
    install(opts);
    return KT;
  };
  window.KT = KT;
  if (!window.KT_NO_AUTO) KT.init(window.KT_OPTS);   // at once: kt.js sits in <head>, so data-tier is set before the tile's own script runs
})();
