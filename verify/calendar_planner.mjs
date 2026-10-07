// Quick Todo v7 (due dates, data/todos.json, add-todo) + Calendar Planner.
//
//   node calendar_planner.mjs        # exit 0 = every case passes
import { webkit } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = n => readFile(path.join(HERE, '..', 'apps-src', n + '.html'), 'utf8');
const browser = await webkit.launch();
let fails = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r === true) { console.log('ok  ', name); return; }
        fails++; console.log('FAIL', name, '->', r); }
  catch (e) { fails++; console.log('FAIL', name, '->', e.message); }
};
async function open(app, { files = {}, storage = {}, noFiles = false, intent = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await context.addInitScript(([files, storage, noFiles, intent]) => {
    for (const [k, v] of Object.entries(storage)) window.myllmStorage.setItem(k, v);
    window.__sent = [];
    window.myllmIntent.send = (action, data) => { window.__sent.push({ action, data }); return Promise.resolve({ routed: true, handlers: 1 }); };
    if (intent) window.__myllmInitialIntent = intent;
    if (noFiles) { delete window.myllmFiles; return; }
    for (const [p, t] of Object.entries(files)) window.myllmFiles.write(p, t);
  }, [files, storage, noFiles, intent]);
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.setContent(await src(app), { waitUntil: 'load' });
  await page.waitForTimeout(500);
  return { page, errs, close: () => context.close() };
}
const pad = n => String(n).padStart(2, '0');
const dayOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return dayOf(d); };
const T = plus(0);

