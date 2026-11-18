#!/usr/bin/env python3
"""make-voice.py — the whole words Trace It says, made ONCE on the laptop with the project Piper voice (D-010: whole words may
be synthesised at build time; an isolated letter sound never is — build.py takes those from the Sound Book). Output is
committed in voice/ so the bundle builds the same on a laptop without Piper.

  python3 tablet/apps/trace/make-voice.py [--force] [--check]
        (needs the piper-tts package that ~/.local/bin/piper belongs to + en_US-kristin-medium, ffmpeg for mp3)
        --check   makes nothing: measures the clips that are there and lists the ones outside the limits (exit 1 if any)

What gets a clip (w_<word>.mp3, the key is the word in small letters): every word of lists.json — the Sound Book lesson
words of "word_stages", the starter names and the starter places — that has NO human recording in demo/audio/free/words
(human first, the same order as apps/read: build.py asks for the recording before it asks for these). Clips already there
are kept unless --force; a clip whose word left the lists is removed. A name or a place a family adds on the tablet is
never here (it is not in the repo): the page asks the launcher to speak those.

ONE WORD IS A HARD CASE FOR PIPER (measured 2026-11-16). Given a bare word ("jet") this voice often speaks for seconds:
the word, then a long noisy tail (jet 3.0 s, rock 3.6 s, off 2.6 s, job 2.8 s). Two things cure it, and both are used:
  a full stop     "jet." is a sentence, and the voice ends it: 0.4 s.
  no length noise --noise-w 0: the length of each sound is the voice's own best guess, not a roll of the dice (with the
                  default 0.8 the same text came out between 0.6 s and 1.5 s from one run to the next).
Nobody listens to 78 clips at build time, so every clip is MEASURED — its speech length, from the first to the last sample
louder than 3 % of the peak — and each word is made twice, as "word." and as "word!". The full stop is kept when its speech
fits what a word of that size can take (limit() below) AND is not much longer than the other one; a few words fail that
("rock." carries a half-second tail at any speed, 1.4 s; "rock!" is 0.4 s; "dim." 0.9 s against 0.6 s) and get the "!"
clip. If neither fits, slower-to-faster full-stop clips are tried and the closest is kept, and the word is printed as a
WARNING. voice.json records what each clip was made from and both lengths, so a later ear can find the odd ones.

A LONE WORD NEEDS ITS MAIN STRESS (Joe, on the tablet, 2026-11-17: "this should sound like at and not it. the a is wrong").
The voice's phonemizer treats the little words — at, an, am, it, him — as it would inside a sentence: no main stress, the
weak form. Said alone, the vowel collapses: the old "at" clip measured F1 583 / F2 2516 Hz, the same vowel as this voice's
"hit" (552 / 2553); "an" came out as "in". With the stress mark put back ("ˈat") it measures 930 / 2040, the vowel of "sat",
"hat", "cat" and "pat" (879–995 / 1891–2045). So a single word is never handed to the voice as text: its phonemes are taken,
stressed() gives them a main stress if they have none, and those are what is spoken ("[[…]]"). voice.json keeps them
("phonemes"), --check and tests/trace_dom.py refuse a clip without the mark, and a clip made before the rule is made again.
"""
import json
import re
import shutil
import subprocess
import sys
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent
OUT = HERE / "voice"
VOICE = Path.home() / ".local" / "share" / "piper-voices" / "en_US-kristin-medium.onnx"
LENGTH = 1.08                        # the length apps/read uses for its single words
# how a word is made: (what follows the word, length scale, length noise). The first two always; the rest only if neither fits.
TRIES = [(".", LENGTH, 0.0), ("!", LENGTH, 0.0), (".", 1.0, 0.0), (".", 0.92, 0.0)]
SHORTEST = 0.25                      # s of speech: under this a word has lost a sound
MUCH = 1.4                           # "word." this many times longer than "word!" = the full stop grew a tail
MAIN = "ˈ"                           # the main-stress mark of the voice's phonemes (espeak IPA); "ˌ" is the secondary one
VOWELS = "aeiouɑɐɒæɔəɛɜɪʊʌɚɝᵻ"       # where a mark goes when a word has none: before its first vowel
sys.path.insert(0, str(ROOT / "tools"))
import soundbook  # noqa: E402


