// Shell v12: full screen + no zoom (Alex), the .scratch area (#9, Alex said
// yes), and the in-Shell assistant's round 4: log sees outside changes,
// preview rm names what goes, times carry a zone, key-like values are masked
// for the model, versions <path>, hidden things counted in info.
//
//   node shell_v12.mjs        # exit 0 = every case passes
import { webkit } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(HERE, '..', 'apps-src', 'shell.html'), 'utf8');

const browser = await webkit.launch();
let fails = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r === true) { console.log('ok  ', name); return; }
        fails++; console.log('FAIL', name, '->', r); }
  catch (e) { fails++; console.log('FAIL', name, '->', e.message); }
};

async function openShell({ withClose = true, seed = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await context.addInitScript(([withClose, seed]) => {
    window.__imm = []; window.__closed = 0; window.__mtime = {};
    window.myllmImmersive = (on, o) => { window.__imm.push(on); return Promise.resolve(); };
    if (withClose) window.myllmClose = () => { window.__closed++; return Promise.resolve(); };
    else delete window.myllmClose;
    const install = () => {
      const f = window.myllmFiles; if (!f || f.__v12) return;
      const list = f.list, write = f.write;
      f.list = async () => (await list()).map(x => ({ ...x, modified: window.__mtime[x.path] ?? x.modified }));
      f.write = async (p, c) => { window.__mtime[p] = Math.floor(Date.now() / 1000); return write(p, c); };
      f.versions = async () => []; f.readVersion = async () => null;
      f.__v12 = true;
      if (seed) for (const [p, t] of Object.entries(seed)) write(p, t);
    };
    install(); document.addEventListener('DOMContentLoaded', install);
  }, [withClose, seed]);
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  return { page, errs, context };
}

const { page, errs } = await openShell({ seed: { '.scratch/old.md': 'left over from last time', 'keep.md': 'mine' } });
const sh = async (cmd, wait = 350) => { await page.fill('#in', cmd); await page.press('#in', 'Enter'); await page.waitForTimeout(wait); };
const screen = () => page.evaluate(() => document.getElementById('out').innerText);
const read = p => page.evaluate(x => window.myllmFiles.read(x), p);
const put = (p, t) => page.evaluate(([x, y]) => window.myllmFiles.write(x, y), [p, t]);
const clear = () => sh('clear', 60);
const out = async cmd => { await clear(); await sh(cmd); return (await screen()).split('\n').slice(1).join('\n'); };
const script = r => page.evaluate(r => { window.__replies = r.slice(); window.__prompts = []; }, r);
await page.evaluate(() => {
  window.__replies = []; window.__prompts = [];
  window.myllmAsk = (p, o) => { window.__prompts.push({ p: String(p), s: (o && o.system) || '' }); return Promise.resolve(window.__replies.shift() || '{"say":"done"}'); };
});

// full screen + zoom
await check('opens full screen with a ✕ when MyLLM can close it', async () => {
  const r = await page.evaluate(() => ({ imm: document.body.classList.contains('imm'), calls: window.__imm.slice(),
    x: getComputedStyle(document.querySelector('header .imm-x')).display }));
  return (r.imm && r.calls.includes(true) && r.x === 'grid') || JSON.stringify(r);
});
await check('✕ closes the app', async () => {
  await page.click('header .imm-x'); return (await page.evaluate(() => window.__closed)) === 1 || 'not closed';
});
await check('no zoom: viewport locked, pinch gesture prevented, touch-action set', async () => {
  const r = await page.evaluate(() => {
    const vp = document.querySelector('meta[name=viewport]').content;
    const ev = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(ev);
    return { vp, prevented: ev.defaultPrevented, ta: getComputedStyle(document.body).touchAction };
  });
  return (/maximum-scale=1/.test(r.vp) && /user-scalable=no/.test(r.vp) && r.prevented && r.ta === 'manipulation') || JSON.stringify(r);
});
await check('older MyLLM (no myllmClose): not full screen, no ✕', async () => {
  const o = await openShell({ withClose: false });
  const r = await o.page.evaluate(() => ({ imm: document.body.classList.contains('imm'), x: getComputedStyle(document.querySelector('header .imm-x')).display }));
  await o.context.close();
  return (!r.imm && r.x === 'none') || JSON.stringify(r);
});

// .scratch
await check('scratch is emptied when Shell opens; your files are not', async () => {
  return ((await read('.scratch/old.md')) === null && (await read('keep.md')) === 'mine') || 'old scratch survived';
});
await check('the assistant writes to scratch without asking, and builds on it', async () => {
  await clear();
  await script(['{"run":["write .scratch/plan.md \\"step 1: read keep.md\\"","cat keep.md >> .scratch/plan.md"]}', '{"run":"cat .scratch/plan.md"}', '{"say":"noted"}']);
  await sh('make a working note', 700);
  const note = await read('.scratch/plan.md'); const t = await screen();
  const prompts = await page.evaluate(() => window.__prompts);
  return (note === 'step 1: read keep.md\nmine' && !t.includes('blocked') && prompts[2].p.includes('step 1: read keep.md')) || JSON.stringify([note, t.slice(-500)]);
});
await check('…but anywhere else is still blocked', async () => {
  const r = await page.evaluate(() => [scratchOnly('write keep.md x'), scratchOnly('cat keep.md > copy.md'), scratchOnly('write .scratch/a x'),
    scratchOnly('cat keep.md > .scratch/c'), scratchOnly('rm .scratch/a'), scratchOnly('mv keep.md .scratch/k'), scratchOnly('write ../.scratch/x y')]);
  return JSON.stringify(r) === '[false,false,true,true,false,false,true]' || JSON.stringify(r);
});
await check('from a subfolder, .scratch still means the one at the root', async () => {
  await sh('mkdir sub'); await sh('cd sub'); await sh('write .scratch/deep.md hi'); await sh('cd /');
  return ((await read('.scratch/deep.md')) === 'hi' && (await read('sub/.scratch/deep.md')) === null) || 'resolved under sub/';
});
await check('scratch is hidden from ls/find/info totals, shown by ls -a and scratch', async () => {
  const ls = await out('ls'); const fi = await out('find *.md'); const la = await out('ls -a'); const sc = await out('scratch'); const inf = await out('info');
  return (!ls.includes('.scratch') && !fi.includes('.scratch') && la.includes('.scratch/') && sc.includes('.scratch/plan.md')
    && /hidden: \.trash 0 file\(s\) · \.scratch 2 file\(s\)/.test(inf)) || JSON.stringify({ ls, fi, la, sc, inf });
});
await check('scratch writes stay off your undo stack and log', async () => {
  const u = await page.evaluate(() => undoStack.filter(o => (o.path || '').indexOf('.scratch') === 0).length);
  const lg = await out('log');
  return (u === 0 && !lg.includes('.scratch')) || JSON.stringify([u, lg]);
});
await check('scratch is capped at 200 KB', async () => {
  await sh('write .scratch/big.txt ' + 'x'.repeat(100)); // small, fine
  await page.evaluate(() => window.myllmFiles.write('.scratch/huge.txt', 'y'.repeat(200 * 1024 - 50)));
  const t = await out('cat keep.md >> .scratch/big.txt');
  await sh('scratch clear');
  return t.includes('is full (200 KB)') || t;
});
await check('scratch clear empties it', async () => {
  return ((await read('.scratch/plan.md')) === null && (await out('scratch')).includes('is empty')) || 'not cleared';
});

// round 4
await check('log lists files changed outside Shell, with times and zone', async () => {
  await page.evaluate(() => { window.__mtime['system/claude.json'] = Math.floor(Date.now() / 1000) - 2 * 86400; });
  await put('system/claude.json', '{"status":"ok"}');
  await page.evaluate(() => { window.__mtime['system/claude.json'] = Math.floor(Date.now() / 1000) - 2 * 86400; });
  const t = await out('log');
  return (t.includes('changed outside Shell in the last 7 days') && t.includes('system/claude.json') && /times are .*UTC[+-]\d/.test(t)) || t;
});
await check('log with nothing via Shell says so, still lists outside changes', async () => {
  const o = await openShell({ seed: { 'notes/a.md': 'x' } });
  await o.page.fill('#in', 'log'); await o.page.press('#in', 'Enter'); await o.page.waitForTimeout(300);
  const t = await o.page.evaluate(() => document.getElementById('out').innerText); await o.context.close();
  return (t.includes('no changes made via Shell yet') && t.includes('notes/a.md')) || t;
});
await check('preview rm of a folder says use rmdir; preview rmdir names every file, size, date and recent edits', async () => {
  await put('vocab/a.md', 'alpha'); await put('vocab/b.md', 'beta beta');
  const a = await out('preview rm vocab'); const b = await out('preview rmdir vocab');
  return (a.includes('is a folder — use  rmdir vocab') && b.includes('vocab/ — 2 file(s)') && b.includes('vocab/a.md') && b.includes('changed in the last 24 h') && b.includes('UTC')) || a + '\n--\n' + b;
});
await check('stat shows the zone', async () => { const t = await out('stat keep.md'); return /modified: .*\(.*UTC[+-]\d/.test(t) || t; });
await check('key-like values are masked for the model, not for you', async () => {
  await put('system/github.json', '{"id":"github","token":"ghp_abcdefghijklmnopqrstuvwx1234","tokens_used":1234,"status":"ok"}');
  const screenView = await out('cat system/github.json');
  const model = await page.evaluate(() => runCaptured('cat system/github.json'));
  return (screenView.includes('ghp_abcdefghijklmnopqrstuvwx1234') && !model.includes('ghp_abcdef') && model.includes('"token":"[masked]"')
    && model.includes('"tokens_used":1234') && model.includes('were masked')) || JSON.stringify([screenView, model]);
});
await check('raw keys (sk-…, Bearer …) are masked too', async () => {
  const r = await page.evaluate(() => maskSecrets('key sk-ant-REDACTEDREDACTEDREDACTED and Authorization: Bearer abcdefghijklmnop123'));
  return (!r.includes('REDACTED') && !r.includes('abcdefghijklmnop123') && r.includes('Bearer [masked]')) || r;
});
await check('ask hands the model masked material', async () => {
  await script(['summary']); await sh('cat system/github.json | ask "summarise"', 500);
  const p = await page.evaluate(() => window.__prompts[0].p);
  return (!p.includes('ghp_abcdef') && p.includes('[masked]')) || p;
});
await check('versions <path> works; bare versions explains', async () => {
  const a = await out('versions keep.md'); const b = await out('versions');
  return (a.includes('No previous versions of keep.md') && b.includes('versions <path>')) || a + '\n' + b;
});
await check('the assistant is told about the zone, hidden folders, masking and scratch', async () => {
  await script(['{"say":"ok"}']); await sh('hi', 400);
  const s = await page.evaluate(() => window.__prompts[0].s);
  return (s.includes('All times shown are') && s.includes('.scratch (your notes)') && s.includes('[masked]') && s.includes('without asking')) || s.slice(0, 500);
});
await check('every command has a man page', async () => {
  const missing = await page.evaluate(() => VERBS.filter(v => !MAN[v]));
  return missing.length === 0 || 'no man page: ' + missing.join(', ');
});
await check('no page errors anywhere in the run', async () => errs.length === 0 || errs.join('\n'));

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
