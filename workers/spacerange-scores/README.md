# Space Range — world leaderboard Worker

A ~60-line Cloudflare Worker + KV namespace that stores the global top-100.
The game only talks to it when the player has opted in on the start screen.

## Deploy (dashboard, ~5 minutes, free tier)

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Create Worker**.
   Name it `spacerange-scores` → **Deploy** (the hello-world), then **Edit code**.
2. Replace the code with `worker.js` from this folder → **Deploy**.
3. **Storage & Databases → KV** → **Create namespace** → name `spacerange_scores`.
4. Back on the worker: **Settings → Bindings → Add → KV namespace** —
   variable name **`SCORES`** (exactly), namespace `spacerange_scores` → save.
5. Copy the worker URL, e.g. `https://spacerange-scores.<your-subdomain>.workers.dev`.

## Wire the game

In `apps-src/space-range.html`, set:

```js
var SCORE_API='https://spacerange-scores.<your-subdomain>.workers.dev';
```

(While `SCORE_API` is empty the whole world-leaderboard UI stays hidden.)

## Smoke test

```sh
curl -s -X POST https://<worker-url>/submit -H 'Content-Type: application/json' \
  -d '{"n":"ACE","s":1234,"w":5}'
curl -s https://<worker-url>/top
```

## Notes

- Rate limit: one submit per IP per 20s. Names clamped to 8 chars A–Z 0–9 `.` `-` space.
- Scores capped at 99,999,999; top-100 kept, top-10 shown in game.
- Single-key KV read-modify-write is last-write-wins under simultaneous submits —
  acceptable at this scale; move to a Durable Object if it ever matters.
