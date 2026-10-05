// Shell v10: Alex's second list (5 Oct, 12 items). shell_v9.mjs and
// shell_pipeline.mjs keep covering what came before.
//
//   node shell_v10.mjs        # exit 0 = every case passes
import { webkit } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(HERE, '..', 'apps-src', 'shell.html'), 'utf8');

const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
await context.addInitScript(() => {
  window.__mtime = {}; window.__versions = {};
  const install = () => {
    const f = window.myllmFiles; if (!f || f.__v10) return;
    const list = f.list, write = f.write;
    f.list = async () => (await list()).map(x => ({ ...x, modified: window.__mtime[x.path] ?? x.modified }));
    f.write = async (p, c) => { window.__mtime[p] = Math.floor(Date.now() / 1000); return write(p, c); };
    f.versions = async p => (window.__versions[p] || []).map(v => ({ stamp: v.stamp, size: v.text.length }));
    f.readVersion = async (p, stamp) => { const v = (window.__versions[p] || []).find(x => x.stamp === stamp); return v ? v.text : null; };
    f.__v10 = true;
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
// what the command printed, without the echoed command line
const out = async cmd => { await clear(); await sh(cmd); return (await screen()).split('\n').slice(1).join('\n'); };

await put('notes/shell feedback.md', 'Shell wishlist: pipes\nTODO tidy\nshell feedback round two');
await put('notes/todo.md', 'TODO one\nTODO two\nnothing\nTODO three');
await put('notes/archives/old.md', 'TODO archived');
await put('projects/a/deep/x.md', 'deep md');
await put('projects/a/y.txt', 'text');
await put('projects/b.md', 'top md');
await put('data.json', JSON.stringify({ name: 'beacon', tags: ['a', 'b'], items: [{ name: 'x', n: 1, ok: true }, { name: 'y', n: 5, ok: false }, { name: 'zed', n: 9, ok: true }], meta: { owner: { name: 'alex' } } }));
await put('a.txt', 'apple\nbanana\ncherry'); await put('b.txt', 'banana\ncherry\ndate');
await put('cols.csv', 'name,qty,price\npen,3,1.50\nink,10,4.00');
const now = Math.floor(Date.now() / 1000);
await page.evaluate(now => {
  Object.assign(window.__mtime, { 'notes/todo.md': now - 30 * 60, 'projects/b.md': now - 5 * 3600, 'projects/a/y.txt': now - 3 * 86400 });
  window.__versions['data.json'] = [{ stamp: Date.now() - 1e6, text: '{"v":2}' }, { stamp: Date.now() - 2e6, text: '{"v":1}' }];
}, now);

// 1. | inside /regex/ stays in the pattern; a non-command stage says so
await check('grep /shell.*(feedback|wishlist)/ is one stage', async () => {
  const t = await out('grep /shell.*(feedback|wishlist)/ notes');
  return (t.includes('wishlist') && t.includes('round two') && !t.includes('not a command')) || t;
});
await check('…and the assistant may run it (not blocked)', async () => {
  const r = await page.evaluate(() => unsafeReason('grep /a(b|c)/ notes | wc -l', READ_ONLY));
  return r === null || r;
});
await check('a bare | in a pattern explains the split', async () => {
  const t = await out('grep feedback|wishlist notes');
  return t.includes('is not a command') || t;
});
await check('an absolute path is not mistaken for a regex', async () => {
  const t = await out('cat /a.txt | wc -l'); return t.trim() === '3' || t;
});

// 2. xargs
await check('grep -l | xargs head -n 1 previews every match', async () => {
  const t = await out('grep -l todo notes | xargs head -n 1');
  return (t.includes('==> notes/todo.md <==') && t.includes('TODO one') && t.includes('Shell wishlist')) || t;
});
await check('xargs works from a subfolder (paths made absolute)', async () => {
  await sh('cd projects'); const t = await out('find *.md | xargs wc -l'); await sh('cd /');
  return (t.includes('projects/b.md') && t.includes('projects/a/deep/x.md')) || t;
});
await check('the assistant may xargs read-only commands only', async () => {
  const r = await page.evaluate(() => [unsafeReason('find *.md | xargs cat', READ_ONLY), unsafeReason('find *.md | xargs rm', READ_ONLY)]);
  return (r[0] === null && !!r[1]) || JSON.stringify(r);
});

// 3. find
await check('find projects/**/*.md matches at any depth', async () => {
  const t = await out('find projects/**/*.md');
  return (t.includes('projects/b.md') && t.includes('projects/a/deep/x.md') && !t.includes('y.txt')) || t;
});
await check('find projects -name *.md -maxdepth 1', async () => {
  const t = await out('find projects -name *.md -maxdepth 1');
  return (t.includes('projects/b.md') && !t.includes('deep')) || t;
});
await check('find -mtime -2h and -mmin -60', async () => {
  const a = await out('find -mtime -2h'); const b = await out('find -mmin -60');
  return (a.includes('todo.md') && !a.includes('b.md') && b.includes('todo.md')) || a + '\n--\n' + b;
});
await check('find -mtime -6h includes 5 hours ago', async () => {
  const t = await out('find -mtime -6h'); return (t.includes('projects/b.md') && !t.includes('y.txt')) || t;
});

// 4. grep filters
await check('grep --include=*.md --exclude-dir=archives', async () => {
  await put('notes/todo.txt', 'TODO in txt');
  const t = await out('grep -l todo notes --include=*.md --exclude-dir=archives');
  return (t.includes('notes/todo.md') && !t.includes('archives') && !t.includes('todo.txt')) || t;
});
await check('grep -o prints only the match', async () => {
  const t = await out('cat notes/todo.md | grep -o /todo \\w+/');
  return t.split('\n').join(',') === 'TODO one,TODO two,TODO three' || t;
});
await check('grep -m 2 stops after two', async () => {
  const t = await out('cat notes/todo.md | grep -m 2 todo'); return (t.includes('two') && !t.includes('three')) || t;
});
await check('grep -w matches whole words', async () => {
  await put('w.txt', 'cat\ncatalog\nthe cat sat');
  const t = await out('cat w.txt | grep -w cat'); return (t.includes('the cat sat') && !t.includes('catalog')) || t;
});
await check('help mentions -i', async () => { const t = await out('man grep'); return t.includes('-i accepted') || t; });

// 5. jq
await check('jq select / map / to_entries / .. / -r', async () => {
  const a = await out('jq -r ".items[] | select(.n > 2) | .name" data.json');
  const b = await out('jq -c "map(.name)" data.json'); // -c ignored; prints JSON
  const b2 = await out('jq ".items | map(.name)" data.json');
  const c = await out('jq "to_entries | .[0].key" data.json');
  const d = await out('jq -r ".. | .name? | select(. != null)" data.json');
  const e = await out(`jq -r '.items[] | select(.name | test("^z")) | .n' data.json`);
  const f = await out('jq ".items[] | select(.ok == true) | .name" data.json');
  return (a === 'y\nzed' && b2.replace(/\s/g, '') === '["x","y","zed"]' && c.trim() === '"name"'
    && d.split('\n').join(',') === 'beacon,x,y,zed,alex' && e.trim() === '9' && f.split('\n').join(',') === '"x","zed"')
    || JSON.stringify({ a, b2, c, d, e, f });
});

// 6. ls -l, tree -L, du -h, wc -c
await check('ls -l shows type, readable size, date, name', async () => {
  const t = await out('ls -l notes'); return (/^d\s+\S+\s+\d{4}-\d\d-\d\d \d\d:\d\d\s+archives\/\s+\(1\)/m.test(t) && /^-\s+\d+B\s+\d{4}-.*todo\.md$/m.test(t)) || t;
});
await check('tree -L 1 stops one level down', async () => {
  const t = await out('tree projects -L 1'); return (t.includes('projects/b.md') && t.includes('projects/a/') && !t.includes('x.md')) || t;
});
await check('du -h and wc -c', async () => {
  const a = await out('du -h'); const b = await out('wc -c a.txt');
  return (a.includes('total') && /^19\ta\.txt$/m.test(b)) || a + '\n' + b;
});

// 7. text helpers
await check('sort -u, tr, head -c', async () => {
  const a = await out('cat a.txt b.txt | sort -u'); const b = await out('cat a.txt | tr a-z A-Z'); const c = await out('head -c 5 a.txt');
  const h = await out('head -n 1 a.txt b.txt | wc -l');
  return (a.split('\n').join(',') === 'apple,banana,cherry,date' && b.startsWith('APPLE') && c === 'apple' && h.trim() === '5') || JSON.stringify([a, b, c, h]);
});
await check('paste and comm', async () => {
  const p = await out('paste -d , a.txt b.txt'); const c = await out('comm -12 a.txt b.txt'); const c2 = await out('comm -23 a.txt b.txt');
  return (p.split('\n')[0] === 'apple,banana' && c.split('\n').join(',') === 'banana,cherry' && c2.trim() === 'apple') || JSON.stringify([p, c, c2]);
});
await check("awk -F , '{print $1, $3}' and '/pen/ {print NR, $2}'", async () => {
  const a = await out("awk -F , '{print $1, $3}' cols.csv"); const b = await out("awk -F , '/pen/ {print NR, $2}' cols.csv");
  return (a.split('\n')[1] === 'pen,1.50' && b.trim() === '2,3') || JSON.stringify([a, b]);
});

// 8. log <path>, log -n, diff @N @M
await check('diff data.json@2 data.json@1 compares two old versions', async () => {
  const t = await out('diff data.json@2 data.json@1'); return (t.includes('-{"v":1}') && t.includes('+{"v":2}')) || t;
});
await check('log <path> and log -n N', async () => {
  await sh('write l1.txt one'); await sh('write l2.txt two'); await sh('write l1.txt uno');
  const a = await out('log l1.txt'); const b = await out('log -n 1');
  return (a.includes('l1.txt') && !a.includes('l2.txt') && b.trim().split('\n').filter(l => l.startsWith('#')).length === 1) || a + '\n--\n' + b;
});

// 9. several paths
await check('cat a b and head -n 1 *.txt give a header per file', async () => {
  const a = await out('cat a.txt b.txt'); const b = await out('head -n 1 *.txt');
  return (a.includes('==> a.txt <==') && a.includes('==> b.txt <==') && b.includes('==> w.txt <==') && b.includes('apple')) || a + '\n--\n' + b;
});
await check('the assistant sees which file each part came from', async () => {
  const r = await page.evaluate(() => runCaptured('cat a.txt b.txt'));
  return (r.includes('==> a.txt <==') && r.includes('==> b.txt <==')) || r;
});
await check('cat a b > file joins them with no headers', async () => {
  await sh('cat a.txt b.txt > joined.txt'); const t = await read('joined.txt');
  return t === 'apple\nbanana\ncherry\nbanana\ncherry\ndate' || JSON.stringify(t);
});
await check('grep output with & < > reaches a file unescaped', async () => {
  await put('amp.txt', 'Tom & Jerry <3 > all'); await sh('grep tom amp.txt > hits.txt');
  const t = await read('hits.txt'); return t.includes('Tom & Jerry <3 > all') || JSON.stringify(t);
});
await check('stat notes/* covers each entry', async () => {
  const t = await out('stat notes/*'); return (t.includes('notes/todo.md') && t.includes('notes/archives/') && t.includes('type: folder')) || t;
});

// 10. statuses for the assistant
await check('the assistant sees ok / found nothing / failed / blocked', async () => {
  const r = await page.evaluate(async () => [await runCaptured('cat a.txt'), await runCaptured('grep zzz notes'), await runCaptured('cat nope.md')]);
  return (r[0].endsWith('[status: ok]') && r[1].endsWith('[status: found nothing]') && r[2].endsWith('[status: failed — the error is above]')) || JSON.stringify(r);
});
await check('a blocked step is shown and explained', async () => {
  await page.evaluate(() => { window.__replies = ['{"run":"grep a|b notes"}', '{"say":"ok"}']; window.myllmAsk = () => Promise.resolve(window.__replies.shift() || '{"say":"done"}'); });
  const t = await out('look for a or b');
  return (t.includes('blocked: grep a|b notes') && t.includes('treated as a pipe')) || t;
});

// 11. regex replace, edit by match, mv/cp globs
await check('replace -E with a $1 group', async () => {
  await put('v.txt', 'version 1.2\nversion 3.4');
  await out('replace -E v.txt "version (\\d)\\.(\\d)" "v$1-$2"'); const t = await read('v.txt');
  return t === 'v1-2\nv3-4' || t;
});
await check('edit /pattern/ changes the matching line; /pattern/+ inserts after it', async () => {
  await put('m.txt', 'alpha\nstatus: draft\nomega');
  await out('edit m.txt /^status:/ "status: final"'); const a = await read('m.txt');
  await out('edit m.txt /alpha/+ "beta"'); const b = await read('m.txt');
  return (a === 'alpha\nstatus: final\nomega' && b === 'alpha\nbeta\nstatus: final\nomega') || JSON.stringify([a, b]);
});
await check('mv *.txt into a folder is one batch, one undo', async () => {
  await sh('mkdir box'); await put('g1.log', '1'); await put('g2.log', '2');
  await out('mv *.log box');
  const moved = [await read('box/g1.log'), await read('box/g2.log'), await read('g1.log')];
  await sh('undo', 500);
  const back = [await read('g1.log'), await read('g2.log'), await read('box/g1.log')];
  return (moved.join() === '1,2,' && back.join() === '1,2,') || JSON.stringify([moved, back]);
});
await check('cp a b folder copies several', async () => {
  await out('cp a.txt b.txt box'); return ((await read('box/a.txt')) === 'apple\nbanana\ncherry' && (await read('box/b.txt')) !== null) || 'missing';
});

// 12. man and changes
await check('man <cmd> lists flags; changes is the changelog', async () => {
  const a = await out('man find'); const b = await out('changes'); const c = await out('man nosuch');
  return (a.includes('-maxdepth') && b.includes('Shell v10') && c.includes('no manual')) || JSON.stringify([a, b, c]);
});
await check('every command has a man page', async () => {
  const missing = await page.evaluate(() => VERBS.filter(v => !MAN[v]));
  return missing.length === 0 || 'no man page: ' + missing.join(', ');
});
await check('no page errors anywhere in the run', async () => errs.length === 0 || errs.join('\n'));

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
