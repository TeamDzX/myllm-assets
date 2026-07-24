#!/usr/bin/env python3
"""
MyLLMos gallery submission scanner — a first-pass security filter for community
apps. It mechanically enforces the CONTRIBUTING rules that matter most for
supply-chain safety: a reviewed app must be self-contained (so it can't change
after review) and must not do anything that escapes the sandbox or hides
behaviour.

Usage:
    python3 scan_app.py apps-src/<slug>.html [more.html ...]

Exit code 0 = no BLOCK findings; 1 = at least one BLOCK finding (or bad input).

NOTE: this is a *filter*, not a proof of safety. Regexes can't fully parse JS,
so a clean scan still needs the human review in GALLERY-REVIEW.md. Its job is to
catch the mechanical violations reliably and surface the rest for a human.
"""
import sys, re, os

# Each rule: (severity, name, compiled regex, explanation).
# BLOCK  = violates "self-contained / can't change after review", or sandbox escape.
# REVIEW = needs human judgement (often legitimate, sometimes not).
BLOCK, REVIEW, INFO = "BLOCK", "REVIEW", "INFO"

RULES = [
    # --- external code / resources that can be swapped after review ---
    (BLOCK, "remote-script",
     re.compile(r"<script\b[^>]*\bsrc\s*=\s*[\"']\s*(?:https?:)?//", re.I),
     "Remote <script src> — external code can be replaced with malware after review. Inline it."),
    (BLOCK, "remote-stylesheet",
     re.compile(r"<link\b[^>]*\bhref\s*=\s*[\"']\s*(?:https?:)?//[^\"']*[\"'][^>]*\brel\s*=\s*[\"']stylesheet|<link\b[^>]*\brel\s*=\s*[\"']stylesheet[\"'][^>]*\bhref\s*=\s*[\"']\s*(?:https?:)?//", re.I),
     "Remote stylesheet — external CSS can change after review (and can exfiltrate via CSS). Inline it."),
    (BLOCK, "remote-iframe",
     re.compile(r"<iframe\b[^>]*\bsrc\s*=\s*[\"']\s*(?:https?:)?//", re.I),
     "Remote <iframe> — loads third-party code/content that can change after review."),
    (BLOCK, "remote-object-embed",
     re.compile(r"<(?:object|embed)\b[^>]*\b(?:data|src)\s*=\s*[\"']\s*(?:https?:)?//", re.I),
     "Remote <object>/<embed> — external plugin content."),
    (BLOCK, "base-href",
     re.compile(r"<base\b[^>]*\bhref\s*=", re.I),
     "<base href> can silently repoint every relative URL to a remote origin."),
    (BLOCK, "meta-refresh",
     re.compile(r"<meta\b[^>]*http-equiv\s*=\s*[\"']refresh[\"'][^>]*url\s*=", re.I),
     "<meta refresh> redirect to another page."),

    # --- dynamic code execution (can run fetched/obfuscated code) ---
    (BLOCK, "eval",
     re.compile(r"\beval\s*\("),
     "eval() runs arbitrary strings as code — a common way to execute hidden/fetched payloads."),
    (BLOCK, "new-function",
     re.compile(r"\bnew\s+Function\s*\("),
     "new Function() compiles strings into code — same risk as eval()."),
    (REVIEW, "dynamic-import",
     re.compile(r"\bimport\s*\(\s*[\"'`]?https?:", re.I),
     "Dynamic import() of a remote module."),
    (REVIEW, "document-write",
     re.compile(r"\bdocument\.write(?:ln)?\s*\("),
     "document.write — check it isn't injecting remote/dynamic markup."),
    (REVIEW, "settimeout-string",
     re.compile(r"\bset(?:Timeout|Interval)\s*\(\s*[\"']"),
     "setTimeout/Interval with a string argument behaves like eval()."),

    # --- network paths that bypass the audited myllmFetch bridge ---
    (REVIEW, "raw-fetch",
     re.compile(r"(?<![.\w])fetch\s*\("),
     "Direct fetch() — prefer myllmFetch (audited, permission-gated). Check the destination."),
    (REVIEW, "xhr",
     re.compile(r"\bXMLHttpRequest\b"),
     "XMLHttpRequest — prefer myllmFetch. Check the destination."),
    (REVIEW, "websocket",
     re.compile(r"\bnew\s+WebSocket\s*\(|\bEventSource\s*\("),
     "WebSocket/EventSource — a persistent channel off-device. Justify it."),
    (REVIEW, "beacon",
     re.compile(r"\bnavigator\.sendBeacon\s*\("),
     "sendBeacon — a classic silent-exfiltration pattern. Justify the destination."),

    # --- sandbox / platform misuse ---
    (REVIEW, "js-dialogs",
     re.compile(r"(?<![.\w])(?:alert|confirm|prompt)\s*\("),
     "alert/confirm/prompt don't work in the MyLLMos web view — use in-page UI."),
    (REVIEW, "web-storage",
     re.compile(r"\b(?:local|session)Storage\b"),
     "localStorage/sessionStorage don't persist here — use myllmStorage."),
    (REVIEW, "fingerprinting",
     re.compile(r"\bnavigator\.(?:userAgent|platform|plugins|hardwareConcurrency|deviceMemory|languages)\b|\bcanvas[^;]{0,40}toDataURL"),
     "Device/fingerprinting signals — check it isn't tracking the user."),
    (BLOCK, "crypto-mining",
     re.compile(r"coinhive|cryptonight|\bminer\b|CoinImp|webminepool|hashrate", re.I),
     "Cryptocurrency-mining signature — banned by the content policy."),

    # --- obfuscation (hiding what the code does) ---
    (REVIEW, "b64-decode-heavy",
     re.compile(r"\batob\s*\(|\bunescape\s*\(|String\.fromCharCode\s*\("),
     "Decoding routines (atob/unescape/fromCharCode) — check they aren't reconstituting hidden code."),
]

