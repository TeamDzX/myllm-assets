#!/usr/bin/env node
// Runtime verification for MyLLMos gallery apps.
//
// scan_app.py reads an app's source and asks "does this text look wrong?".
// This runs the app in a real WebKit engine and asks "does it actually work,
// and does it stay inside the sandbox?" — which regexes can't answer, because
//   new Image().src = h + o + s + t
// is a remote load no pattern will ever match, and a TypeError on first tap is
// invisible to every static check.
//
// The two are complements, not substitutes. scan_app.py stays the first gate
// for untrusted submissions precisely because it never executes the code.
//
//   node verify_app.mjs --all
//   node verify_app.mjs ../apps-src/2048.html --screenshots
//   node verify_app.mjs --all --ask-mode prose      # AI returns prose, not JSON
//   node verify_app.mjs --all --no-bridges          # older build, bridges absent
//
// Exit 0 = every app clean. Exit 1 = at least one FAIL.

import { chromium, webkit } from 'playwright';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'apps-src');
const OUT = path.join(HERE, 'out');

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const CONFIG = {
  all: flag('--all'),
  allSrc: flag('--all-src'),
  clicks: Number(opt('--clicks', 12)),
  screenshots: flag('--screenshots'),
  screenshotFailures: !flag('--no-fail-shots'),
  json: opt('--json', null),
  askMode: opt('--ask-mode', 'json'),      // json | prose | reject
  stripBridges: flag('--no-bridges'),
  browser: opt('--browser', 'webkit'),     // webkit is closest to WKWebView
  headed: flag('--headed'),
  settle: Number(opt('--settle', 1200)),   // ms to let boot animations/timers run
  concurrency: Number(opt('--jobs', 4)),
  quiet: flag('--quiet'),
};

const files = argv.filter((a) => a.endsWith('.html') && !a.startsWith('--'));

// ---------------------------------------------------------------- rules

// Requests that must never leave the device. Remote *images* are explicitly
// allowed by CONTRIBUTING rule 1, so they are reported but not failed.
const HARD_BLOCK = new Set(['script', 'stylesheet', 'document', 'xhr', 'fetch', 'websocket', 'manifest']);
const SOFT_BLOCK = new Set(['image', 'media', 'font', 'other']);

// Guiding rule: BEHAVIOUR fails the build, OBSERVATION only informs.
// Anything an app can legitimately guard with try/catch is recorded, not
// failed — if it is genuinely unguarded the resulting uncaught error or
// rejection fails it anyway, without us having to guess the app's intent.
const SEVERITY = {
  'js-dialog': 'FAIL',            // alert/confirm/prompt — silently wedges the app on device
  'remote-resource': 'FAIL',      // breaks "self-contained, can't change after review"
  'uncaught-error': 'FAIL',
  'unhandled-rejection': 'FAIL',
  'raw-fetch': 'WARN',            // CORS-dead at a null origin; fine if guarded + falls back
  'raw-xhr': 'WARN',
  'console-error': 'WARN',
  'window-open': 'INFO',          // works — createWebViewWith hands the URL to Safari
  'remote-image': 'INFO',         // permitted by CONTRIBUTING rule 1
  'bridge-network': 'INFO',       // myllmFetch — legitimate for network apps
};

const rank = { FAIL: 0, WARN: 1, INFO: 2, PASS: 3 };

// ---------------------------------------------------------------- one app

