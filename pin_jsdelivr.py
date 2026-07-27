#!/usr/bin/env python3
"""Pin gallery app-payload URLs to the git commit that last modified each file.

WHY: app files are served via cdn.jsdelivr.net (so installs are counted). The
mutable `@main` ref is edge-cached and converges SLOWLY after an update — even a
purge can lag by minutes to hours. An IMMUTABLE commit ref (`@<sha>`) is served
instantly on first request and can never go stale, so the moment apps.json (which
the app fetches fresh from raw.githubusercontent) points at the new commit, users
get the new file at once. This is jsDelivr's own recommendation for freshness.

WHAT IT DOES: rewrites each app's `html`/`json` URL
  https://cdn.jsdelivr.net/gh/TeamDzX/myllm-assets@<anyref>/apps-src/foo.html[?q]
    -> https://cdn.jsdelivr.net/gh/TeamDzX/myllm-assets@<lastCommitSha>/apps-src/foo.html[?q]
where <lastCommitSha> = the commit that last touched apps-src/foo.html. Idempotent:
re-running re-pins only files whose last-touch commit changed. apps.json itself
stays on raw (always-fresh index); banner images are left untouched.

Run locally (`--apply`) or from CI after a push (the workflow commits apps.json back).

Usage:
  python3 pin_jsdelivr.py            # dry-run: show what would change
  python3 pin_jsdelivr.py --apply    # rewrite apps.json in place
"""
import json, re, subprocess, sys, os

REPO = "TeamDzX/myllm-assets"
ROOT = os.path.dirname(os.path.abspath(__file__))
APPS_JSON = os.path.join(ROOT, "apps.json")
PREFIX = f"https://cdn.jsdelivr.net/gh/{REPO}@"
URL_RE = re.compile(re.escape(PREFIX) + r"([^/]+)/([^?]+)(\?.*)?$")

def last_commit(path):
    """SHA of the most recent commit that touched `path`, or None if untracked."""
    try:
        out = subprocess.check_output(
            ["git", "-C", ROOT, "log", "-1", "--format=%H", "--", path],
            stderr=subprocess.DEVNULL).decode().strip()
        return out or None
    except subprocess.CalledProcessError:
        return None

def repin(url, warnings):
    m = URL_RE.match(url)
    if not m:
        return url            # not one of our jsDelivr URLs — leave it
    _ref, path, query = m.group(1), m.group(2), m.group(3) or ""
    sha = last_commit(path)
    if not sha:
        warnings.add(path)
        sha = "main"          # not committed yet — fall back so the URL still resolves
    return f"{PREFIX}{sha}/{path}{query}"

def main():
    apply = "--apply" in sys.argv
    with open(APPS_JSON) as f:
        data = json.load(f)
    apps = data["apps"]
    warnings = set()
    changed = 0
    for a in apps:
        for key in ("html", "json"):
            old = a.get(key, "")
            if not old.startswith(PREFIX):
                continue
            new = repin(old, warnings)
            if new != old:
                changed += 1
                if apply:
                    a[key] = new
                else:
                    o = old.split("@", 1)[1].split("/", 1)[0]
                    n = new.split("@", 1)[1].split("/", 1)[0]
                    print(f"  {a['id']}.{key}: @{o[:12]} -> @{n[:12]}")

    if warnings:
        print(f"WARNING: {len(warnings)} file(s) not committed — left on @main:", file=sys.stderr)
        for w in sorted(warnings):
            print("   " + w, file=sys.stderr)

    if apply:
        with open(APPS_JSON, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"APPLIED: pinned {changed} URL(s) to commit refs.")
    else:
        print(f"DRY-RUN: {changed} URL(s) would change. Re-run with --apply.")

if __name__ == "__main__":
    main()
