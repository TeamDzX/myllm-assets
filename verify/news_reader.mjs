// News: the reader, end to end.
//
// verify_app.mjs proves the app boots and stays in the sandbox under a blind tap
// sweep. It cannot prove that tapping a headline produces the ARTICLE rather
// than the RSS blurb, that a publisher's 403 reads as an explanation rather than
// a bug, or that an advert sitting inside the article does not end up in the
// body. Those need real pages driven in order, with the result read back.
//
// The fixtures in fixtures/news/ are SYNTHETIC, and deliberately so. Each one
// reproduces a DOM shape that actually broke the extractor while it was being
// written — the per-three-paragraph wrappers six levels below <article>, the
// advert that is junk-named but made of paragraphs, the page with no semantic
// markup at all. Committing 350KB of a publisher's copyrighted article instead
// would test the same three things, republish someone else's work, and rot the
// first time their top story changed.
//
//   node news_reader.mjs           # the shapes; deterministic, offline
//   node news_reader.mjs --live    # ...then spot-check five real publishers
import { webkit } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = process.argv.includes('--live');
const html = await readFile(path.join(HERE, '..', 'apps-src', 'news-feed.html'), 'utf8');

const SHAPES = {
  'https://shape.test/deep-wrappers': 'deep-wrappers.html',
  'https://shape.test/native-ad': 'native-ad.html',
  'https://shape.test/no-article-tag': 'no-article-tag.html',
};
// A 1x1 gif as a data: URL: it loads with no network, so a missing thumbnail in
// the DOM means the feed was not PARSED, not that the image 404'd.
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const pages = {};
for (const [u, f] of Object.entries(SHAPES)) pages[u] = await readFile(path.join(HERE, 'fixtures', 'news', f), 'utf8');

const FEED = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
${Object.keys(SHAPES).map((u, i) => `<item>
  <title>Shape ${i}</title><link>${u}</link>
  <pubDate>${new Date(Date.now() - (i + 1) * 3600e3).toUTCString()}</pubDate>
  <description>Feed summary number ${i}, which is all RSS gives you.</description>
  <media:thumbnail url="${PIXEL}"/>
</item>`).join('\n')}
<item><title>Refused by the publisher</title><link>https://blocked.test/story</link>
  <pubDate>${new Date().toUTCString()}</pubDate>
  <description>A summary of the story the publisher will not let us read.</description></item>
<item><title>Whole body in the feed</title><link>https://fullfeed.test/story</link>
  <pubDate>${new Date().toUTCString()}</pubDate><description>Short summary.</description>
  <content:encoded><![CDATA[<article><p>${'This paragraph came from content encoded in the feed itself, so the reader never needed to fetch the page at all. '.repeat(6)}</p><p>${'A second paragraph, also straight from the feed, long enough to qualify as prose under the extractor rules. '.repeat(4)}</p></article>]]></content:encoded>
