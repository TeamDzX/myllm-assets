// Space Range — world leaderboard service (Cloudflare Worker + KV).
// Endpoints:
//   GET  /top?limit=10   -> [{n,s,w,t}, ...] best-first (max 100 kept)
//   POST /submit         {n,s,w} -> {ok:true, rank} | {error}
// Storage: one KV key "top" holding the top-100 JSON. Concurrent submits are
// last-write-wins on that key — fine at arcade scale, revisit if it ever isn't.
// Abuse guards: charset/length clamps, score cap, per-IP 20s rate limit.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: CORS });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);

    if (url.pathname === '/top') {
      const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '10', 10) || 10));
      const top = JSON.parse((await env.SCORES.get('top')) || '[]');
      return json(top.slice(0, limit));
    }

    if (url.pathname === '/submit' && req.method === 'POST') {
      const ip = req.headers.get('cf-connecting-ip') || 'unknown';
      if (await env.SCORES.get('rl:' + ip)) return json({ error: 'slow down' }, 429);
      await env.SCORES.put('rl:' + ip, '1', { expirationTtl: 20 });

      let b;
      try { b = await req.json(); } catch { return json({ error: 'bad body' }, 400); }
      const n = String(b.n || '').toUpperCase().replace(/[^A-Z0-9 .\-]/g, '').trim().slice(0, 8) || 'PILOT';
      const s = Math.max(0, Math.min(99999999, Math.floor(Number(b.s) || 0)));
      const w = Math.max(1, Math.min(999, Math.floor(Number(b.w) || 1)));
      if (s < 1) return json({ error: 'no score' }, 400);

      const top = JSON.parse((await env.SCORES.get('top')) || '[]');
      top.push({ n, s, w, t: Date.now() });
      top.sort((a, z) => z.s - a.s);
      const trimmed = top.slice(0, 100);
      await env.SCORES.put('top', JSON.stringify(trimmed));
      const rank = trimmed.findIndex((e) => e.s === s && e.n === n) + 1;
      return json({ ok: true, rank: rank || null });
    }

    return json({ error: 'not found' }, 404);
  },
};
