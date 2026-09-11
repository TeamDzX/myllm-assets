// Shell v7: pipelines, redirection, the model as a filter, and the hand-offs.
//
// verify_app.mjs proves the app boots and stays in the sandbox under a blind tap
// sweep. It cannot prove that `cat notes.md | ask "summarise" > out.md` put the
// ANSWER in the file and not the file's own contents, that a question containing
// a ">" is still a question, or that a failed stage never reaches the disk.
// Those need the real sequence, driven in order, with the store read back.
//
//   node shell_pipeline.mjs        # exit 0 = every case passes
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

// Deterministic AI, and a record of exactly what it was handed. Fenced on
// purpose: a model that wraps its answer in ``` must not put that in a file.
await page.evaluate(() => {
  window.__asks = []; window.__intents = []; window.__shares = [];
  window.myllmAsk = (prompt, opts) => {
    window.__asks.push({ prompt: String(prompt), system: (opts && opts.system) || '' });
    return new Promise(r => setTimeout(() => r('```\nA tidy summary.\n```'), 10));
  };
  window.myllmIntent.send = (action, data) => {
    window.__intents.push({ action, data });
    return Promise.resolve({ routed: true, handlers: 1 });
  };
  window.myllmShareFile = (data, opts) => {
    window.__shares.push({ data: String(data), opts });
    return Promise.resolve({ shared: true });
  };
});

const NOTES = 'Monday: dentist at 9\nTuesday: TODO file the invoice — urgent\nWednesday: nothing\nThursday: TODO call mum\nFriday: rest';
await page.evaluate(t => window.myllmFiles.write('notes.md', t), NOTES);

const sh = async (cmd, wait = 350) => {
  await page.fill('#in', cmd);
  await page.press('#in', 'Enter');
  await page.waitForTimeout(wait);
};
const screen = () => page.evaluate(() => document.getElementById('out').innerText);
const read = p => page.evaluate(x => window.myllmFiles.read(x), p);
const clear = () => sh('clear', 80);

// ---- 1. a pipeline shows only its last stage -------------------------------
await clear();
await sh('cat notes.md | head -n 2');
await check('pipeline prints the sink, not the middle', async () => {
  const t = await screen();
  return (t.includes('Monday: dentist') && t.includes('Tuesday') && !t.includes('Friday: rest'))
    || 'screen was:\n' + t;
});

// ---- 2. grep reads what is piped in ----------------------------------------
await clear();
await sh('cat notes.md | grep todo');
await check('grep filters stdin, case-insensitively', async () => {
  const t = await screen();
  return (t.includes('file the invoice') && t.includes('call mum') && !t.includes('dentist'))
    || 'screen was:\n' + t;
});

// ---- 3. redirection writes the output, not the command ---------------------
await clear();
await sh('cat notes.md | grep todo > todo.md');
await check('> writes the piped output to a file', async () => {
  const t = await read('todo.md');
  return (t && t.includes('file the invoice') && t.includes('call mum') && !t.includes('dentist'))
    || 'todo.md was: ' + JSON.stringify(t);
});
await check('> reports, and offers undo', async () => {
  const t = await screen();
  return (/wrote \d+ chars to todo\.md/.test(t) && t.includes('undo')) || 'screen was:\n' + t;
});
await check('> is on the undo stack', async () => {
  await sh('undo');
  return (await read('todo.md')) === null || 'todo.md survived undo';
});

// ---- 4. >> appends ---------------------------------------------------------
await clear();
await sh('cat notes.md | grep dentist > log.md');
await sh('cat notes.md | grep mum >> log.md');
await check('>> adds to the end instead of replacing', async () => {
  const t = await read('log.md');
  return (t && t.includes('dentist') && t.includes('call mum')) || 'log.md was: ' + JSON.stringify(t);
});

// ---- 5. the model as a filter ----------------------------------------------
await clear();
await sh('cat notes.md | ask "summarise this"', 500);
await check('ask is handed the piped material and the instruction', async () => {
  const a = await page.evaluate(() => window.__asks[window.__asks.length - 1]);
  return (a && a.prompt.includes('summarise this') && a.prompt.includes('Tuesday: TODO')
          && /output ONLY the result/i.test(a.system)) || 'ask got: ' + JSON.stringify(a);
});
await check('the fence never reaches the screen', async () => {
  const t = await screen();
  return (t.includes('A tidy summary.') && !t.includes('```')) || 'screen was:\n' + t;
});

await clear();
await sh('cat notes.md | ask "summarise this" > summary.md', 600);
await check('ask > file stores the answer alone', async () => {
  const t = await read('summary.md');
  return t === 'A tidy summary.' || 'summary.md was: ' + JSON.stringify(t);
});
await check('"asking…" is on screen only, never in the file', async () => {
  const t = await read('summary.md');
  return (!t.includes('asking')) || 'summary.md was: ' + JSON.stringify(t);
});

