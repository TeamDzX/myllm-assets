// Follow: the LinkFindr companion, end to end.
//
// verify_app.mjs proves the app boots and stays in the sandbox. It can't prove
// that a pasted list follows the right projects, that a busy project is capped
// rather than drowning the rest, or that following starts caught up. Those need
// feeds served in order and the result read back.
//
// The feeds below are SYNTHETIC copies of the shapes real sites serve (GitHub
// Atom, a blog that announces its feed, Reddit RSS, Bluesky's untitled RSS with
// its odd date, a JSON Feed, and Instagram, which has none).
//
//   node follow.mjs           # the shapes; deterministic, offline
//   node follow.mjs --live    # ...then the suggestions and real addresses, live
import { webkit } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = process.argv.includes('--live');
const html = await readFile(path.join(HERE, '..', 'apps-src', 'follow.html'), 'utf8');

const ago = (h) => new Date(Date.now() - h * 3600e3);
const atomEntry = (i, h) => `<entry><id>tag:github.com,2008:Repository/1/b${100 + i}</id><title>b${100 + i}</title>
  <updated>${ago(h).toISOString()}</updated><link rel="alternate" type="text/html" href="https://github.com/o/busy/releases/tag/b${100 + i}"/>
  <content type="html">&lt;p&gt;Release notes ${i}&lt;/p&gt;</content></entry>`;
const ATOM = (n, offset = 0) => `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<title>Release notes from busy</title><link rel="alternate" href="https://github.com/o/busy/releases"/>
${Array.from({ length: n }, (_, i) => atomEntry(n - i + offset, i + 1)).join('\n')}</feed>`;

const BLOG_PAGE = `<!doctype html><html><head><title>Garden</title>
<link rel="alternate" type="application/rss+xml" href="/comments/feed/">
<link rel="alternate" type="application/rss+xml" title="Garden" href="/feed/"></head><body>hi</body></html>`;
const BLOG_RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<title>Garden Build</title><link>https://garden.test/</link><image><title>Not the title</title></image>
<item><title>Raised beds &amp; paths</title><link>https://garden.test/beds</link><guid>beds</guid>
<pubDate>${ago(30).toUTCString()}</pubDate><description><![CDATA[<p>We built the <b>beds</b>.</p>]]></description></item>
</channel></rss>`;
const REDDIT = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>The Swift Programming Language</title>
<entry><id>t3_pinned</id><title>FAQ (pinned)</title><link href="https://www.reddit.com/r/swift/pinned"/><updated>2021-01-01T00:00:00Z</updated></entry>
<entry><id>t3_a</id><title>Swift 7 thoughts</title><link href="https://www.reddit.com/r/swift/a"/><updated>${ago(5).toISOString()}</updated></entry></feed>`;
const bskyDate = (d) => d.toUTCString().replace(/^\w+, /, '').replace(/:\d\d GMT$/, ' +0000');
const BSKY = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>@bsky.app - Bluesky</title><link>https://bsky.app/profile/bsky.app</link>
<item><link>https://bsky.app/profile/bsky.app/post/1</link><description>a masterclass in alt text</description><pubDate>${bskyDate(ago(50))}</pubDate><guid isPermaLink="false">at://1</guid></item></channel></rss>`;
const JSONF = JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'JF Notes', home_page_url: 'https://jf.test/',
  items: [{ id: '1', url: 'https://jf.test/1', title: 'First note', content_html: '<p>Hello</p>', date_published: ago(70).toISOString() }] });

const ROUTES = {
  'https://github.com/o/busy/releases.atom': ATOM(8),
  'https://garden.test/': BLOG_PAGE, 'https://garden.test/feed/': BLOG_RSS,
  'https://www.reddit.com/r/swift/.rss': REDDIT,
  'https://bsky.app/profile/bsky.app/rss': BSKY,
  'https://jf.test/': '<html><head><link rel="alternate" type="application/feed+json" href="/feed.json"></head></html>',
  'https://jf.test/feed.json': JSONF,
  'https://www.instagram.com/nasa/': '<html><head><title>Instagram</title></head><body></body></html>',
};
for (let i = 0; i < 12; i++) ROUTES[`https://f${i}.test/feed`] = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed ${i}</title>
<item><title>Post ${i}</title><link>https://f${i}.test/p</link><pubDate>${ago(i + 100).toUTCString()}</pubDate></item></channel></rss>`;

const tmp = path.join(HERE, '_tmp');
await mkdir(tmp, { recursive: true });
const stub = path.join(tmp, 'follow_net.js');
await writeFile(stub, `(() => {
  window.__routes = ${JSON.stringify(ROUTES)};
  window.__fetched = [];
  window.myllmFetch = (url) => {
    const u = String(url);
    window.__fetched.push(u);
    if (window.__live) return window.nodeFetch(u);
    return new Promise(r => setTimeout(() => {
      const body = window.__routes[u];
      r(body != null ? { ok: true, status: 200, headers: {}, body } : { ok: false, status: 404, headers: {}, body: '' });
    }, 10));
  };
})();`, 'utf8');

