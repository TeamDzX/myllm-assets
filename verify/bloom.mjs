// Bloom (cycle tracker): predictions, logging, the passcode's encryption, and
// the privacy promise — no network, no shared files, no AI, nothing left on
// screen once locked.
//
//   node bloom.mjs        # exit 0 = every case passes
import { webkit } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(HERE, '..', 'apps-src', 'bloom.html'), 'utf8');
const browser = await webkit.launch();
let fails = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r === true) { console.log('ok  ', name); return; }
        fails++; console.log('FAIL', name, '->', r); }
  catch (e) { fails++; console.log('FAIL', name, '->', e.message); }
};
// MyLLM serves each app from a secure https origin (crypto.subtle needs one).
const ORIGIN = 'https://bloom.apps.myllm.local/';
async function load(ctx) {
  await ctx.route(ORIGIN, r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  const p = await ctx.newPage(); return p;
}
const pad = n => String(n).padStart(2, '0');
const dk = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const back = n => { const d = new Date(); d.setDate(d.getDate() - n); return dk(d); };
const fwd = n => back(-n);

/** A log with periods starting `starts` days ago, each `len` days of medium flow. */
function log(starts, { len = 5, settings = {}, extra = {} } = {}) {
  const days = {};
  for (const s of starts) for (let i = 0; i < len; i++) days[back(s - i)] = { flow: 'medium' };
  Object.assign(days, extra);
  return JSON.stringify({ v: 1, settings: { cycle: 28, period: 5, luteal: 14, goal: 'track', unit: 'C', setup: true, seed: null, ...settings }, days });
}

async function open({ data = null, dark = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: dark ? 'dark' : 'light' });
  await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await context.addInitScript(([data]) => {
    window.__spy = { ask: 0, files: 0, shared: [], net: 0 };
    window.myllmAsk = window.myllmAskJSON = () => { window.__spy.ask++; return Promise.reject(new Error('no')); };
    for (const k of ['write', 'read', 'list', 'remove']) { const f = window.myllmFiles[k]; window.myllmFiles[k] = (...a) => { window.__spy.files++; return f(...a); }; }
    window.myllmFetch = () => { window.__spy.net++; return Promise.reject(new Error('no')); };
    window.myllmShareFile = (d, o) => { window.__spy.shared.push({ d, o }); return Promise.resolve({ saved: true }); };
    if (data) window.myllmStorage.setItem('bloom.v1', data);
  }, [data]);
  const page = await load(context);
  const errs = [], requests = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('request', r => { if (!r.url().startsWith('data:') && r.url() !== ORIGIN) requests.push(r.url()); });
  await page.goto(ORIGIN, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return { page, errs, requests, close: () => context.close() };
}
const text = (p, id) => p.evaluate(i => document.getElementById(i).innerText, id);
const stored = p => p.evaluate(async () => ({ plain: await window.myllmStorage.getItem('bloom.v1'), enc: await window.myllmStorage.getItem('bloom.v1.enc') }));
const hide = p => p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
const pin = async (p, digits) => { for (const d of digits) await p.click(`#pad [data-pin="${d}"]`); await p.waitForTimeout(150); };

// ---- first run --------------------------------------------------------------
await check('first run: welcome, then day and next period from the start date', async () => {
  const o = await open();
  const shown = await o.page.evaluate(() => !document.getElementById('welcome').hidden);
  await o.page.fill('#wStart', back(10)); await o.page.click('#wGo'); await o.page.waitForTimeout(400);
  const r = { shown, day: await text(o.page, 'rn'), status: await text(o.page, 'status'), q: await text(o.page, 'rq'), s: JSON.parse((await stored(o.page)).plain) };
  await o.close();
  return (shown && r.day === '11' && /in 18 days/.test(r.q) && r.s.settings.seed === back(10) && r.s.settings.setup) || JSON.stringify(r);
});
await check('first run without a date: invites logging, no predictions', async () => {
  const o = await open(); await o.page.click('#wGo'); await o.page.waitForTimeout(300);
  const st = await text(o.page, 'status'); await o.close();
  return st.includes('Period started') || st;
});

// ---- predictions ---------------------------------------------------------------
// Periods 70, 42 and 14 days ago: two 28-day cycles, today is day 15 = ovulation.
await check('averages from logged cycles; next period, ovulation and fertile window', async () => {
  const p = await open({ data: log([70, 42, 14]) });
  const r = await p.page.evaluate(() => { const m = model(); return { avg: m.avgCycle, day: m.day, next: m.next, ov: m.ov, fs: m.fertStart, how: m.ovHow }; });
  const up = await text(p.page, 'upcoming'); await p.close();
  return (r.avg === 28 && r.day === 15 && r.next === fwd(14) && r.ov === fwd(0) && r.fs === back(5) && r.how === 'estimate' && /Fertile window/i.test(up)) || JSON.stringify([r, up]);
});
await check('today on ovulation day says so; fertile days are lilac in the calendar', async () => {
  const o = await open({ data: log([70, 42, 14]) });
  const st = await text(o.page, 'status');
  await o.page.click('[data-tab="cal"]'); await o.page.waitForTimeout(100);
  const cls = k => o.page.evaluate(k => document.querySelector(`.day[data-day="${k}"]`)?.className, k);
  const r = { ov: await cls(back(0)), f1: await cls(back(3)) };
  if (!(await cls(back(14)))) { await o.page.click('#prevM'); await o.page.waitForTimeout(80); }   // the period may be last month
  r.p0 = await cls(back(14));
  await o.close();
  return (/Ovulation day/.test(st) && /m-ov/.test(r.ov) && /m-fert/.test(r.f1) && /m-period/.test(r.p0)) || JSON.stringify([st, r]);
});
await check('predicted period shown dashed in the calendar', async () => {
  const o = await open({ data: log([70, 42, 14]) });
  await o.page.click('[data-tab="cal"]');
  const want = fwd(14); const d = new Date(); const sameMonth = want.slice(0, 7) === dk(d).slice(0, 7);
  if (!sameMonth) await o.page.click('#nextM');
  const cls = await o.page.evaluate(k => document.querySelector(`.day[data-day="${k}"]`)?.className, want); await o.close();
  return /m-pred/.test(cls) || cls;
});
await check('a late period: says how late, gently', async () => {
  const o = await open({ data: log([61, 33]) });   // one 28-day cycle, last start 33 days ago → 5 late
  const r = { st: await text(o.page, 'status'), rp: await text(o.page, 'rp') }; await o.close();
  return (/5 days late/.test(r.st) && /test is reliable/.test(r.st) && r.rp === 'Period late') || JSON.stringify(r);
});
await check('a positive LH test moves ovulation to the next day', async () => {
  const o = await open({ data: log([70, 42, 14], { extra: { [back(4)]: { lh: 'pos' } } }) });
  const r = await o.page.evaluate(() => { const m = model(); return { ov: m.ov, how: m.ovHow }; }); await o.close();
  return (r.ov === back(3) && r.how === 'lh') || JSON.stringify(r);
});
await check('a temperature shift (three over six) confirms ovulation', async () => {
  const temps = {}; const lowT = [36.3, 36.35, 36.3, 36.4, 36.32, 36.38]; const highT = [36.7, 36.72, 36.75];
  // 9 readings ending yesterday
  [...lowT, ...highT].forEach((t, i) => { temps[back(9 - i)] = { temp: t }; });
  const o = await open({ data: log([70, 42, 14], { extra: temps }) });
  const r = await o.page.evaluate(() => { const m = model(); return { ov: m.ov, how: m.ovHow }; });
  await o.page.click('[data-tab="ins"]'); await o.page.waitForTimeout(100);
  const note = await text(o.page, 'tempNote'); const shown = await o.page.evaluate(() => !document.getElementById('tempCard').classList.contains('hidden'));
  await o.close();
  return (r.ov === back(4) && r.how === 'temperature' && shown && /rose and stayed up/.test(note)) || JSON.stringify([r, note]);
});

// ---- logging -------------------------------------------------------------------
await check('log today: flow, symptoms, mood, discharge, temperature, note are saved', async () => {
  const o = await open({ data: log([20]) });
  await o.page.click('#logBtn'); await o.page.waitForTimeout(200);
  await o.page.click('#fFlow [data-flow="light"]'); await o.page.click('#fSym [data-sym="Cramps"]'); await o.page.click('#fMood [data-mood="Calm"]');
  await o.page.click('#fCm [data-cm="eggwhite"]');
  await o.page.fill('#fTemp', '40'); await o.page.dispatchEvent('#fTemp', 'change');
  const err = await o.page.evaluate(() => !document.getElementById('tempErr').classList.contains('hidden'));
  await o.page.fill('#fTemp', '36.55'); await o.page.dispatchEvent('#fTemp', 'change');
  await o.page.fill('#fNote', 'felt good'); await o.page.click('#dDone'); await o.page.waitForTimeout(500);
  const e = JSON.parse((await stored(o.page)).plain).days[back(0)];
  const t = await text(o.page, 'todayLog'); await o.close();
  return (err && e.flow === 'light' && e.sym[0] === 'Cramps' && e.mood[0] === 'Calm' && e.cm === 'eggwhite' && e.temp === 36.55 && e.note === 'felt good' && /Cramps/.test(t)) || JSON.stringify([err, e, t]);
});
await check('"Period started" logs today and starts a new cycle', async () => {
  const o = await open({ data: log([30]) });
  await o.page.click('#periodBtn'); await o.page.click('#dDone'); await o.page.waitForTimeout(400);
  const r = await o.page.evaluate(() => ({ day: model().day, avg: model().cycles.length })); await o.close();
  return (r.day === 1 && r.avg === 1) || JSON.stringify(r);
});
await check('future days can be looked at but not logged', async () => {
  const o = await open({ data: log([70, 42, 14]) });
  await o.page.click('[data-tab="cal"]');
  const k = fwd(2); if (k.slice(0, 7) !== back(0).slice(0, 7)) await o.page.click('#nextM');
  await o.page.click(`.day[data-day="${k}"]`); await o.page.waitForTimeout(200);
  const r = await o.page.evaluate(() => ({ sub: document.getElementById('dSub').innerText, secs: [...document.querySelectorAll('#daySheet .sec')].filter(s => !s.classList.contains('hidden')).length }));
  await o.close();
  return (r.secs === 0 && /log it when the day comes/.test(r.sub)) || JSON.stringify(r);
});
await check('insights: averages, recent cycles, and when symptoms tend to come', async () => {
  // Bloating 2–4 days before each period: the luteal phase.
  const lut = {}; for (const s of [70, 42, 14]) for (const d of [2, 3, 4]) lut[back(s + d)] = { sym: ['Bloating'] };
  const o = await open({ data: log([98, 70, 42, 14], { extra: lut }) });
  await o.page.click('[data-tab="ins"]'); await o.page.waitForTimeout(100);
  const r = { stats: await text(o.page, 'stats'), bars: await o.page.evaluate(() => document.querySelectorAll('#bars .bar').length), freq: await text(o.page, 'freq') };
  await o.close();
  return (/28\s*days\s*Average cycle/.test(r.stats) && r.bars === 3 && /Bloating.*mostly in your luteal phase/s.test(r.freq)) || JSON.stringify(r);
});

// ---- passcode, encryption, lock -------------------------------------------------
await check('passcode: log encrypted, plain copy removed, locks on leaving, wipes the page', async () => {
  const o = await open({ data: log([20], { extra: { [back(1)]: { sym: ['Cramps'], note: 'secret note' } } }) });
  await o.page.click('#gear'); await o.page.click('#pcBtn'); await o.page.waitForTimeout(150);
  await pin(o.page, '123456'); await pin(o.page, '123456'); await o.page.waitForTimeout(1500);
  const s = await stored(o.page);
  await hide(o.page); await o.page.waitForTimeout(800);
  const r = { plain: s.plain, encHasNote: (s.enc || '').includes('secret'), enc: !!s.enc,
    locked: await o.page.evaluate(() => !document.getElementById('lock').hidden),
    leaked: await o.page.evaluate(() => /secret note|Cramps/.test(document.getElementById('app').innerText + document.getElementById('daySheet').innerText)) };
  await o.close();
  return (r.plain === null && r.enc && !r.encHasNote && r.locked && !r.leaked) || JSON.stringify(r);
});
await check('passcode: wrong one refused, right one opens the log again', async () => {
  const o = await open({ data: log([20], { extra: { [back(0)]: { note: 'secret note' } } }) });
  await o.page.click('#gear'); await o.page.click('#pcBtn');
  await pin(o.page, '246810'); await pin(o.page, '246810'); await o.page.waitForTimeout(1500);
  await hide(o.page); await o.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
  await pin(o.page, '111111'); await o.page.waitForTimeout(1500);
  const wrong = await text(o.page, 'lockMsg');
  await pin(o.page, '246810'); await o.page.waitForTimeout(1500);
  const r = { wrong, open: await o.page.evaluate(() => document.getElementById('lock').hidden), log: await text(o.page, 'todayLog') };
  await o.close();
  return (/Wrong passcode/.test(r.wrong) && r.open && /secret note/.test(r.log)) || JSON.stringify(r);
});
await check('reopening an encrypted log asks for the passcode first', async () => {
  const o = await open({ data: log([20]) });
  await o.page.click('#gear'); await o.page.click('#pcBtn');
  await pin(o.page, '135790'); await pin(o.page, '135790'); await o.page.waitForTimeout(1500);
  const enc = (await stored(o.page)).enc; await o.close();
  const ctx = await browser.newContext(); await ctx.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await ctx.addInitScript(e => window.myllmStorage.setItem('bloom.v1.enc', e), enc);
  const p = await load(ctx); await p.goto(ORIGIN, { waitUntil: 'load' }); await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({ lock: !document.getElementById('lock').hidden, welcome: !document.getElementById('welcome').hidden, day: document.getElementById('rn').textContent }));
  await pin(p, '135790'); await p.waitForTimeout(1500);
  const after = await p.evaluate(() => document.getElementById('rn').textContent); await ctx.close();
  return (r.lock && !r.welcome && r.day === '' && after === '21') || JSON.stringify([r, after]);
});
await check('erase everything: two taps, storage empty, back to welcome', async () => {
  const o = await open({ data: log([20]) });
  await o.page.click('#gear'); await o.page.click('#eraseBtn'); await o.page.click('#eraseBtn'); await o.page.waitForTimeout(400);
  const s = await stored(o.page); const w = await o.page.evaluate(() => !document.getElementById('welcome').hidden); await o.close();
  return (s.plain === null && s.enc === null && w) || JSON.stringify([s, w]);
});
await check('export: a CSV through the share sheet, only when asked', async () => {
  const o = await open({ data: log([20], { extra: { [back(1)]: { sym: ['Cramps', 'Acne'], note: 'a, "quoted" note' } } }) });
  const before = await o.page.evaluate(() => window.__spy.shared.length);
  await o.page.click('#gear'); await o.page.click('#exportBtn'); await o.page.waitForTimeout(200);
  const r = await o.page.evaluate(() => { const s = window.__spy.shared[0]; return { o: s.o, csv: decodeURIComponent(escape(atob(s.d.split(',')[1]))) }; });
  await o.close();
  return (before === 0 && r.o.mime === 'text/csv' && r.csv.startsWith('date,period,symptoms') && r.csv.includes('Cramps; Acne') && r.csv.includes('"a, ""quoted"" note"')) || JSON.stringify(r);
});