</item>
</channel></rss>`;

// The network stub has to ride on the CONTEXT, as a file. A page-level
// addInitScript does not land under setContent, and bridges.js — added first —
// would otherwise win with its deliberate "Network unavailable" rejection.
const tmp = path.join(HERE, '_tmp');
await mkdir(tmp, { recursive: true });
const stub = path.join(tmp, 'news_net.js');
await writeFile(stub, `(() => {
  const FEED = ${JSON.stringify(FEED)};
  const SITES = ${JSON.stringify(pages)};
  window.__fetched = []; window.__shared = [];
  window.myllmFetch = (url) => {
    window.__fetched.push(String(url));
    return new Promise(r => setTimeout(() => {
      const u = String(url);
      if (u.includes('/rss') || u.includes('feed')) return r({ ok: true, status: 200, headers: {}, body: FEED });
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
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
// A remote <img> that cannot resolve is this harness having no network — the
// app's own onerror already removes it. Only JS errors are the app's fault.
page.on('console', m => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource/i.test(m.text())) return;
  errs.push('console.error: ' + m.text());
});
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(500);

let fails = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r === true) { console.log('ok  ', name); return; }
        fails++; console.log('FAIL', name, '->', r); }
  catch (e) { fails++; console.log('FAIL', name, '->', e.message); }
};
const openStory = async (i) => { await page.locator('.item').nth(i).click(); await page.waitForTimeout(600); };
const artText = () => page.locator('#art').innerText();
const back = async () => { await page.locator('#back').click(); await page.waitForTimeout(200); };
const absent = async (...needles) => {
  const t = await artText();
  const found = needles.filter(n => t.includes(n));
  return found.length === 0 || 'leaked into the article: ' + JSON.stringify(found);
};

// ---- 1. the list ------------------------------------------------------------
await check('the list shows a card per story', async () =>
  (await page.locator('.item').count()) === 5 || 'cards: ' + await page.locator('.item').count());
await check('each card carries its source and how long ago', async () => {
  const t = await page.locator('.item').first().innerText();
  return (t.includes('shape.test') && /\d+h ago/.test(t)) || 'card was: ' + t;
});
await check('media:thumbnail is parsed out of the feed', async () => {
  const got = await page.evaluate(f => parseFeed(f, 'https://x.test/rss').map(i => i.image), FEED);
  return got.filter(Boolean).length === 3 || 'images: ' + JSON.stringify(got);
});
await check('...and rendered as a thumbnail on the card', async () =>
  (await page.locator('.item .thumb').count()) === 3 || 'thumbs: ' + await page.locator('.item .thumb').count());

// ---- 2. the BBC shape: wrappers six deep, byline only in JSON-LD ------------
await openStory(0);
await check('the reader opens over the list', async () =>
  (await page.locator('#reader.on').count()) === 1 || 'reader did not open');
await check('deep wrappers: the WHOLE article body is found', async () => {
  const t = await artText();
  return (t.includes('The first duty of a government')
       && t.includes('Budgets tripled, agencies were merged')
       && t.includes('collection was never the constraint')
       && !t.includes('Feed summary number 0')) || 'got:\n' + t.slice(0, 400);
});
await check('...with its heading, picture, caption and list', async () =>
  (await page.locator('#art h3').count()) >= 1 && (await page.locator('#art figure').count()) >= 1
  && (await page.locator('#art figcaption').count()) >= 1 && (await page.locator('#art ul li').count()) === 2
  || `h3=${await page.locator('#art h3').count()} fig=${await page.locator('#art figure').count()} li=${await page.locator('#art ul li').count()}`);
await check('...and a relative image src resolved against the article URL', async () => {
  // Asserted on the extractor, not the DOM: a figure whose image fails to load
  // is removed on purpose, so the rendered page cannot answer this.
  const imgs = await page.evaluate(([h, u]) => extractArticle(h, u).blocks.filter(b => b.t === 'img').map(b => b.src),
    [await readFile(path.join(HERE, 'fixtures', 'news', 'deep-wrappers.html'), 'utf8'), 'https://shape.test/deep-wrappers']);
  return imgs.includes('https://shape.test/img/towers.jpg') || 'srcs: ' + JSON.stringify(imgs);
});
await check('...and none of the furniture around it', async () =>
  absent('Related stories', 'Sign up for our morning briefing', 'All rights reserved',
         'Are you personally affected', 'Most read'));
await check('the byline comes out of schema.org JSON-LD', async () => {
  // The BBC carries its byline ONLY there — no meta tag, no class name has it.
  const t = await page.locator('.byline').innerText();
  return (t.includes('Frank Gardner') && t.includes('ago') && t.includes('shape.test')) || 'byline: ' + t;
});
await check('the original is one tap away, and leaves for Safari', async () => {
  const a = page.locator('#art a.open');
  return ((await a.getAttribute('href')) === 'https://shape.test/deep-wrappers'
       && (await a.getAttribute('target')) === '_top') || 'href: ' + await a.getAttribute('href');
});
await back();
await check('back returns to the list', async () =>
  (await page.locator('#reader.on').count()) === 0 || 'reader still open');

// ---- 3. an advert inside the article ---------------------------------------
await openStory(1);
await check('native ad: the body is there', async () => {
  const t = await artText();
  return (t.includes('they got the aspect ratio wrong') && t.includes('clearly a product person')) || 'got:\n' + t.slice(0, 300);
});
await check('...the advert is not', async () => absent('This is the title for the native ad', '/sponsored'));
await check('...and repeated newsletter furniture appears at most once', async () => {
  const t = await artText();
  const n = t.split('Posts from this topic').length - 1;
  return n === 0 || 'the newsletter line is in the article ' + n + ' time(s)';
});
await back();

// ---- 4. a page with no semantic markup at all -------------------------------
await openStory(2);
await check('no <article> tag: density still finds the prose', async () => {
  const t = await artText();
  return (t.includes('Some sites still ship a page built entirely from unnamed divs')
       && t.includes('this is the fixture that will notice')) || 'got:\n' + t.slice(0, 300);
});
await check('...without the navigation around it', async () =>
  absent('Most read', 'Trending', 'paper of record'));
await back();

// ---- 5. a publisher that refuses --------------------------------------------
await openStory(3);
await check('a 403 reads as the publisher refusing, not a crash', async () => {
  const t = await artText();
  return (t.includes('doesn’t let apps read') && t.includes('A summary of the story')) || 'said: ' + t.slice(0, 200);
});
await check('...and still offers the original', async () =>
  (await page.locator('#art a.open').count()) === 1 || 'no link out');
await back();

// ---- 6. a feed that already carries the body --------------------------------
await page.evaluate(() => { window.__fetched = []; });
await openStory(4);
await check('content:encoded is read without fetching the page', async () => {
  const fetched = await page.evaluate(() => window.__fetched);
  const t = await artText();
  return (fetched.length === 0 && t.includes('came from content encoded in the feed'))
    || `fetched ${JSON.stringify(fetched)}`;
});

// ---- 7. reader controls ------------------------------------------------------
await check('A+ and A− resize the article and persist', async () => {
  const before = await page.evaluate(() => getComputedStyle(document.querySelector('#art p')).fontSize);
  await page.locator('#bigger').click(); await page.locator('#bigger').click();
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => getComputedStyle(document.querySelector('#art p')).fontSize);
  const saved = await page.evaluate(() => window.myllmStorage.getItem('readSize'));
  return (parseFloat(after) === parseFloat(before) + 2 && saved === '19') || `${before} -> ${after}, stored ${saved}`;
});
await check('share hands over the headline and the link', async () => {
  await page.locator('#share').click();
  await page.waitForTimeout(150);
  const s = await page.evaluate(() => window.__shared[0] || '');
  return (s.includes('Whole body in the feed') && s.includes('https://fullfeed.test/story')) || 'shared: ' + s;
});

