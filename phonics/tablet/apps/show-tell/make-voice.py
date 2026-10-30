#!/usr/bin/env python3
"""make-voice.py — Piper clips for Show-and-tell: every kid word in words.json + the prompts, as mp3 in voice/.
Build-time on the laptop (D-010: whole words via Piper are fine, isolated letter sounds never). Project voice en_US-kristin-medium.
    python3 tablet/apps/show-tell/make-voice.py        (needs ~/.local/bin/piper + the voice + ffmpeg)
"""
import json, shutil, subprocess, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
OUT = HERE / "voice"
PIPER = Path.home() / ".local" / "bin" / "piper"
VOICE = Path.home() / ".local" / "share" / "piper-voices" / "en_US-kristin-medium.onnx"
PROMPTS = {
    "_intro": "Show me something! Hold it up to the camera and tap the button.",
    "_looking": "Let me look.",
    "_itis": "It's a",
    "_itis_an": "It's an",
    "_unsure": "Hmm, I'm not sure. Show me again, nice and close.",
    "_found": "You found it! Into your collection.",
    "_again": "Again? Show me something else!",
    "_yay": "Hooray!",
}
VOWELS = "aeiou"

def main():
    if not PIPER.is_file() or not VOICE.is_file():
        sys.exit(f"make-voice: need {PIPER} and {VOICE}")
    ff = shutil.which("ffmpeg")
    if not ff:
        sys.exit("make-voice: ffmpeg needed for mp3")
    OUT.mkdir(exist_ok=True)
    words = sorted({w for w, _ in json.loads((HERE / "words.json").read_text())["rules"]})
    items = dict(PROMPTS)
    for w in words:
        items[w] = w                                   # the bare word
        items[w + "_s"] = ("an " if w[0] in VOWELS else "a ") + w + "!"   # "a banana!"
    n = 0
    for key, text in items.items():
        mp3 = OUT / f"{key}.mp3"
        if mp3.is_file():
            continue
        wav = OUT / f"{key}.wav"
        r = subprocess.run([str(PIPER), "-m", str(VOICE), "--length-scale", "1.05", "-f", str(wav)], input=text, text=True, capture_output=True)
        if r.returncode != 0 or not wav.is_file():
            sys.exit(f"make-voice: piper failed on {key!r}: {r.stderr[-300:]}")
        subprocess.run([ff, "-loglevel", "error", "-y", "-i", str(wav), "-codec:a", "libmp3lame", "-q:a", "6", str(mp3)], check=True)
        wav.unlink(); n += 1
    kb = sum(p.stat().st_size for p in OUT.glob("*.mp3")) / 1024
    (OUT / "index.json").write_text(json.dumps(sorted(p.stem for p in OUT.glob("*.mp3"))))
    print(f"make-voice: {n} new, {len(list(OUT.glob('*.mp3')))} clips, {kb:.0f} kB")

if __name__ == "__main__":
    main()
