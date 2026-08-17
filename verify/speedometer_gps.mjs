/* Speedometer GPS connection state machine — the one app whose whole job is to
 * behave well when the signal is bad, so it gets its own harness.
 *
 * verify_app.mjs answers "does it boot and stay in the sandbox". It cannot
 * answer "what does it do 18 seconds into a tunnel", because that needs a fake
 * clock and a bridge you can break on purpose. Everything asserted here is a
 * failure mode that was actually reachable:
 *   - a myllmLocation promise that never settled wedged the app shut for good
 *   - iOS replaying a cached fix kept a healthy green dot over a dead signal
 *   - nothing on screen moved during the 10-20s of a cold start
 *
 * Two suites, because both bridge generations are in users' hands:
 *   POLLING — MyLLM <= 4.5.5, no myllmLocation.watch()
 *   WATCH   — MyLLM >= 4.5.6, live stream + fallback when it disappoints
 *
 * Run:  node speedometer_gps.mjs        (from myllm-assets/verify)
 * Exit: 0 = all green, 1 = at least one assertion failed.
 */
import { webkit } from 'playwright';

const APP = new URL('../apps-src/speedometer.html', import.meta.url).pathname;
const T0 = new Date('2026-08-17T10:00:00Z');

let fails = 0, passes = 0;
const ok = (name, cond, extra = '') => cond
  ? (passes++, console.log(`  ✓ ${name}`))
  : (fails++, console.log(`  ✗ ${name}   ${extra}`));

const browser = await webkit.launch();
const tick = async (p, ms) => { await p.clock.runFor(ms); await p.waitForTimeout(30); };

async function open(initScript) {
  const page = await browser.newPage();
  await page.clock.install({ time: T0 });
  await page.addInitScript(initScript);
  await page.goto('file://' + APP);
  return page;
}

