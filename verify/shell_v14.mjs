// Shell v14: a reply that is almost JSON (a smaller model's unescaped quotes
// or bare line breaks) is still understood, instead of the raw {"say": "…"}
// envelope being shown as the answer (Jarvis, 26B, 5 Oct).
//
//   node shell_v14.mjs        # exit 0 = every case passes
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
const type = async (cmd) => { await page.fill('#in', cmd); await page.press('#in', 'Enter'); };
const screen = () => page.evaluate(() => document.getElementById('out').innerText);
await page.evaluate(() => window.myllmFiles.write('notes.md', 'one\ntwo'));
await page.evaluate(() => {
  window.__replies = []; window.__calls = 0;
  window.myllmAsk = () => { window.__calls++; return Promise.resolve(window.__replies.shift() || '{"say":"done"}'); };
});
const ask = async (replies, q) => {
  await page.evaluate(r => { window.__replies = r; document.getElementById('out').innerHTML = ''; }, replies);
  await type(q); await page.waitForTimeout(700);
  return screen();
};

await check('unescaped quotes inside "say" are shown as the answer, not as JSON', async () => {
  const t = await ask(['{"say": "It is cumbersome to "see" two files at once.\\nSecond line."}'], 'how is it?');
  return (t.includes('It is cumbersome to "see" two files at once.') && t.includes('Second line.') && !t.includes('{"say"')) || t;
});
await check('bare line breaks inside a string are repaired', async () => {
  const t = await ask(['{"say":"line one\nline two"}'], 'two lines?');
  return (t.includes('line one') && t.includes('line two') && !t.includes('{"say"')) || t;
});
await check('a sloppy run step still runs, then answers', async () => {
  const t = await ask(['{"say": "checking "notes" first", "run": "cat notes.md"}', '{"say":"two lines"}'], 'what is in notes?');
  return (t.includes('checking "notes" first') && t.includes('two') && t.includes('two lines') && !t.includes('{"run"')) || t;
});
await check('well-formed replies are untouched (escaped quotes, colons, braces in text)', async () => {
  const t = await ask(['{"say":"use \\"jq\\": {a: 1}, then done"}'], 'tip?');
  return t.includes('use "jq": {a: 1}, then done') || t;
});
await check('plain prose (no JSON at all) is still shown as the answer', async () => {
  const t = await ask(['Just some words.'], 'hi?');
  return t.includes('Just some words.') || t;
});
await check('the prompt tells the model how to write quotes inside a string', async () =>
  (await page.evaluate(() => systemPrompt('x'))).includes('write a quote as \\"') || 'missing hint');
await check('no page errors anywhere in the run', async () => errs.length === 0 || errs.join('\n'));

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
