// Habit Streaks v6 (heatmap, sessions from other apps, local dates) and the
// session logging added to Box Breathing and Stretch.
//
//   node habit_heatmap.mjs        # exit 0 = every case passes
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
async function open(app, { files = {}, storage = {}, tz = 'Europe/London', fixedTime = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, timezoneId: tz });
  await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await context.addInitScript(([files, storage]) => {
    for (const [k, v] of Object.entries(storage)) window.myllmStorage.setItem(k, v);
    for (const [p, t] of Object.entries(files)) window.myllmFiles.write(p, t);
  }, [files, storage]);
  const page = await context.newPage();
  if (fixedTime) await page.clock.setFixedTime(new Date(fixedTime));
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.setContent(await src(app), { waitUntil: 'load' });
  await page.waitForTimeout(500);
  return { page, errs, close: () => context.close() };
}
const pad = n => String(n).padStart(2, '0');
const dayOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const back = n => { const d = new Date(); d.setDate(d.getDate() - n); return dayOf(d); };
const readJSON = (page, p) => page.evaluate(x => window.myllmFiles.read(x), p).then(t => t && JSON.parse(t));

// ---- the writers ------------------------------------------------------------
await check('Box Breathing: a finished session is appended to data/activity.json', async () => {
  const o = await open('box-breathing', { files: { 'data/activity.json': JSON.stringify({ schema: 'myllm.activity', version: 1, source: 'shared', events: [{ app: 'stretch', kind: 'session', date: back(1), at: '' }] }) } });
  await o.page.evaluate(() => { running = true; t0 = performance.now() - 40000; stop(true); });
  await o.page.waitForTimeout(300);
  const j = await readJSON(o.page, 'data/activity.json'); await o.close();
  const e = j.events[1];
  return (j.events.length === 2 && e.app === 'box-breathing' && e.kind === 'session' && e.date === back(0) && e.rounds >= 1 && e.minutes > 0 && o.errs.length === 0) || JSON.stringify([j, o.errs]);
});
await check('Box Breathing: stopping before a whole round logs nothing', async () => {
  const o = await open('box-breathing');
  await o.page.evaluate(() => { running = true; t0 = performance.now() - 2000; stop(false); });
  await o.page.waitForTimeout(300);
  const j = await readJSON(o.page, 'data/activity.json'); await o.close();
  return j === null || JSON.stringify(j);
});
await check('Stretch: a completed hold is logged with the stretch name', async () => {
  const o = await open('stretch');
  await o.page.evaluate(() => { di = 0; ttotal = 30; finishHold(); });
  await o.page.waitForTimeout(300);
  const j = await readJSON(o.page, 'data/activity.json'); await o.close();
  const e = j && j.events[0];
  return (e && e.app === 'stretch' && e.minutes === 0.5 && e.title && o.errs.length === 0) || JSON.stringify([j, o.errs]);
});
await check('a newer activity format is left alone', async () => {
  const v2 = JSON.stringify({ schema: 'myllm.activity', version: 2, events: [] });
  const o = await open('stretch', { files: { 'data/activity.json': v2 } });
  await o.page.evaluate(() => { di = 0; finishHold(); }); await o.page.waitForTimeout(300);
  const t = await o.page.evaluate(() => window.myllmFiles.read('data/activity.json')); await o.close();
  return t === v2 || t;
});

// ---- Habit Streaks v6 ---------------------------------------------------------
const habits = [{ name: 'Read 20 min', days: [back(0), back(1), back(2), back(9)] }, { id: 'h_1', name: 'Walk', days: [back(1)] }];
const act = { schema: 'myllm.activity', version: 1, source: 'shared', events: [
  { app: 'box-breathing', kind: 'session', date: back(0), at: '' }, { app: 'box-breathing', kind: 'session', date: back(0), at: '' },
  { app: 'box-breathing', kind: 'session', date: back(1), at: '' }, { app: 'stretch', kind: 'session', date: back(3), at: '', title: 'Cat-cow' }] };
const hs = await open('habit-streaks', { storage: { habits: JSON.stringify(habits) }, files: { 'data/activity.json': JSON.stringify(act) } });
const P = hs.page;
await check('heatmap: 18 weeks of days, today filled, future hidden', async () => {
  const r = await P.evaluate((t) => ({ n: document.querySelectorAll('#hmCells button').length, today: document.querySelector('#hmCells button[data-day="' + t + '"]').className,
    future: document.querySelectorAll('#hmCells button.future').length }), back(0));
  const dow = (new Date().getDay() + 6) % 7;
  return (r.n === 126 && /l[1-4]/.test(r.today) && r.future === 6 - dow) || JSON.stringify(r);
});
await check('tap a day: habits and sessions that day', async () => {
  await P.click(`#hmCells button[data-day="${back(0)}"]`); await P.waitForTimeout(100);
  const t = await P.evaluate(() => document.getElementById('hmTxt').innerText);
  return (t.includes('Read 20 min') && t.includes('Box Breathing ×2')) || t;
});
await check('From your apps: sessions this week and streaks', async () => {
  const t = await P.evaluate(() => document.getElementById('autoList').innerText);
  return (/Box Breathing\s+2 days in a row\s+3\s+THIS WEEK/i.test(t) && /Stretch[\s\S]*1\s+THIS WEEK/i.test(t)) || t;
});
await check('each habit shows its last 7 days', async () => {
  const r = await P.evaluate(() => [...document.querySelectorAll('.habit')].map(h => h.querySelectorAll('.week7 i.on').length));
  return JSON.stringify(r) === '[3,1]' || JSON.stringify(r);
});
await check('publishes data/habits.json with ids', async () => {
  const j = await readJSON(P, 'data/habits.json');
  return (j.schema === 'myllm.habits' && j.version === 1 && j.habits[0].id === 'h_legacy_1' && j.habits[1].id === 'h_1' && j.habits[0].days.length === 4) || JSON.stringify(j);
});
await check('reads sessions again on return', async () => {
  await P.evaluate((d) => { const j = JSON.parse(JSON.stringify(window.__a || {})); }, null);
  await P.evaluate(([d]) => window.myllmFiles.read('data/activity.json').then(t => { const j = JSON.parse(t); j.events.push({ app: 'stretch', kind: 'session', date: d, at: '' }); return window.myllmFiles.write('data/activity.json', JSON.stringify(j)); }), [back(0)]);
  await P.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await P.waitForTimeout(300);
  const t = await P.evaluate(() => document.getElementById('autoList').innerText);
  return /Stretch[\s\S]*2\s+THIS WEEK/i.test(t) || t;
});
await check('no page errors (habit streaks)', async () => hs.errs.length === 0 || hs.errs.join('\n'));
await hs.close();

await check('00:30 BST: ticking counts for the new day, not yesterday', async () => {
  const o = await open('habit-streaks', { storage: { habits: JSON.stringify([{ id: 'h', name: 'Late night', days: [] }]) }, fixedTime: '2026-07-01T23:30:00Z' });
  await o.page.click('.habit .check'); await o.page.waitForTimeout(200);
  const days = JSON.parse(await o.page.evaluate(() => window.myllmStorage.getItem('habits')))[0].days; await o.close();
  return JSON.stringify(days) === '["2026-07-02"]' || JSON.stringify(days);
});
await check('empty: mentions that sessions from other apps count', async () => {
  const o = await open('habit-streaks'); const t = await o.page.evaluate(() => document.body.innerText); await o.close();
  return t.includes('Box Breathing and Stretch are counted here too') || t;
});

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