async function verifyApp(browser, file) {
  const slug = path.basename(file, '.html');
  const html = await readFile(file, 'utf8');
  const findings = [];
  const add = (rule, detail) =>
    findings.push({ rule, severity: SEVERITY[rule] ?? 'WARN', detail: String(detail).slice(0, 300) });

  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },          // iPhone 17 Pro-ish
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  });

  // Nothing may reach the network. Everything external is aborted so the run
  // is deterministic offline, and classified so we know what it tried.
  await context.route('**', (route) => {
    const req = route.request();
    const url = req.url();
    const type = req.resourceType();
    if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return route.continue();
    if (HARD_BLOCK.has(type)) add('remote-resource', `${type} → ${url}`);
    else if (SOFT_BLOCK.has(type)) add('remote-image', `${type} → ${url}`);
    return route.abort();
  });

  await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await context.addInitScript(
    ({ askMode, stripBridges }) => {
      window.__askMode = askMode;
      window.__stripBridges = stripBridges;
      window.__rejections = [];
      addEventListener('unhandledrejection', (e) => {
        const r = e.reason;
        window.__rejections.push(String(r?.stack || r?.message || r));
      });
    },
    { askMode: CONFIG.askMode, stripBridges: CONFIG.stripBridges },
  );

  const page = await context.newPage();
  page.on('pageerror', (e) => add('uncaught-error', e.stack?.split('\n').slice(0, 2).join(' | ') || e.message));
  page.on('console', (m) => { if (m.type() === 'error') add('console-error', m.text()); });

  let crashed = null;
  try {
    // setContent leaves the document at a null origin — the same footing the
    // MyLLMos web view runs on, which is why plain fetch() is dead there.
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(CONFIG.settle);

    // Tap sweep: drive the app the way a user would. Anchors that would
    // navigate are skipped — leaving the document blanks the page and every
    // later finding becomes noise.
    const targets = await page.$$(
      'button:not([disabled]), [role="button"], input[type="button"], input[type="submit"], ' +
      '[onclick], canvas, .btn, .tab, .card, [data-action]',
    );
    let clicked = 0;
    for (const el of targets) {
      if (clicked >= CONFIG.clicks) break;
      try {
        if (!(await el.isVisible())) continue;
        await el.click({ timeout: 900, noWaitAfter: true, force: false });
        clicked++;
        await page.waitForTimeout(120);
      } catch (e) { /* covered, moved, or detached — a harness miss, not an app bug */ }
    }
    await page.waitForTimeout(400);

    for (const v of await page.evaluate(() => window.__violations ?? [])) add(v.rule, v.detail);
    for (const r of await page.evaluate(() => window.__rejections ?? [])) add('unhandled-rejection', r);

    // A blank screen passes every other check. Catch it explicitly.
    const painted = await page.evaluate(() => {
      const b = document.body;
      if (!b) return { text: 0, nodes: 0 };
      return { text: (b.innerText || '').trim().length, nodes: b.querySelectorAll('*').length };
    });
    if (painted.nodes < 3 && painted.text === 0) add('uncaught-error', 'Rendered nothing — empty body after load');

    const shotFail = CONFIG.screenshotFailures && findings.some((f) => f.severity === 'FAIL');
    if (CONFIG.screenshots || shotFail) {
      await mkdir(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `${slug}.png`) });
    }
  } catch (e) {
    crashed = e.message;
    add('uncaught-error', `harness: ${e.message}`);
  } finally {
    await context.close().catch(() => {});
  }

  const worst = findings.reduce((w, f) => (rank[f.severity] < rank[w] ? f.severity : w), 'PASS');
  return { slug, file, status: worst === 'PASS' ? 'PASS' : worst, crashed, findings, sizeKB: Math.round(html.length / 1024) };
}

// ---------------------------------------------------------------- run

// --all means "everything users can actually install", so it is driven by
// apps.json rather than by globbing apps-src. The directory also holds build
// INPUTS (expense-raw, hanyu-raw — build_*.py inlines their CDN deps before
// shipping), emulator shells, and shelved apps; failing on those is noise.
// A manifest entry with no local file is itself a finding.
let list;
if (files.length) {
  list = files.map((f) => path.resolve(f));
} else if (CONFIG.allSrc) {
  list = (await readdir(SRC)).filter((f) => f.endsWith('.html')).sort().map((f) => path.join(SRC, f));
} else if (CONFIG.all) {
  const manifest = JSON.parse(await readFile(path.join(HERE, '..', 'apps.json'), 'utf8'));
  list = manifest.apps.map((a) => path.join(SRC, `${a.id}.html`)).sort();
  const missing = [];
  for (const f of list) await readFile(f).catch(() => missing.push(path.basename(f)));
  if (missing.length) {
    console.error(`❌ in apps.json but missing from apps-src: ${missing.join(', ')}`);
    process.exit(1);
  }
} else {
  list = [];
}

