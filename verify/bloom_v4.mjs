// Bloom v4: quick symptom logging on Today (one tap, today or yesterday,
// optional severity, your own symptoms, "same as yesterday"), patterns
// counted on the phone, and the optional wording by the phone's own model —
// offered only where MyLLM promises {onDevice:true} never reaches a server.
//
//   node bloom_v4.mjs        # exit 0 = every case passes
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
const ORIGIN = 'https://bloom.apps.myllm.local/';
const pad = n => String(n).padStart(2, '0');
const dk = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const back = n => { const d = new Date(); d.setDate(d.getDate() - n); return dk(d); };

const S0 = { cycle: 28, period: 5, luteal: 14, goal: 'track', unit: 'C', setup: true, seed: null };
function logOf(days, settings = {}) { return JSON.stringify({ v: 2, settings: { ...S0, ...settings }, days }); }
/** Periods starting `starts` days ago (5 days medium), plus extra fields merged in per day. */
function build(starts, extra = {}) {
  const days = {};
  for (const s of starts) for (let i = 0; i < 5; i++) days[back(s - i)] = { flow: 'medium' };
  for (const k in extra) days[k] = { ...(days[k] || {}), ...extra[k] };
  return days;
}
const addSym = (days, k, x, more = {}) => { const e = days[k] || (days[k] = {}); (e.sym = e.sym || []).push(x); Object.assign(e, more); };

// Three complete 28-day cycles and today on day 27 (period due in 2 days).
// Headache in the 3rd and 2nd day before each period, with short sleep;
// cramps on cycle days 1–2; fatigue scattered; good sleep on other days.
function patternLog() {
  const starts = [110, 82, 54, 26], d = build(starts);
  for (const s of starts.slice(1)) { addSym(d, back(s + 3), 'Headache', { sleep: 5 }); addSym(d, back(s + 2), 'Headache', { sleep: 5.5 }); }
  for (const s of starts) { addSym(d, back(s), 'Cramps'); addSym(d, back(s - 1), 'Cramps'); }
  for (const n of [100, 70, 40]) addSym(d, back(n), 'Fatigue');
  for (const n of [104, 96, 90, 76, 66, 48, 44, 38, 20, 12]) d[back(n)] = { ...(d[back(n)] || {}), sleep: 8 };
  return d;
}

