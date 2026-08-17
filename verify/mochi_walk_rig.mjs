/* Mochi's walk rig — the accessories have to ride her head, not float beside it.
 *
 * verify_app.mjs boots the app and pokes it; it cannot tell whether a hat stays
 * on a head that moves 32px inside its own sprite. That needs the walk actually
 * running, frame by frame, which is what this does.
 *
 * The regression being pinned: accessories used to be rigidly parented to the
 * walker box, so their transform never changed while Mochi walked. If these
 * assertions ever go quiet again — a constant transform, a frozen sprite — the
 * float is back.
 *
 * Run:  node mochi_walk_rig.mjs        (from myllm-assets/verify)
 */
import { webkit } from 'playwright';

const APP = new URL('../apps-src/mochi.html', import.meta.url).pathname;
let fails = 0, passes = 0;
const ok = (n, c, e = '') => c ? (passes++, console.log(`  ✓ ${n}`))
                               : (fails++, console.log(`  ✗ ${n}   ${e}`));

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 402, height: 874 } });

// Straight to a hatched, well-fed Mochi wearing one item per slot, so the walk
// is reachable and all three rig paths are exercised at once.
await page.addInitScript(() => {
  window.myllmHaptic = () => {};
  const now = Date.now();
  const mem = {
    mochi_state: JSON.stringify({
      name: 'Test', born: now - 8 * 86400000, hatched: true, last: now,
      hunger: 90, happy: 90, clean: 90, energy: 100,
      walks: 3, finds: 20, unlocked: ['bucket_hat', 'flower', 'crown'], maxHappy: true,
    }),
    mochi_wardrobe: JSON.stringify({ head: 'bucket_hat', eyes: 'sunglasses', neck: 'bowtie' }),
  };
  window.myllmStorage = {
    getItem: (k) => Promise.resolve(mem[k] ?? null),
    setItem: (k, v) => { mem[k] = v; return Promise.resolve(); },
    removeItem: (k) => { delete mem[k]; return Promise.resolve(); },
    clear: () => Promise.resolve(), keys: () => Promise.resolve(Object.keys(mem)),
  };
});
await page.goto('file://' + APP);
await page.waitForTimeout(400);

// ── pure rig maths, driven directly ──────────────────────────────────────────
console.log('\nrig maths');
const m = await page.evaluate(() => ({
  n: RIG_TRACK.length, frames: WALK_FRAMES, cols: SHEET_COLS,
  cells: Array.from({ length: WALK_FRAMES }, (_, i) => walkCell(i)),
  wrapNeg: walkCell(-1), wrapBig: walkCell(WALK_FRAMES * 5 + 7),
  pos: [cellPos(0), cellPos(5), cellPos(6), cellPos(32)],
  play: buildPlay().length,
}));
ok('33 unique frames, 64 played', m.n === 33 && m.frames === 64, `${m.n}/${m.frames}`);
ok('cells stay inside the sheet', Math.min(...m.cells) === 0 && Math.max(...m.cells) === 32,
   `${Math.min(...m.cells)}..${Math.max(...m.cells)}`);
ok('ping-pong mirrors the loop', m.cells[33] === 31 && m.cells[63] === 1 && m.cells[32] === 32,
   `f33=${m.cells[33]} f63=${m.cells[63]} f32=${m.cells[32]}`);
ok('every frame reachable', new Set(m.cells).size === 33, `${new Set(m.cells).size} distinct`);
ok('negative and huge frame numbers wrap', m.wrapNeg === 1 && m.wrapBig === walkCellRef(m),
   `${m.wrapNeg} / ${m.wrapBig}`);
function walkCellRef(mm) { const p = (mm.frames * 5 + 7) % mm.frames; return p < 33 ? p : mm.frames - p; }
// background-position steps must span 0..100%, not 0..83% (the /cols vs /(cols-1) trap)
ok('sheet cell 0 is the origin', m.pos[0].x === 0 && m.pos[0].y === 0);
ok('last column lands on 100%', m.pos[1].x === 100, `${m.pos[1].x}%`);
ok('row 2 steps down, column resets', m.pos[2].x === 0 && m.pos[2].y === 20, JSON.stringify(m.pos[2]));
ok('last cell is bottom-left of the used grid', m.pos[3].x === 40 && m.pos[3].y === 100, JSON.stringify(m.pos[3]));
ok('play table covers the whole loop', m.play === 64, `${m.play}`);

