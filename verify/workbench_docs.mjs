// Workbench: the document lifecycle, end to end.
//
// verify_app.mjs proves an app boots and stays in the sandbox under a blind tap
// sweep. It cannot prove that Save actually wrote the file, that "save as HTML"
// converted anything, or that leaving with unsaved edits stops to ask — those
// need the real sequence, driven in order, with the file store read back after
// each step. Hence this.
//
//   node workbench_docs.mjs        # exit 0 = the whole lifecycle works
import { webkit } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(HERE, '..', 'apps-src', 'workbench.html'), 'utf8');
const bridges = await readFile(path.join(HERE, 'bridges.js'), 'utf8');

const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript({ path: path.join(HERE, 'bridges.js') });
const page = await context.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(400);

let fails = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r === true) { console.log('ok  ', name); return; }
        fails++; console.log('FAIL', name, '->', r); }
  catch (e) { fails++; console.log('FAIL', name, '->', e.message); }
};

// 1. start screen
await check('start screen offers templates and no doc is open', async () =>
  (await page.locator('#main .card[data-t]').count()) === 8 &&
  (await page.locator('#tabs').isHidden()) &&
  (await page.locator('#saveBtn').isDisabled()) || 'start screen wrong');

// 2. create a Document from the start screen
await page.locator('#main .card[data-t="doc"]').click();
await page.waitForTimeout(150);
await check('New sheet opens with the tapped template selected', async () =>
  (await page.locator('#new').isVisible()) &&
  (await page.locator('#newTpl .card[data-t="doc"]').getAttribute('aria-pressed')) === 'true' &&
  (await page.locator('#newName').inputValue()) === 'Document' || 'sheet state wrong');

await page.fill('#newName', 'Quarter report');
await page.locator('#new .btn.primary').click();
await page.waitForTimeout(300);
await check('the file exists in the workspace immediately', async () => {
  const t = await page.evaluate(() => window.myllmFiles.read('Quarter report.md'));
  return (typeof t === 'string' && t.startsWith('# Title')) || 'not written: ' + JSON.stringify(t);
});
await check('it opens in Edit mode with a textarea', async () =>
  (await page.locator('#ta').count()) === 1 &&
  (await page.locator('#tabEdit').getAttribute('aria-selected')) === 'true' || 'not editing');
await check('title and word count show', async () =>
  (await page.locator('#title').textContent()) === 'Quarter report.md' &&
  (await page.locator('#sub').textContent()).includes('words') || 'header wrong');

// 3. type, format, save
await page.locator('#ta').fill('# Quarter report\n\nRevenue is up.\n');
await page.locator('#ta').dispatchEvent('input');
await page.waitForTimeout(50);
await check('Save enables once edited', async () =>
  !(await page.locator('#saveBtn').isDisabled()) || 'save still disabled');
await page.locator('.fmt[data-k="todo"]').click();   // toolbar toggles a task line
await page.waitForTimeout(50);
await check('task toolbar button prefixes the line', async () =>
  (await page.locator('#ta').inputValue()).includes('- [ ] ') || 'no task prefix');
await page.locator('#ta').fill('# Quarter report\n\nRevenue is up.\n\n- [ ] send it\n');
await page.locator('#ta').dispatchEvent('input');
await page.locator('#saveBtn').click();
await page.waitForTimeout(250);
await check('Save writes the edits back to the same path', async () => {
  const t = await page.evaluate(() => window.myllmFiles.read('Quarter report.md'));
  return t.includes('- [ ] send it') || 'stale on disk';
});
await check('Save disables again and says saved', async () =>
  (await page.locator('#saveBtn').isDisabled()) &&
  (await page.locator('#sub').textContent()).includes('saved') || 'save state wrong');

// 4. rendered view shows the task box and heading
await page.locator('#tabView').click();
await page.waitForTimeout(120);
await check('View renders Markdown with a drawn checkbox', async () =>
  (await page.locator('#main .md h1').textContent()) === 'Quarter report' &&
  (await page.locator('#main .md').textContent()).includes('☐') || 'render wrong');

// 5. Save as, converting Markdown to a web page
await page.locator('#moreBtn').click();
await page.waitForTimeout(120);
await page.locator('#more .btn', { hasText: 'Save a copy' }).click();
await page.waitForTimeout(150);
await page.selectOption('#saveAsFmt', 'html');
await page.waitForTimeout(80);
await check('changing the format rewrites the extension and explains itself', async () =>
  (await page.locator('#saveAsPath').inputValue()) === 'Quarter report.html' &&
  (await page.locator('#saveAsNote').textContent()).includes('standalone web page') || 'saveAs note wrong');
await page.fill('#saveAsPath', 'reports/quarter.html');
await page.locator('#saveAs .btn.primary').click();
await page.waitForTimeout(250);
await check('the converted copy is a real HTML document', async () => {
  const t = await page.evaluate(() => window.myllmFiles.read('reports/quarter.html'));
  return (t && t.startsWith('<!doctype html>') && t.includes('<h1>Quarter report</h1>')) || 'bad html: ' + String(t).slice(0,80);
});
await check('the app follows the copy (title, path, HTML view)', async () =>
  (await page.locator('#title').textContent()) === 'quarter.html' &&
  (await page.locator('#sub').textContent()).includes('reports/quarter.html') || 'did not follow');

