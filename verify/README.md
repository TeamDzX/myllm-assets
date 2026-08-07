# Runtime verification harness

Dev-only tooling. **Nothing here ships** — it is not bundled into the iOS app,
not referenced by any gallery app, and needs no MyLLM release to change.

`scan_app.py` reads an app's source and asks *"does this text look wrong?"*.
This runs the app in a real WebKit engine and asks *"does it actually work, and
does it stay inside the sandbox?"* — which a regex structurally cannot answer:

```js
new Image().src = h + o + s + t   // a remote load no pattern will ever match
```

The two are complements, not substitutes. **`scan_app.py` stays the first gate
for untrusted submissions precisely because it never executes the code.**

## Running it

```bash
npm install                    # also fetches WebKit (~85 MB, one-off)

node verify_app.mjs --all                        # every app in apps.json
node verify_app.mjs ../apps-src/2048.html        # one app
node verify_app.mjs --all --screenshots          # PNG per app in out/
node verify_app.mjs --all --no-bridges           # older build: no myllm* at all
node verify_app.mjs --all --ask-mode prose       # AI returns prose, not JSON
node verify_app.mjs --all --headed --clicks 0    # watch one boot, no tapping
```

Exit `0` = every app clean, `1` = at least one FAIL. Failure screenshots land in
`out/` automatically.

`--all` is driven by **`apps.json`**, not by globbing `apps-src/`, because that
directory also holds build *inputs* (`expense-raw`, `hanyu-raw` — `build_*.py`
inlines their CDN dependencies before shipping), emulator shells, and shelved
apps. Use `--all-src` to sweep the directory anyway. A manifest entry with no
local file is itself a failure.

## What it checks

| | |
|---|---|
| **FAIL** | uncaught errors and unhandled rejections, at load and under a tap sweep |
| | remote `script` / `stylesheet` / `iframe` / `xhr` — however the URL was built |
| | `alert` / `confirm` / `prompt` — these silently wedge the app on device |
| | rendering nothing at all (a blank screen passes every other check) |
| **WARN** | raw `fetch` / `XHR` (CORS-dead at a null origin), `console.error` |
| **INFO** | remote images (allowed), `myllmFetch` use, `window.open` |

The guiding rule is **behaviour fails the build, observation only informs**.
Anything an app can legitimately guard with `try`/`catch` is recorded rather
than failed — if it really is unguarded, the resulting uncaught error fails it
anyway, and we never have to guess the app's intent.

`bridges.js` stubs `window.myllm*` faithfully against `HTMLArtifactView.swift`
and booby-traps what the sandbox does not provide. Two deliberate omissions,
both load-bearing:

- **`myllmSpeak` is not stubbed.** `GALLERY_HANDOVER.md` §7 lists it as *"NOT
  IMPLEMENTED — listed here in error historically"*. Five apps call it behind a
  feature-detect; stubbing it would hide exactly the bug worth finding.
- **`localStorage` is not shimmed.** At a null origin WebKit already throws
  `SecurityError` natively, which *is* the device behaviour — so the rule
  enforces itself, and the documented `myllmStorage`-first fallback pattern
  correctly passes.

## Fidelity limits

WebKit here is not iOS WKWebView. This will **not** catch AVAudioSession
behaviour, safe-area layout, real bridge semantics, native permission prompts,
or iOS memory pressure. It raises the floor; it does not replace the device test
in `GALLERY-REVIEW.md`.
