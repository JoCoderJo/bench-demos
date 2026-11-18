#!/usr/bin/env python3
"""make-voice.py — everything Move to Learn says, made ONCE on the laptop with the project Piper voice (D-010: whole words,
letter NAMES and numbers may be synthesised at build time; never an isolated consonant sound; nothing is synthesised on the
tablet, where speechSynthesis is silent). The clips are committed in voice/, so the bundle builds without Piper.

  python3 tablet/apps/move/make-voice.py [--force] [--only KEY …]     (needs the piper Python package + en_US-kristin-medium, ffmpeg)

  w_<word>     every word in words.js ("cat.")            l_<letter>   the 26 letter names ("B." — the NAME, bee)
  n0, n21..n30 the numbers Count With Me does not have (build.py copies its n1..n20 beside these)
  plus / takeaway / minus / is      the joints of a sum: the page plays  three · plus · five  and  eight · three · plus · five · is · eight
  end1_<5..15> "Great job! You got twelve stars!"         end2_<10..30>  "Great job, both of you! Twenty four stars!"
  intro_*      said once when a round starts              say_<key>    hold-to-hear labels of the start screen's buttons

The model is loaded once (about 13 s on the shop laptop) and every line goes through it; a clip is trimmed to the speech
(sequences need tight edges), levelled to the same peak and written as mono mp3. voice.json lists each clip's text, length and
the phonemes Piper spoke — the quick check for a broken clip (a letter that came out as a word, a clip seconds too long).
A single word always ends in a full stop: without one Piper trails off and the clip is seconds too long. A few still do
("F.", "web.", "crab."): a one-word clip over a second is made again, then with "!" instead, and the shortest is kept.
"""
import io
import json
import re
import shutil
import subprocess
import sys
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "voice"
VOICE = Path.home() / ".local" / "share" / "piper-voices" / "en_US-kristin-medium.onnx"
LENGTH = 1.05
ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
        "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"]


def number(n):
    return ONES[n] if n <= 20 else ("thirty" if n == 30 else "twenty " + ONES[n - 20])


def lines():
    out = {}
    words = re.findall(r"\['([a-z]+)',", (HERE / "words.js").read_text(encoding="utf-8"))
    for w in words:
        out[f"w_{w}"] = w + "."
    for c in "abcdefghijklmnopqrstuvwxyz":
        out[f"l_{c}"] = c.upper() + "."
    out["l_z"] = "Zee."        # the voice's phonemes are espeak "en" (British): "Z." comes out as zed
    for n in [0] + list(range(21, 31)):
        out[f"n{n}"] = number(n) + "."
    out.update({"plus": "plus.", "takeaway": "take away.", "minus": "minus.", "is": "is."})
    for n in range(5, 16):
        out[f"end1_{n}"] = f"Great job! You got {number(n)} stars!"
    for n in range(10, 31):
        out[f"end2_{n}"] = f"Great job, both of you! {number(n).capitalize()} stars!"
    out.update({
        "intro_spell": "Pop the letters to spell the word!",
        "intro_math": "Pop the right answer!",
        "say_spell": "Spelling.", "say_math": "Math.", "say_p1": "One player.", "say_p2": "Two players.",
        "say_gk": "Kindergarten.", "say_g1": "First grade.", "say_g2": "Second grade.",
        "say_hear": "Hear it again.", "say_menu": "Menu.", "say_stop": "Stop.",
    })
    return out


def main(argv):
    force = "--force" in argv
    only = [a for a in argv if not a.startswith("--")]
    ff = shutil.which("ffmpeg") or str(Path.home() / ".local" / "bin" / "ffmpeg")
    if not VOICE.is_file() or not Path(ff).is_file():
        sys.exit(f"make-voice: need {VOICE} and ffmpeg")
    import numpy as np
    from piper import PiperVoice, SynthesisConfig
    want = lines()
    OUT.mkdir(exist_ok=True)
    vj = OUT / "voice.json"
    try:
        index = json.loads(vj.read_text(encoding="utf-8"))["clips"]
    except (OSError, ValueError, KeyError):
        index = {}
    todo = [k for k, t in want.items() if (not only or k in only) and
            (force or not (OUT / f"{k}.mp3").is_file() or index.get(k, {}).get("text") != t)]
    for stale in sorted(set(index) - set(want)):
        (OUT / f"{stale}.mp3").unlink(missing_ok=True)
        index.pop(stale)
    if todo:
        voice = PiperVoice.load(str(VOICE))
        cfg = SynthesisConfig(length_scale=LENGTH)
        for i, k in enumerate(todo):
            text = want[k]
            # one word should last well under a second; now and then Piper trails off into a long breath — try again, keep the shortest
            limit = 1000 if k[:2] in ("w_", "l_") or k in ("plus", "minus", "is", "takeaway", "n0", "n30") else 1400 if k[0] == "n" else 0
            best, spoken = None, text
            # a full stop first; a word that still trails off ("F.", "web.") comes out clean with "!" (measured: F. 2.0 s, F! 0.4 s)
            for attempt in range(6 if limit else 1):
                t = text if attempt < 3 else text.rstrip(".") + "!"
                buf = io.BytesIO()
                with wave.open(buf, "wb") as wf:
                    voice.synthesize_wav(t, wf, syn_config=cfg)
                buf.seek(0)
                with wave.open(buf, "rb") as wf:
                    rate = wf.getframerate()
                    a = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32)
                peak = float(np.abs(a).max()) or 1.0
                loud = np.nonzero(np.abs(a) > peak * 0.02)[0]
                if len(loud):
                    a = a[max(0, loud[0] - int(rate * 0.03)): min(len(a), loud[-1] + int(rate * 0.09))]
                a = (a * (0.89 * 32767 / peak)).clip(-32767, 32767).astype(np.int16)
                if best is None or len(a) < len(best):
                    best, spoken = a, t
                if not limit or 1000 * len(best) / rate <= limit:
                    break
            a = best
            mp3 = OUT / f"{k}.mp3"
            r = subprocess.run([ff, "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", "-",
                                "-codec:a", "libmp3lame", "-q:a", "5", str(mp3)], input=a.tobytes(), capture_output=True)
            if r.returncode != 0 or not mp3.is_file():
                sys.exit(f"make-voice: ffmpeg failed for {k}: {r.stderr.decode()[-300:]}")
            ph = "".join("".join(s) for s in voice.phonemize(spoken))
            index[k] = {"text": text, "ms": round(1000 * len(a) / rate), "phonemes": ph}
            if (i + 1) % 20 == 0 or i + 1 == len(todo):
                print(f"  {i + 1}/{len(todo)}", flush=True)
                vj.write_text(json.dumps({"voice": VOICE.stem, "length_scale": LENGTH, "clips": {k2: index[k2] for k2 in want if k2 in index}},
                                         indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    vj.write_text(json.dumps({"voice": VOICE.stem, "length_scale": LENGTH, "clips": {k: index[k] for k in want if k in index}},
                             indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    missing = [k for k in want if not (OUT / f"{k}.mp3").is_file()]
    kb = sum((OUT / f"{k}.mp3").stat().st_size for k in want if (OUT / f"{k}.mp3").is_file()) / 1024
    print(f"make-voice: {len(want)} clips ({len(todo)} made), {kb:.0f} kB in {OUT}" + (f"; MISSING {missing}" if missing else ""))


if __name__ == "__main__":
    main(sys.argv[1:])