// ───────────────────────── suite 1: polling (<= 4.5.5) ─────────────────────────
// A bridge with NO watch(), whose current() can be told to hang, succeed, replay
// a cached fix, or reject.
console.log('\n══ POLLING PATH (MyLLM <= 4.5.5, no watch) ══');
{
  const page = await open(() => {
    window.__gps = { mode: 'hang', calls: 0, lat: 51.5, lon: -0.12, acc: 12,
                     err: 'no fix', frozenT: 0, speed: null };
    window.myllmHaptic = () => {};
    window.myllmLocation = {
      current() {
        const g = window.__gps; g.calls++;
        if (g.mode === 'hang') return new Promise(() => {});          // never settles
        if (g.mode === 'error') return Promise.reject(new Error(g.err));
        if (g.mode === 'cached') {                                    // iOS replays one fix
          if (!g.frozenT) g.frozenT = Date.now();
          return Promise.resolve({ latitude: g.lat, longitude: g.lon, accuracy: g.acc,
                                   speed: 0, course: -1, timestamp: g.frozenT });
        }
        g.frozenT = 0;
        return Promise.resolve({ latitude: g.lat, longitude: g.lon, accuracy: g.acc,
                                 speed: g.speed == null ? -1 : g.speed, course: -1,
                                 timestamp: Date.now() });
      },
      search: () => Promise.resolve([]), reverse: () => Promise.resolve({ address: '' }),
    };
  });

  const dot = () => page.getAttribute('#gpsDot', 'class');
  const txt = () => page.textContent('#gpsTxt');
  const hint = () => page.textContent('#hint');
  const speed = () => page.textContent('#speedV');
  const calls = () => page.evaluate(() => window.__gps.calls);
  const set = (o) => page.evaluate((o) => Object.assign(window.__gps, o), o);

  console.log('\nboot');
  await tick(page, 50);
  ok('idle dot is neutral', (await dot()) === 'gpsdot', await dot());
  ok('idle status reads "GPS off"', (await txt()) === 'GPS off', await txt());
  ok('idle hint invites a start', /Tap Start/.test(await hint()), await hint());

  console.log('\nstart against a bridge that never answers');
  await page.click('#goBtn');
  await tick(page, 1500);
  ok('dot pulses "search" immediately', /search/.test(await dot()), await dot());
  ok('status counts the search up', /searching \d+s/.test(await txt()), await txt());
  ok('hint explains the wait', /Acquiring GPS/.test(await hint()), await hint());
  ok('speed shows — not a fake 0', (await speed()) === '—', await speed());
  const c1 = await calls();
  await tick(page, 9500);
  ok('one request outstanding, not spammed', (await calls()) === c1, `${c1} → ${await calls()}`);
  ok('copy escalates after ~10s', /sky/i.test(await hint()), await hint());
  await tick(page, 4000);                                  // watchdog (12s) fires
  ok('WATCHDOG: a hung promise does not wedge polling', (await calls()) > c1,
     `calls stuck at ${await calls()}`);

  console.log('\nsignal arrives');
  await set({ mode: 'ok', acc: 12 });
  await tick(page, 15000);                                 // worst case: one more watchdog
  ok('dot goes green', /\bok\b/.test(await dot()), await dot());
  ok('accuracy is shown', /±\d+m/.test(await txt()), await txt());

  console.log('\nmoving north, ~33 m per 2s poll (~60 km/h)');
  for (let i = 0; i < 15; i++) {
    await set({ lat: 51.5 + (i + 1) * 0.0003 });
    await tick(page, 2000);
  }
  const kmh = parseFloat(await speed());
  ok('derives a plausible speed with no native reading', kmh > 40 && kmh < 80, `${kmh} km/h`);

  console.log('\nsignal dies but iOS keeps replaying a cached fix');
  await set({ mode: 'cached' });
  await tick(page, 2500);                                  // last live fix lands, then freezes
  await tick(page, 7000);
  ok('CACHE: dot leaves green even though every call succeeds', !/\bok\b/.test(await dot()), await dot());
  ok('status says reacquiring', (await txt()) === 'reacquiring', await txt());
  ok('reading is dimmed as stale', await page.evaluate(
     () => document.querySelector('.readout').classList.contains('stale')));
  await tick(page, 13000);
  ok('after ~18s it admits no signal', (await txt()) === 'no signal', await txt());
  ok('speed refuses to lie', (await speed()) === '—', await speed());
  ok('hint names the cached-position case', /old position/i.test(await hint()), await hint());

  console.log('\nsignal returns');
  await set({ mode: 'ok', lat: 51.52, acc: 10 });
  await tick(page, 6000);
  ok('RECONNECT: back to green on its own', /\bok\b/.test(await dot()), await dot());
  ok('no teleport speed across the gap', parseFloat(await speed()) < 200, await speed());
  const dist = parseFloat(await page.textContent('#tDist'));
  ok('trip distance did not bridge the hole', dist < 5, `${dist} km`);

  console.log('\npermission refused');
  await set({ mode: 'error', err: 'Location access for apps is turned off in MyLLM Settings.' });
  await tick(page, 4000);
  ok('dot goes red, status "blocked"', (await txt()) === 'blocked', await txt());
  ok('hint is actionable', /Settings/.test(await hint()), await hint());
  const c2 = await calls();
  await tick(page, 15000);
  ok('stops hammering a refused permission', (await calls()) === c2, `${c2} → ${await calls()}`);

  console.log('\nretry after fixing the setting');
  await set({ mode: 'ok' });
  await page.click('#goBtn');                              // pause
  await page.click('#goBtn');                              // start again
  await tick(page, 3000);
  ok('Start clears the blocked state', /\bok\b/.test(await dot()), await dot());

  console.log('\npause');
  await page.click('#goBtn');
  await tick(page, 3000);
  ok('status reads paused', (await txt()) === 'paused', await txt());
  await page.close();
}

// ────────────────────────── suite 2: watch (>= 4.5.6) ──────────────────────────
// A bridge WITH watch(). __w.watchFails makes it reject; leaving __w.push unused
// makes it resolve and then deliver nothing, which is the interesting failure.
const watchBridge = () => {
  window.__w = { watchCalls: 0, currentCalls: 0, stopCalls: 0, watchFails: '', push: null };
  window.myllmHaptic = () => {};
  window.myllmLocation = {
    current() {
      window.__w.currentCalls++;
      return Promise.resolve({ latitude: 51.5, longitude: -0.12, accuracy: 14,
                               speed: -1, course: -1, timestamp: Date.now() });
    },
    watch(cb, opts) {
      const w = window.__w; w.watchCalls++; w.opts = opts;
      if (w.watchFails) return Promise.reject(new Error(w.watchFails));
      w.push = (fix) => cb(fix);
      return Promise.resolve({ watching: true });
    },
    stop() { window.__w.stopCalls++; window.__w.push = null; return Promise.resolve({ watching: false }); },
    search: () => Promise.resolve([]), reverse: () => Promise.resolve({ address: '' }),
  };
};
const push = (p, fix) => p.evaluate((f) => window.__w.push && window.__w.push(
  Object.assign({ latitude: 51.5, longitude: -0.12, accuracy: 10, course: -1,
                  timestamp: Date.now() }, f)), fix);
const w = (p) => p.evaluate(() => window.__w);

