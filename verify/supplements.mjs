// Supplements v1: the guide, search, the molecule drawing (from a canned
// PubChem 2D record), FDA reports and Wikipedia through myllmFetch, the stack
// checker, and quiet failures with no network.
//
//   node supplements.mjs        # exit 0 = every case passes
import { webkit } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(HERE, '..', 'apps-src', 'supplements.html'), 'utf8');
const browser = await webkit.launch();

let fails = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r === true) { console.log('ok  ', name); return; }
        fails++; console.log('FAIL', name, '->', r); }
  catch (e) { fails++; console.log('FAIL', name, '->', e.message); }
};

// Caffeine's real shape: 14 heavy atoms, two C=O, methyl groups on N.
const CAFFEINE = { PC_Compounds: [{
  atoms: { aid: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], element: [8,8,7,7,7,7,6,6,6,6,6,6,6,6,1] },
  bonds: { aid1: [1,2,3,3,3,4,4,4,5,5,6,6,7,8,14], aid2: [9,10,8,10,12,7,11,13,9,10,8,11,9,14,15], order: [2,2,1,1,1,1,1,1,1,1,2,1,1,1,1] },
  coords: [{ aid: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], conformers: [{
    x: [5.0,3.27,4.13,2.27,3.27,2.47,3.27,4.13,4.13,3.27,2.4,5.0,1.4,5.0,5.5],
    y: [0.5,-1.5,-0.5,1.0,0,0.06,1.0,0.0,1.0,-0.5,1.55,-1.0,1.5,0.0,0.2] }] }],
}] };

async function open(net) {
  const c = await browser.newContext({ viewport: { width: 393, height: 852 } });
  await c.addInitScript({ path: path.join(HERE, 'bridges.js') });
  await c.addInitScript(({ net, CAFFEINE }) => {
    window.__urls = [];
    if (!net) { delete window.myllmFetch; return; }
    window.myllmFetch = async (u) => {
      window.__urls.push(u);
      const ok = (o) => ({ ok: true, status: 200, headers: {}, body: JSON.stringify(o) });
      if (u.includes('/record/JSON')) return ok(CAFFEINE);
      if (u.includes('/property/')) return ok({ PropertyTable: { Properties: [{ CID: 2519, MolecularFormula: 'C8H10N4O2', MolecularWeight: '194.19', Title: 'Caffeine' }] } });
      if (u.includes('/cids/JSON')) return u.includes('notathing') ? { ok: false, status: 404, body: '' } : ok({ IdentifierList: { CID: [2519] } });
      if (u.includes('api.fda.gov') && u.includes('count=')) return ok({ results: [{ term: 'NAUSEA', count: 9 }, { term: 'HEADACHE', count: 4 }] });
      if (u.includes('api.fda.gov')) return ok({ meta: { results: { total: 304 } }, results: [{}] });
      if (u.includes('wikipedia.org')) return ok({ extract: 'Caffeine is a central nervous system stimulant.', content_urls: { mobile: { page: 'https://en.m.wikipedia.org/wiki/Caffeine' } } });
      return { ok: false, status: 500, body: '' };
    };
  }, { net, CAFFEINE });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setContent(html, { waitUntil: 'load' });
  await p.waitForTimeout(300);
  return { c, p, errs };
}

