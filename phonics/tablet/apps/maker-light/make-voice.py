#!/usr/bin/env python3
"""make-voice.py — Piper clips for Light Lab's spoken prompts (D-010: sentences are fine, letter sounds never).
    python3 tablet/apps/maker-light/make-voice.py      (needs ~/.local/bin/piper + en_US-kristin-medium + ffmpeg)
"""
import json, shutil, subprocess, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
OUT = HERE / "voice"
PIPER = Path.home() / ".local" / "bin" / "piper"
VOICE = Path.home() / ".local" / "share" / "piper-voices" / "en_US-kristin-medium.onnx"
PROMPTS = {
    "intro": "Welcome to the Light Lab! Tap the lights to draw.",
    "asleep": "The brain is asleep. Ask a grown-up to wake it.",
    "awake": "The lights are ready!",
    "plug_knob": "You plugged in a knob! Turn it and watch.",
    "plug_buttons": "Buttons! Press one.",
    "plug_buzzer": "A buzzer! Tap the notes to play a tune.",
    "plug_pixels": "Rainbow lights! Tap a colour.",
    "plug_distance": "A distance eye. Wave your hand in front of it.",
    "plug_movement": "A wiggle sensor. Give it a little shake.",
    "plug_thermo": "A thermometer! It feels how warm it is.",
    "unplug": "Bye bye!",
    "kept": "Saved! That picture is yours.",
    "clear": "All clear. Draw something new!",
    "pin_on": "On!",
    "pin_off": "Off.",
}

def main():
    if not PIPER.is_file() or not VOICE.is_file():
        sys.exit(f"make-voice: need {PIPER} and {VOICE}")
    ff = shutil.which("ffmpeg")
    if not ff:
        sys.exit("make-voice: ffmpeg needed for mp3")
    OUT.mkdir(exist_ok=True)
    n = 0
    for key, text in PROMPTS.items():
        mp3 = OUT / f"{key}.mp3"
        if mp3.is_file():
            continue
        wav = OUT / f"{key}.wav"
        r = subprocess.run([str(PIPER), "-m", str(VOICE), "--length-scale", "1.05", "-f", str(wav)], input=text, text=True, capture_output=True)
        if r.returncode != 0 or not wav.is_file():
            sys.exit(f"make-voice: piper failed on {key!r}: {r.stderr[-300:]}")
        subprocess.run([ff, "-loglevel", "error", "-y", "-i", str(wav), "-codec:a", "libmp3lame", "-q:a", "6", str(mp3)], check=True)
        wav.unlink(); n += 1
    (OUT / "index.json").write_text(json.dumps(sorted(p.stem for p in OUT.glob("*.mp3"))))
    kb = sum(p.stat().st_size for p in OUT.glob("*.mp3")) / 1024
    print(f"make-voice: {n} new, {len(list(OUT.glob('*.mp3')))} clips, {kb:.0f} kB")

if __name__ == "__main__":
    main()
