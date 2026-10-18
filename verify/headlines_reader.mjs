// Headlines: a tapped story opens in the in-app reader, not the browser.
//
// verify_app.mjs proves Headlines boots and stays in the sandbox. This drives
// the taps that matter in order: the lead story and a card open the reader with
// the ARTICLE in it; a publisher's 403 reads as a refusal with the feed summary;
// a feed that carries the whole body is read without a fetch; the lean dot
// still opens the coverage sheet and a coverage card opens the reader over it;
// a playable video still opens the video sheet. The extractor itself is News's
// and is covered by news_reader.mjs on the same synthetic fixtures.
//
//   node headlines_reader.mjs
import { webkit } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(HERE, '..', 'apps-src', 'rss-dashboard.html'), 'utf8');
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const pages = {
  'https://shape.test/deep-wrappers': await readFile(path.join(HERE, 'fixtures', 'news', 'deep-wrappers.html'), 'utf8'),
  'https://shape.test/native-ad': await readFile(path.join(HERE, 'fixtures', 'news', 'native-ad.html'), 'utf8'),
};
const ago = h => new Date(Date.now() - h * 3600e3).toUTCString();
const rss = items => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>${items}</channel></rss>`;
const BBC = rss(`
<item><title>Spy agencies reshaped after decades of growth</title><link>https://shape.test/deep-wrappers</link><pubDate>${ago(1)}</pubDate>
  <description>Feed summary of the lead story.</description><media:thumbnail url="${PIXEL}"/></item>
<item><title>Phone maker gets the aspect ratio wrong</title><link>https://shape.test/native-ad</link><pubDate>${ago(2)}</pubDate>
  <description>Feed summary of the phone story.</description><media:thumbnail url="${PIXEL}"/></item>
<item><title>Refused by the publisher</title><link>https://blocked.test/story</link><pubDate>${ago(3)}</pubDate>
  <description>A summary of the story the publisher will not let us read.</description><media:thumbnail url="${PIXEL}"/></item>
<item><title>Whole body in the feed</title><link>https://fullfeed.test/story</link><pubDate>${ago(4)}</pubDate>
  <description>Short summary.</description><media:thumbnail url="${PIXEL}"/>
  <content:encoded><![CDATA[<article><p>${'This paragraph came from content encoded in the feed itself, so the reader never needed to fetch the page at all. '.repeat(6)}</p><p>${'A second paragraph, also straight from the feed, long enough to qualify as prose under the extractor rules. '.repeat(4)}</p></article>]]></content:encoded></item>
<item><title>Watch: harbour storm footage</title><link>https://www.theguardian.com/world/video/2026/oct/18/storm</link><pubDate>${ago(5)}</pubDate>
  <description>Video.</description><media:thumbnail url="${PIXEL}"/></item>`);
// Another channel on the coverage panel carrying the lead story.
const GUARDIAN = rss(`
<item><title>Spy agencies reshaped after decades of growth, insiders say</title><link>https://shape.test/native-ad</link><pubDate>${ago(1)}</pubDate>
  <description>The Guardian's take.</description><media:thumbnail url="${PIXEL}"/></item>`);

