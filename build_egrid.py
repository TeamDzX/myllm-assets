#!/usr/bin/env python3
"""Refresh E-Grid's baked-in catalogue and its .myllmapp bundle.

The gallery app reads its content live from the E-Grid content repo, exactly
as the iOS and Android apps do. This script only regenerates the *fallback*
copy of the series catalogue that ships inside the HTML, so a first launch
with no network — or with MyLLMos app networking switched off — still opens
on a real season rather than an empty screen.

    python3 build_egrid.py [--channels PATH]

It rewrites only the block between the /*<FB>*/ markers in apps-src/e-grid.html
and then re-emits apps-src/e-grid.myllmapp, so hand edits to the app survive.
Run stamp_apps.py afterwards — it rewrites the payload again with the build id.
"""
import argparse
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "apps-src", "e-grid.html")
BUNDLE = os.path.join(HERE, "apps-src", "e-grid.myllmapp")

# The content repo is the source of truth. Its local clone lives outside this
# repo (it belongs to the E-Grid project, not the gallery), so the path is a
# default rather than a hard requirement — pass --channels to point elsewhere.
DEFAULT_CHANNELS = os.path.expanduser("~/Desktop/Rally/content/channels.json")

# Fields the fallback actually needs. Feeds and regulation links are useless
# without a network, which is the only situation the fallback exists for, so
# they are dropped to keep the payload small.
KEEP = ("id", "name", "tagline", "accentHex", "hasStandings", "comingSoon", "calendar")


def trim(channel):
    out = {k: channel[k] for k in KEEP if k in channel}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--channels", default=DEFAULT_CHANNELS)
    args = ap.parse_args()

    with open(args.channels) as fh:
        channels = json.load(fh)["channels"]

    payload = json.dumps([trim(c) for c in channels],
                         separators=(",", ":"), ensure_ascii=True)
    # A literal "</" inside a <script> would close it early.
    payload = payload.replace("</", "<\\/")

    with open(APP) as fh:
        html = fh.read()

    block = re.compile(r"/\*<FB>\*/.*?/\*</FB>\*/", re.S)
    if not block.search(html):
        raise SystemExit("marker /*<FB>*/ … /*</FB>*/ not found in e-grid.html")
    html = block.sub(lambda _: "/*<FB>*/" + payload + "/*</FB>*/", html, count=1)

    with open(APP, "w") as fh:
        fh.write(html)

    with open(BUNDLE, "w") as fh:
        json.dump({"name": "E-Grid", "kind": "html", "iconSymbol": "flag.checkered",
                   "iconColor": "red", "html": html}, fh, ensure_ascii=False)

    print(f"{len(channels)} series baked in "
          f"({len(payload) / 1024:.1f} KB fallback, {len(html) / 1024:.1f} KB app)")


if __name__ == "__main__":
    main()
