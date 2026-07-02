# MyLLMos App Gallery — Handover & Integration Guide

How the MyLLMos App Gallery works, how it's wired to Git, the CSS/bridge
conventions, and the search/discovery model — so other app-building efforts can
ship into it with the same level of polish and integration.

> **Audience:** anyone building an HTML mini-app that should appear in the MyLLM
> in-app **App Gallery**. You only ever touch this repo (`TeamDzX/myllm-assets`)
> — no Xcode build, no App Store submission. The iOS app reads everything here
> over the network.

---

## 1. The one-paragraph mental model

A MyLLMos app is **one self-contained HTML file**. This repo hosts that file,
plus a small JSON "bundle", plus an 800×400 banner image, and registers all
three in a single manifest (`apps.json`). The iOS app downloads `apps.json`,
renders the gallery, and — when the user taps **Get** — downloads the app's
`.html` and runs it in a sandboxed `WKWebView` with a set of injected
`window.myllm*` bridges. **Push to `main` = live**, because every URL is
hot-linked from `raw.githubusercontent.com`. There is no server, no database,
no rebuild.

---

## 2. Git wiring (how "deploy" works)

- **Repo:** `github.com/TeamDzX/myllm-assets` (public).
- **Branch = deploy target:** commit to **`main`** and it is live. The app and
  the web gallery both hot-link raw URLs of the form:
  ```
  https://raw.githubusercontent.com/TeamDzX/myllm-assets/main/<path>
  ```
- **CDN cache:** `raw.githubusercontent.com` caches ~5 minutes. A freshly pushed
  change may take a moment to propagate; hard-refresh / reopen to force it.
- **Publishing an update to an existing app:** bump its `version` integer in
  `apps.json` (see §4). The gallery shows an **Update** affordance only when the
  remote `version` is higher than what the user installed. Changing the `.html`
  alone is *not* enough to prompt existing users — **always bump `version`**.
- **⚠️ Private-source guardrail:** some raw source files live untracked in
  `apps-src/` (e.g. `hanyu-raw.html`, `expense-raw.html`). These are the
  proprietary originals that `build_*.py` scripts adapt. **Never `git add -A`.**
  Stage new-app files explicitly by name.

Typical publish flow:
```bash
git add apps.json \
  apps-src/<slug>.html apps-src/<slug>.myllmapp apps/<slug>.jpg
git commit -m "Add <Name> app"
git push origin main
```

---

## 3. Repository layout

```
apps.json              ← THE manifest (single source of truth for the gallery)
apps-src/<slug>.html   ← the app itself (one self-contained file)
apps-src/<slug>.myllmapp ← JSON bundle: { name, kind, iconSymbol, iconColor, html }
apps/<slug>.jpg        ← 800×400 gallery banner
langpacks/*.json       ← data inputs for the language-app generator (see §10)
build_*.py             ← generators for templated/adapted apps (see §10)
features/<slug>.jpg    ← banner art for the marketing site (not the app gallery)
wiki/                  ← marketing-site imagery
README.md              ← repo blurb
```

Every gallery app needs **three files that share the same `<slug>`**:
`apps-src/<slug>.html`, `apps-src/<slug>.myllmapp`, `apps/<slug>.jpg`, plus one
entry in `apps.json`.

---

## 4. The manifest — `apps.json`

Top level:
```json
{
  "updated": "2026-07-02",
  "categories": ["Students","Productivity","News & Web", … ],
  "apps": [ { …app… }, … ]
}
```

- **`categories`** is the canonical, ordered category list the gallery groups by.
  Every app's `category` **must** be one of these strings (case-sensitive). Add a
  new category here first if you need one. Current set:
  `Students · Productivity · News & Web · Health & Wellbeing · Kids & Sensory ·
  Home & Garden · Food & Cooking · Astrology · Games · Creative · Developer ·
  Utilities`.
- **`updated`** — bump to today's date when you publish a batch (cosmetic "last
  updated").

### Per-app schema (all 16 fields — all required unless noted)