// ---- privacy and chrome ------------------------------------------------------------
await check('privacy: no network, no shared files, no AI, across a full session', async () => {
  const o = await open({ data: log([70, 42, 14]) });
  for (const t of ['cal', 'ins', 'today']) { await o.page.click(`[data-tab="${t}"]`); await o.page.waitForTimeout(80); }
  await o.page.click('#logBtn'); await o.page.click('#fSym [data-sym="Headache"]'); await o.page.click('#dDone'); await o.page.waitForTimeout(400);
  const spy = await o.page.evaluate(() => window.__spy); const h = await readFile(path.join(HERE, '..', 'apps-src', 'bloom.html'), 'utf8');
  const declares = /myllm:intents|application\/myllm-actions|myllmWidget|myllmMemory/.test(h);
  await o.close();
  return (spy.ask === 0 && spy.files === 0 && spy.net === 0 && o.requests.length === 0 && !declares) || JSON.stringify([spy, o.requests, declares]);
});
await check('full screen with a ✕ on MyLLM 5.6.2+', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await ctx.addInitScript(() => { window.__imm = []; window.myllmImmersive = on => { window.__imm.push(on); return Promise.resolve(); }; window.myllmClose = () => { window.__closed = 1; return Promise.resolve(); }; });
  const p = await load(ctx); await p.goto(ORIGIN, { waitUntil: 'load' }); await p.waitForTimeout(400);
  await p.click('#wGo'); await p.click('.imm-acts button'); await p.waitForTimeout(100);
  const r = await p.evaluate(() => ({ asked: window.__imm.includes(true), closed: window.__closed })); await ctx.close();
  return (r.asked && r.closed === 1) || JSON.stringify(r);
});
await check('dark mode and a long history render without errors', async () => {
  const starts = []; for (let i = 0; i < 24; i++) starts.push(14 + i * 29);
  const o = await open({ data: log(starts), dark: true });
  for (const t of ['cal', 'ins', 'today']) { await o.page.click(`[data-tab="${t}"]`); await o.page.waitForTimeout(80); }
  const size = (await stored(o.page)).plain.length; await o.close();
  return (o.errs.length === 0 && size < 200000) || JSON.stringify([o.errs, size]);
});

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
