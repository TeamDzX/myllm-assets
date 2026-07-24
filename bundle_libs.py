#!/usr/bin/env python3
"""
Vendor external libraries INTO a gallery app so it is self-contained and passes
scan_app.py — no remote <script>/<link> that could be swapped after review.

We keep the exact pinned library bytes in libs/ (so we own/host them), and this
script inlines them in place of the external tags. Idempotent: once a tag is
inlined it's gone, so re-running is a no-op for that app.

Usage:
    python3 bundle_libs.py apps-src/near-me.html [more.html ...]

Registry maps a URL substring → (local lib file in libs/, kind). Add entries as
more apps are de-CDN'd.
"""
import sys, re, os

LIBS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "libs")

# url-substring : (libs/ filename, "script"|"style", human label)
REGISTRY = {
    "leaflet@1.9.4/dist/leaflet.js":  ("leaflet-1.9.4.js",  "script", "Leaflet 1.9.4"),
    "leaflet@1.9.4/dist/leaflet.css": ("leaflet-1.9.4.css", "style",  "Leaflet 1.9.4 CSS"),
    "hanzi-writer@3.5/dist/hanzi-writer.min.js": ("hanzi-writer-3.5.min.js", "script", "HanziWriter 3.5"),
}


def load(libfile):
    path = os.path.join(LIBS, libfile)
    with open(path, encoding="utf-8") as f:
        return f.read()


def guard(content, kind):
    # A closing tag inside inline content would end the block early. Neutralise
    # it in a way that's harmless inside JS/CSS.
    tag = "script" if kind == "script" else "style"
    return re.sub(rf"</\s*{tag}", rf"<\\/{tag}", content, flags=re.I)


def inline_tag(html, url_sub, libfile, kind, label):
    content = guard(load(libfile), kind)
    if kind == "script":
        # <script ... src="...url_sub..." ...></script>
        pat = re.compile(r"<script\b[^>]*\bsrc\s*=\s*[\"'][^\"']*" +
                         re.escape(url_sub) + r"[^\"']*[\"'][^>]*>\s*</script>", re.I)
        repl = f"<script>/* vendored: {label} — see libs/{libfile} */\n{content}\n</script>"
    else:
        # <link ... href="...url_sub..." ...> (self-closing or not)
        pat = re.compile(r"<link\b[^>]*\bhref\s*=\s*[\"'][^\"']*" +
                         re.escape(url_sub) + r"[^\"']*[\"'][^>]*/?>", re.I)
        repl = f"<style>/* vendored: {label} — see libs/{libfile} */\n{content}\n</style>"
    new, n = pat.subn(lambda _: repl, html)
    return new, n


def process(path):
    with open(path, encoding="utf-8") as f:
        html = f.read()
    total = 0
    for url_sub, (libfile, kind, label) in REGISTRY.items():
        if url_sub not in html:          # only vendor libs this app actually loads
            continue
        html, n = inline_tag(html, url_sub, libfile, kind, label)
        if n:
            print(f"  inlined {label}  ({n}x)")
            total += n
    if total:
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"  -> wrote {path}  ({round(os.path.getsize(path)/1024)} KB)")
    else:
        print(f"  no registered external libs found in {path} (already vendored?)")
    return total


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    for path in argv[1:]:
        print(f"=== {path} ===")
        process(path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
