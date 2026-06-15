#!/usr/bin/env python3
"""Build "8-Bit Player" (bring-your-own-ROM NES player) for MyLLMos.

Inlines jsnes (apps-src/jsnes.min.js) into the shell (apps-src/nes-shell.html)
and writes apps-src/nes-emulator.html + .myllmapp + the apps.json entry (Games).
NO ROMs are bundled — the user loads their own .nes files (file picker).
Run:  python3 build_nes.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHELL = os.path.join(HERE, 'apps-src', 'nes-shell.html')
JSNES = os.path.join(HERE, 'apps-src', 'jsnes.min.js')
OUT   = os.path.join(HERE, 'apps-src', 'nes-emulator.html')
WRAP  = os.path.join(HERE, 'apps-src', 'nes-emulator.myllmapp')
MANIFEST = os.path.join(HERE, 'apps.json')
RAWBASE = 'https://raw.githubusercontent.com/TeamDzX/myllm-assets/main'
VERSION = 2

shell = open(SHELL, encoding='utf-8').read()
jsnes = open(JSNES, encoding='utf-8').read()
if '</script>' in jsnes:
    sys.exit('jsnes contains a literal </script> — cannot inline safely')
if '/*__JSNES__*/' not in shell:
    sys.exit('shell is missing the /*__JSNES__*/ placeholder')

html = shell.replace('/*__JSNES__*/', jsnes)
open(OUT, 'w', encoding='utf-8').write(html)
json.dump({"name":"8-Bit Player", "html":html, "kind":"html",
           "iconSymbol":"gamecontroller.fill", "iconColor":"pink"},
          open(WRAP, 'w', encoding='utf-8'), ensure_ascii=False)

m = json.load(open(MANIFEST, encoding='utf-8'))
entry = {
    "id":"nes-emulator", "name":"8-Bit Player", "emoji":"\U0001F3AE",
    "tagline":"Play your own 8-bit ROMs",
    "description":"A bring-your-own-ROM player for classic 8-bit (.nes) games. Load a ROM file you legally own and play it with on-screen controls and sound — runs entirely on your device. No games are included; this is just the player.",
    "tags":["games","retro","emulator","8-bit"],
    "iconSymbol":"gamecontroller.fill", "iconColor":"pink",
    "version":VERSION, "featured":False, "requiresAI":False,
    "banner":RAWBASE+"/apps/nes-emulator.jpg",
    "html":RAWBASE+"/apps-src/nes-emulator.html?v=%d" % VERSION,
    "json":RAWBASE+"/apps-src/nes-emulator.myllmapp",
    "sizeKB":max(1, round(len(html.encode('utf-8'))/1024)), "category":"Games",
}
apps = m["apps"]; by = {a["id"]: i for i, a in enumerate(apps)}
if "nes-emulator" in by: apps[by["nes-emulator"]] = entry
else: apps.append(entry)
json.dump(m, open(MANIFEST, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('OK  nes-emulator.html %d KB | manifest %d apps' % (len(html.encode('utf-8'))//1024, len(apps)))
