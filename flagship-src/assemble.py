#!/usr/bin/env python3
"""Assemble Reflect + Everquill: inject art as base64, emit apps-src files."""
import base64, io, json, os
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

def b64(name, width, q):
    im = Image.open(os.path.join(HERE, "art", name)).convert("RGB")
    if im.width > width:
        im = im.resize((width, int(im.height * width / im.width)))
    b = io.BytesIO(); im.save(b, "JPEG", quality=q)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()

def emit(src, out_slug, name, icon_symbol, icon_color, repl):
    html = open(os.path.join(HERE, src)).read()
    for k, v in repl.items():
        assert k in html, k + " missing in " + src
        html = html.replace(k, v)
    assert "%%" not in html, "unfilled placeholder in " + src
    open(os.path.join(ROOT, "apps-src", out_slug + ".html"), "w").write(html)
    json.dump({"name": name, "kind": "html", "iconSymbol": icon_symbol,
               "iconColor": icon_color, "html": html},
              open(os.path.join(ROOT, "apps-src", out_slug + ".myllmapp"), "w"), ensure_ascii=False)
    print(out_slug, len(html) // 1024, "KB")

emit("reflect.html", "reflect", "Reflect", "book.closed.fill", "teal",
     {"%%HEADER_ART%%": b64("reflect-header.jpg", 800, 70)})
emit("everquill.html", "everquill", "Everquill", "wand.and.stars", "purple",
     {"%%ART_COVER%%":   b64("eq-cover.jpg",   700, 70),
      "%%ART_FANTASY%%": b64("eq-fantasy.jpg", 800, 66),
      "%%ART_SCIFI%%":   b64("eq-scifi.jpg",   800, 66),
      "%%ART_MYSTERY%%": b64("eq-mystery.jpg", 800, 66),
      "%%ART_PIRATE%%":  b64("eq-pirate.jpg",  800, 66)})
