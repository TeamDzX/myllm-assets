// Shell v9: the ten from Alex's list (5 Oct): diff (incl. file@N), grep -n/-C/-v/-c/regex,
// sed -n ranges, wc/sort/uniq/cut, ls -t/-S + find -mtime/-newer/-size, jq,
// patch-style edits with a diff before approval, cp + batch proposals, a change
// log + undo that survive closing the app, and cd - / bookmarks.
//
// shell_pipeline.mjs still covers v7 (pipes, redirects, ask, .shellrc). This file
// drives the new verbs in WebKit against the real page, and reads the store back.
//
//   node shell_v9.mjs        # exit 0 = every case passes
import { webkit } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(HERE, '..', 'apps-src', 'shell.html'), 'utf8');

const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
// Times and versions the stub store doesn't have: list() reports the mtimes we
// set, and versions/readVersion serve fixed older texts.
await context.addInitScript(() => {
  window.__mtime = {};
  window.__versions = {};
  const install = () => {
    const f = window.myllmFiles; if (!f || f.__v9) return;
    const list = f.list, write = f.write;
    f.list = async () => (await list()).map(x => ({ ...x, modified: window.__mtime[x.path] ?? x.modified }));
    f.write = async (p, c) => { window.__mtime[p] = Math.floor(Date.now() / 1000); return write(p, c); };
    f.versions = async p => (window.__versions[p] || []).map((v, i) => ({ stamp: v.stamp, size: v.text.length }));
    f.readVersion = async (p, stamp) => { const v = (window.__versions[p] || []).find(x => x.stamp === stamp); return v ? v.text : null; };
    f.__v9 = true;
  };
  install(); document.addEventListener('DOMContentLoaded', install);
});
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
const sh = async (cmd, wait = 300) => { await page.fill('#in', cmd); await page.press('#in', 'Enter'); await page.waitForTimeout(wait); };
const screen = () => page.evaluate(() => document.getElementById('out').innerText);
const read = p => page.evaluate(x => window.myllmFiles.read(x), p);
const put = (p, t) => page.evaluate(([x, y]) => window.myllmFiles.write(x, y), [p, t]);
const clear = () => sh('clear', 60);
const after = async cmd => { await clear(); await sh(cmd); return screen(); };

const NOTES = 'Monday: dentist at 9\nTuesday: TODO file the invoice\nWednesday: nothing\nThursday: TODO call mum\nFriday: rest';
await put('notes.md', NOTES);
await put('projects/alpha/reports/r1.md', 'one');
await put('projects/alpha/reports/r2.md', 'two two');
await put('projects/beta/plan.md', 'plan');
await put('state.json', JSON.stringify({ name: 'beacon', resonance: { level: 7, tags: ['a', 'b'] }, items: [{ name: 'x', n: 1 }, { name: 'y', n: 2 }] }));
const day = 86400, now = Math.floor(Date.now() / 1000);
await page.evaluate(([now, day]) => {
  Object.assign(window.__mtime, { 'notes.md': now - 2 * day, 'projects/alpha/reports/r1.md': now - 40 * day,
    'projects/alpha/reports/r2.md': now - 1 * day, 'projects/beta/plan.md': now - 10 * day, 'state.json': now - 3 * day });
  window.__versions['notes.md'] = [
    { stamp: Date.now() - 3600e3, text: 'Monday: dentist at 9\nTuesday: TODO file the invoice\nWednesday: gym\nThursday: TODO call mum\nFriday: rest' },
    { stamp: Date.now() - 7200e3, text: 'Monday: dentist at 10\nTuesday: file the invoice' },
  ];
}, [now, day]);

// 1. diff
await check('diff two files shows - and + lines', async () => {
  await put('a.txt', 'one\ntwo\nthree'); await put('b.txt', 'one\n2\nthree\nfour');
  const t = await after('diff a.txt b.txt');
  return (t.includes('-two') && t.includes('+2') && t.includes('+four') && t.includes('@@')) || t;
});
await check('diff notes.md@1 compares that version with now', async () => {
  const t = await after('diff notes.md@1');
  return (t.includes('-Wednesday: gym') && t.includes('+Wednesday: nothing') && !t.includes('Monday: dentist at 10')) || t;
});
await check('diff notes.md alone = newest saved version vs now', async () => {
  const t = await after('diff notes.md');
  return t.includes('+Wednesday: nothing') || t;
});
await check('diff of identical files says so', async () => {
  const t = await after('diff a.txt a.txt'); return t.includes('no differences') || t;
});
await check('diff with an out-of-range version is explained', async () => {
  const t = await after('diff notes.md@9'); return t.includes('versions 1') || t;
});

