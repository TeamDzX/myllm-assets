#!/usr/bin/env python3
"""
Make apps-src/hanyu.html self-contained (passes scan_app.py):
  1. inline HanziWriter from libs/ (via bundle_libs registry)
  2. subset + inline Font Awesome 6.4.0 (only the icons Hanyu actually uses),
     fonts embedded as base64 woff2 — no remote stylesheet/webfonts
  3. replace the 4 remote YouTube <iframe> embeds with tap-to-open thumbnails
     (thumbnail is a remote image = allowed; the link opens in Safari)

Idempotent-ish: re-running re-derives from the current file. Keep libs/fa/*
(the pinned FA source) in the repo. Run after any build_hanyu.py regeneration.
"""
import re, os, io, base64, subprocess, sys
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.abspath(__file__))
FA = os.path.join(ROOT, "libs", "fa")
APP = os.path.join(ROOT, "apps-src", "hanyu.html")

FONT = {  # style -> (source TTF, css font-family, weight)
    # Subset the .ttf (untransformed glyf) rather than .woff2 — fontTools
    # mis-reads FA's woff2-transformed glyf ("not enough glyf table data"). We
    # still emit woff2 (font.flavor) for the inlined data URI.
    "solid":   ("fa-solid-900.ttf",   '"Font Awesome 6 Free"',   900),
    "regular": ("fa-regular-400.ttf",  '"Font Awesome 6 Free"',   400),
    "brands":  ("fa-brands-400.ttf",   '"Font Awesome 6 Brands"', 400),
}
STYLE_TOKEN = {"fas": "solid", "fa-solid": "solid", "far": "regular",
               "fa-regular": "regular", "fab": "brands", "fa-brands": "brands"}


def build_fa(html):
    css = open(os.path.join(FA, "all.min.css"), encoding="utf-8").read()

    # name -> codepoint (handles grouped selectors and alias names)
    name_cp = {}
    for m in re.finditer(r'((?:\.fa-[a-z0-9-]+:before,?)+)\{content:"\\([0-9a-f]+)"\}', css):
        cp = int(m.group(2), 16)
        for nm in re.findall(r'\.fa-([a-z0-9-]+):before', m.group(1)):
            name_cp[nm] = cp

    # which icons Hanyu uses, per style
    cps = {"solid": set(), "regular": set(), "brands": set()}
    used = set()
    for cl in re.findall(r'class="([^"]*fa-[^"]*)"', html):
        toks = cl.split()
        style = "solid"
        for t in toks:
            if t in STYLE_TOKEN:
                style = STYLE_TOKEN[t]
        for t in toks:
            if t.startswith("fa-") and t[3:] in name_cp:
                cps[style].add(name_cp[t[3:]])
                used.add(t[3:])

    # subset each used font -> base64 @font-face
    faces = []
    for style, (fn, fam, wt) in FONT.items():
        if not cps[style]:
            continue
        # TTFont() reconstructs the woff2-transformed glyf reliably; subset's own
        # lazy woff2 loader can choke ("not enough glyf table data").
        font = TTFont(os.path.join(FA, fn))
        ss = subset.Subsetter(options=subset.Options())
        ss.populate(unicodes=sorted(cps[style])); ss.subset(font)
        buf = io.BytesIO(); font.flavor = "woff2"; font.save(buf)
        b64 = base64.b64encode(buf.getvalue()).decode()
        faces.append(f'@font-face{{font-family:{fam};font-style:normal;font-weight:{wt};'
                     f'font-display:block;src:url(data:font/woff2;base64,{b64}) format("woff2")}}')
        print(f"    FA {style}: {len(cps[style])} glyphs -> {round(len(b64)/1024)} KB (b64)")

    # keep FA's base/utility rules; drop its @font-face and the content rules for
    # icons we don't use; prepend our subset faces.
    core = re.sub(r"/\*![\s\S]*?\*/", "", css)
    core = re.sub(r"@font-face\{[^}]*\}", "", core)
    core = re.sub(r'((?:\.fa-[a-z0-9-]+:before,?)+)\{content:"\\[0-9a-f]+"\}',
                  lambda m: m.group(0) if any(n in used for n in re.findall(r'\.fa-([a-z0-9-]+):before', m.group(1))) else "",
                  core)
    return "\n".join(faces) + "\n" + core.strip()


def replace_videos(html):
    vid_rx = re.compile(
        r'<iframe\b[\s\S]*?data-src="https://www\.youtube\.com/embed/([A-Za-z0-9_-]+)"[\s\S]*?</iframe>',
        re.I)

    def thumb(m):
        vid = m.group(1)
        return (
            f'<a href="https://www.youtube.com/watch?v={vid}" '
            f'style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;'
            f'align-items:center;justify-content:center;text-decoration:none;'
            f'background:#000 center/cover no-repeat;'
            f"background-image:url('https://img.youtube.com/vi/{vid}/hqdefault.jpg');\">"
            f'<span style="width:58px;height:58px;border-radius:50%;background:rgba(0,0,0,.62);'
            f'display:flex;align-items:center;justify-content:center;">'
            f'<span style="color:#fff;font-size:24px;line-height:1;margin-left:4px;">&#9654;</span>'
            f'</span></a>')

    html, n = vid_rx.subn(thumb, html)
    print(f"    videos: replaced {n} YouTube iframe(s) with tap-to-Safari thumbnails")
    return html


def main():
    # 1. HanziWriter via the shared bundler
    subprocess.run([sys.executable, os.path.join(ROOT, "bundle_libs.py"), APP], check=True)

    html = open(APP, encoding="utf-8").read()

    # 2. Font Awesome subset+inline
    fa_css = build_fa(html)
    fa_block = "<style>/* vendored + subset Font Awesome 6.4.0 (self-contained) */\n" + fa_css + "\n</style>"
    # callable repl so backslash escapes in the CSS (\f015, \e0xx) stay literal
    html, nlink = re.subn(
        r'<link\b[^>]*href="[^"]*font-awesome/6\.4\.0[^"]*"[^>]*/?>',
        lambda _m: fa_block, html, count=1, flags=re.I)
    print(f"    FA: replaced {nlink} remote stylesheet link")

    # 3. YouTube embeds -> thumbnails
    html = replace_videos(html)

    # 4. remove the dynamic HanziWriter CDN fallback (redundant now it's inlined,
    #    and a remote-code path — it createElement('script')s an unpkg URL).
    html, nfb = re.subn(r"<script>\s*//\s*Hanzi Writer CDN fallback[\s\S]*?</script>",
                        "", html, flags=re.I)
    print(f"    removed {nfb} dynamic CDN-fallback script block(s)")

    open(APP, "w", encoding="utf-8").write(html)
    print(f"  -> wrote {APP}  ({round(os.path.getsize(APP)/1024)} KB)")


if __name__ == "__main__":
    main()