const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.exposeFunction('nodeFetch', async (u) => {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 MyLLM' }, signal: AbortSignal.timeout(15000) });
    return { ok: r.ok, status: r.status, headers: {}, body: await r.text() };
  } catch (e) { return { ok: false, status: 0, headers: {}, body: '' }; }
});
await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
await context.addInitScript({ path: stub });
const page = await context.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error' || /Failed to load resource/i.test(m.text())) return;
  errs.push('console.error: ' + m.text());
});
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(300);

let fails = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r === true) { console.log('ok  ', name); return; }
        fails++; console.log('FAIL', name, '->', r); }
  catch (e) { fails++; console.log('FAIL', name, '->', e.message); }
};
const msg = () => page.locator('#addmsg').innerText();
const paste = async (text) => {
  await page.fill('#addr', text);
  await page.click('#addBtn');
  await page.waitForFunction(() => !document.getElementById('addBtn').disabled, null, { timeout: 15000 });
};
const tab = async (t) => { await page.click(t === 'l' ? '#tabL' : '#tabF'); await page.waitForTimeout(80); };

// ---- 1. first run --------------------------------------------------------------
await check('opens on Following when nothing is followed', async () =>
  await page.locator('#paneF').isVisible() || 'Latest pane showed first');
await check('the LinkFindr card links to the App Store listing', async () => {
  const href = await page.getAttribute('#lfCard', 'href');
  return href === 'https://apps.apple.com/app/linkfindr/id6760857542' || href;
});
await check('no pricing anywhere on the page', async () => {
  const t = await page.evaluate(() => document.body.innerText);
  return !/[$£€]\s?\d|\bfree\b|\bprice\b|\bsubscri/i.test(t) || 'found pricing words';
});

// ---- 2. a pasted list (LinkFindr's share text works as-is) --------------------
await paste(`What I follow on LinkFindr:
• busy — https://github.com/o/busy
• Garden — https://garden.test/
• r/swift — https://www.reddit.com/r/swift/
• Bluesky — https://bsky.app/profile/bsky.app
• Notes — https://jf.test/
• Instagram — https://www.instagram.com/nasa/

Paste this into LinkFindr → Following → Follow to follow them too.`);
await check('a pasted list follows every project that has a feed', async () => {
  const names = await page.locator('#list .row b').allInnerTexts();
  return JSON.stringify(names) === JSON.stringify(['busy releases', 'Garden Build', 'The Swift Programming Language', '@bsky.app - Bluesky', 'JF Notes']) || JSON.stringify(names);
});
await check('...and says which address had none', async () => {
  const t = await msg();
  return (t.includes('No updates found at instagram.com') && t.includes('Following')) || t;
});
await check('GitHub repo → releases.atom without loading the repo page', async () => {
  const f = await page.evaluate(() => window.__fetched);
  return (f.includes('https://github.com/o/busy/releases.atom') && !f.includes('https://github.com/o/busy')) || JSON.stringify(f.filter(u => u.includes('github')));
});
await check('a blog is found through the feed its page announces, skipping the comments feed', async () => {
  const f = await page.evaluate(() => window.__fetched);
  return (f.includes('https://garden.test/feed/') && !f.includes('https://garden.test/comments/feed/')) || JSON.stringify(f.filter(u => u.includes('garden')));
});
await check('pasting the same list again follows nothing twice', async () => {
  await paste('https://garden.test/ https://bsky.app/profile/bsky.app');
  const n = await page.locator('#list .row').count();
  const t = await msg();
  return (n === 5 && t.includes('Already following')) || `rows=${n} msg=${t}`;
});

// ---- 3. Latest: following starts caught up ------------------------------------
await tab('l');
await page.waitForTimeout(400);
await check('just-followed projects are not "new"', async () => {
  const t = await page.locator('#feed').innerText();
  return (t.includes("You're all caught up") && (await page.locator('#feed .up.new').count()) === 0) || t.slice(0, 200);
});
await check('a busy project shows 3, then one "more" row', async () => {
  const busyRows = await page.locator('#feed .up', { hasText: 'busy releases' }).count();
  const more = await page.locator('#feed .more').allInnerTexts();
  return (busyRows === 3 && more.some(m => /5 more from busy releases/.test(m))) || `rows=${busyRows} more=${JSON.stringify(more)}`;
});
await check('order is newest first across projects', async () => {
  const ats = await page.evaluate(() => items.map(x => x.at));
  return ats.every((a, i) => i === 0 || ats[i - 1] >= a) || 'out of order';
});
await check('Bluesky (no title, no seconds in the date) is dated and titled from its text', async () => {
  const b = await page.evaluate(() => items.find(x => x.feed.includes('bsky')));
  return (b && b.at > 0 && b.title === 'a masterclass in alt text') || JSON.stringify(b);
});
await check('HTML in summaries is plain text', async () => {
  const g = await page.evaluate(() => items.find(x => x.feed.includes('garden')));
  return (g && g.summary === 'We built the beds.' && g.title === 'Raised beds & paths') || JSON.stringify(g);
});
await check('"more" expands the rest of that project', async () => {
  await page.locator('#feed .more').first().click();
  await page.waitForTimeout(100);
  return (await page.locator('#feed .up', { hasText: 'busy releases' }).count()) === 8 || 'did not expand';
});