// 2. grep
await check('grep -n numbers piped lines', async () => {
  const t = await after('cat notes.md | grep -n todo');
  return (t.includes('2:Tuesday') && t.includes('4:Thursday')) || t;
});
await check('grep -C 1 shows context and a -- gap', async () => {
  const t = await after('cat notes.md | grep -C 1 dentist');
  return (t.includes('Monday') && t.includes('Tuesday') && !t.includes('Thursday')) || t;
});
await check('grep -v keeps the lines that do not match', async () => {
  const t = await after('cat notes.md | grep -v todo');
  return (t.includes('Monday') && t.includes('Friday') && !t.includes('invoice')) || t;
});
await check('grep -c counts', async () => {
  const t = await after('cat notes.md | grep -c todo'); return t.trim().split('\n').pop() === '2' || t;
});
await check('grep /regex/ matches either word', async () => {
  const t = await after('cat notes.md | grep /mum|dentist/');
  return (t.includes('dentist') && t.includes('mum') && !t.includes('invoice')) || t;
});
await check('grep -s matches case', async () => {
  const t = await after('cat notes.md | grep -s todo'); return t.includes('No match') || t;
});
await check('grep across files with -C keeps file:line', async () => {
  const t = await after('grep -C 1 invoice notes.md');
  return (/notes\.md:2: .*invoice/.test(t) && /notes\.md-1- Monday/.test(t)) || t;
});
await check('a bad regex is explained, not thrown', async () => {
  const t = await after('grep -E "(" notes.md'); return t.includes('not a valid regular expression') || t;
});

// 3. sed
await check('sed -n 2,3p prints a range', async () => {
  const t = await after('sed -n 2,3p notes.md');
  return (t.includes('Tuesday') && t.includes('Wednesday') && !t.includes('Monday') && !t.includes('Thursday') && t.includes('lines 2')) || t;
});
await check('sed range piped into something has no footer in it', async () => {
  const t = await after('sed -n 2,3p notes.md | wc -l'); return t.trim().split('\n').pop().trim() === '2' || t;
});

// 4. wc / sort / uniq / cut
await check('wc -l counts lines', async () => {
  const t = await after('wc -l notes.md'); return /^5\tnotes\.md$/m.test(t) || t;
});
await check('find | cut | sort | uniq -c | sort -rn ranks folders', async () => {
  const t = await after('find *.md | cut -d / -f 1 | sort | uniq -c | sort -rn');
  const lines = t.trim().split('\n').map(s => s.trim());
  return (lines[1] === '3 projects' && lines.includes('1 notes.md')) || t;
});
await check('sort -k 2 -t : sorts on a field', async () => {
  const t = await after('cat notes.md | sort -t : -k 2');
  const l = t.trim().split('\n');
  return (l[1].startsWith('Monday') && l[2].startsWith('Wednesday') && l[l.length - 1].startsWith('Tuesday')) || t;
});

// 5. ls -t / -S, find filters
await check('ls -t lists newest first', async () => {
  const t = await after('ls -t projects/alpha/reports');
  return t.indexOf('r2.md') < t.indexOf('r1.md') || t;
});
await check('ls -S lists biggest first', async () => {
  const t = await after('ls -S projects/alpha/reports');
  return t.indexOf('r2.md') < t.indexOf('r1.md') || t;
});
await check('find -mtime -7 = changed this week, newest first', async () => {
  const t = await after('find -mtime -7');
  return (t.includes('r2.md') && t.includes('notes.md') && !t.includes('r1.md') && !t.includes('plan.md')
    && t.indexOf('r2.md') < t.indexOf('notes.md')) || t;
});
await check('find -mtime +30 = older than a month', async () => {
  const t = await after('find -mtime +30'); return (t.includes('r1.md') && !t.includes('notes.md')) || t;
});
await check('find *.md -newer plan.md', async () => {
  const t = (await after('find *.md -newer projects/beta/plan.md')).split('\n').slice(1).join('\n');
  return (t.includes('notes.md') && t.includes('r2.md') && !t.includes('r1.md') && !t.includes('plan.md')) || t;
});
await check('find -size +4 (bytes)', async () => {
  const t = await after('find -size +4 *.md'); return (t.includes('r2.md') && !t.includes('r1.md')) || t;
});
await check('find -type d lists folders', async () => {
  const t = await after('find -type d rep*'); return t.includes('projects/alpha/reports/') || t;
});

