// Net Worth: the monthly snapshot, the four pots and the charts, driven by real taps.
//
//   node net_worth.mjs            # add --shots for light/dark screenshots in out/
import { webkit } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(HERE, '..', 'apps-src', 'net-worth.html'), 'utf8');
const SHOTS = process.argv.includes('--shots');
const tmp = path.join(HERE, '_tmp');
await mkdir(tmp, { recursive: true });
await mkdir(path.join(HERE, 'out'), { recursive: true });
const shareStub = path.join(tmp, 'nw_share.js');
await writeFile(shareStub, `window.__shared = []; window.myllmShare = (t) => { window.__shared.push(String(t)); return Promise.resolve(null); };`);

const browser = await webkit.launch();
let fails = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r === true) { console.log('ok  ', name); return; }
        fails++; console.log('FAIL', name, '->', r); }
  catch (e) { fails++; console.log('FAIL', name, '->', e.message.split('\n')[0]); }
};

async function open(seed, scheme = 'light') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
  await ctx.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await ctx.addInitScript({ path: shareStub });
  if (seed) await ctx.addInitScript(`(() => { const g = window.myllmStorage.getItem; window.myllmStorage.getItem = (k) => k === 'nw1' ? Promise.resolve(${JSON.stringify(seed)}) : g(k); })();`);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return { page, errs, ctx };
}
const { page, errs } = await open();
const tab = async t => { await page.locator(`.tabs button[data-tab="${t}"]`).click(); await page.waitForTimeout(120); };
const fill = async (name, v) => { await page.locator(`#upPots input[aria-label="${name}"]`).fill(String(v)); };
const text = sel => page.locator(sel).innerText();

await check('first launch: an empty state that offers the first snapshot', async () =>
  (await page.locator('#homeEmpty').isVisible()) && (await text('#homeEmpty')).includes('Take your first snapshot') || 'no empty state');
await check('starter accounts are in all four pots', async () => {
  await tab('accounts');
  const t = await text('#accPots');
  return ['Stocks & Shares ISA', 'Home: mortgage', 'Emergency fund', 'Credit card'].every(n => t.includes(n)) || t.slice(0, 200);
});

// ---- first snapshot ----
await tab('update');
await page.locator('#upDate').fill('2026-09-30');
await page.locator('#upDate').dispatchEvent('change');
await fill('Stocks & Shares ISA', 10000);
await fill('Personal pension (SIPP)', '20,000');
await fill('Home: market value', 300000);
await fill('Home: mortgage', 200000);
await fill('Current account', 2000);
await fill('Emergency fund', 5000);
await fill('Credit card', -1500);            // a minus sign on a debt is ignored: debts are what you owe
await page.waitForTimeout(100);
await check('pot totals add up as you type (mortgage subtracted, debt taken away)', async () => {
  const p = await page.evaluate(() => ['freedom','valuable','cash','debt'].map(k => document.getElementById('pt-' + k).textContent));
  const net = await text('#upTotal');
  return (p.join('|') === '£30,000|£100,000|£7,000|£1,500' && net === '£135,500') || p.join('|') + ' net ' + net;
});
await page.locator('#upSave').click(); await page.waitForTimeout(250);
await check('saving lands on the overview with the net worth', async () =>
  (await page.locator('#v-home').isVisible()) && (await text('#hN')) === '£135,500' && /30 Sept?/.test(await page.locator('#hK').textContent()) || (await text('#hK')) + ' ' + (await text('#hN')));
await check('the 4% figure: £1,200 a year, £100 a month', async () => {
  const t = await text('#fourCard'); return (t.includes('£1,200') && t.includes('£100 a month')) || t;
});

// ---- second snapshot, a month on ----
await tab('update');
await check('a new snapshot starts from the last one’s numbers', async () =>
  (await page.locator('#upPots input[aria-label="Stocks & Shares ISA"]').inputValue()) === '10000' || 'not prefilled');
