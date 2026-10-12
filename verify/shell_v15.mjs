// Shell v15: batch changes are inspectable (Jarvis's review, 12 Oct). A batch
// is one log row with its reason and its parts; each entry says what it did;
// log show N opens a row with each edit's diff. Plus the prompt line telling
// the model its answer may span lines and that the user sees every step.
//
//   node shell_v15.mjs        # exit 0 = every case passes
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
const script = r => page.evaluate(r => { window.__replies = r.slice(); window.__prompts = []; }, r);
await page.evaluate(() => {
  window.__replies = []; window.__prompts = [];
  window.myllmAsk = (p, o) => { window.__prompts.push(String(p) + '\n' + ((o && o.system) || '')); return Promise.resolve(window.__replies.shift() || JSON.stringify({ say: 'done' })); };
});

await sh('write keep.md "alpha"');
await script([JSON.stringify({ propose: ['write notes/a.md "one"', 'write notes/b.md "two"'], why: 'set up the notes folder' })]);
await sh('please set up notes', 1200);
await sh('y', 900);

await check('a batch is one row with its reason and its parts', async () => {
  const t = await out('log');
  const ok = /#1\t.*batch of 2 changes — set up the notes folder/.test(t) && /· wrote 3 chars to notes\/a\.md/.test(t)
    && /· wrote 3 chars to notes\/b\.md/.test(t) && /#2\t.*keep\.md/.test(t);
  return ok || t;
});
await check('the batch row is the one undo reverses', async () => {
  const t = await out('log'); return /batch of 2 changes.*← undo reverses this/.test(t) || t;
});
await check('log show N lists each part with its diff', async () => {
  const t = await out('log show 1');
  return (/#1 .*batch of 2/.test(t) && /· wrote 3 chars to notes\/a\.md/.test(t) && /\(new file\)/.test(t) && /\+one/.test(t) && /\+two/.test(t)) || t;
});
await check('log <path> keeps the whole-log row number and the whole batch', async () => {
  const t = await out('log notes/b.md');
  return (/#1\t.*batch of 2/.test(t) && /notes\/a\.md/.test(t) && !/keep\.md/.test(t)) || t;
});

await sh('replace keep.md alpha beta');
await check('an edit logs what it did, not just "edited"', async () => {
  const t = await out('log -n 1'); return /#1\t.*replaced 1 occurrence in keep\.md/.test(t) || t;
});
await check('log show on an edit shows the diff before -> now', async () => {
  const t = await out('log show 1'); return (/-alpha/.test(t) && /\+beta/.test(t) && /keep\.md before/.test(t)) || t;
});
await sh('replace keep.md beta gamma');
await check('an older edit says later changes are included', async () => {
  const t = await out('log show 2'); return (/\+gamma/.test(t) && /later changes to keep\.md are included/.test(t)) || t;
});

await sh('mkdir box');
await sh('cp notes/a.md notes/b.md box', 600);
await check('cp of several files is a batch with its reason and names each file', async () => {
  const t = await out('log -n 1');
  return (/batch of 2 changes — cp 2 items to box\//.test(t) && /box\/a\.md/.test(t) && /box\/b\.md/.test(t)) || t;
});
await sh('undo', 600);
await check('undo still reverses the whole batch', async () => {
  const r = await page.evaluate(async () => (await window.myllmFiles.list()).map(f => f.path));
  return (!r.includes('box/a.md') && !r.includes('box/b.md') && r.includes('notes/a.md')) || JSON.stringify(r);
});

await check('log show with no such row says how to use it', async () => {
  const t = await out('log show 99'); return /N is a row number from  log/.test(t) || t;
});
await check('entries from before v15 (no paths) still list and filter', async () => {
  await page.evaluate(() => { changeLog.unshift({ id: 1, t: Date.now() - 86400000, text: 'edited old.md  (batch)' }); });
  const t = await out('log old.md'); return /edited old\.md/.test(t) || t;
});
await check('an entry whose detail left the undo stack says so', async () => {
  const n = (await out('log -n 200')).match(/#(\d+)\t[^\n]*edited old\.md/);
  if (!n) return 'row not found';
  const t = await out('log show ' + n[1]); return /no longer kept/.test(t) || t;
});

await check('the assistant is told about log show and multi-line answers', async () => {
  await script([JSON.stringify({ say: 'line one\nline two' })]);
  await sh('what changed?', 900);
  const p = await page.evaluate(() => window.__prompts.join('\n'));
  const t = await screen();
  return (/log show N/.test(p) && /may run to several lines/.test(p) && /line one\nline two/.test(t)) || 'prompt/screen mismatch';
});
await check('changes lists v15 then v14; man log mentions log show', async () => {
  const c = await out('changes'); const m = await out('man log');
  return (/^Shell v15/.test(c.trim()) && c.indexOf('Shell v14') > c.indexOf('Shell v15') && /log show N/.test(m)) || c.slice(0, 200) + ' | ' + m;
});
await check('no page errors', async () => errs.length === 0 || errs.join('; '));

await browser.close();
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