// 6. jq
await check('jq .resonance.level', async () => {
  const t = await after('jq .resonance.level state.json'); return t.trim().split('\n').pop() === '7' || t;
});
await check('jq -r ".items[] | .name"', async () => {
  const t = await after('jq -r ".items[] | .name" state.json');
  const l = t.trim().split('\n'); return (l.slice(-2).join(',') === 'x,y') || t;
});
await check('jq keys / length', async () => {
  const k = await after('jq keys state.json'); const n = await after('jq ".items | length" state.json');
  return (k.includes('"resonance"') && n.trim().split('\n').pop() === '2') || k + n;
});
await check('jq on a non-JSON file says so', async () => {
  const t = await after('jq .a notes.md'); return t.includes('not valid JSON') || t;
});

// 7. replace / edit, and a proposal shows its diff before y
await check('replace swaps text and undo puts it back', async () => {
  await put('r.txt', 'cat sat on the mat\nthe cat');
  await after('replace r.txt cat dog');
  const a = await read('r.txt'); await sh('undo'); const b = await read('r.txt');
  return (a === 'dog sat on the mat\nthe dog' && b === 'cat sat on the mat\nthe cat') || JSON.stringify([a, b]);
});
await check('replace -1 changes only the first', async () => {
  await after('replace -1 r.txt cat dog'); const a = await read('r.txt'); await sh('undo');
  return a === 'dog sat on the mat\nthe cat' || a;
});
await check('edit 2-3 replaces lines; 1+ inserts; empty deletes', async () => {
  await put('e.txt', 'a\nb\nc\nd');
  await after('edit e.txt 2-3 "B\\nC"'); const x = await read('e.txt');
  await after('edit e.txt 1+ "inserted"'); const y = await read('e.txt');
  await after('edit e.txt 1 ""'); const z = await read('e.txt');
  return (x === 'a\nB\nC\nd' && y === 'a\ninserted\nB\nC\nd' && z === 'inserted\nB\nC\nd') || JSON.stringify([x, y, z]);
});
await check('replace of missing text changes nothing', async () => {
  const t = await after('replace e.txt nowhere x'); return t.includes('not in e.txt') || t;
});
await page.evaluate(() => {
  window.__replies = [];
  window.myllmAsk = () => Promise.resolve(window.__replies.shift() || '{"say":"done"}');
});
await check('a proposed replace shows the diff, and y applies it', async () => {
  await put('cfg.txt', 'mode = slow\nlevel = 3');
  await page.evaluate(() => { window.__replies = ['{"propose":"replace cfg.txt slow fast","why":"you asked"}']; });
  const t = await after('make it fast');
  const before = await read('cfg.txt');
  await sh('y'); const afterY = await read('cfg.txt');
  return (t.includes('-mode = slow') && t.includes('+mode = fast') && before === 'mode = slow\nlevel = 3'
    && afterY === 'mode = fast\nlevel = 3') || t + '\n' + JSON.stringify([before, afterY]);
});

