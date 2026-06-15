#!/usr/bin/env python3
"""Build "Pocket Player" (bring-your-own-ROM Game Boy / Game Boy Color player).

Self-driven, jsnes-style: WE own the canvas, audio, and input. Engine is binjgb
(binji/binjgb, MIT) — a single-threaded Game Boy / Color core compiled to WASM,
driven directly via its exported functions (no EmulatorJS / RetroArch). The core
is base64-inlined so the player is fully OFFLINE, exactly like 8-Bit Player.

Inlines: binjgb.js (loader) + fflate (zip) + binjgb.wasm (base64) into gb-shell.html
-> apps-src/gb-player.html + .myllmapp + the apps.json entry (Games).
NO ROMs bundled — the user loads their own .gb/.gbc files. Run: python3 build_gb.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHELL  = os.path.join(HERE, 'apps-src', 'gb-shell.html')
BINJGB = os.path.join(HERE, 'apps-src', 'binjgb.js')
WASMB64= os.path.join(HERE, 'apps-src', 'binjgb.wasm.b64')
FFLATE = os.path.join(HERE, 'apps-src', 'fflate.min.js')
OUT    = os.path.join(HERE, 'apps-src', 'gb-player.html')
WRAP   = os.path.join(HERE, 'apps-src', 'gb-player.myllmapp')
MANIFEST = os.path.join(HERE, 'apps.json')
RAWBASE = 'https://raw.githubusercontent.com/TeamDzX/myllm-assets/main'
VERSION = 4

shell  = open(SHELL, encoding='utf-8').read()
binjgb = open(BINJGB, encoding='utf-8').read()
wasmb64= open(WASMB64, encoding='utf-8').read().strip()
fflate = open(FFLATE, encoding='utf-8').read()

for lib, name in ((binjgb, 'binjgb.js'), (fflate, 'fflate')):
    if '</script>' in lib:
        sys.exit(name + ' contains a literal </script> — cannot inline safely')
for ph in ('/*__BINJGB__*/', '/*__FFLATE__*/', '/*__WASM_B64__*/'):
    if ph not in shell:
        sys.exit('shell is missing the ' + ph + ' placeholder')
# sanity: the base64 must be plain (no quotes / script-enders that would break the JS string)
if any(c in wasmb64 for c in ('"', '\\', '<', '\n')):
    sys.exit('binjgb.wasm.b64 contains unexpected characters — re-generate it')

html = (shell.replace('/*__BINJGB__*/', binjgb)
             .replace('/*__FFLATE__*/', fflate)
             .replace('/*__WASM_B64__*/', wasmb64))
open(OUT, 'w', encoding='utf-8').write(html)
json.dump({"name":"Pocket Player", "html":html, "kind":"html",
           "iconSymbol":"gamecontroller.fill", "iconColor":"green"},
          open(WRAP, 'w', encoding='utf-8'), ensure_ascii=False)

m = json.load(open(MANIFEST, encoding='utf-8'))
entry = {
    "id":"gb-player", "name":"Pocket Player", "emoji":"\U0001F3AE",
    "tagline":"Play your own handheld games — in colour",
    "description":"A bring-your-own-ROM player for classic 8-bit handheld games — both the original grey handheld (.gb) and the Color handheld (.gbc), rendered in full colour. Load a ROM file (or a .zip) you legally own and play with on-screen controls — runs entirely on your device, no internet needed. No games are included; this is just the player.",
    "tags":["games","retro","emulator","game boy","handheld","color"],
    "iconSymbol":"gamecontroller.fill", "iconColor":"green",
    "version":VERSION, "featured":False, "requiresAI":False,
    "banner":RAWBASE+"/apps/gb-player.jpg",
    "html":RAWBASE+"/apps-src/gb-player.html?v=%d" % VERSION,
    "json":RAWBASE+"/apps-src/gb-player.myllmapp",
    "sizeKB":max(1, round(len(html.encode('utf-8'))/1024)), "category":"Games",
}
apps = m["apps"]; by = {a["id"]: i for i, a in enumerate(apps)}
if "gb-player" in by: apps[by["gb-player"]] = entry
else: apps.append(entry)
json.dump(m, open(MANIFEST, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('OK  gb-player.html %d KB | manifest %d apps' % (len(html.encode('utf-8'))//1024, len(apps)))
