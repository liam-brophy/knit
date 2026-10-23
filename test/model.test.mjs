// Model tests (pure node). Run: node test/model.test.mjs
import assert from 'node:assert/strict';
import {
  TRIM_PRESETS, SPINE_PAPERS, YARN_PRESETS, DOC_PRESETS, createDoc, panels, chartDims, serialize, deserialize,
  newLayer, newYarn, spineWidth, layerOrigin,
} from '../src/model/doc.js';
import { composeChart, cellAtInches, cellCentre, paintKey, textMetrics } from '../src/model/compose.js';

/* ---------- fake canvas: glyphs are solid 0.6em × 0.7em boxes, transforms honoured ---------- */
function fakeCanvas(w, h) {
  const cv = { _w: w, _h: h, buf: new Uint8ClampedArray(w * h * 4) };
  Object.defineProperty(cv, 'width', { get: () => cv._w, set: (v) => { cv._w = v; cv.buf = new Uint8ClampedArray(cv._w * cv._h * 4); } });
  Object.defineProperty(cv, 'height', { get: () => cv._h, set: (v) => { cv._h = v; cv.buf = new Uint8ClampedArray(cv._w * cv._h * 4); } });
  let M = [1, 0, 0, 1, 0, 0];
  const px = () => +(/(\d+(?:\.\d+)?)px/.exec(ctx.font) || [0, 10])[1];
  const ctx = {
    font: '10px serif', fillStyle: '#000', textAlign: 'left', textBaseline: 'alphabetic',
    setTransform(a, b, c, d, e, f) { M = [a, b, c, d, e, f]; },
    clearRect(x, y, w2, h2) { for (let j = y; j < y + h2 && j < cv._h; j++) cv.buf.fill(0, (j * cv._w + x) * 4, (j * cv._w + Math.min(cv._w, x + w2)) * 4); },
    measureText(t) { const p = px(), w2 = 0.6 * p * [...t].length; return { width: w2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w2, actualBoundingBoxAscent: 0.7 * p, actualBoundingBoxDescent: 0, fontBoundingBoxAscent: 0.8 * p, fontBoundingBoxDescent: 0.2 * p }; },
    fillText(t, x, y) {
      const p = px(), x0 = x, x1 = x + 0.6 * p * [...t].length, y0 = y - 0.7 * p, y1 = y;
      const [a, b, c, d, e, f] = M, det = a * d - b * c;
      const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([u, v]) => [a * u + c * v + e, b * u + d * v + f]);
      const X0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q[0])))), X1 = Math.min(cv._w, Math.ceil(Math.max(...pts.map((q) => q[0]))));
      const Y0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q[1])))), Y1 = Math.min(cv._h, Math.ceil(Math.max(...pts.map((q) => q[1]))));
      for (let j = Y0; j < Y1; j++) for (let i = X0; i < X1; i++) {
        const X = i + 0.5 - e, Y = j + 0.5 - f, u = (d * X - c * Y) / det, v = (-b * X + a * Y) / det;
        if (u >= x0 && u < x1 && v >= y0 && v < y1) cv.buf[(j * cv._w + i) * 4 + 3] = 255;
      }
    },
    getImageData(x, y, w2, h2) {
      const out = new Uint8ClampedArray(w2 * h2 * 4);
      for (let j = 0; j < h2; j++) out.set(cv.buf.subarray(((y + j) * cv._w + x) * 4, ((y + j) * cv._w + x + w2) * 4), j * w2 * 4);
      return { data: out, width: w2, height: h2 };
    },
  };
  cv.getContext = () => ctx;
  return cv;
}
const opts = { createCanvas: fakeCanvas };
const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≉ ${b}`);
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('presets exist', () => {
  for (const id of ['5x8', '5.25x8', '5.5x8.5', '6x9', '6.14x9.21', '7x10', 'b-format', 'a-format', 'custom']) assert.ok(TRIM_PRESETS.find((t) => t.id === id), id);
  const b = TRIM_PRESETS.find((t) => t.id === 'b-format'), a = TRIM_PRESETS.find((t) => t.id === 'a-format');
  near(b.w, 5.06, 0.01); near(b.h, 7.81, 0.01); near(a.w, 4.33, 0.01); near(a.h, 7.01, 0.01);
  assert.equal(YARN_PRESETS.length, 16);
  assert.ok(SPINE_PAPERS.length >= 3 && SPINE_PAPERS.every((p) => Math.abs(1 / p.caliper - p.ppi) / p.ppi < 0.02));
  for (const id of Object.keys(DOC_PRESETS)) { const d = createDoc(id); assert.equal(d.version, 3); assert.ok(d.yarns.length <= 16); }
});

test('panels + chartDims: front with bleed', () => {
  const d = createDoc('john');
  const P = panels(d);
  assert.deepEqual(P.sheet, { x: 0, y: 0, w: 6.25, h: 9.25 });
  assert.deepEqual(P.front, { x: 0.125, y: 0.125, w: 6, h: 9 });
  assert.deepEqual(P.trim, P.front);
  assert.equal(P.back, undefined); assert.equal(P.spine, undefined);
  assert.deepEqual(P.safe.front, { x: 0.375, y: 0.375, w: 5.5, h: 8.5 });
  const D = chartDims(d);
  assert.equal(D.cols, Math.round(6.25 * 18)); assert.equal(D.rows, Math.round(9.25 * 18 * 28 / 20));
  near(D.cellW, 6.25 / D.cols); near(D.cellH, 9.25 / D.rows);
  // row height ≈ stitch width × sts/rows
  near(D.cellH / D.cellW, 20 / 28, 0.01);
});

test('panels + chartDims: wrap with bleed, spine from pages', () => {
  const d = createDoc('john-wrap');
  assert.equal(d.spine.mode, 'pages');
  near(spineWidth(d), 320 * 0.0025);
  const P = panels(d);
  near(P.sheet.w, 0.125 * 2 + 6 * 2 + 0.8, 1e-9); near(P.sheet.h, 9.25);
  assert.deepEqual(P.back, { x: 0.125, y: 0.125, w: 6, h: 9 });
  near(P.spine.x, 6.125); near(P.spine.w, 0.8);
  near(P.front.x, 6.925); near(P.trim.w, 12.8);
  assert.deepEqual(P.folds.map((v) => +v.toFixed(6)), [6.125, 6.925]);
  near(P.safe.spine.x, 6.125 + 0.0625); near(P.safe.spine.w, 0.8 - 0.125);
  d.spine.mode = 'width'; d.spine.width = 1.25; near(panels(d).front.x, 0.125 + 6 + 1.25);
  d.bleed = 0; const P0 = panels(d); near(P0.sheet.w, 13.25); near(P0.back.x, 0);
  const D = chartDims(d); assert.equal(D.cols, Math.round(13.25 * 18));
  // layer origins follow the panel
  near(layerOrigin(d, { panel: 'front' }).x, P0.front.x);
  d.layout = 'front'; assert.equal(layerOrigin(d, { panel: 'spine' }), null);
});

test('serialize round-trip', () => {
  for (const id of ['john', 'john-wrap', 'patchwork']) {
    const d = createDoc(id);
    d.layers.find((l) => l.type === 'paint').cells[paintKey(d, 3, 4)] = 'y2';
    const back = deserialize(serialize(d));
    assert.deepEqual(back, d);
    assert.deepEqual(deserialize(JSON.parse(serialize(d))), d);
  }
});

test('deserialize partial / old docs', () => {
  const d = deserialize('{"trim":{"w":5,"h":8}}');
  assert.equal(d.version, 3); assert.equal(d.trim.w, 5); assert.equal(d.layout, 'front'); assert.equal(d.bleed, 0.125);
  assert.equal(d.knit.stsPerInch, 18); assert.deepEqual(d.knit.gauge, { sts: 20, rows: 28 });
  assert.ok(d.render.light.azimuth === 135 && d.guides.safe === true && d.yarns.length >= 1);
  const old = deserialize({ version: 2, layout: 'bogus', knit: { stsPerInch: 14 }, render: { halo: 0.8 },
    yarns: [{ id: 'a', hex: '#ff0000' }, { id: 'a', hex: 'nope' }],
    layers: [{ type: 'text', text: 'Hi', yarns: ['a', 'zzz'], rotate: 45 }, { type: 'wat' }, { type: 'rect', yarn: 'a', flecks: { density: 5, yarns: ['a', 'q'] } }, null] });
  assert.equal(old.layout, 'front'); assert.equal(old.knit.stsPerInch, 14); assert.equal(old.knit.gauge.rows, 28);
  assert.equal(old.render.halo, 0.8); assert.equal(old.render.plies, 3);
  assert.equal(old.yarns.length, 2); assert.notEqual(old.yarns[0].id, old.yarns[1].id); assert.equal(old.yarns[1].hex, '#888888');
  assert.equal(old.layers.length, 2);
  const t = old.layers[0];
  assert.deepEqual(t.yarns, ['a']); assert.equal(t.rotate, 0); assert.equal(t.anchor, 'middle'); assert.equal(t.fill, 0.45); assert.ok(t.id);
  assert.equal(old.layers[1].flecks.density, 0.1); assert.deepEqual(old.layers[1].flecks.yarns, ['a']);
  // legacy v1/v2 flat settings
  const leg = deserialize({ text: 'John\nof\n\n\nJohn', font: 'Zilla Slab', weight: 600, cols: 118, gaugeSts: 20, gaugeRows: 28, format: '6x9',
    groundA: '#7f9cc6', groundB: '#62b5ae', split: 0.55, yarns: ['#f7f5ef', '#203063'], lines: [{ scale: 100, yarns: [0] }, { scale: 40, yarns: [0] }, { scale: 100, yarns: [0, 1], mix: 'speckle' }], fill: 0.42, seed: 7, flecks: 14, fleckA: '#d9824e' });
  assert.equal(leg.layers.filter((l) => l.type === 'text').length, 3);
  assert.equal(leg.layers.at(-1).type, 'paint');
  assert.ok(composeChart(leg, opts).cols > 0);
});

test('paint layer survives a gauge change', () => {
  const d = createDoc('john');
  const D = chartDims(d);
  const key = paintKey(d, 40, 200, D);
  d.layers.find((l) => l.type === 'paint').cells[key] = 'y6';
  let ch = composeChart(d, opts);
  assert.equal(ch.yarnIndex[200 * ch.cols + 40], 5);
  assert.equal(ch.layerOf[200 * ch.cols + 40], d.layers.length - 1);
  const p = cellCentre(d, 40, 200, D);
  for (const spi of [12, 9, 24, 18]) {
    d.knit.stsPerInch = spi; d.knit.gauge = { sts: 18, rows: 24 };
    ch = composeChart(d, opts);
    const { c, r, inside } = cellAtInches(d, p.x, p.y);
    assert.ok(inside);
    assert.equal(ch.yarnIndex[r * ch.cols + c], 5, `spi ${spi}`);
    let painted = 0; for (let i = 0; i < ch.layerOf.length; i++) if (ch.layerOf[i] === d.layers.length - 1) painted++;
    assert.equal(painted, 1);
  }
  // null = erase (no effect)
  d.layers.find((l) => l.type === 'paint').cells[key] = null;
  ch = composeChart(d, opts);
  for (let i = 0; i < ch.layerOf.length; i++) assert.notEqual(ch.layerOf[i], d.layers.length - 1);
});

test('compose determinism + seed', () => {
  const d = createDoc('john-wrap');
  const a = composeChart(d, opts), b = composeChart(deserialize(serialize(d)), opts);
  assert.deepEqual(a.yarnIndex, b.yarnIndex); assert.deepEqual(a.layerOf, b.layerOf);
  d.knit.seed = 8; const c = composeChart(d, opts);
  assert.notDeepEqual(a.yarnIndex, c.yarnIndex);
  assert.equal(a.palette.length, d.yarns.length);
  assert.ok(a.palette.every((p) => p.rgb.length === 3 && p.rgb.every((v) => v >= 0 && v <= 1)));
  assert.equal(a.yarnIndex.length, a.cols * a.rows); assert.ok(a.layerOf instanceof Int16Array);
});

test('compose layers: fill, rect split, flecks, text coverage', () => {
  const d = createDoc('john');
  const ch = composeChart(d, opts), { cols, rows, cellH } = ch;
  const split = 0.125 + 4.9;
  // bottom-left and top-left corners: crisp at sheet edge despite feather
  for (const i of [(rows - 1) * cols, rows * cols - 1]) assert.equal(ch.layerOf[i], 1, 'teal reaches the bottom bleed corners');
  for (const i of [0, cols - 1]) assert.equal(ch.layerOf[i], 0);
  let teal = 0, blue = 0, fl = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, id = ch.palette[ch.yarnIndex[i]].id, y = (r + 0.5) * cellH;
    if (ch.layerOf[i] > 1) continue; // text
    if (id === 'y6' || id === 'y7') { fl++; continue; }
    if (y > split + 0.1) { assert.equal(id, 'y2'); teal++; }
    if (y < split - 0.1) { assert.equal(id, 'y1'); blue++; }
  }
  const fr = fl / (cols * rows); assert.ok(fr > 0.004 && fr < 0.012, 'fleck rate ' + fr);
  assert.ok(teal > 1000 && blue > 1000);
  // text: "John" (4 boxes of 0.6em) at size 1.62 centred at x=3.02 → 3.888 in wide, 0.7em tall above baseline 1.92
  const li = d.layers.findIndex((l) => l.id === 't-john1');
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let i = 0; i < ch.layerOf.length; i++) if (ch.layerOf[i] === li) { const c = i % cols, r = (i / cols) | 0; x0 = Math.min(x0, c); x1 = Math.max(x1, c); y0 = Math.min(y0, r); y1 = Math.max(y1, r); }
  const m = textMetrics(d.layers[li], d, fakeCanvas(8, 8).getContext('2d'));
  near(m.ink.w, 0.6 * 1.62 * 4, 1e-6); near(m.ink.h, 0.7 * 1.62, 1e-6);
  near(x0 * ch.cellW, m.ink.x, ch.cellW); near((x1 + 1) * ch.cellW, m.ink.x + m.ink.w, ch.cellW);
  near(y0 * ch.cellH, m.ink.y, ch.cellH); near((y1 + 1) * ch.cellH, m.ink.y + m.ink.h, ch.cellH);
});

test('textMetrics: anchors, align, rotation', () => {
  const d = createDoc('john-wrap'), ctx = fakeCanvas(8, 8).getContext('2d'), P = panels(d);
  const L = { ...newLayer('text', d), text: 'ABCD\nAB', size: 1, x: 1, y: 2, align: 'left', anchor: 'baseline', leading: 1.5, tracking: 0, rotate: 0, panel: 'back' };
  let m = textMetrics(L, d, ctx);
  near(m.anchor.x, P.back.x + 1); near(m.anchor.y, P.back.y + 2);
  near(m.x, m.anchor.x); near(m.w, 2.4); near(m.y, m.anchor.y - 0.8); near(m.h, 0.8 + 1.5 + 0.2);
  assert.equal(m.lines.length, 2); near(m.lines[1].baseline, 1.5);
  m = textMetrics({ ...L, anchor: 'top', align: 'right' }, d, ctx); near(m.y, m.anchor.y); near(m.x + m.w, m.anchor.x);
  m = textMetrics({ ...L, anchor: 'middle', align: 'center' }, d, ctx); near(m.y + m.h / 2, m.anchor.y); near(m.x + m.w / 2, m.anchor.x);
  const m90 = textMetrics({ ...L, anchor: 'middle', align: 'center', rotate: 90 }, d, ctx);
  near(m90.w, m.h, 1e-9); near(m90.h, m.w, 1e-9); near(m90.x + m90.w / 2, m.anchor.x); near(m90.y + m90.h / 2, m.anchor.y);
  // rotate 90 = clockwise: local +x (reading direction) runs down the page
  const r = textMetrics({ ...L, rotate: 90 }, d, ctx);
  near(r.corners[1].y - r.corners[0].y, 2.4); near(r.corners[1].x, r.corners[0].x);
  const rm = textMetrics({ ...L, rotate: -90 }, d, ctx); near(rm.corners[1].y - rm.corners[0].y, -2.4);
  const lp = r.toLocal(r.corners[2].x, r.corners[2].y); near(lp.x, 2.4); near(lp.y, 1.5 + 0.2);
  // spine text composes inside the spine
  const ch = composeChart(d, opts), li = d.layers.findIndex((l) => l.id === 's-title');
  let cnt = 0;
  for (let i = 0; i < ch.layerOf.length; i++) if (ch.layerOf[i] === li) { cnt++; const x = ((i % ch.cols) + 0.5) * ch.cellW; assert.ok(x > P.spine.x && x < P.spine.x + P.spine.w); }
  assert.ok(cnt > 50);
  assert.equal(textMetrics({ ...L, panel: 'spine' }, { ...d, layout: 'front' }, ctx), null);
});

test('mixes produce multiple yarns deterministically', () => {
  const d = createDoc('patchwork');
  const t = d.layers.find((l) => l.type === 'text');
  for (const mix of ['patches', 'stripe', 'letters', 'speckle']) {
    t.mix = mix;
    const a = composeChart(d, opts), b = composeChart(d, opts), li = d.layers.indexOf(t), used = new Set();
    for (let i = 0; i < a.layerOf.length; i++) if (a.layerOf[i] === li) used.add(a.yarnIndex[i]);
    assert.ok(used.size >= 3, mix + ' ' + used.size); assert.deepEqual(a.yarnIndex, b.yarnIndex);
  }
  t.mix = 'solid'; const s = composeChart(d, opts), li = d.layers.indexOf(t), u = new Set();
  for (let i = 0; i < s.layerOf.length; i++) if (s.layerOf[i] === li) u.add(s.yarnIndex[i]);
  assert.equal(u.size, 1);
});

test('helpers: newLayer, newYarn, cellAtInches', () => {
  const d = createDoc('john');
  for (const type of ['fill', 'rect', 'text', 'paint']) { const L = newLayer(type, d); assert.equal(L.type, type); assert.ok(L.id); assert.equal(L.visible, true); }
  const t = newLayer('text', d); assert.equal(t.panel, 'front'); assert.equal(t.x, 3); assert.equal(t.yarns.length, 1); assert.notEqual(t.yarns[0], 'y1');
  assert.throws(() => newLayer('nope', d));
  const y = newYarn(d); assert.ok(!d.yarns.some((q) => q.id === y.id || q.hex === y.hex)); assert.ok(y.name && y.hex);
  const D = chartDims(d), p = cellCentre(d, 7, 9, D), c = cellAtInches(d, p.x, p.y, D);
  assert.deepEqual([c.c, c.r, c.inside], [7, 9, true]);
  assert.equal(cellAtInches(d, -0.01, 1).inside, false);
});

console.log(`\n${n} model tests passed`);
