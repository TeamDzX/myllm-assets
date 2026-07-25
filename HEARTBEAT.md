# System heartbeats — the MyLLMos awareness registry

A tiny convention that lets any app or system report its state into one shared,
**on-device** registry. The **Command Center** app shows it live, and the MyLLM
assistant can summarise it (`system_status`) when you ask "how is everything?".

## The schema

One JSON "heartbeat" per system, written to `system/<id>.json` in the MyLLMos
shared file store. Transport-agnostic — the same shape however it arrives.

```json
{
  "id": "greenhouse",          // required — unique, [a-z0-9_-]
  "name": "Greenhouse",        // optional — display name
  "status": "ok",              // "ok" | "warn" | "error"
  "metrics": { "humidity": 62, "temp": 24 },   // any key → number/text
  "errors": ["pump offline"]   // optional list of strings
}
```

The reader stamps `ts` (arrival time). No heartbeat for 10 minutes → shown as
**stale**. Everything stays on the device unless a transport (below) is enabled.

## Monitor a URL (the main way — Command Center pulls it)

Most systems just expose their state at an HTTP endpoint that returns JSON; a
database or service needs only a small read-only status endpoint in front of it:

```
GET http://your-server/status  →  {"status":"ok","rows":1240,"errors":0}
```

Add it in Command Center → 🌐 Monitors (name + URL; optional metric keys and a
private auth header). It polls the URL and writes the heartbeat for you — top-level
numbers/text become metrics. **Or just ask the assistant:** *"monitor the greenhouse
at http://greenhouse.local/status"* (the `add-monitor` action). The monitor list
lives in the shared store (`system/_collectors.json`) so the assistant can add to it;
auth tokens stay private to the app.

## Reporting from a MyLLMos app (on-device, private)

Two lines — write straight to the shared store:

```js
await myllmFiles.write("system/" + id + ".json", JSON.stringify({
  id, name, status, metrics, errors
}));
```

Or drop in this helper and call `report(...)` whenever state changes:

```js
async function report(id, status, metrics = {}, errors = []) {
  try {
    await myllmFiles.write("system/" + id.replace(/[^a-z0-9_-]+/gi,'-') + ".json",
      JSON.stringify({ id, status, metrics, errors }));
  } catch (e) { /* shared files off — degrade quietly */ }
}
// report("timer-app", "ok", { runs: 12 });
```

## Reporting from outside the phone (optional transport)

Systems that aren't on the phone push through a transport the Command Center
pulls in. **Telegram** is the first one: post a message that starts with
`MYLLM:` followed by the heartbeat JSON, to a bot the hub is watching.

```bash
curl "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d chat_id=<CHAT_ID> \
  --data-urlencode 'text=MYLLM:{"id":"greenhouse","status":"ok","metrics":{"humidity":62,"temp":24}}'
```

The Command Center (Settings → Telegram, opt-in) pulls these via `myllmFetch`
and writes them into the same registry with `"source": "telegram"`. **This leaves
your device via Telegram's cloud** — it's off by default, and only for systems
you can't report on-device. The private cross-device path (trusted circles) will
be a second transport later; the schema doesn't change.

## Reading it back

- **Command Center** app — live dashboard (ok / warn / error / stale, metrics, errors).
- **The assistant** — ask "how are my systems doing?" and it calls `system_status`,
  or reads `system/*.json` with `read_shared_file` / `list_shared_files`.

Because the registry is just files in the shared store, any reader works — no
service, no account, no backend.
