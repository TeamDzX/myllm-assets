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

async function open({ data = null, dark = false, kv = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: dark ? 'dark' : 'light' });
  await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await context.addInitScript(([data, kv]) => {
    window.__spy = { ask: 0, files: 0, shared: [], net: 0 };
    window.myllmAsk = window.myllmAskJSON = () => { window.__spy.ask++; return Promise.reject(new Error('no')); };
    for (const k of ['write', 'read', 'list', 'remove']) { const f = window.myllmFiles[k]; window.myllmFiles[k] = (...a) => { window.__spy.files++; return f(...a); }; }
    window.myllmFetch = () => { window.__spy.net++; return Promise.reject(new Error('no')); };
    window.myllmShareFile = (d, o) => { window.__spy.shared.push({ d, o }); return Promise.resolve({ saved: true }); };
    if (data) window.myllmStorage.setItem('bloom.v1', data);
    if (kv) for (const k in kv) window.myllmStorage.setItem(k, kv[k]);
    // __failSave: the store refuses writes, as MyLLM does when the phone is full
    const set = window.myllmStorage.setItem;
    window.myllmStorage.setItem = (k, v) => window.__failSave ? Promise.reject(new Error('The disk is full.')) : set(k, v);
  }, [data, kv]);
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
// v2: Alex found no way out on the first screen and a scroll freeze.
async function full({ late = 0, data = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await ctx.addInitScript(([late, data]) => {
    const add = () => { window.myllmImmersive = () => Promise.resolve(); window.myllmClose = () => { window.__closed = 1; return Promise.resolve(); }; };
    if (late) setTimeout(add, late); else add();
    if (data) window.myllmStorage.setItem('bloom.v1', data);
  }, [late, data]);
  const p = await load(ctx); await p.goto(ORIGIN, { waitUntil: 'load' }); await p.waitForTimeout(600);
  return { p, close: () => ctx.close() };
}
await check('v2: the welcome screen has its own ✕ that closes Bloom', async () => {
  const o = await full();
  const vis = await o.p.isVisible('#welcome .over-x'); await o.p.click('#welcome .over-x'); await o.p.waitForTimeout(100);
  const closed = await o.p.evaluate(() => window.__closed); await o.close();
  return (vis && closed === 1) || JSON.stringify({ vis, closed });
});
await check('v2: the lock screen has its own ✕ that closes Bloom', async () => {
  const o = await full({ data: log([42, 14]) });
  await o.p.evaluate(() => document.getElementById('pcBtn').click()); await o.p.waitForTimeout(200);
  const vis = await o.p.isVisible('#lock .over-x'); await o.p.click('#lock .over-x'); await o.p.waitForTimeout(100);
  const closed = await o.p.evaluate(() => window.__closed); await o.close();
  return (vis && closed === 1) || JSON.stringify({ vis, closed });
});
await check('v2: the header ✕ stays on screen after scrolling to the bottom', async () => {
  const starts = []; for (let i = 0; i < 12; i++) starts.push(14 + i * 29);
  const o = await full({ data: log(starts) });
  await o.p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await o.p.waitForTimeout(150);
  const r = await o.p.evaluate(() => { const b = document.querySelector('.imm-acts button').getBoundingClientRect(); return { y: window.scrollY, top: b.top, h: b.height }; });
  await o.p.click('.imm-acts button'); const closed = await o.p.evaluate(() => window.__closed); await o.close();
  return (r.y > 150 && r.top >= 0 && r.top < 120 && r.h > 30 && closed === 1) || JSON.stringify({ r, closed });
});
await check('v2: the ✕ still appears when MyLLM\'s bridges arrive late', async () => {
  const o = await full({ late: 250, data: log([14]) });
  await o.p.waitForTimeout(1600);
  const vis = await o.p.isVisible('.imm-acts button'); await o.close();
  return vis || 'not visible';
});
await check('v2: hidden sheets take no touches; the page is pinned only while one is up', async () => {
  const o = await open({ data: log([70, 42, 14]) });
  const st = () => o.page.evaluate(() => ({ modal: document.documentElement.classList.contains('modal'),
    vis: [...document.querySelectorAll('.sheet')].map(s => getComputedStyle(s).visibility).join(','),
    over: getComputedStyle(document.body).overflowY }));
  const before = await st();
  await o.page.click('#logBtn'); await o.page.waitForTimeout(350); const during = await st();
  const inner = await o.page.evaluate(() => getComputedStyle(document.getElementById('daySheet')).overscrollBehaviorY);
  await o.page.click('#dDone'); await o.page.waitForTimeout(400); const after = await st();
  await o.page.evaluate(() => window.scrollTo(0, 300)); const y = await o.page.evaluate(() => window.scrollY);
  await o.close();
  const allHidden = v => v.split(',').every(x => x === 'hidden');
  const ok = !before.modal && allHidden(before.vis) && during.modal && during.vis.includes('visible') && during.over === 'hidden'
    && inner === 'contain' && !after.modal && allHidden(after.vis) && after.over !== 'hidden';
  return ok || JSON.stringify({ before, during, inner, after, y });
});
await check('v2: the welcome screen pins the page; finishing it releases it', async () => {
  const o = await open();
  const a = await o.page.evaluate(() => document.documentElement.classList.contains('modal'));
  await o.page.click('#wGo'); await o.page.waitForTimeout(200);
  const b = await o.page.evaluate(() => document.documentElement.classList.contains('modal')); await o.close();
  return (a && !b) || JSON.stringify({ a, b });
});
await check('dark mode and a long history render without errors', async () => {
  const starts = []; for (let i = 0; i < 24; i++) starts.push(14 + i * 29);
  const o = await open({ data: log(starts), dark: true });
  for (const t of ['cal', 'ins', 'today']) { await o.page.click(`[data-tab="${t}"]`); await o.page.waitForTimeout(80); }
  const size = (await stored(o.page)).plain.length; await o.close();
  return (o.errs.length === 0 && size < 200000) || JSON.stringify([o.errs, size]);
});

// ---- v3: the log can't be lost quietly ------------------------------------------
const all = p => p.evaluate(async () => { const o = {}; for (const k of await window.myllmStorage.keys()) o[k] = await window.myllmStorage.getItem(k); return o; });
const vis = (p, id) => p.evaluate(i => { const e = document.getElementById(i); return !!e && !e.hidden && !e.classList.contains('hidden'); }, id);
const backupOf = p => p.evaluate(() => { const s = window.__spy.shared.at(-1); return decodeURIComponent(escape(atob(s.d.split(',')[1]))); });
const give = (p, name, text, mimeType = 'text/plain') => p.setInputFiles('#impFile', { name, mimeType, buffer: Buffer.from(text) });

await check('v3: an unreadable log is set aside, not saved over, and Bloom says so', async () => {
  const o = await open({ data: '{"v":1,"settings":{"cycle":28' });
  const r1 = { welcome: await vis(o.page, 'welcome'), note: await text(o.page, 'wNote') };
  await o.page.click('#wGo'); await o.page.waitForTimeout(500);
  const st = await all(o.page); const dmg = Object.keys(st).filter(k => k.startsWith('bloom.damaged.'));
  await o.close();
  return (r1.welcome && /set aside, not deleted/.test(r1.note) && dmg.length === 1 && st[dmg[0]] === '{"v":1,"settings":{"cycle":28' && JSON.parse(st['bloom.v1']).v === 2) || JSON.stringify({ r1, keys: Object.keys(st) });
});
await check('v3: a clean load keeps a spare copy; a damaged log opens the spare', async () => {
  const a = await open({ data: log([20], { extra: { [back(2)]: { note: 'kept' } } }) });
  await a.page.waitForTimeout(300); const bak = (await all(a.page))['bloom.v1.bak']; await a.close();
  const b = await open({ kv: { 'bloom.v1': 'nonsense', 'bloom.v1.bak': bak } });
  await b.page.waitForTimeout(400);
  const r = { notice: await vis(b.page, 'notice'), txt: await text(b.page, 'noticeTxt'), day: await text(b.page, 'rn'), welcome: await vis(b.page, 'welcome') };
  const st = await all(b.page); await b.close();
  return (!!bak && JSON.parse(bak).log.days[back(2)].note === 'kept' && r.notice && /last good copy/.test(r.txt) && r.day === '21' && !r.welcome
    && JSON.parse(st['bloom.v1']).days[back(2)].note === 'kept' && Object.keys(st).some(k => k.startsWith('bloom.damaged.'))) || JSON.stringify(r);
});
await check('v3: a refused save shows a bar; Retry stores it and clears the bar', async () => {
  const o = await open({ data: log([20]) });
  await o.page.evaluate(() => { window.__failSave = true; });
  await o.page.click('#logBtn'); await o.page.click('#fSym [data-sym="Headache"]'); await o.page.waitForTimeout(500);
  const r = { bar: await vis(o.page, 'saveBar'), txt: await text(o.page, 'saveTxt') };
  await o.page.evaluate(() => { window.__failSave = false; });
  await o.page.click('#saveRetry'); await o.page.waitForTimeout(300);
  r.after = await vis(o.page, 'saveBar'); r.saved = JSON.parse((await stored(o.page)).plain).days[back(0)];
  await o.close();
  return (r.bar && /Couldn't save/.test(r.txt) && !r.after && r.saved && r.saved.sym[0] === 'Headache') || JSON.stringify(r);
});
await check('v3: passcode on → the plain spare goes, an encrypted spare replaces it', async () => {
  const o = await open({ data: log([20], { extra: { [back(1)]: { note: 'secret note' } } }) });
  await o.page.waitForTimeout(200); const before = await all(o.page);
  await o.page.click('#gear'); await o.page.click('#pcBtn'); await pin(o.page, '123456'); await pin(o.page, '123456'); await o.page.waitForTimeout(1800);
  const st = await all(o.page); await o.close();
  const leak = Object.entries(st).filter(([k, v]) => /secret note/.test(v)).map(([k]) => k);
  return (!!before['bloom.v1.bak'] && !st['bloom.v1.bak'] && !!st['bloom.v1.enc.bak'] && leak.length === 0) || JSON.stringify({ keys: Object.keys(st), leak });
});
await check('v3: a damaged encrypted log opens its spare with the passcode', async () => {
  const o = await open({ data: log([20], { extra: { [back(0)]: { note: 'secret note' } } }) });
  await o.page.click('#gear'); await o.page.click('#pcBtn'); await pin(o.page, '246810'); await pin(o.page, '246810'); await o.page.waitForTimeout(1800);
  const ebak = (await all(o.page))['bloom.v1.enc.bak']; await o.close();
  const p = await open({ kv: { 'bloom.v1.enc': '{"v":1,"salt":"AAAA","iv"', 'bloom.v1.enc.bak': ebak } });
  const r = { lock: await vis(p.page, 'lock'), sub: await text(p.page, 'lockSub') };
  await pin(p.page, '246810'); await p.page.waitForTimeout(1800);
  r.open = !(await vis(p.page, 'lock')); r.log = await text(p.page, 'todayLog'); r.notice = await text(p.page, 'noticeTxt');
  const st = await all(p.page); await p.close();
  return (r.lock && /damaged/.test(r.sub) && r.open && /secret note/.test(r.log) && /last good copy/.test(r.notice)
    && st['bloom.v1.enc'] && JSON.parse(st['bloom.v1.enc']).ct && Object.keys(st).some(k => k.startsWith('bloom.damaged.'))) || JSON.stringify(r);
});
await check('v3: back up, then restore on a fresh install (plain)', async () => {
  const a = await open({ data: log([70, 42, 14], { settings: { cycle: 31 }, extra: { [back(1)]: { sym: ['Cramps'], note: 'n1' } } }) });
  await a.page.click('#gear'); await a.page.click('#backupBtn'); await a.page.waitForTimeout(300);
  const file = await backupOf(a.page); const name = await a.page.evaluate(() => window.__spy.shared.at(-1).o.filename); await a.close();
  const b = await open();
  await give(b.page, name, file, 'application/json'); await b.page.waitForTimeout(400);
  const r = { sheet: await b.page.evaluate(() => document.getElementById('impSheet').classList.contains('on')), counts: await text(b.page, 'iCounts'), from: await text(b.page, 'iFrom') };
  await b.page.click('#iMerge'); await b.page.waitForTimeout(500);
  const s = JSON.parse((await stored(b.page)).plain); r.welcome = await vis(b.page, 'welcome'); await b.close();
  return (/^Bloom backup /.test(name) && r.sheet && /^16\s*New days/.test(r.counts) && /Bloom backup/.test(r.from) && !r.welcome
    && s.settings.cycle === 31 && s.settings.setup && s.days[back(1)].note === 'n1' && Object.keys(s.days).length === 16) || JSON.stringify(r);
});
await check('v3: an encrypted backup stays sealed and restores with its passcode', async () => {
  const a = await open({ data: log([20], { extra: { [back(0)]: { note: 'secret note' } } }) });
  await a.page.click('#gear'); await a.page.click('#pcBtn'); await pin(a.page, '135790'); await pin(a.page, '135790'); await a.page.waitForTimeout(1800);
  await a.page.click('#gear'); await a.page.click('#backupBtn'); await a.page.waitForTimeout(400);
  const file = await backupOf(a.page); await a.close();
  const b = await open();
  await give(b.page, 'Bloom backup.json', file, 'application/json'); await b.page.waitForTimeout(300);
  const r = { sealed: !/secret note/.test(file) && !!JSON.parse(file).encrypted, lock: await vis(b.page, 'lock'), title: await text(b.page, 'lockTitle') };
  await pin(b.page, '111111'); await b.page.waitForTimeout(1500); r.wrong = await text(b.page, 'lockMsg');
  await pin(b.page, '135790'); await b.page.waitForTimeout(1500);
  r.sheet = await b.page.evaluate(() => document.getElementById('impSheet').classList.contains('on'));
  await b.page.click('#iMerge'); await b.page.waitForTimeout(400);
  r.note = JSON.parse((await stored(b.page)).plain).days[back(0)].note; await b.close();
  return (r.sealed && r.lock && /backup is locked/.test(r.title) && /Wrong passcode/.test(r.wrong) && r.sheet && r.note === 'secret note') || JSON.stringify(r);
});
await check('v3: CSV import previews new / already logged / different, and merge keeps yours', async () => {
  const o = await open({ data: log([60], { extra: { [back(1)]: { sym: ['Cramps'] }, [back(3)]: { flow: 'medium' } } }) });
  const csv = ['date,period,symptoms,mood,note', `${back(1)},,Cramps,,`, `${back(3)},Heavy,,,`, `${back(40)},Light,"Headache; migraine",Sad,`, `${back(41)},,,,"from, elsewhere"`, `${fwd(3)},Heavy,,,`].join('\n');
  await o.page.click('#gear'); await give(o.page, 'export.csv', csv, 'text/csv'); await o.page.waitForTimeout(400);
  const r = { counts: await text(o.page, 'iCounts'), note: await text(o.page, 'iNote') };
  await o.page.click('#iMerge'); await o.page.waitForTimeout(400);
  const d = JSON.parse((await stored(o.page)).plain).days; await o.close();
  return (/^2\s*New days\s*1\s*Already logged\s*1\s*Different/.test(r.counts) && /keeps yours/.test(r.note)
    && d[back(3)].flow === 'medium' && d[back(40)].flow === 'light' && d[back(40)].sym.join() === 'Headache' && d[back(40)].mood[0] === 'Low'
    && d[back(41)].note === 'from, elsewhere' && !d[fwd(3)]) || JSON.stringify([r, d[back(40)], d[back(3)]]);
});
await check('v3: another app\'s CSV (semicolons, day/month dates, "yes") imports on the welcome screen', async () => {
  const o = await open();
  const dmy = k => k.slice(8) + '/' + k.slice(5, 7) + '/' + k.slice(0, 4);
  const csv = ['Day;Menstruation;Temperature (°F)', `${dmy(back(30))};yes;97.6`, `${dmy(back(29))};yes;`, `${dmy(back(2))};;98.1`].join('\r\n');
  await o.page.click('#wImport').catch(() => {}); await give(o.page, 'other.csv', csv, 'text/csv'); await o.page.waitForTimeout(400);
  const r = { welcome: await vis(o.page, 'welcome'), counts: await text(o.page, 'iCounts') };
  await o.page.click('#iMerge'); await o.page.waitForTimeout(400);
  const s = JSON.parse((await stored(o.page)).plain); await o.close();
  return (!r.welcome && /^3\s*New/.test(r.counts) && s.settings.setup && s.days[back(30)].flow === 'medium' && s.days[back(2)].temp === 36.72) || JSON.stringify([r, s.days]);
});
await check('v3: a Flo-style JSON is read generically; an unknown one is turned down kindly', async () => {
  const o = await open();
  const flo = { user: { birthday: '1990-01-01' }, exported_at: '2026-10-01T10:00:00Z',
    cycles: [{ period_start_date: back(33), period_end_date: back(29), predicted: false }, { period_start_date: back(5), period_end_date: back(2) }],
    events: [{ date: back(10), category: 'symptoms', values: ['cramps', 'tender_breasts'] }, { date: back(9), type: 'bbt', value: 36.6 }, { date: back(9), type: 'mood', value: 'anxious' }] };
  await give(o.page, 'flo_data.json', JSON.stringify(flo), 'application/json'); await o.page.waitForTimeout(400);
  const r = { from: await text(o.page, 'iFrom'), counts: await text(o.page, 'iCounts'), note: await text(o.page, 'iNote') };
  await o.page.click('#iCancel'); await o.page.waitForTimeout(200);
  await give(o.page, 'flo_data.json', JSON.stringify({ profile: { name: 'x' }, settings: { theme: 1 } }), 'application/json'); await o.page.waitForTimeout(400);
  r.refused = await text(o.page, 'wNote'); r.welcome = await vis(o.page, 'welcome');
  await o.close();
  return (/Flo export/.test(r.from) && /^11\s*New/.test(r.counts) && /9 period days/.test(r.note) && /check the periods/.test(r.note)
    && /isn't supported yet/.test(r.refused) && /don't send the file/.test(r.refused) && r.welcome) || JSON.stringify(r);
});
await check('v3: a v1 log becomes v2 with its days untouched', async () => {
  const o = await open({ data: log([20], { extra: { [back(1)]: { sym: ['Acne'] } } }) });
  await o.page.click('#logBtn'); await o.page.click('#fMood [data-mood="Happy"]'); await o.page.click('#dDone'); await o.page.waitForTimeout(400);
  const s = JSON.parse((await stored(o.page)).plain); await o.close();
  return (s.v === 2 && s.settings.wunit === 'kg' && s.settings.pill === false && s.days[back(1)].sym[0] === 'Acne' && s.days[back(20)].flow === 'medium') || JSON.stringify(s.settings);
});
await check('v3: pill, pregnancy test, energy, sleep, water and weight are logged, shown and exported', async () => {
  const o = await open({ data: log([20]) });
  const hiddenPill = await o.page.evaluate(() => { document.getElementById('logBtn').click(); return document.getElementById('pillSec').classList.contains('hidden'); });
  await o.page.click('#dDone'); await o.page.waitForTimeout(350);
  await o.page.click('#gear'); await o.page.click('#sPill [data-v="on"]'); await o.page.click('#sDone'); await o.page.waitForTimeout(350);
  await o.page.click('#logBtn'); await o.page.waitForTimeout(250);
  await o.page.click('#fPill [data-pill="taken"]'); await o.page.click('#fPreg [data-preg="neg"]'); await o.page.click('#fEnergy [data-energy="high"]');
  await o.page.fill('#fSleep', '7.5'); await o.page.dispatchEvent('#fSleep', 'change');
  await o.page.click('[data-water="1"]'); await o.page.click('[data-water="1"]');
  await o.page.fill('#fWeight', '900'); await o.page.dispatchEvent('#fWeight', 'change'); const err = await vis(o.page, 'bodyErr');
  await o.page.fill('#fWeight', '61.2'); await o.page.dispatchEvent('#fWeight', 'change');
  await o.page.click('#dDone'); await o.page.waitForTimeout(400);
  const e = JSON.parse((await stored(o.page)).plain).days[back(0)]; const t = await text(o.page, 'todayLog');
  await o.page.click('#gear'); await o.page.click('#exportBtn'); await o.page.waitForTimeout(200);
  const csv = await backupOf(o.page); await o.close();
  const [h, ...rows] = csv.split('\n'); const row = rows.find(r => r.startsWith(back(0)));
  return (hiddenPill && err && e.pill === 'taken' && e.preg === 'neg' && e.energy === 'high' && e.sleep === 7.5 && e.water === 2 && e.weight === 61.2
    && /Pill taken/.test(t) && /7.5 h sleep/.test(t) && /61.2 kg/.test(t)
    && h.endsWith('energy,pregnancy_test,pill,sleep_hours,water_glasses,weight_kg') && row.endsWith('High,Negative,Taken,7.5,2,61.2')) || JSON.stringify({ hiddenPill, err, e, t, h, row });
});
await check('v3: Bloom reads its own spreadsheet back, new fields included', async () => {
  const a = await open({ data: log([20], { extra: { [back(1)]: { sym: ['Cramps'], mood: ['Calm'], cm: 'eggwhite', lh: 'pos', temp: 36.5, sex: 'protected', energy: 'low', pill: 'late', sleep: 6, water: 3, weight: 70, note: 'a, "q"' } } }) });
  await a.page.click('#gear'); await a.page.click('#exportBtn'); await a.page.waitForTimeout(200);
  const csv = await backupOf(a.page); const orig = JSON.parse((await stored(a.page)).plain).days; await a.close();
  const b = await open(); await give(b.page, 'Bloom cycle log.csv', csv, 'text/csv'); await b.page.waitForTimeout(400);
  const from = await text(b.page, 'iFrom'); await b.page.click('#iMerge'); await b.page.waitForTimeout(400);
  const got = JSON.parse((await stored(b.page)).plain).days; await b.close();
  const sortK = o => JSON.stringify(o, Object.keys(o).sort());
  return (from === 'Bloom spreadsheet' && Object.keys(got).length === Object.keys(orig).length && sortK(got[back(1)]) === sortK(orig[back(1)])) || JSON.stringify([from, got[back(1)], orig[back(1)]]);
});
await check('v3: cycle history lists every cycle, newest first', async () => {
  const o = await open({ data: log([70, 42, 14]) });
  await o.page.click('[data-tab="ins"]'); await o.page.click('#histBtn'); await o.page.waitForTimeout(300);
  const rows = await o.page.evaluate(() => [...document.querySelectorAll('#histList .hrow')].map(r => r.innerText.replace(/\s+/g, ' ')));
  const sub = await text(o.page, 'hSub'); await o.close();
  return (rows.length === 3 && /Day 15 in progress/.test(rows[0]) && /28 days cycle/.test(rows[1]) && /Period 5 days/.test(rows[2]) && /Average 28-day cycle/.test(sub)) || JSON.stringify({ rows, sub });
});
await check('v3: erase clears the spare and set-aside copies too', async () => {
  const o = await open({ data: 'broken' }); await o.page.click('#wGo'); await o.page.waitForTimeout(300);
  await o.page.click('#gear'); await o.page.click('#eraseBtn'); await o.page.click('#eraseBtn'); await o.page.waitForTimeout(400);
  const st = await all(o.page); await o.close();
  return Object.keys(st).length === 0 || JSON.stringify(Object.keys(st));
});

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
