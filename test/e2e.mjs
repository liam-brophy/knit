// End-to-end test of the built single-file app (dist/stitch-setter.html) in headless Chromium + SwiftShader.
//
//   npm run test:e2e        (= npm run build && NODE_PATH=$(npm root -g) node test/e2e.mjs)
//
// Wraps dist in a doctype skeleton with a stubbed downloads capability (window.claude.use) that captures the saved
// blobs, then drives the UI with real pointer / keyboard input at 1440×900 and 390×844.
// Screenshots: .scratch/app/e2e-*.png
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.scratch/app');
mkdirSync(out, { recursive: true });

const html = readFileSync(join(root, 'dist/stitch-setter.html'), 'utf8');
if (!html.startsWith('<title>Stitch Setter</title>')) throw new Error('dist must start with <title>Stitch Setter</title>');
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script>
window.__saved = []; window.__blobs = {};
window.claude = { use: async (cap) => cap === 'downloads' ? { save: async ({ filename, data }) => {
  window.__blobs[filename] = data;
  const b = new Uint8Array(await data.arrayBuffer());
  const png = b[0] === 0x89 && b[1] === 0x50;
  const dv = new DataView(b.buffer);
  window.__saved.push({ filename, size: data.size, type: data.type, png, w: png ? dv.getUint32(16) : 0, h: png ? dv.getUint32(20) : 0 });
} } : null };
</script></head><body>
${html}
</body></html>`;
const pagePath = join(out, 'e2e-page.html');
writeFileSync(pagePath, page);

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const T0 = Date.now();
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function open(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // Google Fonts are the only allowed external request; offline here, so fail them fast.
  const external = [];
  await p.route(/^https?:\/\//, (r) => { external.push(r.request().url()); r.abort(); });
  await p.goto('file://' + pagePath, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__studio && window.__studio.chart, null, { timeout: 60000 });
  await settle(p);
  return { p, ctx, errors, external };
}
const settle = (p) => p.evaluate(async () => { await window.__studio.flush(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
const shot = async (p, name, full = false) => { await settle(p); await p.screenshot({ path: join(out, `e2e-${name}.png`), fullPage: full, timeout: 180000 }); console.log(`  shot e2e-${name}.png  (${((Date.now() - T0) / 1000).toFixed(0)} s)`); };
/** Screen position (client px) of a sheet point in inches. */
const inchToClient = (p, x, y) => p.evaluate(([x, y]) => { const r = document.querySelector('#stage').getBoundingClientRect(); const s = window.__studio.stage.inToScreen(x, y); return { x: r.left + s.x, y: r.top + s.y }; }, [x, y]);

try {
  /* ------------------------------------------------------------ desktop */
  const { p, errors, external } = await open({ width: 1440, height: 900 });
  check('loads with a chart', await p.evaluate(() => __studio.chart.cols > 50 && __studio.chart.rows > 50));
  check('real WebGL renderer wired', await p.evaluate(() => !!__studio.renderer && typeof __studio.renderer.renderRegion === 'function' && !!document.querySelector('#fabric').getContext('webgl2')));
  check('no horizontal overflow (desktop)', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // 1. load the John preset from the header menu
  await p.selectOption('#preset', 'john');
  await settle(p);
  check('John preset loaded', await p.evaluate(() => __studio.doc.name.includes('John') && __studio.doc.layout === 'front'));
  await shot(p, '01-john-front');

  // 2. switch to full wrap
  const colsFront = await p.evaluate(() => __studio.chart.cols);
  await p.click('#docBody .seg button:has-text("Full wrap")');
  await settle(p); await p.click('#zoomFit'); await settle(p);
  const wrap = await p.evaluate(() => ({ layout: __studio.doc.layout, cols: __studio.chart.cols }));
  check('switched to wrap', wrap.layout === 'wrap' && wrap.cols > colsFront * 1.9, JSON.stringify(wrap));
  check('spine controls shown', await p.isVisible('#docBody .sub:has-text("Spine")'));
  await shot(p, '02-wrap');
  // back to front for the editing checks (layer geometry below is front-relative)
  await p.click('#docBody .seg button:has-text("Front")'); await settle(p); await p.click('#zoomFit'); await settle(p);

  // 3. edit text of "John (top)"
  await p.click('#layers .layer:has-text("John (top)")');
  await p.fill('#propText', 'Johnny');
  await settle(p);
  const txt = await p.evaluate(() => { const i = __studio.doc.layers.findIndex((l) => l.id === 't-john1'); let n = 0; for (const v of __studio.chart.layerOf) if (v === i) n++; return { text: __studio.doc.layers[i].text, cells: n }; });
  check('text edited and recomposed', txt.text === 'Johnny' && txt.cells > 50, JSON.stringify(txt));
  await p.keyboard.press('Escape'); // blur field

  // 4. move a layer by dragging it on the stage
  await p.keyboard.press('v');
  const before = await p.evaluate(() => { const L = __studio.doc.layers.find((l) => l.id === 't-john2'); const b = __studio.stage.layerBox(L); return { x: L.x, y: L.y, cx: b.x + b.w / 2, cy: b.y + b.h / 2 }; });
  const a = await inchToClient(p, before.cx, before.cy);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  for (let k = 1; k <= 8; k++) await p.mouse.move(a.x + k * 10, a.y - k * 5);
  await p.mouse.up(); await settle(p);
  const ppi = await p.evaluate(() => __studio.S.view.ppi);
  const after = await p.evaluate(() => { const L = __studio.doc.layers.find((l) => l.id === 't-john2'); return { x: L.x, y: L.y, sel: __studio.S.sel }; });
  check('layer moved by drag', Math.abs(after.x - before.x - 80 / ppi) < 0.02 && Math.abs(after.y - before.y + 40 / ppi) < 0.02 && after.sel === 't-john2', `dx=${(after.x - before.x).toFixed(3)} expect ${(80 / ppi).toFixed(3)}`);
  await shot(p, '03-moved-selected');
  await p.keyboard.press('Control+z'); await settle(p);
  check('undo restores layer position', await p.evaluate((x) => Math.abs(__studio.doc.layers.find((l) => l.id === 't-john2').x - x) < 1e-6, before.x));
  await p.keyboard.press('Control+Shift+z'); await settle(p);
  check('redo re-applies move', await p.evaluate((x) => Math.abs(__studio.doc.layers.find((l) => l.id === 't-john2').x - x) < 1e-6, after.x));

  // 5. paint stitches with the pencil (zoom in first so cells are big)
  await p.keyboard.press('Escape');
  const paintAt = await inchToClient(p, 1.2, 8.3);
  await p.mouse.move(paintAt.x, paintAt.y);
  for (let k = 0; k < 6; k++) await p.mouse.wheel(0, -200);
  await settle(p);
  await p.keyboard.press('b');
  const pa = await inchToClient(p, 1.2, 8.3);
  await p.mouse.move(pa.x, pa.y); await p.mouse.down();
  for (let k = 1; k <= 10; k++) await p.mouse.move(pa.x + k * 30, pa.y + (k % 3) * 2);
  await p.mouse.up(); await settle(p);
  const painted = await p.evaluate(() => {
    const L = __studio.doc.layers.find((l) => l.type === 'paint'), keys = Object.keys(L.cells), c = __studio.chart;
    const yi = __studio.doc.yarns.findIndex((y) => y.id === __studio.S.activeYarn);
    const [x, y] = keys[0].split(',').map(Number); const i = Math.floor(y / c.cellH) * c.cols + Math.floor(x / c.cellW);
    return { n: keys.length, ok: c.yarnIndex[i] === yi };
  });
  check('pencil painted stitches into the paint layer', painted.n >= 8 && painted.ok, JSON.stringify(painted));
  await shot(p, '04-painted-fabric');
  await p.keyboard.press('Control+z'); await settle(p);
  const undone = await p.evaluate(() => Object.keys(__studio.doc.layers.find((l) => l.type === 'paint').cells).length);
  check('undo removes the whole stroke', undone === 0, `cells=${undone}`);
  await p.keyboard.press('Control+Shift+z'); await settle(p);
  check('redo restores the stroke', await p.evaluate((n) => Object.keys(__studio.doc.layers.find((l) => l.type === 'paint').cells).length === n, painted.n));

  // 6. paint in Chart view too, then fill + eyedropper
  await p.keyboard.press('2'); await p.keyboard.press('Control+0'); await settle(p);
  check('chart view shown', await p.evaluate(() => document.querySelector('#stage').dataset.view === 'chart' && getComputedStyle(document.querySelector('#chartcv')).display === 'block'));
  const pc = await inchToClient(p, 1.4, 8.7);
  await p.mouse.move(pc.x, pc.y); await p.mouse.down(); await p.mouse.move(pc.x + 40, pc.y); await p.mouse.up(); await settle(p);
  const n2 = await p.evaluate(() => Object.keys(__studio.doc.layers.find((l) => l.type === 'paint').cells).length);
  check('painting works in chart view', n2 > painted.n, `${painted.n} → ${n2}`);
  await shot(p, '05-chart-painted');
  await p.keyboard.press('i');
  const ey = await inchToClient(p, 4.5, 7.6); await p.mouse.click(ey.x, ey.y); await settle(p);
  check('eyedropper picks the ground shade', await p.evaluate(() => __studio.S.activeYarn === 'y2'));
  const cz = await inchToClient(p, 1.6, 8.4); await p.mouse.move(cz.x, cz.y); for (let k = 0; k < 6; k++) await p.mouse.wheel(0, -200);
  await settle(p); await shot(p, '06-chart-zoomed');
  await p.keyboard.press('Control+0'); await settle(p);
  await p.keyboard.press('3'); await settle(p);
  check('split view shows swipe handle', await p.evaluate(() => !document.querySelector('#splitter').hidden && document.querySelector('#stage').dataset.view === 'split' && !!document.querySelector('#chartcv').style.clipPath));
  await shot(p, '07-split');
  await p.keyboard.press('1'); await settle(p);
  // a close-up of the knitted fabric
  const fc = await inchToClient(p, 2.6, 2.2);
  await p.mouse.move(fc.x, fc.y); for (let k = 0; k < 7; k++) await p.mouse.wheel(0, -200);
  await p.keyboard.press('v'); await settle(p);
  await shot(p, '08-fabric-closeup');
  await p.keyboard.press('Control+0'); await settle(p);

  // 7. add text with T, check selection + properties
  await p.keyboard.press('t'); await settle(p);
  check('T adds a text layer and focuses its text', await p.evaluate(() => { const L = __studio.doc.layers.find((l) => l.id === __studio.S.sel); return L && L.type === 'text' && document.activeElement.id === 'propText'; }));
  await p.keyboard.type('NEW'); await p.keyboard.press('Escape'); await settle(p);
  await shot(p, '09-new-text');

  // 8. export: front, 300 dpi → renderRegion PNG of 1800 × 2700
  await p.click('#exportBtn');
  await p.waitForSelector('#exportDlg[open]');
  await p.check('#exWhat input[value="front"]');
  check('export size readout', /1800 × 2700/.test(await p.textContent('#exSize')));
  await shot(p, '10-export-dialog');
  await p.click('#exFmt button[data-fmt="png"]');
  await p.click('#exPng', { noWaitAfter: true });
  await p.waitForFunction(() => window.__saved.some((s) => /\.png$/.test(s.filename) && !/chart/.test(s.filename)), null, { timeout: 240000 });
  const png = await p.evaluate(() => window.__saved.find((s) => /\.png$/.test(s.filename) && !/chart/.test(s.filename)));
  check('export PNG blob has the right pixel size', png.png && png.w === 1800 && png.h === 2700, JSON.stringify(png));
  await p.click('#exChart', { noWaitAfter: true });
  await p.waitForFunction(() => window.__saved.some((s) => /chart\.png$/.test(s.filename)), null, { timeout: 60000 });
  const cp = await p.evaluate(() => window.__saved.find((s) => /chart\.png$/.test(s.filename)));
  check('chart PNG exported', cp.png && cp.w > 600 && cp.h > 900, JSON.stringify(cp));
  await p.click('#exJson');
  await p.waitForFunction(() => window.__saved.some((s) => /\.json$/.test(s.filename)), null, { timeout: 10000 });
  check('project JSON saved', true);
  await p.keyboard.press('Escape');

  // 9. autosave
  await p.waitForTimeout(800);
  check('autosaved to localStorage', await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('stitch-setter-v3:doc')).layers.some((l) => l.text === 'NEW'); } catch { return false; } }));

  check('no console errors (desktop)', errors.length === 0, errors.slice(0, 5).join(' | '));
  check('only Google Fonts requested externally', external.every((u) => u.startsWith('https://fonts.g')), external.filter((u) => !u.startsWith('https://fonts.g')).join(' '));

  // write the exported PNGs to disk for inspection
  for (const [re, name] of [[/chart\.png$/, 'e2e-export-chart.png'], [/front-300dpi\.png$/, 'e2e-export-front-300dpi.png']]) {
    const b64 = await p.evaluate(async (src) => { const r = new RegExp(src); const k = Object.keys(window.__blobs).find((f) => r.test(f)); if (!k) return null; const u = new Uint8Array(await window.__blobs[k].arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }, re.source);
    if (b64) { writeFileSync(join(out, name), Buffer.from(b64, 'base64')); console.log('  wrote ' + name); }
  }

  /* ------------------------------------------------------------ phone */
  const ph = await open({ width: 390, height: 844 });
  check('phone: no horizontal scroll', await ph.p.evaluate(() => document.documentElement.scrollWidth <= 390), String(await ph.p.evaluate(() => document.documentElement.scrollWidth)));
  check('phone: stage is visible and sized', await ph.p.evaluate(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return r.width >= 380 && r.height > 300; }));
  await shot(ph.p, '11-phone-top');
  await ph.p.click('#layers .layer:has-text("John (top)")'); await settle(ph.p);
  await shot(ph.p, '12-phone-full', true);
  check('no console errors (phone)', ph.errors.length === 0, ph.errors.slice(0, 5).join(' | '));
} catch (e) {
  failed++; console.log('FAIL  exception —', e.stack || e.message);
} finally {
  await browser.close();
}
console.log(`\n${failed ? failed + ' FAILED' : 'ALL PASSED'}  (${((Date.now() - T0) / 1000).toFixed(0)} s)`);
process.exit(failed ? 1 : 0);