// ---- Quick Todo v7 -----------------------------------------------------------
await check('Quick Todo: add with a due date → published with id, due, added', async () => {
  const o = await open('quick-todo');
  await o.page.fill('#t', 'Book MOT'); await o.page.fill('#due', plus(3)); await o.page.dispatchEvent('#due', 'change'); await o.page.click('#addBtn'); await o.page.waitForTimeout(200);
  const j = JSON.parse(await o.page.evaluate(() => window.myllmFiles.read('data/todos.json')));
  const t = await o.page.evaluate(() => document.getElementById('list').innerText); await o.close();
  const it = j.items[0];
  return (j.schema === 'myllm.todos' && j.version === 1 && it.text === 'Book MOT' && it.due === plus(3) && /^t_\d+/.test(it.id) && it.added && t.includes('Book MOT') && o.errs.length === 0) || JSON.stringify([j, t, o.errs]);
});
await check('Quick Todo: overdue tag, date change on a task, done stamps doneAt', async () => {
  const o = await open('quick-todo', { storage: { todos: JSON.stringify([{ text: 'Old one', done: false }, { id: 't_1', text: 'Late', done: false, due: plus(-2) }]) } });
  const t1 = await o.page.evaluate(() => document.getElementById('list').innerText);
  await o.page.locator('.row').nth(0).locator('.rdate input').fill(T); await o.page.locator('.row').nth(0).locator('.rdate input').dispatchEvent('change'); await o.page.waitForTimeout(150);
  await o.page.locator('.row').nth(1).locator('.ck').click(); await o.page.waitForTimeout(150);
  const j = JSON.parse(await o.page.evaluate(() => window.myllmFiles.read('data/todos.json'))); await o.close();
  return (/Overdue/.test(t1) && j.items[0].id === 't_legacy_1' && j.items[0].due === T && j.items[1].done && !!j.items[1].doneAt) || JSON.stringify([t1, j]);
});
await check('Quick Todo: add-todo action adds a dated task and replies', async () => {
  const o = await open('quick-todo', { intent: { action: 'add-todo', data: { text: 'Call the bank', due: plus(1) } } });
  await o.page.waitForTimeout(300);
  const j = JSON.parse(await o.page.evaluate(() => window.myllmFiles.read('data/todos.json')));
  const reply = await o.page.evaluate(() => window.__myllmIntentHandler({ action: 'add-todo', data: { text: 'Second', due: 'not a date' } })); await o.close();
  return (j.items.some(x => x.text === 'Call the bank' && x.due === plus(1)) && /Added .Second. to Quick Todo \(/.test(reply)) || JSON.stringify([j, reply]);
});
await check('Quick Todo: declares add-todo for the assistant', async () => {
  const h = await src('quick-todo');
  return (h.includes('<meta name="myllm:intents" content="add-todo">') && /"name":"add-todo"/.test(h)) || 'missing declarations';
});

// ---- Calendar Planner --------------------------------------------------------
const file = items => JSON.stringify({ schema: 'myllm.todos', version: 1, source: 'quick-todo', updated: new Date().toISOString(), items });
const ITEMS = [
  { id: 'a', text: 'Dentist', done: false, due: T },
  { id: 'b', text: 'Pay rent', done: false, due: plus(2) },
  { id: 'c', text: 'Return parcel', done: false, due: plus(-1) },
  { id: 'd', text: 'Done thing', done: true, due: T },
  { id: 'e', text: 'Someday', done: false, due: null },
  { id: 'f', text: 'Far away', done: false, due: plus(40) },
];
const cp = await open('calendar-planner', { files: { 'data/todos.json': file(ITEMS) } });
const P = cp.page;
await check('month grid: today marked, dots on due days, overdue red', async () => {
  const r = await P.evaluate((T) => ({
    today: document.querySelector('.day.today')?.getAttribute('data-day'),
    dotsToday: document.querySelectorAll('.day[data-day="' + T + '"] .dots i').length,
    late: document.querySelectorAll('.dots i.late').length, cells: document.querySelectorAll('.day').length }), T);
  return (r.today === T && r.dotsToday === 2 && r.late === 1 && r.cells % 7 === 0) || JSON.stringify(r);
});
await check('today panel lists today’s tasks, done struck', async () => {
  const t = await P.evaluate(() => document.getElementById('dList').innerText + '|' + document.getElementById('dSub').innerText);
  return (t.includes('Dentist') && t.includes('Done thing') && t.includes('1 to do · 1 done')) || t;
});
await check('agenda: overdue first, then the next two weeks, not undated or far ones', async () => {
  const t = await P.evaluate(() => document.getElementById('agenda').innerText);
  return (t.indexOf('Return parcel') < t.indexOf('Dentist') && t.includes('Pay rent') && !t.includes('Someday') && !t.includes('Far away') && /Overdue/.test(t)) || t;
});
await check('undated open tasks are mentioned', async () => {
  const t = await P.evaluate(() => document.getElementById('notice').innerText); return t.includes('1 open task has no date') || t;
});
await check('tap a day, add a task: sent to Quick Todo with that date, shown at once', async () => {
  await P.click(`.day[data-day="${plus(2)}"]`); await P.fill('#dIn', 'Buy flowers'); await P.click('#dAdd'); await P.waitForTimeout(200);
  const r = await P.evaluate(() => ({ sent: window.__sent, list: document.getElementById('dList').innerText }));
  return (r.sent[0]?.action === 'add-todo' && r.sent[0].data.text === 'Buy flowers' && r.sent[0].data.due === plus(2) && r.list.includes('Buy flowers') && r.list.includes('Pay rent')) || JSON.stringify(r);
});
await check('month navigation and Today', async () => {
  await P.click('#nextM'); await P.click('#nextM'); await P.waitForTimeout(100);
  const far = await P.evaluate(() => document.querySelectorAll('.dots i').length);
  await P.click('#todayB'); await P.waitForTimeout(100);
  const sel = await P.evaluate(() => document.querySelector('.day.sel')?.getAttribute('data-day'));
  return (far >= 0 && sel === T) || JSON.stringify([far, sel]);
});
await check('reads again on return', async () => {
  await P.evaluate((f) => window.myllmFiles.write('data/todos.json', f), file(ITEMS.concat([{ id: 'g', text: 'New from Quick Todo', done: false, due: T }])));
  await P.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await P.waitForTimeout(300);
  const t = await P.evaluate(() => document.getElementById('dList').innerText); return t.includes('New from Quick Todo') || t;
});
await check('no page errors (planner)', async () => cp.errs.length === 0 || cp.errs.join('\n'));
await cp.close();

await check('no file yet: explains, still lets you add', async () => {
  const o = await open('calendar-planner'); const r = await o.page.evaluate(() => ({ n: document.getElementById('notice').innerText, dis: document.getElementById('dAdd').disabled })); await o.close();
  return (r.n.includes('Nothing from Quick Todo yet') && !r.dis) || JSON.stringify(r);
});
await check('shared files off / newer format', async () => {
  const a = await open('calendar-planner', { noFiles: true }); const ta = await a.page.evaluate(() => document.getElementById('notice').innerText); await a.close();
  const b = await open('calendar-planner', { files: { 'data/todos.json': JSON.stringify({ schema: 'myllm.todos', version: 2, items: [] }) } });
  const tb = await b.page.evaluate(() => document.getElementById('notice').innerText); await b.close();
  return (ta.includes('Shared files are off') && tb.includes('newer format (v2)')) || JSON.stringify([ta, tb]);
});

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
