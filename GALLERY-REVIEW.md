# Gallery submission review

How we vet a community app before it goes on the **Community** shelf. The goal is
simple: **a reviewed app must not be able to change after we approve it, and must
not misbehave inside the sandbox.** This process is how we hold that line.

## Trust model — why we review at all

| Tier | Who wrote it | Control |
|---|---|---|
| **First-party** | Us (Opticell) | We trust our own code. (Caveat: any first-party app that loads external CDN code must be bundled/self-hosted — see below.) |
| **Community** | Public submissions | **This document.** Untrusted until reviewed; reviewed apps must be self-contained. |
| **User paste / remix / AI-built** | The user, on their own device | Not gallery-listed, not reviewed. The user's own risk, contained by the sandbox + per-app permissions. |

The sandbox (non-persistent `WKWebView`, permission-gated `myllm*` bridges, no raw
device access) is the floor under everything. Review is the extra bar for the one
tier we don't author.

## The load-bearing idea

An external `<script src>` / stylesheet / iframe is code we **don't control and
can be swapped for malware after review**. So the single most important rule is:
**approved apps are self-contained** — all CSS/JS inline, no remote code. Then
there is nothing to swap. (Remote *images* are allowed — they can't execute.)

## Step 1 — run the scanner (mechanical gate)

```
python3 scan_app.py apps-src/<slug>.html
```

- **`BLOCK`** — must be fixed before listing. No exceptions. These are the
  self-containment and sandbox-escape violations (remote script/style/iframe,
  `eval`/`new Function`, `<base>`/meta-refresh, crypto-mining).
- **`REVIEW`** — not automatically wrong, but a human must look: direct
  `fetch`/XHR/WebSocket (should be `myllmFetch`), obfuscated blobs, fingerprinting,
  `document.write`, JS dialogs, `localStorage`, oversized files.
- **`INFO`** — context: remote image hosts, and which bridges the app uses
  (cross-check these against what the submission *said* it needs).

A non-zero exit code means at least one `BLOCK`. Never list an app that BLOCKs.

The scanner is a **filter, not a proof** — regexes can't fully parse JS. A clean
scan still gets the human pass below.

## Step 2 — human review (judgement the scanner can't make)

- [ ] **Does it do what it claims**, and only that? Open it, use it, read the code.
- [ ] **Honest about network/AI.** Every off-device call is obvious to the user;
      the declared "what it needs" matches the bridges the scanner found. No hidden
      calls, no data sent anywhere it shouldn't be. API keys live in `myllmStorage`
      and go only to the service they belong to.
- [ ] **No dark patterns / deception / impersonation.** Not pretending to be a real
      brand, person, or a system dialog. No fake buttons that exfiltrate.
- [ ] **Any `REVIEW` findings explained.** A direct `fetch` to a public API can be
      fine; an obfuscated blob that decodes and runs almost never is.
- [ ] **IP is clean.** Name/art aren't trademark-infringing; inlined libraries are
      credited and appropriately licensed (rule 5).
- [ ] **Family-friendly & lawful** (content policy).
- [ ] **Feature-detects bridges** and degrades gracefully when a permission is off.

## Step 3 — on approval

- Merge the app into `apps.json` on the **Community** shelf, credited to the author.
- Because an approved app is self-contained, **there is no external dependency to
  pin** — self-containment *is* the anti-tamper guarantee. (If we ever relax that,
  approval must snapshot the dependency so it can't change afterward.)
- Record the reviewed version. On any later update from the author, **re-run this
  whole process** — an update is a new submission.

## Monitoring & takedown

- Reports and takedown requests come in as repo issues (see `GALLERY-TERMS.md`).
- To pull an app: remove it from `apps.json`. Installed copies are local; a future
  build can also stop offering it.

## First-party status

Every first-party app that used to load external code is now self-contained:

- **Near Me** — Leaflet vendored in `libs/` and inlined (`bundle_libs.py`).
- **Expense** — dropped Google Fonts (→ system font) and unused Font Awesome.
- **Hanyu** — HanziWriter inlined, Font Awesome subset + inlined, YouTube embeds
  → tap-to-Safari thumbnails, dynamic CDN fallback removed (`secure_hanyu.py`).

So every served gallery app passes `scan_app.py` **except the two documented
exceptions below**.

## Documented exceptions

Recorded in `scan_app.py` → `EXCEPTIONS`, **scoped to a single finding** (any
*other* issue in the same app still blocks, and a future change that adds one is
not masked):

- **retro-player**, **retro-shell** — the retro-console emulator apps load the
  **EmulatorJS** runtime from `cdn.emulatorjs.org` (finding: `dynamic-script`).
  EmulatorJS is architecturally CDN-based — multi-megabyte, per-console cores
  fetched on demand — so inlining or self-hosting isn't practical. Accepted
  because: it's a reputable, purpose-built emulator CDN; the code runs in the
  same sandbox with the same per-app permissions as everything else; and ROMs are
  user-supplied (we ship none).

**Rules for exceptions**
- **First-party only.** A *community* submission that loads remote code is a
  rejection, never an exception — self-containment is mandatory for the tier we
  don't author.
- **Scoped + re-reviewed.** The waiver covers one named finding; add nothing to
  its blast radius, and re-review the app on every change.
