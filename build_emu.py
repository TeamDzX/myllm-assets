#!/usr/bin/env python3
"""Build "Retro Player" (multi-system emulator, EmulatorJS) for MyLLMos.

Inlines fflate (zip support) into retro-shell.html; EmulatorJS itself + its
RetroArch WASM cores load on demand from cdn.emulatorjs.org (which sends
Access-Control-Allow-Origin:* so it works on the sandbox's null origin).
NO ROMs bundled — bring your own. Run: python3 build_emu.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHELL = os.path.join(HERE, 'apps-src', 'retro-shell.html')
FFLATE = os.path.join(HERE, 'apps-src', 'fflate.min.js')
OUT   = os.path.join(HERE, 'apps-src', 'retro-player.html')
WRAP  = os.path.join(HERE, 'apps-src', 'retro-player.myllmapp')
MANIFEST = os.path.join(HERE, 'apps.json')
RAWBASE = 'https://raw.githubusercontent.com/TeamDzX/myllm-assets/main'
VERSION = 8

shell = open(SHELL, encoding='utf-8').read()
fflate = open(FFLATE, encoding='utf-8').read()
if '</script>' in fflate:
    sys.exit('fflate contains a literal </script> — cannot inline safely')
if '/*__FFLATE__*/' not in shell:
    sys.exit('shell is missing the /*__FFLATE__*/ placeholder')

html = shell.replace('/*__FFLATE__*/', fflate)
open(OUT, 'w', encoding='utf-8').write(html)
json.dump({"name":"Retro Player", "html":html, "kind":"html",
           "iconSymbol":"gamecontroller.fill", "iconColor":"indigo"},
          open(WRAP, 'w', encoding='utf-8'), ensure_ascii=False)

m = json.load(open(MANIFEST, encoding='utf-8'))
entry = {
    "id":"retro-player", "name":"Retro Player", "emoji":"\U0001F3AE",
    "tagline":"Your own retro games — many systems",
    "description":"A bring-your-own-ROM player for classic consoles — NES, SNES, Game Boy / Color, Game Boy Advance, and Sega Genesis. Load a ROM file (or a .zip) you legally own and play with on-screen controls, sound, and save states. No games are included; this is just the player. The first time you load a system it downloads that console's core, so it needs internet.",
    "tags":["games","retro","emulator","snes","game boy"],
    "iconSymbol":"gamecontroller.fill", "iconColor":"indigo",
    "version":VERSION, "featured":False, "requiresAI":False,
    "banner":RAWBASE+"/apps/retro-player.jpg",
    "html":RAWBASE+"/apps-src/retro-player.html?v=%d" % VERSION,
    "json":RAWBASE+"/apps-src/retro-player.myllmapp",
    "sizeKB":max(1, round(len(html.encode('utf-8'))/1024)), "category":"Games",
}
apps = m["apps"]; by = {a["id"]: i for i, a in enumerate(apps)}
if "retro-player" in by: apps[by["retro-player"]] = entry
else: apps.append(entry)
json.dump(m, open(MANIFEST, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('OK  retro-player.html %d KB | manifest %d apps' % (len(html.encode('utf-8'))//1024, len(apps)))
