// E-Grid: a headline opens in the in-app reader, not the browser — except for
// the outlets that refuse apps, which still open on their own site.
//
// The app boots on a channels.json stub whose F1 feeds are one reader-friendly
// outlet (The Race shape: content:encoded), one that serves its page
// (DirtFish shape: fetched, News's deep-wrappers fixture) and Motorsport.com
// (403 to apps). The extractor itself is News's and is covered by
// news_reader.mjs; this checks E-Grid's wiring around it.
//
//   node egrid_reader.mjs
import { webkit } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(HERE, '..', 'apps-src', 'e-grid.html'), 'utf8');
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const page1 = await readFile(path.join(HERE, 'fixtures', 'news', 'deep-wrappers.html'), 'utf8');
const ago = h => new Date(Date.now() - h * 3600e3).toUTCString();
const rss = items => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>${items}</channel></rss>`;
const RACE = rss(`<item><title>Verstappen hype explained</title><link>https://www.the-race.com/formula-1/hype/</link><pubDate>${ago(1)}</pubDate>
  <description>Short.</description><media:thumbnail url="${PIXEL}"/>
  <content:encoded><![CDATA[<p>${'This paragraph came from content encoded in the feed itself, so the reader never needed to fetch the page at all. '.repeat(6)}</p><p>${'A second paragraph, also straight from the feed, long enough to qualify as prose under the extractor rules. '.repeat(4)}</p>]]></content:encoded></item>`);
const DIRT = rss(`<item><title>Latvala wants new events</title><link>https://dirtfish.com/rally/wrc/latvala/</link><pubDate>${ago(2)}</pubDate>
  <description>Short.</description><media:thumbnail url="${PIXEL}"/></item>`);
const MSPORT = rss(`<item><title>When can Mercedes become champions</title><link>https://www.motorsport.com/f1/news/mercedes/123/</link><pubDate>${ago(3)}</pubDate>
  <description>Short.</description><media:thumbnail url="${PIXEL}"/></item>
<item><title>A new outlet that refuses</title><link>https://refuser.test/story</link><pubDate>${ago(4)}</pubDate><description>Short.</description></item>`);
const CHANNELS = JSON.stringify({ channels: [{ id: 'f1', name: 'Formula 1', tagline: 't', accentHex: 'E10600', hasStandings: false, comingSoon: false,
  calendar: [{ round: 1, name: 'Test GP', location: 'Somewhere', date: '2026-12-01' }],
  feeds: [{ name: 'The Race', url: 'https://feed.test/race' }, { name: 'DirtFish', url: 'https://feed.test/dirt' },
          { name: 'Motorsport.com F1', url: 'https://feed.test/msport' }] }] });

const tmp = path.join(HERE, '_tmp');
await mkdir(tmp, { recursive: true });
const stub = path.join(tmp, 'egrid_net.js');
await writeFile(stub, `(() => {
  const R = { 'https://feed.test/race': ${JSON.stringify(RACE)}, 'https://feed.test/dirt': ${JSON.stringify(DIRT)},
              'https://feed.test/msport': ${JSON.stringify(MSPORT)}, 'https://dirtfish.com/rally/wrc/latvala/': ${JSON.stringify(page1)} };
  const CH = ${JSON.stringify(CHANNELS)};
  window.__fetched = []; window.__shared = [];
  window.myllmFetch = (url) => {
    const u = String(url); window.__fetched.push(u);
    return new Promise(r => setTimeout(() => {
      if (u.endsWith('/channels.json')) return r({ ok: true, status: 200, headers: {}, body: CH });
      if (R[u]) return r({ ok: true, status: 200, headers: {}, body: R[u] });
      if (/refuser\\.test/.test(u)) return r({ ok: false, status: 403, headers: {}, body: '' });
      return r({ ok: false, status: 404, headers: {}, body: '' });
    }, 15));
  };
  window.myllmShare = (t) => { window.__shared.push(String(t)); return Promise.resolve(null); };
})();`, 'utf8');

const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
await context.addInitScript({ path: stub });
const page = await context.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push('console.error: ' + m.text()); });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(1200);

let fails = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r === true) { console.log('ok  ', name); return; }
        fails++; console.log('FAIL', name, '->', r); }
  catch (e) { fails++; console.log('FAIL', name, '->', e.message); }
};
const readerOn = async () => (await page.locator('#reader.on').count()) === 1;
const artText = () => page.locator('#art').innerText();
// Whether a tap was left to the browser: the app never calls preventDefault.
const tapLeftAlone = t => page.evaluate(t => {
  const a = [...document.querySelectorAll('a.news')].find(n => n.textContent.includes(t));
  if (!a) return 'no such headline';
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
  a.dispatchEvent(ev);
  return !ev.defaultPrevented;
}, t);