| field | type | notes |
|---|---|---|
| `id` | string | stable slug, **must equal the `<slug>`** of the files. Never change it. |
| `name` | string | display name |
| `emoji` | string | one emoji, shown in lists/headers |
| `tagline` | string | ≤ ~5 words, shown under the name |
| `description` | string | the full pitch. **This + name + tagline + tags are what search indexes** (§9). End AI apps with the "enable AI in Settings" sentence. |
| `tags` | string[] | discovery keywords. Conventions: `"AI-powered"`, `"offline"`, `"saves data"`, plus topical tags. |
| `iconSymbol` | string | an **SF Symbol** name (e.g. `checklist`, `character.bubble.fill`, `figure.run`). Rendered as the tile icon. |
| `iconColor` | string | tint name — one of: `blue, cyan, green, indigo, mint, orange, pink, purple, red, teal, yellow`. |
| `version` | int | bump to ship an update (§2). |
| `featured` | bool | surfaces the app in the featured rail. Use sparingly. |
| `requiresAI` | bool | `true` only if the app is *useless* without `myllmAsk`. If AI is optional/partial (e.g. manual fallback), keep `false` and gate gracefully in-app. |
| `banner` | url | raw URL to `apps/<slug>.jpg` (800×400). |
| `html` | url | raw URL to `apps-src/<slug>.html`. |
| `json` | url | raw URL to `apps-src/<slug>.myllmapp`. |
| `sizeKB` | int | rough size of the html, shown in the gallery. |
| `category` | string | one of `categories` above. |
| `icon` | url | **optional** — a raster PNG icon URL, overrides `iconSymbol`. Only used where an SF Symbol won't do (currently just Hanyu). |

Keep the file's formatting: **6-space indentation** for object keys, one entry
per `{ }` block. Make **surgical edits** — do not reformat / re-dump the whole
file (it makes an unreadable diff). Validate before committing:
`python3 -c "import json;json.load(open('apps.json'))"`.

---

## 5. The two payloads: `.html` and `.myllmapp`

Each app ships **twice**:

1. **`apps-src/<slug>.html`** — the app. Loaded when a user runs the app from the
   gallery.
2. **`apps-src/<slug>.myllmapp`** — a JSON **bundle** used by the standalone
   share/import flow (`.myllmapp` files can be shared between users, where there
   is *no* manifest to read icons from). Schema:
   ```json
   { "name": "Sprint Planner", "kind": "html",
     "iconSymbol": "figure.run", "iconColor": "indigo",
     "html": "<!doctype html>…the entire app…" }
   ```
   `html` is the **exact same** markup as the `.html` file, inlined as a string.

> **Keep them in sync.** When you edit the `.html`, regenerate the bundle:
> ```python
> import json
> html = open("apps-src/<slug>.html").read()
> json.dump({"name":"<Name>","kind":"html","iconSymbol":"<sym>","iconColor":"<col>","html":html},
>           open("apps-src/<slug>.myllmapp","w"), ensure_ascii=False)
> ```
> The `build_*.py` generators do this automatically.

---

## 6. The app shell — CSS conventions

Apps must feel native, respect light/dark, and fit the phone safely.

### 6a. Light/dark + design tokens
Start every app with `color-scheme: light dark`, then style against the injected
**`--myllm-*` design tokens** with sensible fallbacks. The iOS app injects these
tokens into every web view so apps match the user's theme automatically:

| token | fallback | meaning |
|---|---|---|
| `--myllm-bg` | `#f2f2f7` | page background |
| `--myllm-surface` | `#fff` | card / panel background |
| `--myllm-text` | `#111` | primary text |
| `--myllm-muted` | `#8a8a8e` | secondary text |
| `--myllm-accent` | `#0a84ff` | accent / tint |
| `--myllm-border` | `#e3e3e8` | hairlines |
| `--myllm-font` | system stack | font family |
| `--myllm-radius` | — | corner radius |

```css
body{
  font-family:var(--myllm-font,-apple-system,system-ui,sans-serif);
  background:var(--myllm-bg,#f2f2f7);
  color:var(--myllm-text,#111);
}
.card{ background:var(--myllm-surface,#fff); border:1px solid var(--myllm-border,#e3e3e8); }
```
(A `@media(prefers-color-scheme:dark)` block is a fine alternative/supplement,
but tokens are preferred — they follow in-app theme choices, not just OS dark
mode.)

### 6b. Layout safety
- Constrain width on tablets: `body{max-width:820px;margin:0 auto}`.
- Respect the home indicator: pad the bottom with
  `calc(28px + env(safe-area-inset-bottom))`; fixed tab bars use
  `padding-bottom:env(safe-area-inset-bottom)`.
- **Legibility:** give primary values explicit high-contrast colour and weight —
  don't rely on low `opacity` for anything a user must read. (A too-faint
  flashcard word was our first field bug — fixed by `font-weight:800; color:#000`
  with a `#fff` dark-mode override.)

### 6c. No native JS dialogs
The MyLLMos web view has **no `alert` / `confirm` / `prompt`** (they silently
no-op). Use in-page inputs, inline status text, and custom modals. Wire
`Enter`-to-submit on inputs.

### 6d. The AI "thinking" indicator (paste-in)
Any app that calls `myllmAsk` should include this self-contained wrapper — it
shows a floating "AI is thinking… privately, on your device" pill during calls,
and no-ops if AI isn't available:

```html
<style>
@keyframes myllmAiSpin{to{transform:rotate(360deg)}}
.myllm-ai-busy{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translateX(-50%) translateY(18px);z-index:99999;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;display:flex;align-items:center;gap:10px;background:rgba(28,28,30,.96);color:#fff;border-radius:999px;padding:10px 16px 10px 14px;box-shadow:0 6px 22px rgba(0,0,0,.4);font-size:14px;font-weight:600;max-width:92%}
.myllm-ai-busy.on{opacity:1;transform:translateX(-50%) translateY(0)}
.myllm-ai-cog{font-size:18px;animation:myllmAiSpin 2.4s linear infinite;filter:drop-shadow(0 0 5px rgba(124,92,255,.85))}
.myllm-ai-busy small{font-weight:400;opacity:.6}
</style>
<script>
(function(){if(window.__myllmAiWrap||typeof window.myllmAsk!=='function')return;window.__myllmAiWrap=true;
var orig=window.myllmAsk,depth=0,node=null;
function ensure(){if(node)return;node=document.createElement('div');node.className='myllm-ai-busy';
node.innerHTML='<span class="myllm-ai-cog">⚙️</span><span>AI is thinking… <small>privately, on your device</small></span>';
(document.body||document.documentElement).appendChild(node);}
function show(){ensure();depth++;node.classList.add('on');}
function hide(){depth=Math.max(0,depth-1);if(depth===0&&node)node.classList.remove('on');}
window.myllmAsk=function(){show();var p;try{p=orig.apply(this,arguments);}catch(e){hide();throw e;}
return Promise.resolve(p).then(function(r){hide();return r;},function(e){hide();throw e;});};})();
</script>
```

---

## 7. The bridges — `window.myllm*`

Injected APIs the sandbox exposes. **Always feature-detect and degrade
gracefully** — older app versions won't have newer bridges. (Usage counts show
how battle-tested each is across the current 80 apps.)

| bridge | what it does | notes |
|---|---|---|
| `myllmHaptic(kind)` | haptic feedback | `'light' \| 'selection' \| 'success'…`. Cheap polish, use liberally. |
| `myllmStorage` | per-app persistence | `getItem(k)→Promise<string\|null>`, `setItem(k,v)→Promise`. ~1 MB/app. Async! See §8. |
| `myllmAsk(prompt)` | on-device LLM | `→Promise<string>`. The core AI bridge. Ask for **strict JSON** and parse defensively (`indexOf('[')…lastIndexOf(']')`). |
| `myllmFetch(url,opts)` | network GET/POST | Use this instead of `fetch()` — the web view runs at a **null origin**, so `fetch()`/XHR are CORS-dead. (Plain `<img src=https://…>` *does* load, so remote images are fine without the bridge.) |
| `myllmShare(payload)` | share sheet | text/url/image out |
| `myllmSpeak(text,{lang})` | text-to-speech | pass a BCP-47 `lang` (e.g. `'es'`). |
| `myllmSaveImage(dataUrl)` | save to Photos | |
| `myllmIntent(...)` | MyLLMos intent bus | cross-app / chat hand-off |
| `myllmFiles` | shared folder r/w | list/read/write shared files |
| `myllmLocation` | location + place search | `current()`, `search(q,{limit})` → `[{name,address,latitude,longitude,distance}]`. |
| `myllmVision` / `myllmScan` / `myllmTranscribe` | camera vision / doc scan / speech-to-text | |
| `myllmGenerateImage(prompt)` | on-device/served image gen | |
| `myllmMemory` | long-term memory | |

Feature-detect pattern:
```js
var store = window.myllmStorage || {getItem:function(){return Promise.resolve(null)},
                                    setItem:function(){return Promise.resolve()}};
function haptic(k){ if(window.myllmHaptic) myllmHaptic(k||'light'); }
if(!window.myllmAsk){ /* show "enable AI in Settings" hint, offer manual path */ }
```

---

## 8. Persistence pattern (`myllmStorage`)

Async, string-valued, per-app. Serialize your whole state under one key and
save on every mutation:

```js
var items=[];
function save(){ store.setItem('items', JSON.stringify(items)); }
store.getItem('items').then(function(v){
  if(v){ try{ items=JSON.parse(v); }catch(e){} }
  render();
});
```
> Randomness: don't seed IDs on `Math.random()` if you want reproducibility — a
> small LCG (`seed=(seed*9301+49297)%233280`) gives stable ids/shuffles.

---

## 9. Search & discovery

Two distinct things share the word "search":

### 9a. Gallery discovery (how users *find* your app)
The in-app gallery's search indexes the **manifest text**: `name`, `tagline`,
`description`, and `tags` (and filters by `category`). Practical implications:
- Put the words people will search into the **`description`** and **`tags`** —
  not just the name. (Our language apps carry `learning`, `AI-powered`,
  `offline`; the risk log carries `productivity`.)
