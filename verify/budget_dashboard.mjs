// Budget Dashboard + Receipt Logger v4: the first app built on the shared data
// formats (docs/SHARED_DATA.md). Checks the writer's file (schema, ids, dates)
// and the reader's handling of it, including every way the file can be absent.
//
//   node budget_dashboard.mjs        # exit 0 = every case passes
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

// One page per scenario. `files` and `storage` are seeded before the app runs;
// `noFiles` removes the shared-files bridge (the user switched it off).
async function open(app, { files = {}, storage = {}, noFiles = false, scan = null, ask = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await context.addInitScript(([files, storage, noFiles, scan, ask]) => {
    for (const [k, v] of Object.entries(storage)) window.myllmStorage.setItem(k, v);
    if (scan) window.myllmScan = () => Promise.resolve(scan);
    if (ask) window.myllmAsk = () => Promise.resolve(ask);
    if (noFiles) { delete window.myllmFiles; return; }
    for (const [p, t] of Object.entries(files)) window.myllmFiles.write(p, t);
  }, [files, storage, noFiles, scan, ask]);
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.setContent(await src(app), { waitUntil: 'load' });
  await page.waitForTimeout(500);
  return { page, errs, close: () => context.close() };
}
const fileOf = (page, p) => page.evaluate(x => window.myllmFiles.read(x), p);

const now = new Date(), pad = n => String(n).padStart(2, '0');
const ym = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1);
const day = (offsetMonths, dd) => { const d = new Date(now.getFullYear(), now.getMonth() + offsetMonths, dd); return ym(d) + '-' + pad(d.getDate()); };

// ---- Receipt Logger publishes ---------------------------------------------
await check('Receipt Logger: a scan publishes data/receipts.json in the v1 format', async () => {
  const o = await open('receipt-logger', { scan: 'TESCO\nTOTAL 23.40\n06/10/2026', ask: '{"merchant":"Tesco","date":"06/10/2026","total":23.4,"currency":"£"}' });
  await o.page.click('#goBtn'); await o.page.waitForTimeout(500);
  const j = JSON.parse(await fileOf(o.page, 'data/receipts.json')); await o.close();
  const r = j.items[0];
  return (j.schema === 'myllm.receipts' && j.version === 1 && j.source === 'receipt-logger' && /^r_\d+$/.test(r.id)
    && r.merchant === 'Tesco' && r.total === 23.4 && r.currency === '£' && r.date === '2026-10-06' && r.added && o.errs.length === 0) || JSON.stringify([j, o.errs]);
});
await check('Receipt Logger: old receipts get stable ids and are published at start', async () => {
  const old = [{ merchant: 'Boots', total: 5, currency: '£', date: 'Oct 3, 2026' }, { merchant: 'Shell', total: 40, currency: '£', date: '' }];
  const o = await open('receipt-logger', { storage: { receipts: JSON.stringify(old) } });
  const j = JSON.parse(await fileOf(o.page, 'data/receipts.json'));
  const kept = JSON.parse(await o.page.evaluate(() => window.myllmStorage.getItem('receipts'))); await o.close();
  return (j.items.length === 2 && j.items[0].id === 'r_legacy_2' && j.items[0].date === '2026-10-03' && j.items[1].date === null
    && kept[0].id === 'r_legacy_2') || JSON.stringify([j, kept]);
});
await check('Receipt Logger: works as before with shared files off', async () => {
  const o = await open('receipt-logger', { noFiles: true, scan: 'X', ask: '{"merchant":"Aldi","date":"2026-10-01","total":9,"currency":"£"}' });
  await o.page.click('#goBtn'); await o.page.waitForTimeout(500);
  const t = await o.page.evaluate(() => document.body.innerText); await o.close();
  return (t.includes('Aldi') && o.errs.length === 0) || JSON.stringify(o.errs);
});

// ---- Budget Dashboard reads ------------------------------------------------
const file = items => JSON.stringify({ schema: 'myllm.receipts', version: 1, source: 'receipt-logger', updated: new Date().toISOString(), items });
const ITEMS = [
  { id: 'a', merchant: 'Tesco', total: 40, currency: '£', date: day(0, 1) },
  { id: 'b', merchant: 'Tesco', total: 25.5, currency: '£', date: day(0, 2) },
  { id: 'c', merchant: 'Pret', total: 9.8, currency: '£', date: day(0, 2) },
  { id: 'd', merchant: 'Trainline', total: 60, currency: '£', date: day(-1, 12) },
  { id: 'e', merchant: 'Duty Free', total: 30, currency: '€', date: day(0, 1) },
  { id: 'f', merchant: 'Unreadable', total: null, currency: '', date: day(0, 1) },
  { id: 'g', merchant: 'Mystery', total: 3, currency: '£', date: null },
];
const bd = await open('budget-dashboard', { files: { 'data/receipts.json': file(ITEMS) } });
const P = bd.page, text = () => P.evaluate(() => document.body.innerText);