if (!list.length) {
  console.error('Usage: node verify_app.mjs [--all | --all-src | <app.html>...] [--screenshots] [--json out.json]');
  process.exit(2);
}

const engine = CONFIG.browser === 'chromium' ? chromium : webkit;
const browser = await engine.launch({ headless: !CONFIG.headed });

const results = [];
const queue = [...list];
const icon = { PASS: '✅', INFO: 'ℹ️ ', WARN: '⚠️ ', FAIL: '❌' };

await Promise.all(
  Array.from({ length: Math.min(CONFIG.concurrency, queue.length) }, async () => {
    while (queue.length) {
      const file = queue.shift();
      const r = await verifyApp(browser, file);
      results.push(r);
      if (!CONFIG.quiet) {
        const fails = r.findings.filter((f) => f.severity === 'FAIL').length;
        const warns = r.findings.filter((f) => f.severity === 'WARN').length;
        console.log(
          `${icon[r.status] ?? '  '} ${r.slug.padEnd(28)} ${String(r.sizeKB + 'KB').padStart(7)}` +
          (fails ? `  ${fails} fail` : '') + (warns ? `  ${warns} warn` : ''),
        );
      }
    }
  }),
);

await browser.close();
results.sort((a, b) => a.slug.localeCompare(b.slug));

// ---------------------------------------------------------------- report

const failed = results.filter((r) => r.status === 'FAIL');
const warned = results.filter((r) => r.status === 'WARN');

if (failed.length) {
  console.log('\n' + '─'.repeat(72) + '\nFAILURES\n' + '─'.repeat(72));
  for (const r of failed) {
    console.log(`\n❌ ${r.slug}  (apps-src/${r.slug}.html)`);
    const seen = new Set();
    for (const f of r.findings.filter((f) => f.severity === 'FAIL')) {
      const k = f.rule + f.detail.slice(0, 80);
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`   [${f.rule}] ${f.detail}`);
    }
  }
}

if (warned.length) {
  console.log('\n' + '─'.repeat(72) + '\nWARNINGS\n' + '─'.repeat(72));
  for (const r of warned) {
    const rules = [...new Set(r.findings.filter((f) => f.severity === 'WARN').map((f) => f.rule))];
    console.log(`⚠️  ${r.slug.padEnd(28)} ${rules.join(', ')}`);
  }
}

const tally = { PASS: 0, INFO: 0, WARN: 0, FAIL: 0 };
for (const r of results) tally[r.status]++;
console.log(
  `\n${results.length} apps — ` +
  `✅ ${tally.PASS + tally.INFO} clean   ⚠️  ${tally.WARN} warn   ❌ ${tally.FAIL} fail` +
  `   [engine: ${CONFIG.browser}, ask-mode: ${CONFIG.askMode}` +
  (CONFIG.stripBridges ? ', bridges stripped' : '') + `]`,
);
if (CONFIG.clicks === 0) console.log('note: --clicks 0 — no tap sweep ran, only load-time errors were checked.');

if (CONFIG.json) {
  // out/ only exists once something has written a screenshot, so on a fresh
  // checkout this threw ENOENT — after every app had already passed — and took
  // the whole run down with it. Create the directory, and never let a reporting
  // failure masquerade as a failing gallery.
  try {
    await mkdir(path.dirname(path.resolve(CONFIG.json)), { recursive: true });
    await writeFile(CONFIG.json, JSON.stringify({ config: CONFIG, results }, null, 2));
    console.log(`json → ${CONFIG.json}`);
  } catch (e) {
    console.error(`could not write ${CONFIG.json}: ${e.message}`);
  }
}

process.exit(failed.length ? 1 : 0);
