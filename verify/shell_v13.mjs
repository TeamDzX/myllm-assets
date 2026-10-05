// Shell v13: you can see when MyLLM is working, a second Enter doesn't
// re-send the question, Stop works, and your questions have their own colour.
//
//   node shell_v13.mjs        # exit 0 = every case passes
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
const bar = () => page.evaluate(() => ({ shown: !document.getElementById('work').hidden, text: document.getElementById('workTxt').textContent, t: document.getElementById('workT').textContent }));
await page.evaluate(() => window.myllmFiles.write('notes.md', 'one\ntwo'));

// A slow model: each reply takes 1.2 s; we can watch the bar meanwhile.
await page.evaluate(() => {
  window.__replies = []; window.__calls = 0;
  window.myllmAsk = () => { window.__calls++; return new Promise(r => setTimeout(() => r(window.__replies.shift() || '{"say":"done"}'), 1200)); };
});

await check('a question shows the working bar while MyLLM thinks', async () => {
  await page.evaluate(() => { window.__replies = ['{"run":"cat notes.md"}', '{"say":"two lines"}']; window.__calls = 0; });
  await type('what is in notes?'); await page.waitForTimeout(400);
  const b = await bar();
  return (b.shown && /thinking/.test(b.text)) || JSON.stringify(b);
});
await check('…shows the step it is running, and the seconds', async () => {
  await page.waitForTimeout(1200);
  const b = await bar();
  return ((/running  cat notes\.md|thinking · step 2/.test(b.text)) && /^\d+s$/.test(b.t)) || JSON.stringify(b);
});
await check('a second Enter while working is NOT sent again', async () => {
  await type('what is in notes?'); await page.waitForTimeout(200);
  const v = await page.inputValue('#in'); const b = await bar();
  return (v === 'what is in notes?' && /still working, tap Stop/.test(b.text)) || JSON.stringify([v, b]);
});
await check('the bar goes away when the answer arrives; the model was asked once per step', async () => {
  await page.waitForTimeout(2600);
  const b = await bar(); const calls = await page.evaluate(() => window.__calls); const t = await screen();
  return (!b.shown && calls === 2 && t.includes('two lines')) || JSON.stringify([b, calls]);
});
await check('Stop ends it after the current step', async () => {
  await page.fill('#in', '');
  await page.evaluate(() => { window.__replies = ['{"run":"cat notes.md"}', '{"run":"ls"}', '{"say":"ZZSAID1"}']; window.__calls = 0; });
  await type('look around'); await page.waitForTimeout(300);
  await page.click('#workStop'); await page.waitForTimeout(1600);
  const b = await bar(); const calls = await page.evaluate(() => window.__calls); const t = await screen();
  return (!b.shown && calls === 1 && t.includes('stopped') && !t.includes('ZZSAID1')) || JSON.stringify([b, calls, t.slice(-200)]);
});
await check('typing "stop" while working also stops', async () => {
  await page.evaluate(() => { window.__replies = ['{"run":"ls"}', '{"say":"ZZSAID2"}']; window.__calls = 0; });
  await type('another look'); await page.waitForTimeout(300);
  await type('stop'); await page.waitForTimeout(1600);
  const t = await screen(); const b = await bar();
  return (!b.shown && !t.includes("ZZSAID2") && t.includes('stopped')) || JSON.stringify([b, t.slice(-200)]);
});
await check('your question has its own colour; a command keeps the prompt style', async () => {
  await page.evaluate(() => { window.__replies = ['{"say":"hi"}']; });
  await type('hello there'); await page.waitForTimeout(1600);
  await type('ls'); await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    you: [...document.querySelectorAll('#out .you')].map(e => e.textContent).pop(),
    bg: getComputedStyle(document.querySelector('#out .you')).backgroundColor,
    cmd: [...document.querySelectorAll('#out .cmd')].map(e => e.textContent).pop()
  }));
  return (r.you === 'youhello there' && r.bg !== 'rgba(0, 0, 0, 0)' && /❯ ls$/.test(r.cmd)) || JSON.stringify(r);
});
await check('ask (the filter) shows the bar too', async () => {
  await page.evaluate(() => { window.myllmAsk = () => new Promise(r => setTimeout(() => r('summary'), 800)); });
  await type('cat notes.md | ask "summarise"'); await page.waitForTimeout(300);
  const b = await bar(); await page.waitForTimeout(900); const b2 = await bar();
  return (b.shown && /working on: summarise/.test(b.text) && !b2.shown) || JSON.stringify([b, b2]);
});
await check('no page errors anywhere in the run', async () => errs.length === 0 || errs.join('\n'));

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