async function open({ data = null, ai = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await context.addInitScript(([data, ai]) => {
    window.__spy = { ask: [], net: 0, shared: [] };
    // ai null: a MyLLM whose myllmAsk can't promise the phone (5.9.4 and older)
    window.myllmAsk = (prompt, opts) => {
      window.__spy.ask.push({ prompt, opts });
      if (ai && ai.error) return Promise.reject(new Error(ai.error));
      return new Promise(r => setTimeout(() => r(ai ? ai.reply : 'x'), ai && ai.delay || 30));
    };
    if (ai) window.myllmAsk.onDeviceOnly = true;
    window.myllmAskJSON = () => Promise.reject(new Error('no'));
    window.myllmFetch = () => { window.__spy.net++; return Promise.reject(new Error('no')); };
    window.myllmShareFile = (d, o) => { window.__spy.shared.push({ d, o }); return Promise.resolve({ saved: true }); };
    if (data) window.myllmStorage.setItem('bloom.v1', data);
  }, [data, ai]);
  await context.route(ORIGIN, r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(ORIGIN, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return { page, errs, close: () => context.close() };
}
const text = (p, id) => p.evaluate(i => document.getElementById(i).innerText, id);
const saved = async p => { await p.waitForTimeout(400); return p.evaluate(async () => JSON.parse(await window.myllmStorage.getItem('bloom.v1'))); };
const sheetOpen = p => p.evaluate(() => !!document.querySelector('.sheet.on'));
const hide = p => p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
const pin = async (p, digits) => { for (const d of digits) await p.click(`#pad [data-pin="${d}"]`); await p.waitForTimeout(150); };

// ---- capture ------------------------------------------------------------------
await check('one tap on Today logs a symptom for today, saved, no sheet', async () => {
  const o = await open({ data: logOf(build([20])) });
  await o.page.click('#qSym [data-qsym="Headache"]');
  const s = await saved(o.page), sheet = await sheetOpen(o.page), sev = await o.page.isVisible('#qSev');
  const summary = await text(o.page, 'todayLog'); await o.close();
  return (s.days[back(0)].sym.join() === 'Headache' && !sheet && sev && /Headache/.test(summary) && !o.errs.length) || JSON.stringify([s.days[back(0)], sheet, sev, o.errs]);
});
await check('severity is optional; rating shows dots and goes with the symptom', async () => {
  const o = await open({ data: logOf(build([20])) });
  await o.page.click('#qSym [data-qsym="Cramps"]'); await o.page.click('#qSev [data-qsev="3"]');
  const a = await saved(o.page);
  const dots = await o.page.evaluate(() => document.querySelectorAll('#qSym [data-qsym="Cramps"] .sv i.f').length);
  const summary = await text(o.page, 'todayLog');
  await o.page.click('#qSym [data-qsym="Cramps"]');      // off again: the rating goes too
  const b = await saved(o.page); await o.close();
  return (a.days[back(0)].sev.Cramps === 3 && dots === 3 && /Cramps \(severe\)/.test(summary) && !b.days[back(0)]) || JSON.stringify([a.days[back(0)], dots, summary, b.days[back(0)]]);
});
await check('Yesterday logs yesterday; moods log the same way', async () => {
  const o = await open({ data: logOf(build([20])) });
  await o.page.click('#qDay [data-q="1"]'); await o.page.click('#qSym [data-qsym="Bloating"]'); await o.page.click('#qMood [data-qmood="Low"]');
  const s = await saved(o.page); await o.close();
  return (s.days[back(1)].sym.join() === 'Bloating' && s.days[back(1)].mood.join() === 'Low' && !s.days[back(0)]) || JSON.stringify(s.days);
});
await check('same as yesterday copies symptoms, ratings and mood, and adds to what is there', async () => {
  const o = await open({ data: logOf(build([20], { [back(1)]: { sym: ['Cramps', 'Backache'], sev: { Cramps: 2 }, mood: ['Low'] }, [back(0)]: { sym: ['Backache'] } })) });
  const before = await o.page.isDisabled('#qSame');
  await o.page.click('#qSame');
  const s = await saved(o.page), after = await o.page.isDisabled('#qSame'); await o.close();
  const t = s.days[back(0)];
  return (!before && after && t.sym.sort().join() === 'Backache,Cramps' && t.sev.Cramps === 2 && t.mood.join() === 'Low') || JSON.stringify([before, after, t]);
});
await check('your own symptom: added, logged, kept in the day sheet; a known word maps to the usual one', async () => {
  const o = await open({ data: logOf(build([20])) });
  await o.page.click('#qSym [data-qadd]'); await o.page.fill('#qNew', '  jaw   ache '); await o.page.press('#qNew', 'Enter');
  await o.page.click('#qSym [data-qadd]'); await o.page.fill('#qNew', 'migraine'); await o.page.click('#qNewGo');
  const s = await saved(o.page);
  await o.page.click('#qMore'); await o.page.waitForTimeout(150);
  const inSheet = await o.page.isVisible('#fSym [data-sym="Jaw ache"]'); await o.close();
  return (s.settings.custom.join() === 'Jaw ache' && s.days[back(0)].sym.sort().join() === 'Headache,Jaw ache' && inSheet) || JSON.stringify([s.settings.custom, s.days[back(0)], inSheet]);
});
await check('removing your own symptom in Settings keeps the days it was logged', async () => {
  const o = await open({ data: logOf(build([20], { [back(2)]: { sym: ['Jaw ache'] } }), { custom: ['Jaw ache'] }) });
  await o.page.click('#gear'); await o.page.click('#sMine [data-unmine="Jaw ache"]');
  const s = await saved(o.page); await o.close();
  return (s.settings.custom.length === 0 && s.days[back(2)].sym.join() === 'Jaw ache') || JSON.stringify(s);
});
await check('the chips you log most come first', async () => {
  const d = build([20]); for (const n of [3, 5, 7, 9]) addSym(d, back(n), 'Nausea');
  const o = await open({ data: logOf(d) });
  const first = await o.page.evaluate(() => [...document.querySelectorAll('#qSym [data-qsym]')].map(b => b.dataset.qsym));
  await o.page.click('#qSym [data-qmore="sym"]');
  const all = await o.page.evaluate(() => document.querySelectorAll('#qSym [data-qsym]').length); await o.close();
  return (first[0] === 'Nausea' && first.length === 6 && all === 12) || JSON.stringify([first, all]);
});
await check('quick log on a passcode-locked Bloom is saved encrypted', async () => {
  const o = await open({ data: logOf(build([20])) });
  await o.page.click('#gear'); await o.page.click('#pcBtn'); await o.page.waitForTimeout(150);
  await pin(o.page, '123456'); await pin(o.page, '123456'); await o.page.waitForTimeout(1500);
  if (await o.page.isVisible('#sDone')) await o.page.click('#sDone');
  await o.page.click('#qSym [data-qadd]'); await o.page.fill('#qNew', 'Jaw ache'); await o.page.press('#qNew', 'Enter');
  await o.page.waitForTimeout(1200);
  const st = await o.page.evaluate(async () => ({ plain: await window.myllmStorage.getItem('bloom.v1'), enc: await window.myllmStorage.getItem('bloom.v1.enc') }));
  await hide(o.page); await o.page.waitForTimeout(600);
  const leaked = await o.page.evaluate(() => /Jaw ache/.test(document.body.innerText)); await o.close();
  return (st.plain === null && !!st.enc && !/Jaw/.test(st.enc) && !leaked) || JSON.stringify([st.plain, (st.enc || '').slice(0, 40), leaked]);
});

// ---- patterns -------------------------------------------------------------------
await check('patterns: before-period, cycle-day and sleep links found; scattered fatigue is not', async () => {
  const o = await open({ data: logOf(patternLog()) });
  await o.page.click('[data-tab="ins"]');
  const t = await text(o.page, 'pats'); await o.close();
  return (/headache in the five days before your period in 3 of your last 3 cycles/.test(t) && /cramps on cycle days 1–2 \(8 of 8 times\), across 4 cycles/.test(t)
    && /under 6½ hours' sleep, you also logged headache on 6 of 6 — on other days, 0 of 10/.test(t) && !/fatigue/i.test(t)) || t;
});
await check('patterns: too little logged says so instead of guessing', async () => {
  const o = await open({ data: logOf(build([40, 12], { [back(3)]: { sym: ['Headache'] }, [back(30)]: { sym: ['Headache'] } })) });
  await o.page.click('[data-tab="ins"]');
  const t = await text(o.page, 'pats'); await o.close();
  return /once you've logged how you feel on a few more days — 2 so far/.test(t) || t;
});
await check('heads-up on Today when a before-period symptom is due', async () => {
  const o = await open({ data: logOf(patternLog()) });
  const t = await text(o.page, 'qHeads'); await o.close();
  return /Heads-up: you've often logged headache in the days before your period, and it's due around/.test(t) || t;
});
await check('symptom with low mood link', async () => {
  const d = build([60, 32, 4]);
  for (const n of [50, 45, 38, 25, 18, 10]) addSym(d, back(n), 'Bloating', { mood: ['Low'] });
  for (const n of [49, 44, 37, 24, 17, 9, 8, 7, 6]) d[back(n)] = { ...(d[back(n)] || {}), mood: ['Happy'] };
  const o = await open({ data: logOf(d) });
  await o.page.click('[data-tab="ins"]'); const t = await text(o.page, 'pats'); await o.close();
  return /On days with bloating you also logged a low mood, anxiety, irritability or mood swings on 6 of 6 — on other days, 0 of/.test(t) || t;
});

// ---- the phone's model ------------------------------------------------------------
await check('older MyLLM (no phone-only promise): no AI option anywhere, never asked', async () => {
  const o = await open({ data: logOf(patternLog(), { aiWords: true }) });
  await o.page.click('[data-tab="ins"]'); await o.page.click('#gear');
  const r = { card: await o.page.isVisible('#aiCard'), btn: await o.page.$('#wordsBtn'), asks: await o.page.evaluate(() => window.__spy.ask.length) };
  await o.close();
  return (!r.card && !r.btn && r.asks === 0) || JSON.stringify(r);
});
await check('phone-only MyLLM, setting off (the default): offered in Settings, nothing sent', async () => {
  const o = await open({ data: logOf(patternLog()), ai: { reply: 'ok' } });
  await o.page.click('[data-tab="ins"]');
  const btn = await o.page.$('#wordsBtn'); await o.page.click('#gear');
  const card = await o.page.isVisible('#aiCard'), off = await o.page.evaluate(() => document.querySelector('#sAI [data-v="off"]').classList.contains('on'));
  const asks = await o.page.evaluate(() => window.__spy.ask.length); await o.close();
  return (!btn && card && off && asks === 0) || JSON.stringify({ btn: !!btn, card, off, asks });
});
await check('setting on: only the pattern sentences go, marked onDevice; reply shown, not saved', async () => {
  const d = patternLog(); d[back(2)] = { ...(d[back(2)] || {}), note: 'secret note' };
  const o = await open({ data: logOf(d), ai: { reply: 'Your **headaches** tend to come just before your period.' } });
  await o.page.click('#gear'); await o.page.click('#sAI [data-v="on"]'); await o.page.click('#sDone');
  await o.page.click('[data-tab="ins"]'); await o.page.click('#wordsBtn'); await o.page.waitForTimeout(300);
  const call = await o.page.evaluate(() => window.__spy.ask[0]);
  const shown = await text(o.page, 'wordsBox'); const s = await saved(o.page); await o.close();
  const raw = JSON.stringify(s);
  return (call.opts.onDevice === true && !/\d{4}-\d\d-\d\d/.test(call.prompt + call.opts.system) && !/secret/.test(call.prompt + call.opts.system)
    && /five days before your period/.test(call.prompt) && /^Patterns from my log/.test(call.prompt)
    && /Your headaches tend to come/.test(shown) && /on this phone/.test(shown) && !/headaches tend/.test(raw) && s.settings.aiWords === true) || JSON.stringify({ call, shown });
});
await check('no model on the phone: MyLLM\'s reason is shown, nothing else happens', async () => {
  const o = await open({ data: logOf(patternLog(), { aiWords: true }), ai: { error: "There's no model on this phone to use." } });
  await o.page.click('[data-tab="ins"]'); await o.page.click('#wordsBtn'); await o.page.waitForTimeout(200);
  const t = await text(o.page, 'wordsBox'); await o.close();
  return (/no model on this phone/.test(t) && /Put these in words/.test(t)) || t;
});
await check('locking mid-reply: the reply is dropped and nothing is left on screen', async () => {
  const o = await open({ data: logOf(patternLog(), { aiWords: true }), ai: { reply: 'Headaches before your period.', delay: 900 } });
  await o.page.click('#gear'); await o.page.click('#pcBtn'); await o.page.waitForTimeout(150);
  await pin(o.page, '123456'); await pin(o.page, '123456'); await o.page.waitForTimeout(1500); if (await o.page.isVisible('#sDone')) await o.page.click('#sDone');
  await o.page.click('[data-tab="ins"]'); await o.page.click('#wordsBtn'); await hide(o.page); await o.page.waitForTimeout(1300);
  const leaked = await o.page.evaluate(() => /Headaches before|headache|cramps/i.test(document.getElementById('app').innerText));
  await o.close();
  return (!leaked && !o.errs.length) || JSON.stringify({ leaked, errs: o.errs });
});

// ---- export / import ---------------------------------------------------------------
await check('spreadsheet round trip keeps ratings and your own symptoms', async () => {
  const a = await open({ data: logOf(build([20], { [back(1)]: { sym: ['Cramps', 'Jaw ache'], sev: { Cramps: 3, 'Jaw ache': 1 } } }), { custom: ['Jaw ache'] }) });
  await a.page.click('#gear'); await a.page.click('#exportBtn'); await a.page.waitForTimeout(200);
  const csv = await a.page.evaluate(() => { const s = window.__spy.shared.at(-1); return decodeURIComponent(escape(atob(s.d.split(',')[1]))); }); await a.close();
  const b = await open(); await b.page.setInputFiles('#impFile', { name: 'Bloom cycle log.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await b.page.waitForTimeout(400); await b.page.click('#iMerge');
  const s = await saved(b.page); await b.close();
  const e = s.days[back(1)];
  return (/Cramps \(severe\); Jaw ache \(mild\)/.test(csv) && e.sym.join() === 'Cramps,Jaw ache' && e.sev.Cramps === 3 && e.sev['Jaw ache'] === 1 && s.settings.custom.join() === 'Jaw ache') || JSON.stringify([csv.split('\n')[1], e, s.settings.custom]);
});
await check('a bad custom list or rating in a file is cleaned, not trusted', async () => {
  const o = await open({ data: JSON.stringify({ v: 2, settings: { ...S0, custom: 'x', aiWords: 'yes' }, days: { [back(1)]: { sym: ['Cramps'], sev: { Cramps: 9, Ghost: 2 } } } }) });
  const s = await o.page.evaluate(() => ({ c: S.settings.custom, ai: S.settings.aiWords }));
  await o.page.click('#qDay [data-q="1"]'); await o.page.click('#qSym [data-qsym="Headache"]');
  const d = await saved(o.page); await o.close();
  return (Array.isArray(s.c) && s.c.length === 0 && s.ai === false && !d.days[back(1)].sev) || JSON.stringify([s, d.days[back(1)]]);
});

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
