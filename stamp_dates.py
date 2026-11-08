#!/usr/bin/env python3
"""Give every gallery app the dates it joined the gallery and got its current version.

WHY: MyLLM 6.5.1 shows a "New & Updated" row and NEW / UPDATED labels, so the
gallery's front page changes as apps arrive and improve. That needs dates, and
nobody should have to remember to type them. They are already in git: this
reads every past apps.json and records, for each app,

  added    the day its id first appeared in the manifest
  updated  the day its current `version` first appeared

so `updated` moves only when the version is bumped, never for re-pins, stamps
or edits to the description. Both are "YYYY-MM-DD" (commit date, UTC). Apps not
yet committed get today. Older MyLLM builds ignore both keys.

Idempotent; run before a push, and the pin workflow runs it after one.

Usage:
  python3 stamp_dates.py            # dry-run: list what would change
  python3 stamp_dates.py --apply    # rewrite apps.json in place
"""
import json, os, subprocess, sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
APPS_JSON = os.path.join(ROOT, "apps.json")


def git(*args):
    return subprocess.check_output(["git", "-C", ROOT, *args], stderr=subprocess.DEVNULL).decode()


def history():
    """(day, manifest) for every committed apps.json, oldest first."""
    for line in git("log", "--reverse", "--format=%H %cs", "--", "apps.json").splitlines():
        sha, day = line.split()
        try:
            yield day, json.loads(git("show", f"{sha}:apps.json"))
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            continue   # a broken revision: skip it rather than guess


def dates():
    added, since = {}, {}          # id -> day; id -> (version, day it appeared)
    for day, manifest in history():
        for app in manifest.get("apps", []):
            aid, ver = app.get("id"), app.get("version")
            if not aid:
                continue
            added.setdefault(aid, day)
            if since.get(aid, (None,))[0] != ver:
                since[aid] = (ver, day)
    return added, since


def main():
    apply = "--apply" in sys.argv
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with open(APPS_JSON) as f:
        data = json.load(f)
    added, since = dates()
    changes = []
    for app in data["apps"]:
        aid, ver = app["id"], app.get("version")
        new_added = added.get(aid, today)
        prior = since.get(aid)
        # The committed history ends at HEAD; a version bumped since then is today's.
        new_updated = prior[1] if prior and prior[0] == ver else today
        if app.get("added") != new_added or app.get("updated") != new_updated:
            changes.append(f"{aid}: added {app.get('added')} -> {new_added}, updated {app.get('updated')} -> {new_updated}")
            app["added"], app["updated"] = new_added, new_updated
    for c in changes:
        print(c)
    print(f"{len(changes)} app(s) {'updated' if apply else 'would change'}")
    if apply and changes:
        with open(APPS_JSON, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")


if __name__ == "__main__":
    main()
