// Shell v11: the assistant loop, from the in-Shell assistant's own list (5 Oct,
// round 3). A scripted myllmAsk replays replies and records every prompt, so
// we can check both what the user sees and what the model is told.
//
//   node shell_v11.mjs        # exit 0 = every case passes
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
await page.waitForTimeout(500);

let fails = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r === true) { console.log('ok  ', name); return; }
        fails++; console.log('FAIL', name, '->', r); }
  catch (e) { fails++; console.log('FAIL', name, '->', e.message); }
};
const sh = async (cmd, wait = 350) => { await page.fill('#in', cmd); await page.press('#in', 'Enter'); await page.waitForTimeout(wait); };
const screen = () => page.evaluate(() => document.getElementById('out').innerText);
const read = p => page.evaluate(x => window.myllmFiles.read(x), p);
const put = (p, t) => page.evaluate(([x, y]) => window.myllmFiles.write(x, y), [p, t]);
const clear = () => sh('clear', 60);
const script = replies => page.evaluate(r => { window.__replies = r.slice(); window.__prompts = []; }, replies);
const prompts = () => page.evaluate(() => window.__prompts);
await page.evaluate(() => {
  window.__replies = []; window.__prompts = [];
  window.myllmAsk = (p, o) => { window.__prompts.push({ p: String(p), s: (o && o.system) || '' }); return Promise.resolve(window.__replies.shift() || '{"say":"done"}'); };
});

for (let i = 0; i < 30; i++) await put(`bulk/file${String(i).padStart(2, '0')}.md`, 'x');
await put('projects/alpha/plan.md', 'Plan: ship v11\nOwner: alex');
await put('projects/alpha/log.md', 'started');
await put('notes.md', 'one\ntwo');
await put('long.txt', Array.from({ length: 400 }, (_, i) => 'line ' + (i + 1) + ' ' + 'x'.repeat(30)).join('\n'));

// 1. no folder dump on screen per question
await check('a question no longer prints the folder listing on screen', async () => {
  await clear(); await script(['{"say":"hello"}']);
  await sh('what is here?', 500);
  const t = await screen(); const p = await prompts();
  return (!t.includes('bulk/') && t.includes('hello') && p[0].s.includes('bulk/')) || t;
});

// 2. several looks in one step
await check('run: [a, b] runs both in one step', async () => {
  await clear(); await script(['{"run":["cat notes.md","cat projects/alpha/plan.md"]}', '{"say":"read both"}']);
  await sh('read both files', 600);
  const p = await prompts();
  return (p.length === 2 && p[1].p.includes('Assistant ran: cat notes.md') && p[1].p.includes('Plan: ship v11')) || JSON.stringify(p.map(x => x.p.slice(-300)));
});

// 3. the assistant's own cd, put back afterwards; a proposal runs from its folder
await check('the assistant can cd; your folder is put back', async () => {
  await clear(); await sh('cd /');
  await script(['{"run":"cd projects/alpha"}', '{"run":"cat plan.md"}', '{"say":"owner is alex"}']);
  await sh('who owns the plan?', 700);
  const t = await screen(); const cwd = await page.evaluate(() => cwd); const p = await prompts();
  return (cwd === '' && t.includes('(in /projects/alpha)') && p[2].p.includes('Owner: alex')) || JSON.stringify([cwd, t.slice(-400)]);
});
await check('a proposal made after cd runs in that folder', async () => {
  await clear();
  await script(['{"run":"cd projects/alpha"}', '{"propose":"replace plan.md v11 v12","why":"bump"}']);
  await sh('bump the plan to v12', 600);
  await sh('y', 500);
  const t = await read('projects/alpha/plan.md'); const cwd = await page.evaluate(() => cwd);
  return (t === 'Plan: ship v12\nOwner: alex' && cwd === '') || JSON.stringify([t, cwd]);
});

// 4. a note alongside a command
await check('"say" with "run" is shown as a note, then the step runs', async () => {
  await clear(); await script(['{"say":"checking the log first…","run":"cat projects/alpha/log.md"}', '{"say":"it started"}']);
  await sh('how is alpha going?', 600);
  const notes = await page.evaluate(() => [...document.querySelectorAll('#out .note')].map(n => n.textContent));
  const t = await screen();
  return (notes.includes('checking the log first…') && t.includes('$ cat projects/alpha/log.md') && t.includes('it started')) || JSON.stringify([notes, t.slice(-300)]);
});