await page.locator('[data-act="tab"][data-tab="news"]').first().click();
await page.waitForTimeout(800);
await check('the News tab lists the headlines', async () =>
  (await page.locator('a.news').count()) === 4 || 'headlines: ' + await page.locator('a.news').count());

await page.locator('a.news', { hasText: 'Latvala' }).click(); await page.waitForTimeout(500);
await check('a fetched story opens in the reader with the whole article', async () => {
  const t = await artText();
  return ((await readerOn()) && t.includes('The first duty of a government') && t.includes('collection was never the constraint'))
    || 'got: ' + t.slice(0, 200);
});
await check('...the bar names the outlet', async () => /^dirtfish$/i.test(await page.locator('#rSite').innerText()) || await page.locator('#rSite').innerText());
await check('...and the original is one readable tap away', async () => {
  const r = await page.evaluate(() => {
    const a = document.querySelector('#art a.open'); if (!a) return null;
    const cs = getComputedStyle(a), rgb = s => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const L1 = lum(rgb(cs.color)), L2 = lum(rgb(cs.backgroundColor));
    return { href: a.getAttribute('href'), target: a.getAttribute('target'), ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) };
  });
  return (r && r.href === 'https://dirtfish.com/rally/wrc/latvala/' && r.target === '_top' && r.ratio >= 3) || JSON.stringify(r);
});
await page.screenshot({ path: path.join(HERE, 'out', 'egrid_reader.png') });
await page.locator('#rBack').click(); await page.waitForTimeout(150);
await check('back returns to the list', async () => !(await readerOn()) || 'still open');

await page.evaluate(() => { window.__fetched = []; });
await page.locator('a.news', { hasText: 'Verstappen' }).click(); await page.waitForTimeout(400);
await check('a feed that carries the body is read without fetching the page', async () => {
  const f = await page.evaluate(() => window.__fetched);
  return (f.length === 0 && (await artText()).includes('came from content encoded')) || 'fetched ' + JSON.stringify(f);
});
await check('A+ resizes and is remembered', async () => {
  await page.locator('#rBigger').click(); await page.waitForTimeout(100);
  const fs = await page.evaluate(() => getComputedStyle(document.querySelector('#art p')).fontSize);
  const saved = await page.evaluate(() => window.myllmStorage.getItem('egrid1:readSize'));
  return (fs === '18px' && saved === '18') || `font ${fs}, stored ${saved}`;
});
await check('share hands over the headline and the link', async () => {
  await page.locator('#rShare').click(); await page.waitForTimeout(100);
  const s = await page.evaluate(() => window.__shared[0] || '');
  return s.includes('Verstappen hype explained') && s.includes('the-race.com') || 'shared: ' + s;
});
await check('the full body is not written into saved storage', async () => {
  const saved = await page.evaluate(() => window.myllmStorage.getItem('egrid1:news'));
  return !String(saved || '').includes('content encoded in the feed') || 'feed body leaked into egrid1:news';
});
await page.locator('#rBack').click(); await page.waitForTimeout(150);

// Motorsport.com is no longer special-cased: Apple's stack gets its pages (18 Oct).
await check('a Motorsport.com story opens in the reader like any other', async () =>
  (await tapLeftAlone('When can Mercedes')) === false || 'the tap was left to the browser');
await page.locator('#rBack').click(); await page.waitForTimeout(150);

await page.locator('a.news', { hasText: 'A new outlet' }).click(); await page.waitForTimeout(400);
await check('an unknown outlet that refuses gets a plain note and the link', async () => {
  const t = await artText();
  return (t.includes('doesn’t let apps read') && (await page.locator('#art a.open').count()) === 1) || t.slice(0, 160);
});
await page.locator('#rBack').click(); await page.waitForTimeout(150);
await check('...and the next tap on it goes straight to the site', async () =>
  (await tapLeftAlone('A new outlet')) === true || 'reader took the tap again');
await check('...remembered across launches', async () => {
  const saved = await page.evaluate(() => window.myllmStorage.getItem('egrid1:refuses'));
  return String(saved).includes('refuser.test') || 'stored: ' + saved;
});

// Series page → News segment uses the same rows.
await page.locator('[data-act="tab"][data-tab="series"]').first().click(); await page.waitForTimeout(300);
await page.locator('[data-act="channel"][data-ch="f1"]').first().click(); await page.waitForTimeout(300);
await page.locator('[data-act="seg"][data-seg="news"]').first().click(); await page.waitForTimeout(500);
await page.locator('a.news', { hasText: 'Latvala' }).click(); await page.waitForTimeout(400);
await check('a series page headline opens the reader too', async () => (await readerOn()) && (await artText()).includes('The first duty') || 'no reader');
await page.locator('#rBack').click();

await check('no page errors anywhere in the run', async () => errs.length === 0 || errs.join(' | '));
await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall clean');
process.exit(fails ? 1 : 0);