def limit(word):
    """The longest speech a word may take, in s: 0.8 for one beat, a quarter of a second more for each further one."""
    w = re.sub(r"[^a-z]", "", word.lower())
    beats = len(re.findall(r"[aeiouy]+", w))
    if beats > 1 and w.endswith("e") and not w.endswith(("le", "ee")):
        beats -= 1                   # the silent e of home, lake, store
    return 0.8 + 0.25 * (max(1, beats) - 1)


def wanted():
    """word (small letters) -> the word as it is written, for everything lists.json offers."""
    lists = json.loads((HERE / "lists.json").read_text(encoding="utf-8"))
    book = soundbook.load()
    out = {}
    for les in book["lessons"]:
        if les.get("stage") in lists.get("word_stages", []):
            for w in les["words"]:
                out.setdefault(w.lower(), w)
    for kind in ("names", "places"):
        for e in lists.get(kind, []):
            out.setdefault(e["w"].lower(), e["w"])
    return out


def stressed(ph):
    """The phonemes of ONE word, with a main stress: a secondary mark is raised, a word with no mark gets one before its
    first vowel. Phonemes that have one already, and anything of more than one word, come back as they are."""
    if MAIN in ph or " " in ph.strip():
        return ph
    if "ˌ" in ph:
        return ph.replace("ˌ", MAIN, 1)
    for i, c in enumerate(ph):
        if c in VOWELS:
            return ph[:i] + MAIN + ph[i:]
    return ph


def plain(voice, text):
    """The phonemes the voice would speak for this text left to itself ("" when it is more than one sentence)."""
    ph = voice.phonemize(text)
    return "".join(ph[0]) if len(ph) == 1 else ""


def speech(samples, rate):
    """(first, last) sample louder than 3 % of the peak, and the seconds between them."""
    import numpy as np
    a = np.abs(samples.astype(np.int32))
    idx = np.nonzero(a > max(1, a.max()) * 0.03)[0]
    if not len(idx):
        return 0, 0, 0.0
    return int(idx[0]), int(idx[-1]), float(idx[-1] - idx[0]) / rate


def measure_mp3(ff, mp3):
    import numpy as np
    raw = subprocess.run([ff, "-loglevel", "error", "-i", str(mp3), "-f", "s16le", "-ac", "1", "-ar", "22050", "-"], capture_output=True).stdout
    return speech(np.frombuffer(raw, dtype=np.int16), 22050)[2]