await page.locator('#upDate').fill('2026-10-31'); await page.locator('#upDate').dispatchEvent('change');
await fill('Stocks & Shares ISA', 12500);
await fill('Credit card', 500);
await page.locator('#upSave').click(); await page.waitForTimeout(250);
await check('change since last time, per pot and overall', async () => {
  const meta = await text('#hMeta'), pots = await text('#pots');
  return (meta.includes('+£3,500') && pots.includes('+£2,500') && pots.includes('−£1,000')) || meta + ' / ' + pots.replace(/\n/g, ' ');
});
await check('a debt going down is shown as good news (green), not red', async () =>
  page.evaluate(() => [...document.querySelectorAll('.pot')].find(p => p.textContent.includes('Debts')).querySelector('.pd').classList.contains('up')));
await check('the overview chart draws two lines', async () => (await page.locator('#homeChart polyline').count()) === 2 || 'lines: ' + await page.locator('#homeChart polyline').count());

// ---- yearly spending ----
await tab('accounts');
await page.locator('#spendIn').fill('30000'); await page.locator('#spendIn').dispatchEvent('change');
await tab('home');
await check('with spending set, the 4% shows the share of a year it covers', async () => {
  const t = await text('#fourCard'); return (t.includes('about 2 weeks') && t.includes('£30,000')) || t;   // 32,500 × 4% = 1,300 = 4.3% of 30,000
});

// ---- charts ----
await tab('charts');
const seg = async c => { await page.locator(`#chartSeg button[data-c="${c}"]`).click(); await page.waitForTimeout(120); };
await check('over time: net worth and Freedom Fund lines', async () => (await page.locator('#chBody polyline').count()) === 2 || 'no lines');
await seg('split');
await check('split: four bars for the chosen date, and the date can change', async () => {
  const n = await page.locator('#chBody .bar').count();
  await page.locator('#splitSel').selectOption('2026-09-30'); await page.waitForTimeout(100);
  const t = await text('#chBody');
  return (n === 4 && t.includes('£1,500')) || `bars ${n}: ${t.slice(0, 160)}`;
});
await seg('four');
await check('4% chart keeps the spending line on the chart', async () => {
  const ys = await page.evaluate(() => [...document.querySelectorAll('#chBody line[stroke-dasharray]')].map(l => +l.getAttribute('y1')));
  return (ys.length === 1 && ys[0] >= 9) || 'dashed line y: ' + ys;
});
await seg('debt');
await check('debt payoff: one bar per snapshot', async () => (await page.evaluate(() => document.querySelectorAll('#chBody i[style*="c-debt"]').length)) === 2 || 'bars wrong');
await seg('units');
await check('units: explains how to turn it on when nothing is tracked', async () => (await text('#chBody')).includes('Track units') || 'no hint');

// ---- units ----
await tab('accounts');
await page.locator('[data-acc-edit="s0"]').click(); await page.waitForTimeout(100);
await page.locator('#acUnits [data-u="1"]').click();
await page.locator('#shA button.pri').click(); await page.waitForTimeout(100);
await tab('charts');
await page.locator('#history [data-edit="2026-10-31"]').click(); await page.waitForTimeout(150);
await page.locator('#upPots input[aria-label="Units in Stocks & Shares ISA"]').fill('140.5');
await page.locator('#upSave').click(); await page.waitForTimeout(200);
await tab('update');                                     // a new snapshot for November
await page.locator('#upDate').fill('2026-11-28'); await page.locator('#upDate').dispatchEvent('change');
await page.locator('#upPots input[aria-label="Units in Stocks & Shares ISA"]').fill('152');
await page.locator('#upSave').click(); await page.waitForTimeout(200);
await tab('charts'); await seg('units');
await check('units chart draws, with plain numbers on its axis (no currency)', async () => {
  const lines = await page.locator('#chBody polyline').count(), axis = await page.evaluate(() => [...document.querySelectorAll('#chBody text')].map(t => t.textContent).join(' '));
  return (lines === 1 && !/£/.test(axis)) || `lines ${lines}, axis ${axis}`;
});

// ---- edit and delete ----
await page.locator('#history [data-edit="2026-11-28"]').click(); await page.waitForTimeout(150);
await check('editing an old snapshot opens it with its own values', async () =>
  (await page.locator('#upTitle').textContent()) === 'Edit snapshot' && (await page.locator('#upDate').inputValue()) === '2026-11-28' || 'not in edit mode');
