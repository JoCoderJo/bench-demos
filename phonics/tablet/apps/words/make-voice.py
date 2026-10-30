#!/usr/bin/env python3
"""make-voice.py — the friend's prompts for Word Builder, made ONCE on the laptop with the project Piper voice
(D-010: whole words and sentences may be synthesised at build time; isolated letter sounds never are — those come
from vouched-for recordings via build.py). Output is committed in voice/ so the bundle builds the same on a
laptop without Piper.

  python3 tablet/apps/words/make-voice.py        (needs ~/.local/bin/piper + en_US-kristin-medium, ffmpeg for mp3)
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "voice"
PIPER = Path.home() / ".local" / "bin" / "piper"
VOICE = Path.home() / ".local" / "share" / "piper-voices" / "en_US-kristin-medium.onnx"   # demo/audio/manifest.json meta.voice
LENGTH = "1.05"
PROMPTS = {
    "build": "Build the word.",
    "listen": "Listen.",
    "tap": "Tap the letters to spell it.",
    "yes": "Yes! You built",
    "hooray": "Hooray! A new word!",
    "again": "Not quite. Listen to the sounds.",
    "notword": "That is not a word yet. Try another letter.",
    "change": "Change the first letter to make a new word.",
    "which": "Which word is this?",
    "thisone": "It is this one.",
    "allfound": "You found every word in this family!",
    "great": "Great job!",
}


def main():
    if not PIPER.is_file() or not VOICE.is_file():
        sys.exit(f"make-voice: need {PIPER} and {VOICE}")
    OUT.mkdir(exist_ok=True)
    ff = shutil.which("ffmpeg")
    made = {}
    for key, text in PROMPTS.items():
        wav = OUT / f"{key}.wav"
        r = subprocess.run([str(PIPER), "-m", str(VOICE), "--length-scale", LENGTH, "-f", str(wav)],
                           input=text, text=True, capture_output=True)
        if r.returncode != 0 or not wav.is_file():
            sys.exit(f"make-voice: piper failed on {key!r}: {r.stderr[-300:]}")
        name = f"{key}.wav"
        if ff:
            mp3 = OUT / f"{key}.mp3"
            r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(wav), "-codec:a", "libmp3lame", "-q:a", "5", str(mp3)],
                               capture_output=True, text=True)
            if r.returncode == 0 and mp3.is_file():
                wav.unlink()
                name = mp3.name
        made[key] = {"file": name, "text": text}
    (OUT / "voice.json").write_text(json.dumps({"voice": VOICE.stem, "length_scale": float(LENGTH), "prompts": made},
                                               indent=1), encoding="utf-8")
    kb = sum((OUT / v["file"]).stat().st_size for v in made.values()) / 1024
    print(f"make-voice: {len(made)} prompts, {kb:.0f} kB in {OUT}")


if __name__ == "__main__":
    main()