// 8. cp + batch
await check('cp file, cp into a folder, clash needs -f', async () => {
  await after('cp notes.md copy.md'); const a = await read('copy.md');
  await after('cp notes.md projects/beta/'); const b = await read('projects/beta/notes.md');
  const t = await after('cp notes.md copy.md');
  return (a === NOTES && b === NOTES && t.includes('cp -f')) || JSON.stringify([a, b, t]);
});
await check('cp -r a folder, and undo removes the copies', async () => {
  await after('cp projects/alpha projects/gamma');
  const a = await read('projects/gamma/reports/r2.md');
  await sh('undo'); const b = await read('projects/gamma/reports/r2.md');
  return (a === 'two two' && b === null) || JSON.stringify([a, b]);
});
await check('a batch proposal runs every step on one y, and one undo reverses all', async () => {
  await put('inbox/x.md', 'x'); await put('inbox/y.md', 'y');
  await page.evaluate(() => { window.__replies = ['{"propose":["mkdir archive","mv inbox/x.md archive/x.md","mv inbox/y.md archive/y.md"],"why":"tidy"}']; });
  const t = await after('tidy the inbox');
  await sh('y', 600);
  const moved = [await read('archive/x.md'), await read('archive/y.md'), await read('inbox/x.md')];
  await sh('undo', 600);
  const back = [await read('inbox/x.md'), await read('inbox/y.md'), await read('archive/x.md')];
  return (t.includes('proposes 3 changes') && moved.join() === 'x,y,' && back.join() === 'x,y,') || t + JSON.stringify([moved, back]);
});
await check('a batch stops at the first failing step', async () => {
  await page.evaluate(() => { window.__replies = ['{"propose":["cp notes.md n2.md","mv nothing.md z.md","cp notes.md n3.md"]}']; });
  await after('do it'); await sh('y', 600);
  const t = await screen();
  return (t.includes('stopped at step 2') && (await read('n2.md')) === NOTES && (await read('n3.md')) === null) || t;
});

// 9. log + persistence
await check('log lists changes newest first and marks what undo reverses', async () => {
  const t = await after('log');
  return (/#1\t.*\t/.test(t) && t.includes('undo reverses this') && t.includes('copied')) || t;
});
await check('undo and log survive closing Shell (reloaded from storage)', async () => {
  await put('keep.txt', 'v1'); await after('write keep.txt v2');
  const saved = await page.evaluate(async () => (await window.myllmStorage.getItem('shell.undo')) || '');
  await page.evaluate(async () => { undoStack = []; changeLog = []; await loadState(); });
  await after('undo'); const v = await read('keep.txt');
  const lg = await after('log 3');
  return (saved.includes('keep.txt') && v === 'v1' && lg.includes('undid')) || JSON.stringify([saved.slice(0, 80), v, lg]);
});

// 10. cd - and bookmarks
await check('mark, cd @name, ls @name/sub, cd -', async () => {
  await sh('cd projects/alpha/reports'); await sh('mark rep'); await sh('cd /');
  const a = await after('ls @rep');
  await sh('cd @rep'); const here = await page.evaluate(() => cwd);
  await sh('cd projects/beta'); await sh('cd /projects/beta'); await sh('cd -'); const back = await page.evaluate(() => cwd);
  await sh('cd /');
  return (a.includes('r1.md') && here === 'projects/alpha/reports' && back === 'projects/alpha/reports') || JSON.stringify([a, here, back]);
});
await check('bookmarks persist, list, and forget', async () => {
  const saved = await page.evaluate(async () => await window.myllmStorage.getItem('shell.marks'));
  const l = await after('mark'); await sh('mark -d rep'); const l2 = await after('mark');
  return (saved.includes('reports') && l.includes('@rep') && l2.includes('no bookmarks')) || JSON.stringify([saved, l, l2]);
});
await check('an unknown bookmark is explained', async () => {
  const t = await after('cd @nowhere'); return t.includes('no bookmark @nowhere') || t;
});

// safety: the agent may run the new read-only verbs, but not the new writers
await check('agent: diff/jq/sed/sort are read-only, cp/replace/edit are not', async () => {
  const r = await page.evaluate(() => [
    unsafeReason('diff a.txt b.txt', READ_ONLY), unsafeReason('jq .a state.json | sort', READ_ONLY),
    unsafeReason('sed -n 1,2p notes.md', READ_ONLY), unsafeReason('cp a b', READ_ONLY),
    unsafeReason('replace a x y', READ_ONLY), unsafeReason('edit a 1 x', READ_ONLY), unsafeReason('mark x', READ_ONLY)]);
  return (r[0] === null && r[1] === null && r[2] === null && r.slice(3).every(Boolean)) || JSON.stringify(r);
});
// (help layout is covered by shell_pipeline.mjs)
await check('no page errors anywhere in the run', async () => errs.length === 0 || errs.join('\n'));

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