const tmp = path.join(HERE, '_tmp');
await mkdir(tmp, { recursive: true });
const stub = path.join(tmp, 'headlines_net.js');
await writeFile(stub, `(() => {
  const BBC = ${JSON.stringify(BBC)}, GUARDIAN = ${JSON.stringify(GUARDIAN)}, EMPTY = ${JSON.stringify(rss(''))};
  const SITES = ${JSON.stringify(pages)};
  window.__fetched = []; window.__shared = [];
  window.myllmFetch = (url) => {
    window.__fetched.push(String(url));
    return new Promise(r => setTimeout(() => {
      const u = String(url);
      if (u === 'https://feeds.bbci.co.uk/news/rss.xml') return r({ ok: true, status: 200, headers: {}, body: BBC });
      if (u === 'https://www.theguardian.com/uk/rss') return r({ ok: true, status: 200, headers: {}, body: GUARDIAN });
      if (/rss|feed|xml/i.test(u) && !SITES[u]) return r({ ok: true, status: 200, headers: {}, body: EMPTY });
      if (u.startsWith('https://blocked.test')) return r({ ok: false, status: 403, headers: {}, body: '' });
      if (SITES[u]) return r({ ok: true, status: 200, headers: {}, body: SITES[u] });
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
const errs = [], popups = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error' || /Failed to load resource/i.test(m.text())) return;
  errs.push('console.error: ' + m.text());
});
context.on('page', p => popups.push(p.url()));
page.on('framenavigated', f => { if (f === page.mainFrame() && f.url() !== 'about:blank') popups.push('nav:' + f.url()); });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(900);

let fails = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r === true) { console.log('ok  ', name); return; }
        fails++; console.log('FAIL', name, '->', r); }
  catch (e) { fails++; console.log('FAIL', name, '->', e.message); }
};
const story = t => page.locator('a.hero, a.card', { hasText: t }).first();
const open = async t => { await story(t).click(); await page.waitForTimeout(500); };
const artText = () => page.locator('#art').innerText();
const readerOn = async () => (await page.locator('#reader.on').count()) === 1;
const back = async () => { await page.locator('#rBack').click(); await page.waitForTimeout(150); };

await check('the wall shows the stories', async () =>
  (await page.locator('a.hero').count()) === 1 && (await page.locator('a.card').count()) >= 4
  || `hero=${await page.locator('a.hero').count()} cards=${await page.locator('a.card').count()}`);

// ---- the lead story ----
await open('Spy agencies reshaped');
await check('tapping the lead story opens the reader in the app', async () => (await readerOn()) || 'reader did not open');
await check('...with the whole article, not the feed summary', async () => {
  const t = await artText();
  return (t.includes('The first duty of a government') && t.includes('collection was never the constraint')
       && !t.includes('Feed summary of the lead story')) || 'got:\n' + t.slice(0, 300);
});
await check('...without the furniture around it', async () => {
  const t = await artText();
  const bad = ['Related stories', 'Sign up for our morning briefing', 'Most read'].filter(n => t.includes(n));
  return bad.length === 0 || 'leaked: ' + bad;
});
await check('...the bar names the outlet and the byline carries its lean', async () => {
  const site = await page.locator('#rSite').innerText();
  const lean = await page.locator('#art .byline .mini').count();
  return (/bbc/i.test(site) && lean === 1) || `site="${site}" lean=${lean}`;
});
await check('...and nothing left the app', async () => popups.length === 0 || 'navigated: ' + popups.join(', '));
await check('the original is one tap away, readable, and leaves for Safari', async () => {
  const r = await page.evaluate(() => {
    const a = document.querySelector('#art a.open');
    if (!a) return null;
    const cs = getComputedStyle(a);
    const rgb = s => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
                       return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const L1 = lum(rgb(cs.color)), L2 = lum(rgb(cs.backgroundColor));
    return { href: a.getAttribute('href'), target: a.getAttribute('target'), text: a.textContent.trim(),
             ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) };
  });
  if (!r) return 'no button';
  return (r.href === 'https://shape.test/deep-wrappers' && r.target === '_top' && r.ratio >= 3 && /BBC/.test(r.text))
    || JSON.stringify(r);
});
await page.screenshot({ path: path.join(HERE, 'out', 'headlines_reader.png') });
await back();
await check('back returns to the wall', async () => (!(await readerOn())) || 'reader still open');
await check('...and the wall scrolls again', async () =>
  (await page.evaluate(() => document.body.style.overflow)) === '' || 'body still locked');

// ---- a card ----
await open('Phone maker');
await check('a card opens the reader too, advert left out', async () => {
  const t = await artText();
  return (t.includes('they got the aspect ratio wrong') && !t.includes('native ad')) || 'got:\n' + t.slice(0, 300);
});
await back();

// ---- refused ----
await open('Refused by the publisher');
await check('a 403 reads as the publisher refusing, with the feed summary', async () => {
  const t = await artText();
  return (t.includes('doesn’t let apps read') && t.includes('A summary of the story')) || 'said: ' + t.slice(0, 200);
});
await check('...and still offers the original', async () => (await page.locator('#art a.open').count()) === 1 || 'no link out');
await back();

// ---- content:encoded ----
await page.evaluate(() => { window.__fetched = []; });
await open('Whole body in the feed');
await check('a feed that carries the body is read without fetching the page', async () => {
  const f = await page.evaluate(() => window.__fetched);
  const t = await artText();
  return (f.length === 0 && t.includes('came from content encoded in the feed')) || 'fetched ' + JSON.stringify(f);
});
await check('A+ resizes the article and remembers it', async () => {
  const before = await page.evaluate(() => getComputedStyle(document.querySelector('#art p')).fontSize);
  await page.locator('#rBigger').click(); await page.locator('#rBigger').click();
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => getComputedStyle(document.querySelector('#art p')).fontSize);
  const saved = await page.evaluate(() => window.myllmStorage.getItem('readSize'));
  return (parseFloat(after) === parseFloat(before) + 2 && saved === '19') || `${before} -> ${after}, stored ${saved}`;
});
await check('share hands over the headline and the link', async () => {
  await page.locator('#rShare').click(); await page.waitForTimeout(120);
  const s = await page.evaluate(() => window.__shared[0] || '');
  return (s.includes('Whole body in the feed') && s.includes('https://fullfeed.test/story')) || 'shared: ' + s;
});
await back();

// ---- video keeps its own sheet ----
await open('harbour storm');
await check('a playable video still opens the video sheet, not the reader', async () => {
  const sheet = await page.locator('#ovl .sh-t', { hasText: 'Video' }).count();
  return (sheet === 1 && !(await readerOn())) || `video sheet=${sheet} reader=${await readerOn()}`;
});
await page.evaluate(() => closeCoverage());

// ---- lean dot → coverage → reader over the sheet ----
await page.locator('a.hero .lean').click();
await page.waitForTimeout(900);
await check('the lean dot still opens the coverage sheet, not the reader', async () =>
  ((await page.locator('#ovl').count()) === 1 && !(await readerOn())) || 'sheet/reader state wrong');
const cvg = page.locator('#ovl a.cvg').first();
if (await cvg.count()) {
  await cvg.click(); await page.waitForTimeout(500);
  await check('a coverage card opens the reader over the sheet', async () => {
    const t = await artText();
    return ((await readerOn()) && t.includes('they got the aspect ratio wrong')
      && /guardian/i.test(await page.locator('#rSite').innerText())) || 'got: ' + t.slice(0, 120);
  });
  await back();
  await check('...and back lands on the sheet, still locked behind it', async () =>
    ((await page.locator('#ovl').count()) === 1
      && (await page.evaluate(() => document.body.style.overflow)) === 'hidden') || 'sheet gone or page unlocked');
} else {
  fails++; console.log('FAIL the coverage sheet found no matching story for the lead (fixture match)');
}
await check('no tap navigated away or opened a window', async () => popups.length === 0 || popups.join(', '));
await check('no page errors anywhere in the run', async () => errs.length === 0 || errs.join(' | '));

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall clean');
process.exit(fails ? 1 : 0);