await check('no page errors anywhere in the run', async () => errs.length === 0 || errs.join(' | '));

// ---- 8. optional: the real web -----------------------------------------------
if (LIVE) {
  console.log('\n--- live spot check (real publishers, needs network) ---');
  const FEEDS = {
    BBC: 'https://feeds.bbci.co.uk/news/rss.xml',
    Guardian: 'https://www.theguardian.com/world/rss',
    TechCrunch: 'https://techcrunch.com/feed/',
    Verge: 'https://www.theverge.com/rss/index.xml',
    NASA: 'https://www.nasa.gov/news-release/feed/',
  };
  const probe = await browser.newContext();
  const lp = await probe.newPage();
  await lp.setContent(html, { waitUntil: 'load' });
  // Fetch in NODE, not in the page: the page is at a null origin under
  // setContent, so its own fetch() is CORS-dead — the same wall the sandbox
  // puts up, which is why the app has myllmFetch at all.
  const grab = async (u) => {
    const r = await fetch(u, { headers: { 'Accept': '*/*' }, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  };
  for (const [name, feed] of Object.entries(FEEDS)) {
    await check(`${name}: a real article extracts`, async () => {
      let xml;
      try { xml = await grab(feed); }
      catch (e) { console.log(`     (skipped: feed — ${e.message})`); return true; }
      const item = await lp.evaluate(([x, f]) => (parseFeed(x, f).find(i => i.link) || null), [xml, feed]);
      if (!item) return 'no items in ' + feed;
      let pageHtml;
      try { pageHtml = await grab(item.link); }
      catch (e) { console.log(`     (skipped: ${new URL(item.link).hostname} — ${e.message})`); return true; }
      const r = await lp.evaluate(([h, u]) => {
        const a = extractArticle(h, u);
        return { chars: a.blocks.reduce((n, b) => n + (b.text ? b.text.length : 0), 0), author: a.author };
      }, [pageHtml, item.link]);
      console.log(`     ${r.chars} chars, byline "${r.author}"  ${item.link.slice(0, 64)}`);
      return r.chars > 900 || `only ${r.chars} chars`;
    });
  }
  await probe.close();
}

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall clean');
process.exit(fails ? 1 : 0);
