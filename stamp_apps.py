#!/usr/bin/env python3
"""Stamp gallery apps with their provenance.

WHY: these files are published from a public repo and are trivially copyable —
that is a property of shipping HTML, not a leak, and no amount of obfuscation
changes it (it would only break "View code" and Remix, which exist on purpose).
What we can do is make the terms unmissable and make a copy provable:

  1. A HEADER comment naming the app, the holder and the licence. It costs a
     copier nothing to delete, which is the point — deleting it is a deliberate
     act, not an oversight, and that difference matters in a takedown.

  2. A BUILD ID: an inert, unique token per app. It does nothing, so nobody
     removes it, and it has no innocent reason to appear in someone else's
     file. Derived from the app id, so it is stable across rebuilds and can be
     recomputed at any time from this script alone.

Both are idempotent — re-running never double-stamps, so it is safe to run over
the whole manifest after any rebuild (`build_hanyu.py` and friends emit an
unstamped file; run this afterwards).

Payloads: an app's `.myllmapp` carries a copy of the HTML, so a stamped `.html`
with a stale payload would ship the unstamped file to anyone who installs the
JSON. This rewrites both, together, or neither.

Usage:
    python3 stamp_apps.py                 # dry-run over every app in apps.json
    python3 stamp_apps.py --apply
    python3 stamp_apps.py --apply apps-src/social-studio.html
"""
import json, os, re, sys, hashlib, io

ROOT = os.path.dirname(os.path.abspath(__file__))
APPS_JSON = os.path.join(ROOT, "apps.json")
HOLDER = "Opticell Ltd"
YEAR = "2026"
LICENCE_URL = "https://github.com/TeamDzX/myllm-assets/blob/main/LICENSE"

# apps carrying third-party code get it named in their own header, so the file
# says what it contains without anyone having to find THIRD-PARTY.md first
THIRD_PARTY = {
    "nes-emulator": "jsnes (Apache-2.0)",
    "gb-player":    "binjgb (MIT)",
    "chess":        "chess.js (BSD-2-Clause)",
    "near-me":      "Leaflet (BSD-2-Clause)",
    "hanyu":        "HanziWriter (MIT)",
}

# Finds a header this script wrote, whatever its wording, so the text can be
# revised later without leaving 118 files on two different versions of it.
HEADER_RE = re.compile(r"<!--\s*\n\s+[^\n]*?App Gallery.*?-->\n?", re.S)
ID_PROP = "--build-id"                     # idempotency probe for the token


def build_id(app_id):
    """Stable, unique, meaningless. Recomputable from the app id alone."""
    return hashlib.sha1(("myllmos.gallery/" + app_id).encode()).hexdigest()[:10]


def header(app_id, name):
    extra = THIRD_PARTY.get(app_id)
    lines = [
        f"{name} — MyLLMos™ App Gallery · © {YEAR} {HOLDER}",
        "Source-available: read it, remix it, run your version inside MyLLM™.",
        f"Not for redistribution or republication. Terms: {LICENCE_URL}",
    ]
    if extra:
        lines.append(f"Includes {extra} — see THIRD-PARTY.md.")
    return "<!--\n  " + "\n  ".join(lines) + "\n-->"


def stamp(html, app_id, name):
    """Return (new_html, [what changed])."""
    did = []

    want = header(app_id, name)
    head = html[:1600]
    m_old = HEADER_RE.search(head)
    if m_old and m_old.group(0).rstrip("\n") != want:
        html = html[:m_old.start()] + want + html[m_old.end():]
        did.append("header (rewritten)")
    elif not m_old:
        m = re.match(r"\s*<!doctype[^>]*>", html, re.I)
        if m:
            html = html[:m.end()] + "\n" + want + html[m.end():]
        else:
            html = want + "\n" + html
        did.append("header")

    if ID_PROP not in html:
        prop = f'{ID_PROP}:"{build_id(app_id)}";'
        i = html.find(":root{")
        if i >= 0:
            j = i + len(":root{")
            html = html[:j] + prop + html[j:]
        else:
            # no design-token block to hide in — give it its own, in the head
            k = html.lower().find("</head>")
            block = "<style>:root{" + prop + "}</style>\n"
            if k < 0:
                return html, did          # nowhere safe to put it; header alone
            html = html[:k] + block + html[k:]
        did.append("build-id")

    return html, did


def payload_path(html_path):
    p = re.sub(r"\.html$", ".myllmapp", html_path)
    return p if os.path.exists(p) else None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    apply_ = "--apply" in sys.argv

    manifest = json.loads(io.open(APPS_JSON, encoding="utf-8").read())
    apps = manifest["apps"] if isinstance(manifest, dict) else manifest
    by_file = {}
    for a in apps:
        f = a["html"].rsplit("/", 1)[-1].split("?")[0]
        by_file[f] = a

    targets = [os.path.basename(a) for a in args] or sorted(by_file)
    changed = skipped = 0
    for f in targets:
        meta = by_file.get(f)
        if not meta:
            print(f"  ?  {f} — not in apps.json, skipped")
            continue
        path = os.path.join(ROOT, "apps-src", f)
        if not os.path.exists(path):
            print(f"  !  {f} — missing locally")
            continue
        src = io.open(path, encoding="utf-8").read()
        out, did = stamp(src, meta["id"], meta["name"])
        if not did:
            skipped += 1
            continue
        changed += 1
        pay = payload_path(path)
        print(f"  +  {f:34} {', '.join(did)}" + ("  (+payload)" if pay else ""))
        if apply_:
            io.open(path, "w", encoding="utf-8").write(out)
            if pay:
                d = json.loads(io.open(pay, encoding="utf-8").read())
                d["html"] = out
                io.open(pay, "w", encoding="utf-8").write(
                    json.dumps(d, ensure_ascii=False))

    verb = "STAMPED" if apply_ else "would stamp"
    print(f"\n{verb} {changed} app(s); {skipped} already stamped.")
    if not apply_ and changed:
        print("Dry run — pass --apply to write.")


if __name__ == "__main__":
    main()