await page.locator('#upDelete').click(); await page.waitForTimeout(100);
await page.locator('#shA button.dan').click(); await page.waitForTimeout(200);
await check('deleting asks first, then removes it', async () => (await page.locator('#history .row').count()) === 2 || 'rows: ' + await page.locator('#history .row').count());

// ---- remove an account ----
await tab('accounts');
await page.locator('[data-acc-edit="s10"]').click(); await page.waitForTimeout(100);   // Credit card
await page.locator('#shA button.dan').click(); await page.waitForTimeout(150);
await check('a removed account disappears from Accounts', async () => !(await text('#accPots')).includes('Credit card') || 'still listed');
await tab('update');
await check('...is left out of a new snapshot', async () =>
  (await page.locator('#upPots input[aria-label="Credit card"]').count()) === 0 && (await page.evaluate(() => document.getElementById('pt-debt').textContent)) === '£0' || 'still counted');
await tab('charts');
await check('...but past snapshots keep its value', async () => (await text('#history')).includes('Debts £500') || await text('#history'));

// ---- export ----
await tab('accounts');
await page.locator('#exportBtn').click(); await page.waitForTimeout(100);
await check('export hands a CSV with a column per snapshot and the totals', async () => {
  const csv = await page.evaluate(() => window.__shared[0] || '');
  const head = csv.split('\n')[0];
  return (head === 'Pot,Account,2026-09-30,2026-10-31' && csv.includes('Total,Net worth,135500,139000') && csv.includes('Credit card,1500,500')) || csv.slice(0, 300);
});

// ---- add an account ----
await page.locator('[data-acc-add="freedom"]').click(); await page.waitForTimeout(100);
await page.locator('#acName').fill('Old employer pension');
await page.locator('#shA button.pri').click(); await page.waitForTimeout(100);
await check('adding an account puts it in the chosen pot', async () => (await text('#accPots')).includes('Old employer pension') || 'missing');
await page.locator('[data-acc-add="debt"]').click(); await page.waitForTimeout(100);
await page.locator('#shA button.pri').click(); await page.waitForTimeout(100);
await check('an account needs a name (the sheet stays open)', async () => !(await page.locator('#sheet').isHidden()) || 'closed without a name');
await page.locator('#shA button').first().click();

// ---- persistence ----
const saved = await page.evaluate(() => window.myllmStorage.getItem('nw1'));
const second = await open(saved);
await check('reopening the app restores snapshots, accounts and settings', async () =>
  (await second.page.locator('#hN').innerText()) === '£139,000' && (await second.page.locator('#fourCard').innerText()).includes('£30,000') || await second.page.locator('#hN').innerText());
await check('help sheet: the four pots, tips, and a credit that isn’t an endorsement', async () => {
  await second.page.locator('#helpBtn').click(); await second.page.waitForTimeout(100);
  const t = await second.page.locator('#shB').innerText();
  return (['Freedom Fund', 'Valuable Liabilities', 'multiply the yearly amount', 'isn’t made by or affiliated'].every(s => t.includes(s))) || t.slice(0, 200);
});
await check('no page errors', async () => (errs.length + second.errs.length) === 0 || errs.concat(second.errs).join(' | '));

if (SHOTS) {
  for (const scheme of ['light', 'dark']) {
    const s = await open(saved, scheme);
    await s.page.screenshot({ path: path.join(HERE, 'out', `net-worth-home-${scheme}.png`), fullPage: true });
    await s.page.locator('.tabs button[data-tab="charts"]').click(); await s.page.waitForTimeout(150);
    await s.page.screenshot({ path: path.join(HERE, 'out', `net-worth-charts-${scheme}.png`) });
    await s.page.locator('.tabs button[data-tab="update"]').click(); await s.page.waitForTimeout(150);
    await s.page.screenshot({ path: path.join(HERE, 'out', `net-worth-update-${scheme}.png`) });
  }
}
await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall clean');
process.exit(fails ? 1 : 0);