console.log('\n══ WATCH PATH (MyLLM >= 4.5.6) ══');
console.log('\nprefers the live watch over polling');
{
  const p = await open(watchBridge);
  await p.click('#goBtn');
  await tick(p, 3000);
  const s = await w(p);
  ok('watch() called once', s.watchCalls === 1, `${s.watchCalls}`);
  ok('asks for navigation-grade accuracy', s.opts?.accuracy === 'best', JSON.stringify(s.opts));
  ok('does NOT poll current() as well', s.currentCalls === 0, `${s.currentCalls} polls`);
  ok('shows searching until the first fix', /searching/.test(await p.textContent('#gpsTxt')));

  // the chip's own Doppler speed — the whole reason watch() exists
  await push(p, { speed: 25 });
  await tick(p, 600);
  ok('uses the native speed reading', Math.round(parseFloat(await p.textContent('#speedV'))) === 90,
     `${await p.textContent('#speedV')} (25 m/s should read 90)`);
  ok('dot is green', /\bok\b/.test(await p.getAttribute('#gpsDot', 'class')));

  console.log('\nstream goes quiet, then comes back');
  await tick(p, 7000);
  ok('reacquiring while quiet', (await p.textContent('#gpsTxt')) === 'reacquiring',
     await p.textContent('#gpsTxt'));
  await tick(p, 13000);
  ok('admits no signal after ~18s', (await p.textContent('#gpsTxt')) === 'no signal',
     await p.textContent('#gpsTxt'));
  ok('speed refuses to lie', (await p.textContent('#speedV')) === '—');
  ok('has not given up on the watch yet', (await w(p)).currentCalls === 0);
  await push(p, { speed: 30 });
  await tick(p, 600);
  ok('recovers on the next fix, no restart needed', /\bok\b/.test(await p.getAttribute('#gpsDot', 'class')));

  console.log('\npause releases the GPS');
  await p.click('#goBtn');
  await tick(p, 500);
  ok('calls myllmLocation.stop()', (await w(p)).stopCalls === 1, `${(await w(p)).stopCalls}`);
  ok('status reads paused', (await p.textContent('#gpsTxt')) === 'paused');
  await p.close();
}

console.log('\na watch that never delivers falls back to polling');
{
  const p = await open(watchBridge);
  await p.click('#goBtn');
  await p.evaluate(() => { window.__w.push = null; });    // resolved, but silent
  await tick(p, 10000);
  ok('still on the watch inside the grace period', (await w(p)).currentCalls === 0);
  await tick(p, 7000);                                    // past WATCH_GRACE (15s)
  ok('FALLBACK: drops to polling current()', (await w(p)).currentCalls > 0,
     `${(await w(p)).currentCalls} polls`);
  ok('releases the dead watch', (await w(p)).stopCalls === 1);
  await tick(p, 3000);
  ok('and recovers a fix that way', /\bok\b/.test(await p.getAttribute('#gpsDot', 'class')),
     await p.getAttribute('#gpsDot', 'class'));
  await p.close();
}

console.log('\nwatch rejected outright');
{
  const p = await open(watchBridge);
  await p.evaluate(() => { window.__w.watchFails = 'Something went wrong.'; });
  await p.click('#goBtn');
  await tick(p, 3000);
  ok('falls straight through to polling', (await w(p)).currentCalls > 0);
  ok('and still gets a fix', /\bok\b/.test(await p.getAttribute('#gpsDot', 'class')));
  await p.close();
}

console.log('\nwatch refused on permission grounds');
{
  const p = await open(watchBridge);
  await p.evaluate(() => {
    window.__w.watchFails = 'Location access for apps is turned off in MyLLM Settings.';
  });
  await p.click('#goBtn');
  await tick(p, 4000);
  ok('reports blocked, not "no signal"', (await p.textContent('#gpsTxt')) === 'blocked',
     await p.textContent('#gpsTxt'));
  ok('does not poll a refused permission', (await w(p)).currentCalls === 0,
     `${(await w(p)).currentCalls} polls`);
  await p.close();
}

console.log('\nstream errors after it started');
{
  const p = await open(watchBridge);
  await p.click('#goBtn');
  await tick(p, 1500);
  await push(p, {});
  await tick(p, 600);
  await p.evaluate(() => window.__w.push({ error: 'Location access is denied. Enable it in Settings.' }));
  await tick(p, 1000);
  ok('a mid-stream denial surfaces as blocked', (await p.textContent('#gpsTxt')) === 'blocked',
     await p.textContent('#gpsTxt'));
  await p.close();
}

await browser.close();
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