- Use the **shared tag vocabulary** so filters stay coherent: `"AI-powered"`,
  `"offline"`, `"saves data"` are cross-cutting; add topical tags on top.
- `featured:true` + a good `banner` pull an app into the featured rail.
- The update badge is driven purely by **`version`** (§2).

### 9b. In-app search (inside your app)
The common pattern (used by the language apps' vocabulary tab, JSON tools, etc.)
is a debounce-free `oninput` filter over an in-memory list — no library:

```html
<input id="q" placeholder="Search…" oninput="render()">
```
```js
function render(){
  var q=(document.getElementById('q').value||'').toLowerCase().trim();
  var rows = DATA.filter(function(x){
    return !q || x.word.toLowerCase().indexOf(q)>=0
             || x.meaning.toLowerCase().indexOf(q)>=0;
  });
  // …render rows; show an empty-state when rows.length===0…
}
```
Keep it origin-free (no network), match against every human-visible field, and
always render an explicit empty state.

---

## 10. Templated & generated apps (`build_*.py`)

When you're producing a *family* of apps or adapting an external source, don't
hand-maintain each HTML — use a generator. Existing ones:

| script | produces |
|---|---|
| `build_language.py` | `learn-<lang>` picture-flashcard apps from `langpacks/<code>.json` |
| `build_hanyu.py` | adapts the Wix "Hanyu" app into the MyLLMos sandbox |
| `build_expense.py` | adapts the household Expense Tracker (Sheets backend) |
| `build_emu.py` / `build_nes.py` / `build_gb.py` | emulator players |

**`build_language.py` is the reference pattern to copy:**
- A single `TEMPLATE` HTML string with `__TOKENS__` placeholders.
- A data file per instance (`langpacks/es.json` …) supplying the variable bits.
- It emits the `.html` **and** the full `.myllmapp` bundle, and **prints the
  ready-to-paste `apps.json` entry**.
- It **asserts data integrity** (e.g. word-count == image-count) so a bad data
  file fails loudly instead of shipping broken.
- **Asset reuse:** the language apps reuse the *language-agnostic* flashcard
  photos from the sibling repo `TeamDzX/hanyu-packs`
  (`images/flashcards/<category>/<n>.jpg`, card N ↔ image N) — a picture of an
  apple works for any language, so only the labels change. This is the model for
  "bring the same detail to other apps": **find shared, already-generated assets
  and re-skin the data layer around them.**

Adding a 4th language ≈ write one `langpacks/<code>.json` + run the builder.

---

## 11. Banners (gallery art)

- **Size:** 800×400 JPG at `apps/<slug>.jpg`.
- **Generator:** the ComfyUI / FLUX.2-klein server via
  `~/.claude/scripts/imagegen/comfy_gen.py OUT "PROMPT" SEED --size 1216x608 --max 800`.
- **House style:** clean, premium, minimal; soft glowing shapes; subject motif
  on a themed gradient. Always end the prompt with **"no text, no letters, no
  words, no people"** — FLUX garbles text, so never rely on rendered type
  (render any real glyphs as CSS/SVG, never as generated images).
- Confirm before generating *large* batches (server time costs).

---

## 12. New-app checklist

1. Author `apps-src/<slug>.html` — self-contained, tokenised CSS, feature-detected
   bridges, AI cog wrapper if it uses `myllmAsk`, no native dialogs.
2. Generate `apps-src/<slug>.myllmapp` (`{name,kind:"html",iconSymbol,iconColor,html}`).
3. Generate `apps/<slug>.jpg` (800×400, no text).
4. Add the `apps.json` entry (surgical edit, valid category, good `description`/`tags`).
5. `python3 -c "import json;json.load(open('apps.json'))"` to validate.
6. Stage the **named** files (never `-A`), commit, `git push origin main`.
7. Verify live: `curl -sI <raw html url>` → `200`; pull-to-refresh the gallery.
8. Updating later? **Bump `version`.**

---

## 13. Gotchas (the short list)

- **Push = live** on `main`; ~5-min CDN cache.
- **Bump `version`** or existing users won't see updates.
- **Never `git add -A`** — `*-raw.html` are private source.
- **Null origin:** `fetch()` is CORS-dead → use `myllmFetch`; `<img>` remote URLs
  are fine.
- **No `alert`/`confirm`/`prompt`.**
- **FLUX garbles text** — no rendered words in generated images.
- **Don't rely on `opacity`** for must-read text; set explicit colour + weight.
- **Keep `.html` and `.myllmapp` in sync.**
- **`category` must be in the top-level `categories` list.**

---

*Living document — update it when the manifest schema, bridges, or deploy flow
change.*
