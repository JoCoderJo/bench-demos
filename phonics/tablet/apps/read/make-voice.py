#!/usr/bin/env python3
"""make-voice.py — the friend's voice for Read It, made ONCE on the laptop with the project Piper voice (D-010: whole
words and whole sentences may be synthesised at build time; isolated letter sounds never are — build.py takes those
from the vouched-for tiers). Output is committed in voice/ so the bundle builds the same on a laptop without Piper.

  python3 tablet/apps/read/make-voice.py        (needs ~/.local/bin/piper + en_US-kristin-medium, ffmpeg for mp3)

Three kinds of clip: prompts (p_*), the sight words that have no human recording (w_<word>), and every line of
sentences.json read as one sentence (s_<n>, so a line is read back fluently, not word by word). One piper process for
all of them (--output-dir-naming text), then renamed to their keys and encoded to mp3.
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


def main():
    if not PIPER.is_file() or not VOICE.is_file():
        sys.exit(f"make-voice: need {PIPER} and {VOICE}")
    data = json.loads((HERE / "sentences.json").read_text(encoding="utf-8"))
    words_dir = HERE.parent.parent.parent / "demo" / "audio" / "free" / "words"
    items = dict(PROMPTS)
    for w in data["sight"]:
        if not (words_dir / f"{w}.mp3").is_file():          # human first: a sight word with a recording needs no Piper
            items[f"w_{w}"] = "I" if w == "i" else w
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
    for old in OUT.glob("*.mp3"):                              # a line removed from sentences.json leaves no orphan clip
        if old.stem not in made:
            old.unlink()
    (OUT / "voice.json").write_text(json.dumps({"voice": VOICE.stem, "length_scale": float(LENGTH), "prompts": made}, indent=1), encoding="utf-8")
    kb = sum((OUT / v["file"]).stat().st_size for v in made.values()) / 1024
    print(f"make-voice: {len(made)} clips ({sum(k.startswith('s_') for k in made)} lines, {sum(k.startswith('w_') for k in made)} sight words), {kb:.0f} kB in {OUT}")


if __name__ == "__main__":
    main()