// 5. the next question hears what became of the last proposal
await check('approved proposal → "approved and done" next time', async () => {
  await script(['{"say":"ok"}']); await sh('anything else?', 500);
  const p = await prompts();
  return /You proposed: replace plan\.md v11 v12\n\s+Outcome: approved and done/.test(p[0].p) || p[0].p.slice(0, 600);
});
await check('declined proposal → "DECLINED" next time', async () => {
  await clear(); await script(['{"propose":"rm notes.md","why":"tidy"}']);
  await sh('tidy up', 500); await sh('n', 300);
  await script(['{"say":"ok"}']); await sh('and now?', 500);
  const p = await prompts();
  return (/You proposed: rm notes\.md\n\s+Outcome: the user DECLINED/.test(p[0].p) && (await read('notes.md')) === 'one\ntwo') || p[0].p.slice(0, 700);
});
await check('failed proposal → "FAILED" next time', async () => {
  await clear(); await script(['{"propose":"mv nothing.md else.md"}']);
  await sh('move it', 500); await sh('y', 400);
  await script(['{"say":"ok"}']); await sh('did it work?', 500);
  const p = await prompts();
  return /Outcome: approved, but it FAILED/.test(p[0].p) || p[0].p.slice(0, 700);
});
await check('a batch that stops reports which step failed', async () => {
  await clear(); await script(['{"propose":["cp notes.md n2.md","mv nope.md z.md","cp notes.md n3.md"]}']);
  await sh('do the batch', 500); await sh('y', 700);
  await script(['{"say":"ok"}']); await sh('status?', 500);
  const p = await prompts();
  return /steps 1–1 ran, step 2 FAILED/.test(p[0].p) || p[0].p.slice(0, 900);
});

// 6. preview (dry run)
await check('preview replace -E shows the diff and changes nothing', async () => {
  await put('v.txt', 'version 1.2\nversion 3.4');
  await clear(); await sh('preview replace -E v.txt "version (\\d)" "v$1"');
  const t = await screen(); const f = await read('v.txt');
  return (t.includes('-version 1.2') && t.includes('+v1.2') && t.includes('preview only') && f === 'version 1.2\nversion 3.4') || t;
});
await check('preview mv glob lists moves, clashes and missing', async () => {
  await sh('mkdir box'); await put('box/a.log', 'old'); await put('a.log', '1'); await put('b.log', '2');
  await clear(); await sh('preview mv *.log box');
  const t = await screen();
  return (t.includes('would move a.log -> box/a.log  — CLASH') && t.includes('would move b.log -> box/b.log') && (await read('a.log')) === '1') || t;
});
await check('preview rm of a missing file says the step would fail', async () => {
  await clear(); await sh('preview rm ghost.md'); return (await screen()).includes('missing: ghost.md') || await screen();
});
await check('preview is read-only for the assistant; the change itself is not', async () => {
  const r = await page.evaluate(() => [unsafeReason('preview rm notes.md', AGENT_OK), unsafeReason('rm notes.md', AGENT_OK), unsafeReason('cd projects', AGENT_OK), unsafeReason('cd projects', READ_ONLY)]);
  return (r[0] === null && !!r[1] && r[2] === null && !!r[3]) || JSON.stringify(r);
});

// 8. truncation marker
await check('long output is cut at a line with how to read on', async () => {
  const r = await page.evaluate(() => runCaptured('cat long.txt'));
  const m = /\[output cut at line (\d+) of 400 — read on with:  cat long\.txt \| sed -n '(\d+),\+80p'/.exec(r);
  return (m && +m[2] === +m[1] + 1 && r.endsWith('[status: ok]')) || r.slice(-300);
});

// 10. date and info
await check('date gives the day, zone, iso and unix time', async () => {
  await clear(); await sh('date'); const t = await screen();
  return (/zone \S* \(UTC[+-]\d/.test(t) && /iso \d{4}-\d\d-\d\dT/.test(t) && /unix \d{10}/.test(t)) || t;
});
await check('info summarises the workspace', async () => {
  await clear(); await sh('info'); const t = await screen();
  return (/\d+ files, \d+ folders, .* of 25 MB/.test(t) && t.includes('bulk/') && t.includes('changed most recently:')) || t;
});
await check('the assistant is told today\'s date and that it may cd', async () => {
  await script(['{"say":"ok"}']); await sh('hi', 400);
  const p = await prompts();
  return (p[0].s.includes('Today: 20') && p[0].s.includes('You may `cd <path>`') && p[0].s.includes('preview <the command>')) || p[0].s.slice(0, 400);
});
await check('every command has a man page', async () => {
  const missing = await page.evaluate(() => VERBS.filter(v => !MAN[v]));
  return missing.length === 0 || 'no man page: ' + missing.join(', ');
});
await check('no page errors anywhere in the run', async () => errs.length === 0 || errs.join('\n'));

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
