# Submit your app to the MyLLMos Gallery

Built something in MyLLM you're proud of? The gallery has a **Community** shelf
for apps made by users. Anyone can submit; every app is human-reviewed before
it goes live, and ships to both iOS and Android at once.

## The easy way (from inside MyLLM)

1. Open your app on the springboard → long-press → **View Code** → copy it.
2. Open **Submit Your App** in the App Gallery.
3. Paste your code — it checks the rules below automatically and packages a
   submission you can email or attach to a GitHub issue.

## The GitHub way

Open an issue using the **App submission** template (or a PR adding
`apps-src/<your-slug>.html`) with:

- **App name** and a one-line pitch
- **Author name/handle** as you want it credited
- **What it needs**: network? AI (`myllmAsk`)? storage? microphone/camera?
- The complete, self-contained HTML file

## The rules (what review checks)

1. **One self-contained file.** All CSS and JavaScript inline. **No remote
   `<script src>`, no remote stylesheets, no remote iframes** — a reviewed app
   must not be able to change after review. Remote *images* are fine.
2. **Play nice with the sandbox.** Use the `myllm*` bridges (see
   `GALLERY_HANDOVER.md` §6–7): `myllmStorage` not localStorage, `myllmFetch`
   not fetch, no `alert/confirm/prompt`. Feature-detect every bridge.
3. **Be honest about network and AI.** Anything that leaves the device must be
   obvious to the user. Tokens/keys must stay in `myllmStorage` and go only to
   the service they belong to.
4. **Size**: keep the HTML under ~600 KB (embed images as base64 sparingly).
5. **Own it**: only submit code and assets you have the right to publish.
   No trademark-infringing names or art. Credit any libraries you inlined.
6. **Family-friendly** by default; nothing illegal, hateful, or deceptive.

## What happens next

We run your app on a device, read the code, and if it's a fit: we generate
banner art in the gallery's house style, credit you in the description, and
merge — it appears in every MyLLM user's gallery within minutes. If something
needs fixing we'll say exactly what in the issue thread.

Maintainer review notes live in `GALLERY_HANDOVER.md` §12 (the checklist) —
submissions are checked against the same list.