// ---- 6. a question is not a pipeline ---------------------------------------
await clear();
await page.evaluate(() => { window.__asks = []; });
await sh('which files are > 1 kB?', 600);
await check('a sentence containing > is asked, not redirected', async () => {
  const names = await page.evaluate(() => window.myllmFiles.list().then(l => l.map(f => f.path)));
  const asked = await page.evaluate(() => window.__asks.length);
  return (asked > 0 && !names.some(n => n.includes('1'))) || 'files: ' + names.join(',') + ' asks: ' + asked;
});

// ---- 7. a failed stage never reaches a file --------------------------------
await clear();
await sh('cat nosuch.md > out.txt');
await check('a broken pipeline writes nothing', async () =>
  (await read('out.txt')) === null || 'out.txt was created');
await check('...and says why', async () => {
  const t = await screen();
  return t.includes('No such file') || 'screen was:\n' + t;
});

// ---- 8. aliases ------------------------------------------------------------
await clear();
await sh('alias ll "ls -R"');
await sh('ll');
await check('an alias expands, flags and all', async () => {
  const t = await screen();
  return (t.includes('alias ll -> ls -R') && t.includes('notes.md')) || 'screen was:\n' + t;
});
await check('aliases persist in per-app storage', async () => {
  const v = await page.evaluate(() => window.myllmStorage.getItem('shell.aliases'));
  return (v && JSON.parse(v).ll === 'ls -R') || 'stored: ' + v;
});
await check('an alias cannot shadow a command', async () => {
  await clear(); await sh('alias rm "ls"');
  const t = await screen();
  return t.includes('already a command') || 'screen was:\n' + t;
});
await check('unalias removes it', async () => {
  await sh('unalias ll');
  const v = await page.evaluate(() => window.myllmStorage.getItem('shell.aliases'));
  return JSON.parse(v).ll === undefined || 'stored: ' + v;
});

// ---- 9. history, ! and persistence -----------------------------------------
await clear();
await sh('history');
await check('bare history lists commands, with a path it is file versions', async () => {
  const t = await screen();
  return (t.includes('alias ll') && t.includes('!5 runs number 5')) || 'screen was:\n' + t;
});
await clear();
await sh('cat notes.md | grep dentist');
await sh('!!');
await check('!! runs the last command again and echoes what ran', async () => {
  const t = await screen();
  return (t.split('dentist at 9').length - 1 >= 2 && !t.includes('❯ !!')) || 'screen was:\n' + t;
});
await check('history is written to storage', async () => {
  const v = await page.evaluate(() => window.myllmStorage.getItem('shell.history'));
  return (v && JSON.parse(v).includes('cat notes.md | grep dentist')) || 'stored: ' + v;
});
await clear();
await sh('!nope');
await check('an unmatched ! says so rather than running something else', async () => {
  const t = await screen();
  return t.includes('no matching command') || 'screen was:\n' + t;
});

// ---- 10. open and share ----------------------------------------------------
await clear();
await sh('open notes.md');
await check('open routes open-text with the payload the Files app sends', async () => {
  const i = await page.evaluate(() => window.__intents[window.__intents.length - 1]);
  return (i && i.action === 'open-text' && i.data.name === 'notes.md'
          && i.data.path === 'notes.md' && i.data.ext === 'md'
          && i.data.text.includes('dentist')) || 'intent was: ' + JSON.stringify(i);
});
await check('open falls back to printing when nothing handles it', async () => {
  await page.evaluate(() => { window.myllmIntent.send = () => Promise.reject(new Error('none')); });
  await clear(); await sh('open notes.md');
  const t = await screen();
  return (t.includes('No installed app can open text') && t.includes('Friday: rest')) || 'screen was:\n' + t;
});
await clear();
await sh('share notes.md');
await check('share sends a UTF-8 data URL that decodes back to the file', async () => {
  const s = await page.evaluate(() => window.__shares[window.__shares.length - 1]);
  if (!s) return 'nothing shared';
  const b64 = s.data.split(',')[1];
  const text = Buffer.from(b64, 'base64').toString('utf8');
  return (text === NOTES && s.opts.filename === 'notes.md' && s.opts.mime === 'text/markdown')
    || 'decoded: ' + JSON.stringify(text.slice(0, 60)) + ' opts: ' + JSON.stringify(s.opts);
});

// ---- 11. dictate -----------------------------------------------------------
await clear();
await sh('dictate > voice.md', 400);
await check('dictate is pipeable into a file', async () =>
  (await read('voice.md')) === 'sample transcription' || 'voice.md was: ' + JSON.stringify(await read('voice.md')));

