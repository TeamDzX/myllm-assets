// Shell v16: the user's saved apps as files in apps/ (MyLLM 5.9.7 myllmApps
// bridge), `check`, an automatic check after an approved app change, and a
// small mode for the model on the phone (short prompt, 1,200-character
// outputs, only the last two outputs in full, numbered sed for the assistant).
//
//   node shell_v16.mjs        # exit 0 = every case passes
import { webkit } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(HERE, '..', 'apps-src', 'shell.html'), 'utf8');
const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
const page = await context.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(600);

let fails = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r === true) { console.log('ok  ', name); return; }
        fails++; console.log('FAIL', name, '->', r); }
  catch (e) { fails++; console.log('FAIL', name, '->', e.message); }
};
const sh = async (cmd, wait = 350) => { await page.fill('#in', cmd); await page.press('#in', 'Enter'); await page.waitForTimeout(wait); };
const screen = () => page.evaluate(() => document.getElementById('out').innerText);
const out = async (cmd, wait) => { await sh('clear', 60); await sh(cmd, wait); return (await screen()).split('\n').slice(1).join('\n'); };
const script = r => page.evaluate(r => { window.__replies = r.slice(); window.__prompts = []; window.__systems = []; }, r);

const BUDGET = Array.from({ length: 30 }, (_, i) => i === 11 ? 'let total = sum(items)' : `line ${i + 1} of budget`).join('\n');
await page.evaluate(({ BUDGET }) => {
  window.__replies = []; window.__prompts = []; window.__systems = [];
  window.__room = { onDevice: true, tokens: 8192 };
  window.myllmAsk = (p, o) => { window.__prompts.push(String(p)); window.__systems.push((o && o.system) || ''); return Promise.resolve(window.__replies.shift() || JSON.stringify({ say: 'done' })); };
  window.myllmAsk.room = () => Promise.resolve(window.__room);
  // The 5.9.7 bridge, in memory: three apps (two share a name), versions kept per save.
  const apps = [
    { id: 'A1', name: 'Budget', kind: 'html', html: BUDGET, versions: [] },
    { id: 'A2', name: 'Notes Tool', kind: 'py', html: 'print("hi")\n', versions: [] },
    { id: 'A3', name: 'Budget', kind: 'html', html: '<p>second</p>', versions: [] },
  ];
  window.__apps = apps; window.__checks = [];
  const byId = id => apps.find(a => a.id === id);
  window.myllmApps = {
    list: async () => { const seen = {}; return apps.map(a => { const n = (seen[a.name] = (seen[a.name] || 0) + 1);
      return { id: a.id, name: a.name, file: a.name + (n > 1 ? ` (${n})` : '') + '.' + a.kind, kind: a.kind, size: a.html.length, modified: 1760000000 }; }); },
    read: async id => byId(id).html,
    write: async (id, t) => { const a = byId(id); a.versions.unshift({ stamp: Date.now() + a.versions.length, html: a.html }); a.html = String(t); },
    versions: async id => byId(id).versions.map(v => ({ stamp: v.stamp, size: v.html.length })),
    readVersion: async (id, s) => (byId(id).versions.find(v => v.stamp === s) || {}).html ?? null,
    check: async id => { window.__checks.push(id); const a = byId(id);
      return /broken/.test(a.html) ? `run_check '${a.name}': loaded in 0.2 s, ran 2.5 s — 1 error, 0 warnings.\n\nERRORS\n- ReferenceError: broken is not defined` : `run_check '${a.name}': loaded in 0.2 s, ran 2.5 s — no errors.`; },
  };
}, { BUDGET });

await sh('write keep.md "alpha"');