{
  const { c, p, errs } = await open(true);
  const listText = () => p.evaluate(() => document.getElementById('list').innerText);

  await check('every entry is listed, sorted by name', async () => {
    const n = await p.evaluate(() => document.querySelectorAll('#list .item').length);
    const total = await p.evaluate(() => DATA.length);
    const names = await p.evaluate(() => [...document.querySelectorAll('#list .item b')].map((b) => b.textContent));
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    return (n === total && total >= 70 && names.join() === sorted.join()) || `${n}/${total}`;
  });
  await check('every entry has the fields the page reads', async () => {
    const bad = await p.evaluate(() => DATA.filter((e) => !e.id || !e.n || !Array.isArray(e.aka) || !CAT_NAME[e.cat] || !e.what || !e.dose || !e.us ||
      !Array.isArray(e.cautions) || !e.cautions.length || !Array.isArray(e.src) || !e.src.length || !ST_NAME[e.st] || !e.wiki ||
      e.flags.some((f) => !FLAGS[f]) || e.uses.some((u) => ['good', 'some', 'little'].indexOf(u[1]) < 0)).map((e) => e.id));
    return bad.length === 0 || bad.join(', ');
  });
  await check('search finds by another name (Hypericum → St John\'s wort)', async () => {
    await p.fill('#q', 'hypericum'); await p.waitForTimeout(250);
    return /St John's wort/.test(await listText()) || await listText();
  });
  await check('category filter shows only that kind', async () => {
    await p.fill('#q', ''); await p.waitForTimeout(250);
    await p.evaluate(() => setCat('peptide')); await p.waitForTimeout(100);
    const t = await listText();
    return (/BPC-157/.test(t) && !/Vitamin D/.test(t)) || t.slice(0, 200);
  });
  await check('an unknown name offers an online look-up', async () => {
    await p.evaluate(() => setCat('all'));
    await p.fill('#q', 'spirulina'); await p.waitForTimeout(250);
    return /Look up “spirulina” online/.test(await listText()) || await listText();
  });

  await p.fill('#q', ''); await p.waitForTimeout(200);
  await p.evaluate(() => openEntry('caffeine')); await p.waitForTimeout(500);
  await check('detail: evidence, amounts, cautions and status', async () => {
    const t = await p.evaluate(() => document.getElementById('detail').innerText);
    return (/EVIDENCE/i.test(t) && /400 mg/.test(t) && /CAUTIONS/i.test(t) && /LEGAL STATUS/i.test(t) && /Sport/.test(t)) || t.slice(0, 400);
  });
  await check('the molecule is drawn: bonds, labelled heteroatoms, no bare carbons', async () => {
    const r = await p.evaluate(() => {
      const svg = document.querySelector('#mol svg');
      if (!svg) return { none: document.getElementById('mol').innerText };
      const labels = [...svg.querySelectorAll('text')].map((t) => t.textContent);
      return { lines: svg.querySelectorAll('line').length, labels, cap: document.querySelector('.molcap').innerText };
    });
    if (r.none) return r.none;
    return (r.lines >= 16 && r.labels.filter((l) => l === 'O').length === 2 && r.labels.filter((l) => l === 'N').length === 4 &&
      !r.labels.includes('C') && /194\.2 g\/mol/.test(r.cap)) || JSON.stringify(r);
  });
  await check('FDA reports: the total, the top reactions and the caveat', async () => {
    const t = await p.evaluate(() => document.getElementById('fda').innerText);
    return (/304 reports to FDA/.test(t) && /Nausea/.test(t) && /doesn't show the product caused it/.test(t)) || t;
  });
  await check('Wikipedia summary with its link', async () => {
    const t = await p.evaluate(() => document.getElementById('wiki').innerText);
    return (/stimulant/.test(t) && /Read on Wikipedia/.test(t)) || t;
  });
  await check('add to stack, then back to the list', async () => {
    await p.click('#stackBtn'); await p.waitForTimeout(100);
    const b = await p.textContent('#stackBtn');
    await p.evaluate(() => closeDetail());
    const listed = await p.evaluate(() => document.getElementById('main').style.display !== 'none');
    return (/In my stack/.test(b) && listed) || b;
  });

  await check('stack: a supplement and a medicine give one warning with every reason', async () => {
    const r = await p.evaluate(() => { stack = ['st-johns-wort']; meds = ['ssri']; return checkStack(); });
    return (r.length === 1 && r[0].lvl === 'red' && /serotonin syndrome/.test(r[0].d) && /antidepressant levels/.test(r[0].d) && /Antidepressants/.test(r[0].t)) || JSON.stringify(r);
  });
  await check('stack: two blood-thinning supplements add up', async () => {
    const r = await p.evaluate(() => { stack = ['ginkgo', 'garlic']; meds = []; return checkStack(); });
    return r.some((o) => /Ginkgo and Garlic may add up to a higher bleeding risk/.test(o.d)) || JSON.stringify(r);
  });
  await check('stack: minerals that compete are spread out', async () => {
    const r = await p.evaluate(() => { stack = ['calcium', 'iron', 'zinc']; meds = []; return checkStack(); });
    return r.some((o) => /Calcium, Iron and Zinc compete/.test(o.d)) || JSON.stringify(r);
  });
  await check('stack: an unlawful product is called out', async () => {
    const r = await p.evaluate(() => { stack = ['bpc-157']; meds = []; return checkStack(); });
    return (r.length === 1 && r[0].lvl === 'red' && /isn't a lawful supplement/.test(r[0].t)) || JSON.stringify(r);
  });
  await check('stack tab renders the checks', async () => {
    await p.evaluate(() => { stack = ['vitamin-k']; meds = ['thinner']; showTab('s'); });
    const t = await p.evaluate(() => document.getElementById('checks').innerText);
    return /works against warfarin/.test(t) || t;
  });
  await check('online look-up draws from PubChem by name', async () => {
    await p.evaluate(() => { showTab('b'); query = 'caffeine anhydrous'; lookUp(); }); await p.waitForTimeout(500);
    const t = await p.evaluate(() => document.getElementById('detail').innerText);
    return (/No safety or legal summary/.test(t) && !!(await p.$('#mol svg'))) || t.slice(0, 300);
  });
  await check('no page errors', async () => errs.length === 0 || errs.join('\n'));
  await c.close();
}

{
  const { c, p, errs } = await open(false);
  await p.evaluate(() => openEntry('nmn')); await p.waitForTimeout(400);
  await check('offline: the guide still reads, live parts say why they are empty', async () => {
    const t = await p.evaluate(() => document.getElementById('detail').innerText);
    return (/nicotinamide mononucleotide/i.test(t) && /September 2025/.test(t) && (t.match(/Needs internet access/g) || []).length === 3) || t.slice(0, 600);
  });
  await check('offline: no page errors', async () => errs.length === 0 || errs.join('\n'));
  await c.close();
}

await browser.close();
console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