// ---- 12. the gate the agent and .shellrc share -----------------------------
await check('a redirect counts as a change, however read-only the verbs', async () => {
  const r = await page.evaluate(() => unsafeReason('cat notes.md > x.md', READ_ONLY));
  return (typeof r === 'string' && /> or >>/.test(r)) || 'got: ' + JSON.stringify(r);
});
await check('a pipeline of read-only stages may run unattended', async () => {
  const r = await page.evaluate(() => unsafeReason('cat notes.md | grep todo | head -n 2', READ_ONLY));
  return r === null || 'got: ' + JSON.stringify(r);
});
await check('every stage is checked, not just the first', async () => {
  const r = await page.evaluate(() => unsafeReason('ls | rm notes.md', READ_ONLY));
  return (typeof r === 'string') || 'a rm in stage two ran the gate: ' + JSON.stringify(r);
});
await check('ask is not something the agent may run on its own', async () => {
  const r = await page.evaluate(() => unsafeReason('ask "delete everything"', READ_ONLY));
  return (typeof r === 'string') || 'got: ' + JSON.stringify(r);
});

// ---- 13. .shellrc ----------------------------------------------------------
await clear();
await page.evaluate(() => window.myllmFiles.makeFolder('work'));
await page.evaluate(() => window.myllmFiles.write('.shellrc',
  '# my setup\nalias t "grep todo"\ncd work\nrm notes.md\nls > snoop.txt\n'));
await page.waitForTimeout(100);
await page.evaluate(() => runRC());
await page.waitForTimeout(600);
await check('.shellrc runs its safe lines', async () => {
  const cwd = await page.evaluate(() => cwd);
  const al = await page.evaluate(() => aliases.t);
  return (cwd === 'work' && al === 'grep todo') || 'cwd: ' + cwd + ' alias: ' + al;
});
await check('.shellrc refuses to delete anything at launch', async () =>
  (await read('notes.md')) !== null || 'notes.md was deleted by a startup file');
await check('.shellrc refuses to write a file at launch', async () =>
  (await read('snoop.txt')) === null || 'snoop.txt was written by a startup file');
await check('...and says which lines it skipped', async () => {
  const t = await screen();
  return (t.includes('.shellrc:4') && t.includes('.shellrc:5')) || 'screen was:\n' + t;
});

// ---- 14. completion follows the stage, not the line ------------------------
await sh('cd /', 200);   // the .shellrc case left us in work/
const chips = async v => {
  await page.fill('#in', v);
  await page.waitForTimeout(120);
  return page.evaluate(() => [...document.querySelectorAll('#chips .chip')].map(c => c.textContent));
};
await check('after a pipe the chips are commands that read one', async () => {
  const c = await chips('cat notes.md | ');
  return (c.slice(0, 5).join(',') === 'ask,grep,head,tail,cat') || 'chips: ' + c.join(',');
});
await check('mid-command the chips are | and > then the file names', async () => {
  const c = await chips('cat not');
  const d = await chips('cat notes.md ');
  return (d[0] === '|' && d[1] === '>' && c.includes('notes.md')) || 'chips: ' + d.join(',') + ' / ' + c.join(',');
});
await check('after a redirect the chips are file names again', async () => {
  const c = await chips('ls > ');
  return (!c.includes('ask') && !c.includes('grep')) || 'chips: ' + c.join(',');
});
await page.fill('#in', '');

// ---- 15. help fits the phone it is read on ---------------------------------
await clear();
await sh('help', 300);
await check('no help line wraps at 390pt', async () => {
  const bad = await page.evaluate(() => {
    const src = document.getElementById('out').lastElementChild;
    const probe = document.createElement('div');
    probe.style.cssText = 'white-space:pre-wrap;word-break:break-word;position:absolute;visibility:hidden';
    probe.style.width = getComputedStyle(src).width;
    src.parentNode.appendChild(probe);
    const lh = parseFloat(getComputedStyle(src).lineHeight), out = [];
    for (const line of src.innerText.split('\n')) {
      probe.textContent = line || ' ';
      if (probe.getBoundingClientRect().height > lh * 1.4) out.push(line);
    }
    probe.remove();
    return out;
  });
  return bad.length === 0 || 'these wrap: ' + JSON.stringify(bad);
});
await check('help still pipes as plain text', async () => {
  await clear(); await sh('help | grep dictate');
  const t = await screen();
  return (t.includes('dictate') && !t.includes('this list')) || 'screen was:\n' + t;
});

// ---- 16. nothing broke ------------------------------------------------------
await check('no page errors anywhere in the run', async () =>
  errs.length === 0 || errs.join(' | '));

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall clean');
process.exit(fails ? 1 : 0);
