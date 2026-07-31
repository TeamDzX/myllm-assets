#!/usr/bin/env python3
"""Build apps-android.json: the same manifest, payload URLs pinned to an ALIAS commit.

WHY: jsDelivr reports hits per ref. iOS (apps.json) pins each file to its
last-touch commit; the Android manifest pins the SAME bytes at a different
(alias) ref, so installs split into per-platform buckets with zero telemetry —
the platform is encoded in which immutable URL the client fetches, nothing else
leaves the device. The alias must be a commit containing every app file at its
current content: the pin commit (HEAD right after `pin_jsdelivr.py --apply` +
commit) always qualifies.

android-refs.json accumulates every alias SHA ever used; the local stats
dashboard buckets per-version hits by that list (Android) vs everything else
(iOS — plus not-yet-updated Android clients, which decay over time).

Usage: python3 pin_android.py [--alias <sha>]    # default: current HEAD
Run AFTER pin_jsdelivr.py --apply has been committed (locally or in CI).
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = "TeamDzX/myllm-assets"
PREFIX = f"https://cdn.jsdelivr.net/gh/{REPO}@"

def head_sha():
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()

def main():
    alias = sys.argv[sys.argv.index("--alias") + 1] if "--alias" in sys.argv else head_sha()
    with open(os.path.join(ROOT, "apps.json")) as f:
        data = json.load(f)
    n = 0
    for a in data["apps"]:
        for k in ("html", "json"):
            u = a.get(k, "")
            if u.startswith(PREFIX):
                path = u[len(PREFIX):].split("/", 1)[1]   # keeps any ?query
                a[k] = f"{PREFIX}{alias}/{path}"
                n += 1
    with open(os.path.join(ROOT, "apps-android.json"), "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    refs_p = os.path.join(ROOT, "android-refs.json")
    refs = json.load(open(refs_p)) if os.path.exists(refs_p) else {"aliases": []}
    if alias not in refs["aliases"]:
        refs["aliases"].append(alias)
    with open(refs_p, "w") as f:
        json.dump(refs, f, indent=2)
        f.write("\n")
    print(f"apps-android.json: {n} URLs @ {alias[:12]} · {len(refs['aliases'])} alias ref(s) recorded")

if __name__ == "__main__":
    main()