console.log('\nper-item character');
const chr = await page.evaluate(() => {
  const at = (id, slot) => Array.from({ length: 64 }, (_, i) => accTransform(i, slot, id, 1));
  const spread = (id, slot) => {
    const rots = at(id, slot).map(t => parseFloat(t.match(/rotate\(([-\d.]+)deg\)/)[1]));
    return Math.max(...rots) - Math.min(...rots);
  };
  // Baseline: the head's own lean. Everything worn on the head tilts by at
  // least this much — that IS the head tilting. Character is what each item
  // adds on top.
  const leans = RIG_TRACK.map(t => t[2]);
  return {
    bare: Math.max(...leans) - Math.min(...leans),
    crown: spread('crown', 'head'), bucket: spread('bucket_hat', 'head'),
    shades: spread('sunglasses', 'eyes'), flower: spread('flower', 'head'),
    neckX: Math.max(...at('bowtie', 'neck').map(t => Math.abs(parseFloat(t.match(/translate\(([-\d.]+)px/)[1])))),
    headX: Math.max(...at('beanie', 'head').map(t => Math.abs(parseFloat(t.match(/translate\(([-\d.]+)px/)[1])))),
  };
});
ok('everything on the head tilts with the head', chr.shades >= chr.bare * 0.9,
   `shades ${chr.shades.toFixed(1)}° vs head lean ${chr.bare.toFixed(1)}°`);
ok('glasses add almost nothing of their own', chr.shades < chr.bare * 1.15,
   `shades ${chr.shades.toFixed(1)}° vs head lean ${chr.bare.toFixed(1)}°`);
ok('a floppy bucket hat lollops well past the head', chr.bucket > chr.bare * 1.4,
   `bucket ${chr.bucket.toFixed(1)}° vs ${chr.bare.toFixed(1)}°`);
ok('a crown stays regal — stiffer than the bucket hat', chr.crown < chr.bucket * 0.8,
   `crown ${chr.crown.toFixed(1)}° vs bucket ${chr.bucket.toFixed(1)}°`);
ok('a springy flower is the liveliest thing she owns', chr.flower > chr.bucket,
   `flower ${chr.flower.toFixed(1)}°`);
ok('a neck item sways less than a hat', chr.neckX < chr.headX,
   `neck ${chr.neckX.toFixed(1)}px vs head ${chr.headX.toFixed(1)}px`);

// ── the real thing: walk her and watch the accessories ───────────────────────
console.log('\nout for a walk');
await page.evaluate(() => { sheetReady = true; startWalk(); });
await page.waitForTimeout(120);
ok('walk view is up', await page.isVisible('#walkview'));
ok('pet is driven by the sheet, not the plain loop',
   !(await page.getAttribute('#walkpet', 'class')).includes('plain'),
   await page.getAttribute('#walkpet', 'class'));

const samples = [];
for (let i = 0; i < 14; i++) {
  samples.push(await page.evaluate(() => ({
    bg: getComputedStyle(document.getElementById('walkpet')).backgroundPosition,
    head: document.getElementById('wacc_head').style.transform,
    eyes: document.getElementById('wacc_eyes').style.transform,
    neck: document.getElementById('wacc_neck').style.transform,
  })));
  await page.waitForTimeout(90);
}
const uniqBg = new Set(samples.map(s => s.bg)).size;
const uniqHead = new Set(samples.map(s => s.head)).size;
ok('the sprite is actually advancing', uniqBg > 4, `${uniqBg} distinct positions in 14 samples`);
ok('THE FIX: the hat moves with her, every frame', uniqHead > 4,
   `${uniqHead} distinct transforms — 1 means it is floating again`);
ok('all three slots ride', new Set(samples.map(s => s.eyes)).size > 4
   && new Set(samples.map(s => s.neck)).size > 4);
ok('transforms are well-formed', samples.every(
     s => /^translate\(-?[\d.]+px,\s*-?[\d.]+px\)\s*rotate\(-?[\d.]+deg\)$/.test(s.head)),
   samples[0].head);

console.log('\nwalk ends cleanly');
await page.evaluate(() => endWalk(false));
await page.waitForTimeout(120);
const after = await page.evaluate(() => ({
  raf: walkRAF, bg: document.getElementById('walkpet').style.backgroundImage,
  head: document.getElementById('wacc_head').style.transform,
}));
ok('frame loop stopped', after.raf === null, String(after.raf));
ok('2400x2400 sheet released', after.bg === '', after.bg);
ok('accessory transforms reset', after.head === '', after.head);

console.log('\nfallback for builds without the sheet');
await page.evaluate(() => { sheetReady = false; startWalk(); });
await page.waitForTimeout(120);
ok('falls back to the animated loop', (await page.getAttribute('#walkpet', 'class')).includes('plain'));
ok('no frame loop running', await page.evaluate(() => walkRAF) === null);
ok('and Mochi still goes outside', await page.isVisible('#walkview'));
await page.evaluate(() => endWalk(false));

await browser.close();
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