await check('this month: total in the main currency, other currency apart', async () => {
  const t = await text();
  return (t.includes('£75.30') && t.includes('3 receipts') && t.includes('€30.00 in other currencies')) || t.slice(0, 600);
});
await check('unreadable and undated receipts are said, not silently dropped', async () => {
  const t = await text(); return (t.includes('1 receipt had no readable total') && t.includes('1 had no date')) || t.slice(0, 400);
});
await check('six-month chart, this month highlighted', async () => {
  const r = await P.evaluate(() => ({ cols: document.querySelectorAll('#chart .col').length, cur: document.querySelectorAll('#chart .col.cur').length }));
  return (r.cols === 6 && r.cur === 1) || JSON.stringify(r);
});
await check('set a budget: bar, pace marker, left per day', async () => {
  await P.click('#setBudget'); await P.fill('#shIn', '300'); await P.click('#shOk'); await P.waitForTimeout(200);
  const r = await P.evaluate(() => ({ bar: !document.getElementById('hBar').hidden, w: document.getElementById('hFill').style.width, t: document.getElementById('hMeta').innerText }));
  const saved = JSON.parse(await P.evaluate(() => window.myllmStorage.getItem('budget.settings')));
  return (r.bar && r.w === '25.1%' && /£224\.70.* left/.test(r.t) && saved.budget === 300) || JSON.stringify([r, saved]);
});
await check('over budget turns the hero red', async () => {
  await P.click('#setBudget'); await P.fill('#shIn', '50'); await P.click('#shOk'); await P.waitForTimeout(200);
  const r = await P.evaluate(() => ({ over: document.getElementById('hero').classList.contains('over'), t: document.getElementById('hMeta').innerText }));
  return (r.over && /£25\.30.* over budget/.test(r.t)) || JSON.stringify(r);
});
await check('categorise a place: all its receipts move, and it sticks', async () => {
  await P.click('#places button.tag[data-place="tesco"]'); await P.click('#shChips button:has-text("Groceries")'); await P.click('#shOk'); await P.waitForTimeout(200);
  const cats = await P.evaluate(() => document.getElementById('cats').innerText);
  const saved = JSON.parse(await P.evaluate(() => window.myllmStorage.getItem('budget.settings')));
  return (/Groceries\s+£65\.50\s+87%/.test(cats) && /Uncategorised\s+£9\.80/.test(cats) && saved.cats.tesco === 'Groceries') || JSON.stringify([cats, saved]);
});
await check('previous month, and no going past this month', async () => {
  const dis = await P.evaluate(() => document.getElementById('nextM').disabled);
  await P.click('#prevM'); await P.waitForTimeout(150);
  const t = await P.evaluate(() => document.getElementById('hN').innerText + ' | ' + document.getElementById('hK').innerText);
  await P.click('#nextM'); await P.waitForTimeout(150);
  return (dis && t.startsWith('£60.00') && /Spent in/i.test(t)) || JSON.stringify([dis, t]);
});
await check('summarise sends totals only, never receipt text', async () => {
  await P.evaluate(() => { window.__asked = []; window.myllmAsk = (p) => { window.__asked.push(p); return Promise.resolve('You spent most on groceries.'); }; });
  await P.click('#aiBtn'); await P.waitForTimeout(200);
  const r = await P.evaluate(() => ({ p: window.__asked[0] || '', t: document.getElementById('aiText').innerText }));
  return (r.t.includes('groceries') && r.p.includes('Groceries £65.50') && !r.p.includes('TOTAL')) || JSON.stringify(r);
});
await check('reads again when it comes back to the screen', async () => {
  await P.evaluate((f) => window.myllmFiles.write('data/receipts.json', f), file(ITEMS.concat([{ id: 'h', merchant: 'Tesco', total: 10, currency: '£', date: day(0, 3) }])));
  await P.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await P.waitForTimeout(300);
  const t = await P.evaluate(() => document.getElementById('hN').innerText);
  return t.startsWith('£85.30') || t;
});
await check('no page errors (dashboard)', async () => bd.errs.length === 0 || bd.errs.join('\n'));
await bd.close();

await check('no file yet: points to Receipt Logger', async () => {
  const o = await open('budget-dashboard'); const t = await o.page.evaluate(() => document.body.innerText); await o.close();
  return (t.includes('No receipts yet') && t.includes('Receipt Logger')) || t;
});
await check('shared files off: says how to turn them on', async () => {
  const o = await open('budget-dashboard', { noFiles: true }); const t = await o.page.evaluate(() => document.body.innerText); await o.close();
  return (t.includes('Shared files are off')) || t;
});
await check('a newer format: asks for an update instead of guessing', async () => {
  const o = await open('budget-dashboard', { files: { 'data/receipts.json': JSON.stringify({ schema: 'myllm.receipts', version: 2, items: [] }) } });
  const t = await o.page.evaluate(() => document.body.innerText); await o.close();
  return t.includes('newer format (v2)') || t;
});
await check('not JSON: says so', async () => {
  const o = await open('budget-dashboard', { files: { 'data/receipts.json': 'oops' } });
  const t = await o.page.evaluate(() => document.body.innerText); await o.close();
  return t.includes('couldn’t be read') || t;
});

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
