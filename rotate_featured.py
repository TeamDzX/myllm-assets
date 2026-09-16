#!/usr/bin/env python3
"""Rotate which apps sit at the FRONT of the gallery's Featured carousel.

Why this exists. 51 of the gallery's apps carry `featured: true`, the carousel
shows them in manifest order, and a phone shows about one and a half cards at a
time — so only the first two or three are ever really featured, and until now
those were simply whatever was added last. This gives every featured app its
turn at the front, on a rule (least recently at the front goes first), and
writes down what was at the front each week in featured-rotation.json. That log
is what lets admin/gallery-stats.html ask whether the front slots change
installs at all.

What it does NOT do: create, remove or edit any app entry. It only reorders the
apps that are already featured, among the positions they already occupy, so the
manifest keeps every key of every entry byte for byte (an entry missing a key
breaks the whole gallery — see the project notes) and non-featured apps never
move. It also never adds a key to apps.json.

featured-rotation.json:
  front    how many front slots rotate (3: what a phone shows without scrolling)
  pinned   ids that stay at the very front regardless (a launch, a season);
           they occupy front slots but are not logged as rotation
  log      one entry per rotation: {"week": "YYYY-MM-DD", "front": [ids]}

Usage:  rotate_featured.py            dry run — prints the plan
        rotate_featured.py --apply    rewrites apps.json + the log
        rotate_featured.py --week YYYY-MM-DD   (tests; default: today)
"""
import argparse
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "apps.json"
ROTATION = ROOT / "featured-rotation.json"


def load_rotation():
    if ROTATION.exists():
        return json.loads(ROTATION.read_text())
    return {"front": 3, "pinned": [], "log": []}


def plan(apps, rotation, week):
    """Return the new order of the featured ids and the ids chosen for the front."""
    featured = [a["id"] for a in apps if a.get("featured") is True]
    pinned = [p for p in rotation.get("pinned", []) if p in featured]
    front_n = max(0, int(rotation.get("front", 3)) - len(pinned))

    # When each app was last at the front. Never → -1, so it sorts first.
    last = {}
    for i, entry in enumerate(rotation.get("log", [])):
        for app_id in entry.get("front", []):
            last[app_id] = i
    candidates = [f for f in featured if f not in pinned]
    # Least recently at the front first; ties keep the manifest's current
    # order, so the result is stable and reproducible from the log alone.
    candidates.sort(key=lambda a: last.get(a, -1))
    front = candidates[:front_n]

    rest = [f for f in featured if f not in pinned and f not in front]
    return pinned + front + rest, front


def apply(apps, new_featured_order):
    """Write the featured apps back into the slots featured apps occupy now."""
    slots = [i for i, a in enumerate(apps) if a.get("featured") is True]
    by_id = {a["id"]: a for a in apps}
    assert len(slots) == len(new_featured_order)
    for slot, app_id in zip(slots, new_featured_order):
        apps[slot] = by_id[app_id]
    return apps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--week", default=dt.date.today().isoformat())
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text())
    apps = manifest["apps"]
    rotation = load_rotation()

    if rotation.get("log") and rotation["log"][-1]["week"] == args.week:
        print(f"already rotated for {args.week}; nothing to do")
        return 0

    before = [a["id"] for a in apps if a.get("featured") is True]
    order, front = plan(apps, rotation, args.week)
    print(f"week {args.week}: front = {rotation.get('pinned', [])} + {front}")
    print(f"featured order: {' '.join(order[:8])} … ({len(order)} featured)")
    if order == before:
        print("order unchanged")

    if not args.apply:
        return 0

    apps = apply(apps, order)
    ids_before = sorted(a["id"] for a in json.loads(MANIFEST.read_text())["apps"])
    assert ids_before == sorted(a["id"] for a in apps), "an app went missing — refusing to write"
    manifest["apps"] = apps
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    rotation.setdefault("log", []).append({"week": args.week, "front": front})
    ROTATION.write_text(json.dumps(rotation, indent=2) + "\n")
    print("written apps.json and featured-rotation.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
