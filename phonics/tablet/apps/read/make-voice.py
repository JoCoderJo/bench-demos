#!/usr/bin/env python3
"""make-voice.py — the friend's voice for Read It, made ONCE on the laptop with the project Piper voice (D-010: whole
words and whole sentences may be synthesised at build time; isolated letter sounds never are — build.py takes those
from the vouched-for tiers). Output is committed in voice/ so the bundle builds the same on a laptop without Piper.

  python3 tablet/apps/read/make-voice.py        (needs ~/.local/bin/piper + en_US-kristin-medium, ffmpeg for mp3)
  python3 tablet/apps/read/make-voice.py --only w_at w_and      only these sight words again; every other clip is left alone

Three kinds of clip: prompts (p_*), the sight words that have no human recording (w_<word>), and every line of
sentences.json read as one sentence (s_<n>, so a line is read back fluently, not word by word). One piper process for
all of them (--output-dir-naming text), then renamed to their keys and encoded to mp3.

A SIGHT WORD IS A LONE WORD, and the voice gives the little ones (at, and, am, it, is, the …) no main stress, as it would
inside a sentence. Said alone the vowel collapses: "at" measured as the vowel of "hit" and "and" close to "end" (Joe heard
it in Trace It on 2026-11-17: "this should sound like at and not it" — the rule and the numbers are in
apps/trace/make-voice.py). So the sight words are spoken a second time, one by one through the piper package, from their
phonemes WITH a main stress (lone_words() below), as a sentence ("at.") so the voice ends the word instead of trailing off.
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "voice"
PIPER = Path.home() / ".local" / "bin" / "piper"
VOICE = Path.home() / ".local" / "share" / "piper-voices" / "en_US-kristin-medium.onnx"
LENGTH = "1.08"
PROMPTS = {
    "p_tap": "Tap each word to read the line.",
    "p_readit": "Now I will read it.",
    "p_which": "Which picture goes with it?",
    "p_yes": "Yes!",
    "p_great": "Great reading!",
    "p_again": "Not that one. Listen again.",
    "p_find": "Find the word",
    "p_fix": "Put the words in order. Listen.",
    "p_nice": "You read the whole line!",
    "p_sound": "Sound it out.",
    "p_hooray": "Hooray! A new line!",
}


MAIN = "ˈ"                           # the main-stress mark of the voice's phonemes (espeak IPA); "ˌ" is the secondary one
VOWELS = "aeiouɑɐɒæɔəɛɜɪʊʌɚɝᵻ"       # where a mark goes when a word has none: before its first vowel


def stressed(ph):
    """The phonemes of ONE word, with a main stress (the same rule as apps/trace/make-voice.py)."""
    if MAIN in ph or " " in ph.strip():
        return ph
    if "ˌ" in ph:
        return ph.replace("ˌ", MAIN, 1)
    for i, c in enumerate(ph):
        if c in VOWELS:
            return ph[:i] + MAIN + ph[i:]
    return ph


def lone_words(words, ff):
    """{key: text} of single words → {key: voice.json entry}; each is spoken from its stressed phonemes, cut to its speech
    (40 ms before the first sample louder than 3 % of the peak, 150 ms after the last) and written as voice/<key>.mp3."""
    import numpy as np
    from piper import PiperVoice, SynthesisConfig
    voice = PiperVoice.load(str(VOICE))
    out = {}
    for key, text in words.items():
        ph = stressed("".join(voice.phonemize(text + ".")[0]))
        chunks = list(voice.synthesize(f"[[{ph}]]", syn_config=SynthesisConfig(length_scale=float(LENGTH), noise_w_scale=0.0)))
        a, rate = np.concatenate([c.audio_int16_array for c in chunks]), chunks[0].sample_rate
        level = np.abs(a.astype(np.int32))
        loud = np.nonzero(level > max(1, int(level.max())) * 0.03)[0]
        a = a[max(0, int(loud[0]) - int(0.04 * rate)):int(loud[-1]) + int(0.15 * rate)]
        mp3 = OUT / f"{key}.mp3"
        r = subprocess.run([ff, "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", "-",
                            "-codec:a", "libmp3lame", "-q:a", "5", str(mp3)], input=a.tobytes(), capture_output=True)
        if r.returncode != 0 or not mp3.is_file():
            sys.exit(f"make-voice: ffmpeg failed for {mp3.name}: {r.stderr[-300:]!r}")
        out[key] = {"file": mp3.name, "text": text, "phonemes": ph, "speech_s": round(float(loud[-1] - loud[0]) / rate, 2)}
        print(f"  {key:8s} {text!r:8} {ph:10s} {out[key]['speech_s']:.2f} s of speech", flush=True)
    return out


def main():
    if not PIPER.is_file() or not VOICE.is_file():
        sys.exit(f"make-voice: need {PIPER} and {VOICE}")
    data = json.loads((HERE / "sentences.json").read_text(encoding="utf-8"))
    words_dir = HERE.parent.parent.parent / "demo" / "audio" / "free" / "words"
    items = dict(PROMPTS)
    for w in data["sight"]:
        if not (words_dir / f"{w}.mp3").is_file():          # human first: a sight word with a recording needs no Piper
            items[f"w_{w}"] = "I" if w == "i" else w
    sight = {k: t for k, t in items.items() if k.startswith("w_")}
    if "--only" in sys.argv:                                   # some sight words again, nothing else touched
        keys = sys.argv[sys.argv.index("--only") + 1:]
        if not keys or any(k not in sight for k in keys):
            sys.exit(f"make-voice --only: sight-word keys only ({' '.join(sorted(sight))})")
        ff = shutil.which("ffmpeg") or sys.exit("make-voice --only: need ffmpeg")
        vj = json.loads((OUT / "voice.json").read_text(encoding="utf-8"))
        vj["prompts"].update(lone_words({k: sight[k] for k in keys}, ff))
        (OUT / "voice.json").write_text(json.dumps(vj, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"make-voice: {len(keys)} sight words made again in {OUT}")
        return
    for n, line in enumerate(data["lines"]):
        items[f"s_{n}"] = line[0].upper() + line[1:]
    OUT.mkdir(exist_ok=True)
    work = OUT / "_work"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    r = subprocess.run([str(PIPER), "-m", str(VOICE), "--length-scale", LENGTH, "--output-dir", str(work), "--output-dir-naming", "text"],
                       input="\n".join(items.values()) + "\n", text=True, capture_output=True)
    if r.returncode != 0:
        sys.exit(f"make-voice: piper failed: {r.stderr[-400:]}")
    have = {p.stem.lower(): p for p in work.glob("*.wav")}
    ff = shutil.which("ffmpeg")
    made = {}
    for key, text in items.items():
        wav = have.get(text.lower()) or have.get(text.rstrip(".!?").lower()) or have.get(re.sub(r"[^a-z ]", "", text.lower()).strip())
        if wav is None:
            sys.exit(f"make-voice: no wav for {key!r} ({text!r}); have {sorted(have)[:8]}")
        name = f"{key}.wav"
        if ff:
            mp3 = OUT / f"{key}.mp3"
            r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(wav), "-codec:a", "libmp3lame", "-q:a", "5", str(mp3)],
                               capture_output=True, text=True)
            if r.returncode == 0 and mp3.is_file():
                name = mp3.name
        if name.endswith(".wav"):
            shutil.copy2(wav, OUT / name)
        made[key] = {"file": name, "text": text}
    shutil.rmtree(work, ignore_errors=True)
    if ff:                                                     # the sight words once more, each with its main stress
        try:
            made.update(lone_words(sight, ff))
        except ImportError as e:
            print(f"make-voice: WARNING, no piper package ({e}) — the sight words keep the voice's weak forms (pip install --user piper-tts)")
    for old in OUT.glob("*.mp3"):                              # a line removed from sentences.json leaves no orphan clip
        if old.stem not in made:
            old.unlink()
    (OUT / "voice.json").write_text(json.dumps({"voice": VOICE.stem, "length_scale": float(LENGTH), "prompts": made}, indent=1, ensure_ascii=False), encoding="utf-8")
    kb = sum((OUT / v["file"]).stat().st_size for v in made.values()) / 1024
    print(f"make-voice: {len(made)} clips ({sum(k.startswith('s_') for k in made)} lines, {sum(k.startswith('w_') for k in made)} sight words), {kb:.0f} kB in {OUT}")


if __name__ == "__main__":
    main()