// ---- 4. something new arrives --------------------------------------------------
await page.evaluate(() => {
  window.__routes['https://github.com/o/busy/releases.atom'] = window.__routes['https://github.com/o/busy/releases.atom']
    .replace('<title>Release notes from busy</title>', `<title>Release notes from busy</title><entry><id>tag:new1</id><title>b200</title><updated>${new Date(Date.now() - 6e4).toISOString()}</updated><link rel="alternate" href="https://github.com/o/busy/releases/tag/b200"/></entry>`);
});
await page.click('#refBtn');
await page.waitForTimeout(400);
await check('a new update shows under New with its dot, then "That\'s everything new"', async () => {
  const t = await page.locator('#feed').innerText();
  const n = await page.locator('#feed .up.new').count();
  return (n === 1 && t.indexOf('b200') < t.indexOf("That's everything new") && (await page.locator('#feed .up.new .dot').count()) === 1) || `new=${n}\n${t.slice(0, 300)}`;
});
await check('updates open in their own app (target=_blank)', async () =>
  (await page.locator('#feed .up').first().getAttribute('target')) === '_blank' || 'not _blank');

// ---- 5. unfollow, undo -------------------------------------------------------
await tab('f');
await page.locator('#list .row .x').nth(1).click();
await page.waitForTimeout(200);
await check('unfollow removes the project and its updates', async () => {
  const names = await page.locator('#list .row b').allInnerTexts();
  const left = await page.evaluate(() => items.filter(x => x.feed.includes('garden')).length);
  return (!names.includes('Garden Build') && left === 0) || JSON.stringify(names);
});
await page.click('#list .undo');
await page.waitForTimeout(300);
await check('...and Undo puts it back', async () =>
  (await page.locator('#list .row b').allInnerTexts()).includes('Garden Build') || 'not restored');

// ---- 6. the pocket limit -------------------------------------------------------
await paste(Array.from({ length: 12 }, (_, i) => `https://f${i}.test/feed`).join('\n'));
await check(`stops at the limit and points to LinkFindr`, async () => {
  const n = await page.locator('#list .row').count();
  const t = await msg();
  return (n === 10 && t.includes('follows up to 10') && t.includes('LinkFindr')) || `rows=${n} msg=${t}`;
});
await check('suggestions hide once full', async () => !(await page.locator('#sugCard').isVisible()) || 'still shown');

// ---- 7. it was all saved -------------------------------------------------------
await check('the follow list is saved to myllmStorage', async () => {
  const saved = await page.evaluate(() => myllmStorage.getItem('follows_v1'));
  return (JSON.parse(saved).length === 10) || saved;
});

await check('no page errors anywhere in the run', async () => errs.length === 0 || errs.join('\n'));
await page.screenshot({ path: path.join(HERE, 'out', 'follow-latest.png'), fullPage: false }).catch(() => {});

// ---- live --------------------------------------------------------------------
if (LIVE) {
  console.log('\n— live —');
  const live = await context.newPage();
  live.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await live.setContent(html, { waitUntil: 'load' });
  await live.evaluate(() => { window.__live = true; });
  const suggested = await live.evaluate(() => SUGGESTED.map(s => s.feed));
  for (const f of suggested) {
    const r = await live.evaluate(u => tryFeed(u, {}).then(r => r && { n: r.items.length, dated: r.items.filter(x => x.at).length, title: r.title }), f);
    await check(`suggestion ${f} → ${r ? `${r.title}, ${r.n} updates, ${r.dated} dated` : 'nothing'}`, async () => !!(r && r.n > 0 && r.dated === r.n) || 'failed');
  }
  for (const a of ['https://github.com/ggml-org/llama.cpp', 'https://www.youtube.com/@NASA', 'https://www.reddit.com/r/swift/',
                   'https://mastodon.social/@Mastodon', 'https://bsky.app/profile/bsky.app', 'https://daringfireball.net/', 'https://www.swift.org/blog/']) {
    const r = await live.evaluate(u => discover(u).then(r => r && { feed: r.feed, n: r.items.length, dated: r.items.filter(x => x.at).length }), a);
    await check(`${a} → ${r ? `${r.feed}, ${r.n} updates, ${r.dated} dated` : 'nothing'}`, async () => !!(r && r.n > 0 && r.dated === r.n) || 'failed');
  }
  const ig = await live.evaluate(u => discover(u), 'https://www.instagram.com/nasa/');
  await check('Instagram honestly finds nothing', async () => ig === null || JSON.stringify(ig).slice(0, 120));
}

await browser.close();
console.log(fails === 0 ? '\nall passing' : `\n${fails} failing`);
process.exit(fails === 0 ? 0 : 1);