def main(argv):
    force, check = "--force" in argv, "--check" in argv
    ff = shutil.which("ffmpeg")
    if not ff:
        sys.exit("make-voice: need ffmpeg")
    human = ROOT / "demo" / "audio" / "free" / "words"
    items = {k: t for k, t in wanted().items() if not (human / f"{k}.mp3").is_file()}
    try:
        old = json.loads((OUT / "voice.json").read_text(encoding="utf-8"))["prompts"]
    except (OSError, ValueError, KeyError):
        old = {}
    if check:
        bad = []
        for k in sorted(items):
            mp3 = OUT / f"w_{k}.mp3"
            s = measure_mp3(ff, mp3) if mp3.is_file() else -1
            if not SHORTEST <= s <= limit(k):
                bad.append(f"{k} {s:.2f} s (limit {limit(k):.2f})" if s >= 0 else f"{k} has no clip")
            elif MAIN not in old.get(f"w_{k}", {}).get("phonemes", ""):
                bad.append(f"{k} is said without a main stress (the weak form) — run make-voice.py")
        print(f"make-voice --check: {len(items)} whole-word clips, {len(bad)} outside the limits" + (": " + "; ".join(bad) if bad else ""))
        sys.exit(1 if bad else 0)
    OUT.mkdir(exist_ok=True)
    todo = {k: t for k, t in items.items() if force or not (OUT / f"w_{k}.mp3").is_file() or f"w_{k}" not in old or "speech_s" not in old[f"w_{k}"]}
    made, warn = {}, []
    voice = why = None
    if not VOICE.is_file():
        why = f"need {VOICE}"
    else:
        try:
            import numpy as np
            from piper import PiperVoice, SynthesisConfig
            voice = PiperVoice.load(str(VOICE))
        except ImportError as e:
            why = f"need the piper-tts python package (pip install --user piper-tts): {e}"
    if voice:
        for k, t in items.items():                               # a clip from before the stress rule, of a word the voice leaves weak
            e = old.get(f"w_{k}", {})
            if MAIN not in e.get("phonemes", "") and MAIN not in plain(voice, e.get("text") or t + "."):
                todo.setdefault(k, t)
    if todo:
        if not voice:
            sys.exit(f"make-voice: {why}")
        work = OUT / "_work"
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir()
        for k, t in todo.items():
            cands = []
            for n, (tail, length, noise_w) in enumerate(TRIES):
                ph = stressed(plain(voice, t + tail))            # the word's own phonemes, never without a main stress
                chunks = list(voice.synthesize(f"[[{ph}]]" if ph else t + tail, syn_config=SynthesisConfig(length_scale=length, noise_w_scale=noise_w)))
                a, rate = np.concatenate([c.audio_int16_array for c in chunks]), chunks[0].sample_rate
                first, last, s = speech(a, rate)
                cands.append({"text": t + tail, "phonemes": ph, "length_scale": length, "noise_w": noise_w, "speech_s": round(s, 2),
                              "_off": max(0.0, SHORTEST - s, s - limit(k)),          # how far outside the limits
                              "_audio": a[max(0, first - int(0.04 * rate)):last + int(0.15 * rate)], "_rate": rate})
                if n == 1:
                    stop, bang = cands
                    if not stop["_off"] and not (not bang["_off"] and stop["speech_s"] > MUCH * bang["speech_s"]):
                        best = stop
                        break
                    if not bang["_off"]:
                        best = bang
                        break
            else:
                best = min(cands, key=lambda c: c["_off"])
            best["other_s"] = next(c["speech_s"] for c in cands[:2] if c is not best)
            if best["_off"]:
                warn.append(f"{k} {best['speech_s']:.2f} s (limit {limit(k):.2f})")
            wav, mp3 = work / f"w_{k}.wav", OUT / f"w_{k}.mp3"
            with wave.open(str(wav), "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(best["_rate"]); w.writeframes(best["_audio"].tobytes())
            r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(wav), "-codec:a", "libmp3lame", "-q:a", "5", str(mp3)],
                               capture_output=True, text=True)
            if r.returncode != 0 or not mp3.is_file():
                sys.exit(f"make-voice: ffmpeg failed for {mp3.name}: {r.stderr[-300:]}")
            made[f"w_{k}"] = {"file": f"w_{k}.mp3", **{x: y for x, y in best.items() if not x.startswith("_")}}
            print(f"  {k:12s} {best['text']!r:16} {best['phonemes']:14s} length {best['length_scale']} → {best['speech_s']:.2f} s of speech (the other way {best['other_s']:.2f} s)", flush=True)
        shutil.rmtree(work, ignore_errors=True)
    for stale in OUT.glob("w_*.mp3"):                            # a word that left the lists leaves no orphan clip
        if stale.stem[2:] not in items:
            stale.unlink()
    prompts = {f"w_{k}": made.get(f"w_{k}") or old[f"w_{k}"] for k in sorted(items)}
    if voice:
        for e in prompts.values():                               # a kept clip was spoken from its text: write down what that was
            e.setdefault("phonemes", plain(voice, e["text"]))
    (OUT / "voice.json").write_text(json.dumps({"voice": VOICE.stem, "length_scale": LENGTH, "prompts": prompts}, indent=1, ensure_ascii=False) + "\n",
                                    encoding="utf-8")
    kb = sum((OUT / v["file"]).stat().st_size for v in prompts.values()) / 1024
    print(f"make-voice: {len(prompts)} whole-word clips ({len(made)} made now), {kb:.0f} kB in {OUT}; "
          f"{len(wanted()) - len(items)} more words have a human recording and need none"
          + (f"\nmake-voice: WARNING, still outside the limits — listen to these: {'; '.join(warn)}" if warn else ""))


if __name__ == "__main__":
    main(sys.argv[1:])