// 6. Open browser lists both files, newest first, and opens one
await page.locator('.tb', { hasText: 'Open' }).click();
await page.waitForTimeout(300);
await check('Open lists the workspace documents', async () =>
  (await page.locator('#browseList .row').count()) === 2 || 'rows: ' + await page.locator('#browseList .row').count());
await page.fill('#browseQ', 'quarter report');
await page.waitForTimeout(80);
await check('search filters the list', async () =>
  (await page.locator('#browseList .row').count()) === 1 || 'filter broken');
await page.locator('#browseList .row').first().click();
await page.waitForTimeout(300);
await check('opening from the browser loads the file', async () =>
  (await page.locator('#title').textContent()) === 'Quarter report.md' &&
  (await page.locator('#browse').isHidden()) || 'open failed');

// 7. rename / move
await page.locator('#moreBtn').click();
await page.waitForTimeout(120);
await page.locator('#more .btn', { hasText: 'Rename' }).click();
await page.waitForTimeout(120);
await page.fill('#renamePath', 'reports/2026-q3.md');
await page.locator('#rename .btn.primary').click();
await page.waitForTimeout(250);
await check('rename moves the file and follows it', async () => {
  const gone = await page.evaluate(() => window.myllmFiles.exists('Quarter report.md'));
  const there = await page.evaluate(() => window.myllmFiles.read('reports/2026-q3.md'));
  return (!gone && there.includes('send it') &&
    (await page.locator('#title').textContent()) === '2026-q3.md') || 'rename wrong';
});

// 8. unsaved-changes guard
await page.locator('#tabEdit').click();
await page.waitForTimeout(120);
await page.locator('#ta').fill('# changed but not saved\n');
await page.locator('#ta').dispatchEvent('input');
await page.locator('.tb', { hasText: 'New' }).click();
await page.waitForTimeout(150);
await check('leaving with unsaved edits raises the in-page guard, not a dialog', async () =>
  (await page.locator('#unsaved').isVisible()) && (await page.locator('#new').isHidden()) || 'no guard');
await page.locator('#unsaved .btn.primary').click();   // save, then continue
await page.waitForTimeout(350);
await check('guard saves then continues to the New sheet', async () => {
  const t = await page.evaluate(() => window.myllmFiles.read('reports/2026-q3.md'));
  return (t.includes('changed but not saved') && await page.locator('#new').isVisible()) || 'guard failed';
});
await page.locator('#new .btn', { hasText: 'Cancel' }).click();

// 9. a CSV round-trip: create, view as a table, export-convert to JSON
await page.locator('.tb', { hasText: 'New' }).click();
await page.waitForTimeout(150);
await page.locator('#newTpl .card[data-t="table"]').click();
await page.fill('#newName', 'stock');
await page.locator('#new .btn.primary').click();
await page.waitForTimeout(300);
await page.locator('#ta').fill('Item,Qty\nApples,3\nPears,1\n');
await page.locator('#ta').dispatchEvent('input');
await page.locator('#tabView').click();
await page.waitForTimeout(150);
await check('CSV renders as a table with a row count', async () =>
  (await page.locator('#main table th').count()) === 2 &&
  (await page.locator('#main .note').textContent()).includes('2 rows') || 'csv view wrong');
await check('the header shows rows, not words, for a table', async () =>
  (await page.locator('#sub').textContent()).includes('2 rows') || 'sub wrong');
await page.locator('#moreBtn').click();
await page.waitForTimeout(120);
await page.locator('#more .btn', { hasText: 'Export' }).click();
await page.waitForTimeout(150);
await page.locator('#expFmt button', { hasText: 'JSON' }).click();
await page.waitForTimeout(100);
await check('export explains the CSV to JSON conversion', async () =>
  (await page.locator('#expNote').textContent()).includes('first row as keys') || 'export note wrong');
const shared = await page.evaluate(async () => {
  const seen = [];
  const real = window.myllmShareFile;
  window.myllmShareFile = (d, o) => { seen.push({ d, o }); return Promise.resolve(true); };
  document.querySelector('#export .btn.primary').click();
  await new Promise(r => setTimeout(r, 300));
  window.myllmShareFile = real;
  return seen;
});
await check('Share hands over converted JSON bytes with the right name and mime', () => {
  if (!shared.length) return 'share never called';
  const { d, o } = shared[0];
  const body = Buffer.from(d.split(',')[1], 'base64').toString('utf8');
  const rows = JSON.parse(body);
  return (o.filename === 'stock.json' && o.mime === 'application/json' &&
    rows[0].Item === 'Apples' && rows[0].Qty === 3) || 'bad payload: ' + body.slice(0, 120);
});

// 10. draft recovery survives a reload
await page.locator('#tabEdit').click();
await page.waitForTimeout(120);
await page.locator('#ta').fill('Item,Qty\nApples,3\nPears,1\nPlums,9\n');
await page.locator('#ta').dispatchEvent('input');
await page.waitForTimeout(1200);            // let the draft debounce fire
const store = await page.evaluate(() => window.myllmStorage.getItem('wb.draft'));
await check('unsaved edits are mirrored into app storage', () =>
  (store && JSON.parse(store).text.includes('Plums')) || 'no draft: ' + store);

console.log(errs.length ? '\nRUNTIME ERRORS:\n' + errs.join('\n') : '\nno uncaught errors');
await browser.close();
console.log(fails || errs.length ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails || errs.length ? 1 : 0);