# A long run of base64-looking characters in a string literal often hides a payload
# (legit inline images use data: URIs, which we exempt).
B64_BLOB = re.compile(r"[\"'`]([A-Za-z0-9+/]{240,}={0,2})[\"'`]")
DATA_URI = re.compile(r"data:[a-z0-9.+-]+/[a-z0-9.+-]+;base64,", re.I)


def line_of(text, idx):
    return text.count("\n", 0, idx) + 1


def scan(path):
    try:
        html = open(path, encoding="utf-8", errors="replace").read()
    except OSError as e:
        print(f"  cannot read {path}: {e}")
        return {BLOCK: [("read-error", 0, str(e))]}

    findings = {BLOCK: [], REVIEW: [], INFO: []}
    for sev, name, rx, _ in RULES:
        for m in rx.finditer(html):
            findings[sev].append((name, line_of(html, m.start()), m.group(0)[:70].replace("\n", " ")))

    # obfuscation blobs, excluding legitimate data: URIs
    for m in B64_BLOB.finditer(html):
        pre = html[max(0, m.start() - 40):m.start()]
        if DATA_URI.search(pre):
            continue
        findings[REVIEW].append(("obfuscated-blob", line_of(html, m.start()),
                                 f"{len(m.group(1))}-char base64 string literal"))

    # remote images are ALLOWED by the rules — record as INFO for awareness
    for m in re.finditer(r"<img\b[^>]*\bsrc\s*=\s*[\"']\s*(?:https?:)?//([^\"'/]+)", html, re.I):
        findings[INFO].append(("remote-image", line_of(html, m.start()), m.group(1)))

    # which sandbox bridges the app uses (cross-check against declared needs)
    bridges = sorted(set(re.findall(r"\bmyllm(?:Fetch|Storage|Ask|Vision|Generate\w+|Location|"
                                    r"Memory|Transcribe|Scan|Haptic|Share|SaveImage|Files|Intent|Theme)\b", html)))
    if bridges:
        findings[INFO].append(("bridges", 0, ", ".join(bridges)))

    return findings


def report(path, findings):
    size_kb = round(os.path.getsize(path) / 1024) if os.path.exists(path) else 0
    print(f"\n=== {path}  ({size_kb} KB) ===")
    if size_kb > 600:
        findings[REVIEW].insert(0, ("size", 0, f"{size_kb} KB > 600 KB guideline"))
    n_block = len(findings[BLOCK])
    for sev in (BLOCK, REVIEW, INFO):
        items = findings[sev]
        if not items:
            continue
        # group by rule name: count + first line, so a big app doesn't spew a wall
        by_name = {}
        for name, ln, snip in items:
            g = by_name.setdefault(name, {"count": 0, "first": ln, "snip": snip})
            g["count"] += 1
            if ln and (not g["first"] or ln < g["first"]):
                g["first"] = ln
        print(f"  {sev} ({len(by_name)} type{'s' if len(by_name) != 1 else ''}):")
        for name in sorted(by_name):
            g = by_name[name]
            where = f"line {g['first']}" if g["first"] else "—"
            times = f", {g['count']} occurrences" if g["count"] > 1 else ""
            detail = f"  ·  {g['snip']}" if name in ("remote-image", "bridges") else ""
            print(f"    - {name}  ({where}{times}){detail}")
    verdict = "BLOCK" if n_block else ("REVIEW" if findings[REVIEW] else "PASS")
    print(f"  VERDICT: {verdict}" + (f"  ({n_block} blocking)" if n_block else ""))
    return n_block


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    total_block = 0
    for path in argv[1:]:
        total_block += report(path, scan(path))
    print(f"\nScanned {len(argv) - 1} app(s); {total_block} blocking finding(s).")
    return 1 if total_block else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
