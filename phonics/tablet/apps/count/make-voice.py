#!/usr/bin/env python3
"""make-voice.py — the friend's voice for Count With Me, made ONCE on the laptop with the project Piper voice
(D-010: whole words and sentences may be synthesised at build time; nothing is synthesised on the tablet).
Output is committed in voice/ so the bundle builds the same on a laptop without Piper. "ten" has a human
recording in demo/audio/free/words — build.py prefers it (human first), so the Piper ten is only a fallback.

  python3 tablet/apps/count/make-voice.py        (needs ~/.local/bin/piper + en_US-kristin-medium, ffmpeg for mp3)

One piper process for every line (--output-dir-naming text), then the wavs are renamed to their keys and
re-encoded to mp3. Roughly 5 s a clip on the shop laptop.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "voice"
PIPER = Path.home() / ".local" / "bin" / "piper"
VOICE = Path.home() / ".local" / "share" / "piper-voices" / "en_US-kristin-medium.onnx"
LENGTH = "1.05"
NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
           "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"]
SHAPES = {"circle": "circle", "square": "square", "triangle": "triangle", "star": "star", "heart": "heart", "rectangle": "rectangle"}
COLORS = ["red", "blue", "green", "yellow", "orange", "purple"]
PROMPTS = {
    "count": "Count with me!",
    "howmany": "How many do you see?",
    "tapeach": "Tap each one to count it.",
    "tapnum": "Now tap the number.",
    "yes": "Yes!",
    "great": "Great counting!",
    "together": "Not quite. Let's count them together.",
    "again": "Try again.",
    "shapes": "Let's find shapes!",
    "add": "Let's add!",
    "and": "and",
    "more": "more.",
    "altogether": "How many altogether?",
    "makes": "makes",
}
for i, n in enumerate(NUMBERS, 1):
    PROMPTS[f"n{i}"] = n
for s in SHAPES:
    PROMPTS[f"shape_{s}"] = f"Find the {s}."
    PROMPTS[f"is_{s}"] = f"A {s}!"
for c in COLORS:
    PROMPTS[f"color_{c}"] = f"Find the {c} one."
    PROMPTS[f"isc_{c}"] = f"It's {c}!"
    for s in SHAPES:
        PROMPTS[f"cs_{c}_{s}"] = f"Find the {c} {s}."


def main():
    if not PIPER.is_file() or not VOICE.is_file():
        sys.exit(f"make-voice: need {PIPER} and {VOICE}")
    OUT.mkdir(exist_ok=True)
    work = OUT / "_work"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    lines = "\n".join(PROMPTS.values()) + "\n"
    r = subprocess.run([str(PIPER), "-m", str(VOICE), "--length-scale", LENGTH, "--output-dir", str(work), "--output-dir-naming", "text"],
                       input=lines, text=True, capture_output=True)
    if r.returncode != 0:
        sys.exit(f"make-voice: piper failed: {r.stderr[-400:]}")
    ff = shutil.which("ffmpeg")
    made = {}
    for key, text in PROMPTS.items():
        cands = [work / f"{text}.wav", work / f"{text.rstrip('.!?')}.wav"]
        wav = next((c for c in cands if c.is_file()), None)
        if wav is None:
            wav = next((p for p in work.glob("*.wav") if p.stem.lower() == text.rstrip(".!?").lower()), None)
        if wav is None:
            sys.exit(f"make-voice: no wav for {key!r} ({text!r}); have {sorted(p.name for p in work.glob('*.wav'))[:8]}")
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
    (OUT / "voice.json").write_text(json.dumps({"voice": VOICE.stem, "length_scale": float(LENGTH), "prompts": made},
                                               indent=1), encoding="utf-8")
    kb = sum((OUT / v["file"]).stat().st_size for v in made.values()) / 1024
    print(f"make-voice: {len(made)} prompts, {kb:.0f} kB in {OUT}")


if __name__ == "__main__":
    main()
