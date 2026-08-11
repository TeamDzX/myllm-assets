# myllm-assets

Generated visual assets for the [MyLLM](https://apps.apple.com/gb/app/myllm-local-ai-agent/id6760704297) site and marketplace, hot-linked via `raw.githubusercontent.com`.

- `features/<slug>.jpg` — banner art for the site's feature cards (800×400).

Art is generated on our own ComfyUI FLUX.2-klein server in one consistent direction:
isometric, deep indigo/violet, electric-blue accents, no text.

Skill-card banners live in [myllm-skills](https://github.com/TeamDzX/myllm-skills) `banners/` beside the skills they illustrate.

## Gallery apps

`apps-src/` holds the MyLLMos™ App Gallery — one self-contained HTML file per
app, listed in `apps.json` and served to MyLLM over jsDelivr. See
`GALLERY_HANDOVER.md` to add one, `CONTRIBUTING.md` to submit one.

## Licence

**Source-available, not open source.** MyLLM™ ships a *View code* button and a
*Remix* button, so these files are public on purpose: read them, modify them,
run your version inside MyLLM. Republishing them, selling them, or presenting
them as your own is not permitted — see [LICENSE](LICENSE) for the full terms,
and ask if you want to do something it doesn't allow. The answer is often yes.

Community apps belong to their authors ([GALLERY-TERMS.md](GALLERY-TERMS.md)),
and bundled open-source libraries keep their own licences
([THIRD-PARTY.md](THIRD-PARTY.md)).

Every app file carries a header stating this and a `--build-id` identifying it.
`stamp_apps.py` applies both; it is idempotent, so run it after any rebuild.

"MyLLM", "MyLLMos" and "Opticell" are unregistered trade marks of Opticell Ltd;
[BRAND.md](BRAND.md) records their first and continuous use, with dated sources.