await check('ls shows apps/ beside the workspace', async () => { const t = await out('ls'); return (/apps\//.test(t) && /keep\.md/.test(t)) || t; });
await check('ls apps lists each app as a file; a shared name gets (2)', async () => {
  const t = await out('ls apps'); return (/Budget\.html/.test(t) && /Budget \(2\)\.html/.test(t) && /Notes Tool\.py/.test(t)) || t;
});
await check('sed -n reads a slice of an app (unnumbered when you type it)', async () => {
  const t = await out("sed -n '12,13p' apps/Budget.html"); return (/^let total = sum\(items\)\nline 13 of budget/m.test(t) && !/12\| /.test(t)) || t;
});
await check('grep -n finds a line in an app', async () => { const t = await out('grep -n total apps/Budget.html'); return /12/.test(t) && /sum\(items\)/.test(t) || t; });
await check('edit changes the app through the bridge', async () => {
  await sh('edit apps/Budget.html 12 "let total = sum(items) + tax"', 500);
  const h = await page.evaluate(() => window.__apps[0].html.split('\n')[11]);
  return h === 'let total = sum(items) + tax' || h;
});
await check('versions lists what the bridge kept', async () => { const t = await out('versions apps/Budget.html'); return /1\b/.test(t) && !/no saved versions/i.test(t) || t; });
await check('undo puts the app back', async () => {
  await sh('undo', 500);
  const h = await page.evaluate(() => window.__apps[0].html.split('\n')[11]);
  return h === 'let total = sum(items)' || h;
});
await check('rm, mv and a new file in apps/ are refused, nothing changes', async () => {
  const a = await out('rm apps/Budget.html'), b = await out('mv apps/Budget.html apps/B.html'), c = await out('write apps/New.html "x"');
  const n = await page.evaluate(() => window.__apps.length);
  return (/use MyLLMos/.test(a) && /use MyLLMos/.test(b) && /use MyLLMos/.test(c) && n === 3) || [a, b, c, n].join(' | ');
});
await check('check reports on an app', async () => { const t = await out('check apps/Budget.html', 500); return /check 'Budget'.*no errors/.test(t) || t; });
await check('check outside apps/ says what it is for', async () => { const t = await out('check keep.md'); return /check works on saved apps/.test(t) || t; });
await check('cp an app out to the workspace works', async () => {
  await sh('cp "apps/Notes Tool.py" notes-copy.py', 400);
  const t = await out('cat notes-copy.py'); return /print\("hi"\)/.test(t) || t;
});

// The assistant on the phone model: small prompt, numbered sed, old outputs shrink.
await script([
  JSON.stringify({ run: 'grep -n total apps/Budget.html' }),
  JSON.stringify({ run: "sed -n '11,13p' apps/Budget.html" }),
  JSON.stringify({ run: 'wc -l apps/Budget.html' }),
  JSON.stringify({ propose: 'edit apps/Budget.html 12 "let total = broken(items)"', why: 'use the new helper' }),
]);
await sh('add tax to the total in Budget', 2200);
await check('small mode: a short system prompt naming apps/', async () => {
  const s = await page.evaluate(() => window.__systems[0]);
  return (s.length < 2600 && /apps\/ holds the user's saved apps/.test(s) && /Never cat a whole app/.test(s)) || s.length + ' ' + s.slice(0, 200);
});
await check('small mode: sed output reaches the model numbered', async () => {
  const p = await page.evaluate(() => window.__prompts[2]); return /12\| let total = sum\(items\)/.test(p) || p.slice(-600);
});
await check('small mode: only the last two outputs stay in full', async () => {
  const p = await page.evaluate(() => window.__prompts[3]);
  return (/Assistant ran: grep -n total apps\/Budget\.html\n\(output read earlier\)/.test(p) && /12\| let total/.test(p) && /30 apps\/Budget\.html|30\t/.test(p)) || p.slice(-800);
});
await check('approving an app edit runs check and says what broke', async () => {
  await sh('y', 900);
  const t = await screen(); const n = await page.evaluate(() => window.__checks.length);
  return (/\$ check apps\/Budget\.html/.test(t) && /1 error/.test(t) && /undo  to put the app back/.test(t) && n >= 2) || t.slice(-500);
});
await check('the next question is told what the check said', async () => {
  await script([JSON.stringify({ say: 'fixing' })]);
  await sh('fix it', 900);
  const p = await page.evaluate(() => window.__prompts[0]); return /then check apps\/Budget\.html said: .*1 error/.test(p) || p.slice(0, 600);
});
await sh('undo', 500);

// A server model keeps the full prompt and the 4,000-character outputs.
await page.evaluate(() => { window.__room = { onDevice: false, tokens: null }; });
await script([JSON.stringify({ say: 'ok' })]);
await sh('what apps do I have?', 900);
await check('server model: the full prompt, with the apps/ guidance', async () => {
  const s = await page.evaluate(() => window.__systems[0]);
  return (s.length > 3500 && /holds the user's saved MyLLMos apps as files/.test(s)) || s.length;
});

// A real apps/ folder in the workspace keeps its name; the mount moves aside.
// Shell itself refuses a new file in apps/, so another app made this one.
await page.evaluate(() => window.myllmFiles.write('apps/mine.md', 'my own'));
await check('a real apps/ folder wins; saved apps move to saved-apps/', async () => {
  const t = await out('ls'); const u = await out('ls saved-apps'); const m = await out('cat apps/mine.md');
  return (/saved-apps\//.test(t) && /Budget\.html/.test(u) && /my own/.test(m)) || [t, u, m].join(' | ');
});

// Older MyLLM (no bridge): no apps/ at all.
await page.evaluate(() => { delete window.myllmApps; });
await check('without the bridge there is no saved-apps folder', async () => { const t = await out('ls'); return !/saved-apps/.test(t) || t; });

await check('no page errors anywhere in the run', async () => errs.length === 0 || errs.join('\n'));
await browser.close();

// Edit in Chat on the phone's model → Shell, opened in apps/ on that app.
{
  const b2 = await webkit.launch();
  const c2 = await b2.newContext({ viewport: { width: 390, height: 844 } });
  await c2.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await c2.addInitScript(() => {
    const apps = [{ id: 'A1', name: 'Менеджер Фінансів', kind: 'html', html: '<p>hi</p>' }];
    window.myllmApps = { list: async () => apps.map(a => ({ id: a.id, name: a.name, file: a.name + '.html', kind: 'html', size: 9, modified: 1760000000 })),
      read: async () => apps[0].html, write: async () => {}, versions: async () => [], readVersion: async () => null, check: async () => 'ok' };
    let handler = null;
    window.myllmIntent = { send: async () => ({}), receive: cb => { handler = cb; setTimeout(() => cb({ action: 'edit-app', data: { id: 'A1', name: 'Менеджер Фінансів' } }), 0); } };
  });
  const p2 = await c2.newPage();
  const e2 = []; p2.on('pageerror', e => e2.push(e.message));
  await p2.setContent(html, { waitUntil: 'load' });
  await p2.waitForTimeout(900);
  const t = await p2.evaluate(() => document.getElementById('out').innerText);
  const v = await p2.inputValue('#in');
  await check('edit-app intent: Shell opens in apps/ with the request begun', async () =>
    (/Менеджер Фінансів\.html/.test(t) && /Tell MyLLM what to change in Менеджер Фінансів\.html/.test(t) && v === 'In Менеджер Фінансів.html, ' && e2.length === 0) || [t.slice(-300), v, e2.join(';')].join(' | '));
  await b2.close();
}
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
