#!/usr/bin/env python3
"""All ComfyUI art for the Reflect + Everquill flagship apps."""
import os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "art")
GEN = os.path.expanduser("~/.claude/scripts/imagegen/comfy_gen.py")
BANNER_STYLE = (", deep navy background, subtle cyan and warm amber rim lighting, "
                "premium studio product photography, minimal dark 3D render, elegant, "
                "sophisticated, no text, no words, no letters, no people")
JOBS = [
  # gallery banners (settled dark-premium style)
  ("banner-reflect.jpg",   "an elegant open leather journal with a fountain pen resting on it, one page softly glowing in moonlight" + BANNER_STYLE, 301, "1216x608", 800),
  ("banner-everquill.jpg", "an ornate feather quill standing in a glowing inkwell, wisps of golden magical light curling upward" + BANNER_STYLE, 302, "1216x608", 800),
  # Reflect in-app header (calm, both themes friendly)
  ("reflect-header.jpg",   "soft abstract atmospheric art, dawn mist drifting over calm water, gentle horizontal gradient, muted teal, warm sand and pale gold tones, serene, painterly, minimal, no text, no people", 303, "1216x512", 900),
  # Everquill title cover
  ("eq-cover.jpg",         "epic painterly fantasy illustration, an ancient glowing quill hovering above an old map on a dark oak desk, candlelight, deep purple and gold palette, cinematic, atmospheric, no text, no people", 304, "1024x768", 900),
  # Everquill genre backdrops
  ("eq-fantasy.jpg",  "atmospheric painterly fantasy game backdrop, misty castle towers above a pine valley at dusk, deep teal and violet, muted, cinematic, no text, no people", 305, "1216x608", 900),
  ("eq-scifi.jpg",    "atmospheric painterly science fiction game backdrop, vast space station corridor window onto a nebula, deep blue and cyan glow, muted, cinematic, no text, no people", 306, "1216x608", 900),
  ("eq-mystery.jpg",  "atmospheric painterly noir mystery game backdrop, foggy gaslit victorian street at night, rain sheen on cobblestones, deep charcoal and amber, cinematic, no text, no people", 307, "1216x608", 900),
  ("eq-pirate.jpg",   "atmospheric painterly pirate adventure game backdrop, tall ship silhouetted against a golden storm sunset at sea, deep teal waves, cinematic, no text, no people", 308, "1216x608", 900),
]
fails = []
for name, prompt, seed, size, maxpx in JOBS:
    out = os.path.join(OUT, name)
    if os.path.exists(out): print("skip", name, flush=True); continue
    r = subprocess.run([sys.executable, GEN, out, prompt, str(seed), "--size", size, "--max", str(maxpx)])
    print(("OK  " if r.returncode == 0 else "FAIL") + " " + name, flush=True)
    if r.returncode: fails.append(name)
print("done;", len(fails), "failed:", fails)
