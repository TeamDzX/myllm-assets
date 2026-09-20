#!/usr/bin/env python3
"""Stamp each gallery app's manifest entry with the AI bridges it calls.

  aiUses   every AI bridge found in the app's source: "ask" (myllmAsk /
           myllmAskJSON), "vision" (myllmVision — reads a photo), "image"
           (myllmGenerateImage — draws one). Derived; never hand-edited.
  aiNeeds  the subset the app is pointless without. A judgement, so it is
           listed by hand in NEEDS below.

Why: "requiresAI" alone told an on-device user that Fridge Chef would work on a
text-only phone model, and that Colouring Pages would work with no image
server. MyLLM 5.6.1+ shows PHOTO / IMAGE badges and says, before install, what
the current model can't do. Both keys are optional: older iOS builds and the
Android app ignore them.

Run after adding or changing an app:   python3 tag_ai_uses.py   (--check: exit 1 if stale)
Writes apps.json exactly as pin_jsdelivr.py does, so the two never fight.
"""
import json, re, sys

NEEDS = {
    "nutrition-lens": ["vision"],
    "fridge-chef": ["vision"],
    "plant-doctor": ["vision"],
    "colouring-pages": ["image"],
}

def uses(html):
    out = []
    if re.search(r"\bmyllmAsk(JSON)?\b", html): out.append("ask")
    if "myllmVision" in html: out.append("vision")
    if "myllmGenerateImage" in html: out.append("image")
    return out

def main():
    check = "--check" in sys.argv
    data = json.load(open("apps.json", encoding="utf-8"))
    changed = []
    for i, app in enumerate(data["apps"]):
        src = "apps-src/" + app["html"].split("/apps-src/")[-1].split("?")[0]
        found = uses(open(src, encoding="utf-8").read())
        need = [n for n in NEEDS.get(app["id"], []) if n in found]
        want = dict(app)
        want.pop("aiUses", None); want.pop("aiNeeds", None)
        # Keep the keys beside requiresAI, where a reader looks for them.
        rebuilt = {}
        for k, v in want.items():
            rebuilt[k] = v
            if k == "requiresAI":
                if found: rebuilt["aiUses"] = found
                if need:  rebuilt["aiNeeds"] = need
        if rebuilt != app or list(rebuilt) != list(app):
            changed.append(app["id"])
            data["apps"][i] = rebuilt
    missing = [a for a in NEEDS if a not in {x["id"] for x in data["apps"]}]
    if missing: sys.exit(f"NEEDS names apps that are not in the manifest: {missing}")
    if check:
        if changed: sys.exit(f"stale aiUses/aiNeeds: {', '.join(changed)} — run tag_ai_uses.py")
        print("aiUses/aiNeeds up to date"); return
    if changed:
        with open("apps.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
    print(f"{len(changed)} entr{'y' if len(changed)==1 else 'ies'} updated" + (": " + ", ".join(changed[:8]) + (" …" if len(changed) > 8 else "") if changed else ""))

if __name__ == "__main__":
    main()
