#!/usr/bin/env python3
"""make-voice.py — the friend's lines for Music Pads, made ONCE on the laptop with the project Piper voice (D-010: whole
sentences at build time; nothing is synthesised on the tablet). Output is committed in voice/.

  python3 tablet/apps/music/make-voice.py        (needs ~/.local/bin/piper + en_US-kristin-medium, ffmpeg for mp3)
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
PROMPTS = {
    "play": "Tap the bars to play!",
    "listen": "Listen, and watch the lights.",
    "yourturn": "Your turn!",
    "yes": "Yes!",
    "lovely": "Lovely playing!",
    "again": "Not that one. Watch the lights again.",
    "song_done": "You played the whole song!",
    "beat": "Listen to the beat.",
    "beat_done": "You've got the beat!",
    "song_twinkle": "Twinkle, Twinkle, Little Star.",
    "song_mary": "Mary Had a Little Lamb.",
    "song_hotcross": "Hot Cross Buns.",
    "song_row": "Row, Row, Row Your Boat.",
    "song_rain": "Rain, Rain, Go Away.",
}


def main():
    if not PIPER.is_file() or not VOICE.is_file():
        sys.exit(f"make-voice: need {PIPER} and {VOICE}")
    OUT.mkdir(exist_ok=True)
    work = OUT / "_work"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    r = subprocess.run([str(PIPER), "-m", str(VOICE), "--length-scale", LENGTH, "--output-dir", str(work), "--output-dir-naming", "text"],
                       input="\n".join(PROMPTS.values()) + "\n", text=True, capture_output=True)
    if r.returncode != 0:
        sys.exit(f"make-voice: piper failed: {r.stderr[-400:]}")
    ff = shutil.which("ffmpeg")
    made = {}
    for key, text in PROMPTS.items():
        cands = [work / f"{text}.wav", work / f"{text.rstrip('.!?')}.wav"]
        wav = next((c for c in cands if c.is_file()), None) or next((p for p in work.glob("*.wav") if p.stem.lower() == text.rstrip(".!?").lower()), None)
        if wav is None:
            sys.exit(f"make-voice: no wav for {key!r} ({text!r}); have {sorted(p.name for p in work.glob('*.wav'))[:8]}")
        name = f"{key}.wav"
        if ff:
            mp3 = OUT / f"{key}.mp3"
            r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(wav), "-codec:a", "libmp3lame", "-q:a", "5", str(mp3)], capture_output=True, text=True)
            if r.returncode == 0 and mp3.is_file():
                name = mp3.name
        if name.endswith(".wav"):
            shutil.copy2(wav, OUT / name)
        made[key] = {"file": name, "text": text}
    shutil.rmtree(work, ignore_errors=True)
    (OUT / "voice.json").write_text(json.dumps({"voice": VOICE.stem, "length_scale": float(LENGTH), "prompts": made}, indent=1), encoding="utf-8")
    print(f"make-voice: {len(made)} prompts, {sum((OUT / v['file']).stat().st_size for v in made.values()) / 1024:.0f} kB in {OUT}")


if __name__ == "__main__":
    main()
