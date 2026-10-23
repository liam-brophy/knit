// Knit — layers → knitting chart. Owner: model.
// Port of the v1/v2 coverage → threshold → mix approach (legacy/v2/src/chart.js), now in inch space:
// text is drawn into a supersampled mask whose pixels map to cells, with an inch-space transform, so letterforms
// keep their true printed proportions whatever the gauge. All randomness is a pure hash of (seed, cell, layer).
import { panels, chartDims, layerOrigin } from './doc.js';

export const SS = 4;              // mask supersampling per cell axis
const PX = 100;                   // canvas px per inch of font size (fonts are drawn at size*PX px, then scaled)

/* ---------- deterministic noise (identical maths to v1/v2) ---------- */
export function h32(a) {
  a |= 0; a = Math.imul(a ^ (a >>> 16), 0x7feb352d); a = Math.imul(a ^ (a >>> 15), 0x846ca68b); a ^= a >>> 16;
  return (a >>> 0) / 4294967296;
}
export function makeRng(seed) {
  const s = Math.imul((seed | 0) + 1, 0xC2B2AE3D);
  const rnd = (i, salt) => h32(Math.imul(i, 0x9E3779B1) ^ Math.imul(salt + 1, 0x85EBCA77) ^ s);
  const vnoise = (x, y, salt) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const k = Math.imul(salt + (seed | 0) * 31, 0x9E3779B1);
    const h = (a, b) => h32(Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ k);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, s2) => vnoise(x, y, s2) * 0.55 + vnoise(x * 2.1, y * 2.1, s2 + 17) * 0.3 + vnoise(x * 4.3, y * 4.3, s2 + 43) * 0.15;
  return { rnd, vnoise, fbm };
}
function strHash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) & 0xffff; }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const hexToRgb = (h) => {
  h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16) || 0; return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/* ---------- cells ---------- */
export function cellAtInches(doc, xIn, yIn, dims = chartDims(doc)) {
  const c = Math.floor(xIn / dims.cellW), r = Math.floor(yIn / dims.cellH);
  return { c, r, inside: c >= 0 && r >= 0 && c < dims.cols && r < dims.rows };
}
export function cellCentre(doc, c, r, dims = chartDims(doc)) {
  return { x: (c + 0.5) * dims.cellW, y: (r + 0.5) * dims.cellH };
}
/** Key used by paint layers: cell-centre inches rounded to 1e-3. */
export function paintKey(doc, c, r, dims = chartDims(doc)) {
  const p = cellCentre(doc, c, r, dims);
  return `${(Math.round(p.x * 1000) / 1000)},${(Math.round(p.y * 1000) / 1000)}`;
}

/* ---------- canvases (reused) ---------- */
const canvasCache = new WeakMap();
function defaultCreateCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  throw new Error('composeChart: no canvas available — pass { createCanvas }');
}
function getMask(createCanvas, w, h) {
  const key = createCanvas || defaultCreateCanvas;
  let m = canvasCache.get(key);
  if (!m) {
    const canvas = key(Math.max(64, w), Math.max(64, h));
    m = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
    canvasCache.set(key, m);
  }
  if (m.canvas.width < w || m.canvas.height < h) {
    m.canvas.width = Math.max(m.canvas.width, Math.ceil(w * 1.25));
    m.canvas.height = Math.max(m.canvas.height, Math.ceil(h * 1.25));
    m.ctx = m.canvas.getContext('2d', { willReadFrequently: true });
  }
  return m;
}

/* ---------- text layout ---------- */
export const fontCss = (layer, px) => `${layer.italic ? 'italic ' : ''}${layer.weight || 400} ${px}px "${layer.font || 'serif'}", serif`;

const lsMode = new WeakMap(); // ctx → 'none' | 'measured' | 'unmeasured'
function letterSpacingMode(ctx) {
  let m = lsMode.get(ctx);
  if (m) return m;
  if (!('letterSpacing' in ctx)) m = 'none';
  else {
    ctx.font = '100px serif'; ctx.letterSpacing = '0px'; const a = ctx.measureText('iii').width;
    ctx.letterSpacing = '10px'; const b = ctx.measureText('iii').width; ctx.letterSpacing = '0px';
    m = b - a > 15 ? 'measured' : 'unmeasured';
  }
  lsMode.set(ctx, m);
  return m;
}

const layoutCache = new Map();
export function clearTextCache() { layoutCache.clear(); }
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', clearTextCache);
}

/** Local (unrotated) layout of a text layer, in inches, origin = anchor point, y down. */
function layoutText(layer, ctx, wantBounds) {
  const size = Math.max(0.01, +layer.size || 1), fpx = size * PX, trPx = (+layer.tracking || 0) * fpx;
  const key = [fontCss(layer, fpx), layer.text, trPx, layer.leading, layer.align, layer.anchor, wantBounds ? 1 : 0].join('|');
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const mode = letterSpacingMode(ctx);
  ctx.font = fontCss(layer, fpx);
  if (mode !== 'none') ctx.letterSpacing = trPx + 'px';
  const measure = (t) => {
    const m = ctx.measureText(t);
    let w = m.width;
    const n = [...t].length;
    if (mode === 'measured') w -= trPx; else if (mode === 'unmeasured' && n) w += trPx * (n - 1); else if (mode === 'none' && n) w += trPx * (n - 1);
    return { m, w };
  };
  const probe = ctx.measureText('Hg');
  const asc = probe.fontBoundingBoxAscent ?? fpx * 0.8, desc = probe.fontBoundingBoxDescent ?? fpx * 0.22;
  const lh = size * (+layer.leading || 1);
  const texts = String(layer.text ?? '').split('\n');
  const lines = texts.map((t, i) => {
    const { m, w } = measure(t);
    const width = w / PX;
    const x = layer.align === 'left' ? 0 : layer.align === 'right' ? -width : -width / 2;
    const L = { text: t, x, baseline: i * lh, width,
      ink: t.trim() ? { l: x - (m.actualBoundingBoxLeft ?? 0) / PX, r: x + (m.actualBoundingBoxRight ?? w) / PX,
        t: i * lh - (m.actualBoundingBoxAscent ?? asc) / PX, b: i * lh + (m.actualBoundingBoxDescent ?? desc) / PX } : null };
    if (wantBounds) {
      // glyph boundaries along the line (inches from line x), per code point
      const chars = [...t]; L.bounds = [0];
      for (let j = 1; j <= chars.length; j++) {
        const s = chars.slice(0, j).join(''); const mm = ctx.measureText(s).width;
        L.bounds.push((mode === 'unmeasured' || mode === 'none' ? mm + trPx * j : mm) / PX);
      }
    }
    return L;
  });
  if (mode !== 'none') ctx.letterSpacing = '0px';
  const A = asc / PX, D = desc / PX;
  const top = -A, bottom = (lines.length - 1) * lh + D;
  const dy = layer.anchor === 'top' ? A : layer.anchor === 'baseline' ? 0 : -(top + bottom) / 2;
  let left = Infinity, right = -Infinity, il = Infinity, ir = -Infinity, it = Infinity, ib = -Infinity;
  for (const L of lines) {
    L.baseline += dy;
    left = Math.min(left, L.x); right = Math.max(right, L.x + L.width);
    if (L.ink) { L.ink.t += dy; L.ink.b += dy; il = Math.min(il, L.ink.l); ir = Math.max(ir, L.ink.r); it = Math.min(it, L.ink.t); ib = Math.max(ib, L.ink.b); }
  }
  if (!Number.isFinite(left)) { left = 0; right = 0; }
  const out = { size, fpx, trPx, mode, ascent: A, descent: D, lineHeight: lh, lines,
    box: { left, right, top: top + dy, bottom: bottom + dy },
    ink: Number.isFinite(il) ? { left: il, right: ir, top: it, bottom: ib } : null };
  if (layoutCache.size > 400) layoutCache.clear();
  layoutCache.set(key, out);
  return out;
}

function aabb(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Exact geometry of a text layer in SHEET inches.
 * Returns { anchor:{x,y}, rotate, corners:[tl,tr,br,bl] (rotated layout box: line advance widths × ascent..descent),
 *   x,y,w,h (axis-aligned box of corners), ink:{x,y,w,h,corners}|null (actual glyph ink), local:{left,top,right,bottom}
 *   (unrotated, relative to anchor), lines:[{text,x,baseline,width}] (local inches), ascent, descent, lineHeight,
 *   toLocal(x,y), toSheet(lx,ly) } — or null if the layer's panel doesn't exist in this layout.
 */
export function textMetrics(layer, doc, measureCtx, P = panels(doc)) {
  const o = layerOrigin(doc, layer, P);
  if (!o) return null;
  const ctx = measureCtx || getMask(null, 64, 64).ctx;
  const lay = layoutText(layer, ctx, false);
  const ax = o.x + (+layer.x || 0), ay = o.y + (+layer.y || 0);
  const th = ((+layer.rotate || 0) * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
  const toSheet = (lx, ly) => ({ x: ax + lx * cs - ly * sn, y: ay + lx * sn + ly * cs });
  const toLocal = (x, y) => { const dx = x - ax, dy = y - ay; return { x: dx * cs + dy * sn, y: -dx * sn + dy * cs }; };
  const b = lay.box;
  const corners = [toSheet(b.left, b.top), toSheet(b.right, b.top), toSheet(b.right, b.bottom), toSheet(b.left, b.bottom)];
  let ink = null;
  if (lay.ink) {
    const k = lay.ink, ic = [toSheet(k.left, k.top), toSheet(k.right, k.top), toSheet(k.right, k.bottom), toSheet(k.left, k.bottom)];
    ink = { ...aabb(ic), corners: ic };
  }
  return { anchor: { x: ax, y: ay }, rotate: +layer.rotate || 0, corners, ...aabb(corners), ink,
    local: { ...b }, lines: lay.lines.map((l) => ({ text: l.text, x: l.x, baseline: l.baseline, width: l.width })),
    ascent: lay.ascent, descent: lay.descent, lineHeight: lay.lineHeight, toLocal, toSheet };
}

/* ---------- composition ---------- */
export function composeChart(doc, { createCanvas } = {}) {
  const dims = chartDims(doc), { cols, rows, cellW, cellH } = dims, N = cols * rows;
  const P = panels(doc);
  const yarnIndex = new Uint8Array(N), layerOf = new Int16Array(N).fill(-1);
  const yid = new Map(doc.yarns.map((y, i) => [y.id, i]));
  const seed = (doc.knit && doc.knit.seed) | 0;
  const { rnd, vnoise, fbm } = makeRng(seed);
  const idx = (ids) => (ids || []).map((id) => yid.get(id)).filter((v) => v !== undefined);
  const sheetW = P.sheet.w, sheetH = P.sheet.h;
  // knitting order: flat knitting from the bottom-right, alternating direction each row
  const knitOrder = (c, r) => { const rb = rows - 1 - r; return rb * cols + (rb & 1 ? c : cols - 1 - c); };

  const pickMix = (mix, n, i, c, r, salt, scaleIn, run) => {
    if (n <= 1) return 0;
    if (mix === 'speckle') return Math.floor(rnd(i, salt + 31) * n);
    if (mix === 'stripe') return Math.floor((knitOrder(c, r) + Math.floor(vnoise(c / 6, r / 6, salt + 5) * 4)) / run) % n;
    // patches (also the fallback for 'letters' on blocks)
    const x = (c + 0.5) * cellW, y = (r + 0.5) * cellH;
    const v = fbm(x / scaleIn, y / scaleIn, salt + 11);
    return Math.min(n - 1, Math.floor(clamp((v - 0.22) / 0.56, 0, 0.999) * n));
  };

  const applyFlecks = (L, i, li, salt, fy) => {
    if (fy.length && rnd(i, salt + 91) < L.flecks.density) yarnIndex[i] = fy[Math.floor(rnd(i, salt + 92) * fy.length)];
  };

  const block = (L, li, x0, y0, x1, y1) => {
    const multi = L.mix && L.mix !== 'solid' && L.yarns && L.yarns.length > 1;
    const ys = multi ? idx(L.yarns) : idx([L.yarn ?? (L.yarns && L.yarns[0])]);
    if (!ys.length) return;
    const salt = strHash(L.id) + 1, n = ys.length, fy = L.flecks && L.flecks.density > 0 ? idx(L.flecks.yarns) : [];
    const f = Math.max(0, +L.feather || 0);
    const run = Math.max(3, Math.round(0.5 / cellW)), sc = Math.max(4 * cellW, 0.6);
    // only edges that lie inside the sheet are feathered (an edge at the bleed stays crisp)
    const eps = 1e-6;
    const fl = f && x0 > eps, fr = f && x1 < sheetW - eps, ft = f && y0 > eps, fb = f && y1 < sheetH - eps;
    const c0 = Math.max(0, Math.floor((x0 - f) / cellW)), c1 = Math.min(cols - 1, Math.ceil((x1 + f) / cellW));
    const r0 = Math.max(0, Math.floor((y0 - f) / cellH)), r1 = Math.min(rows - 1, Math.ceil((y1 + f) / cellH));
    for (let r = r0; r <= r1; r++) {
      const cy = (r + 0.5) * cellH;
      for (let c = c0; c <= c1; c++) {
        const cx = (c + 0.5) * cellW, i = r * cols + c;
        if (f) {
          let d = Infinity;
          d = Math.min(d, fl ? cx - x0 : (cx >= x0 ? Infinity : -Infinity));
          d = Math.min(d, fr ? x1 - cx : (cx < x1 ? Infinity : -Infinity));
          d = Math.min(d, ft ? cy - y0 : (cy >= y0 ? Infinity : -Infinity));
          d = Math.min(d, fb ? y1 - cy : (cy < y1 ? Infinity : -Infinity));
          if (d === -Infinity) continue;
          if (d !== Infinity && d < f && rnd(i, salt + 3) >= smooth(-f, f, d)) continue;
        } else if (cx < x0 || cx >= x1 || cy < y0 || cy >= y1) continue;
        yarnIndex[i] = ys[pickMix(L.mix, n, i, c, r, salt, sc, run)];
        layerOf[i] = li;
        if (fy.length) applyFlecks(L, i, li, salt, fy);
      }
    }
  };

  const text = (L, li) => {
    const ys = idx(L.yarns && L.yarns.length ? L.yarns : []);
    if (!ys.length || !String(L.text || '').trim()) return;
    const mask = getMask(createCanvas, 64, 64);
    const wantBounds = L.mix === 'letters' && ys.length > 1;
    const o = layerOrigin(doc, L, P);
    if (!o) return;
    const lay = layoutText(L, mask.ctx, wantBounds);
    const ax = o.x + (+L.x || 0), ay = o.y + (+L.y || 0);
    const th = ((+L.rotate || 0) * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
    const toSheet = (lx, ly) => ({ x: ax + lx * cs - ly * sn, y: ay + lx * sn + ly * cs });
    const b = lay.box, k = lay.ink || b;
    const bx = [Math.min(b.left, k.left), Math.max(b.right, k.right)], by = [Math.min(b.top, k.top), Math.max(b.bottom, k.bottom)];
    const bb = aabb([toSheet(bx[0], by[0]), toSheet(bx[1], by[0]), toSheet(bx[1], by[1]), toSheet(bx[0], by[1])]);
    const c0 = Math.max(0, Math.floor(bb.x / cellW) - 1), c1 = Math.min(cols, Math.ceil((bb.x + bb.w) / cellW) + 1);
    const r0 = Math.max(0, Math.floor(bb.y / cellH) - 1), r1 = Math.min(rows, Math.ceil((bb.y + bb.h) / cellH) + 1);
    const cw = c1 - c0, ch = r1 - r0;
    if (cw <= 0 || ch <= 0) return;
    const W = cw * SS, H = ch * SS;
    const { ctx } = getMask(createCanvas, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // local font px → sheet inches → mask px
    const sx = SS / cellW, sy = SS / cellH, ox = c0 * cellW, oy = r0 * cellH;
    ctx.setTransform(sx * cs / PX, sy * sn / PX, -sx * sn / PX, sy * cs / PX, sx * (ax - ox), sy * (ay - oy));
    ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = fontCss(L, lay.fpx);
    if (lay.mode !== 'none') ctx.letterSpacing = lay.trPx + 'px';
    for (const ln of lay.lines) {
      if (!ln.text) continue;
      if (lay.mode === 'none' && lay.trPx) {
        let x = ln.x * PX; for (const ch2 of ln.text) { ctx.fillText(ch2, x, ln.baseline * PX); x += ctx.measureText(ch2).width + lay.trPx; }
      } else ctx.fillText(ln.text, ln.x * PX, ln.baseline * PX);
    }
    if (lay.mode !== 'none') ctx.letterSpacing = '0px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const img = ctx.getImageData(0, 0, W, H).data;
    const thr = (1 - clamp(+L.fill || 0.45, 0.01, 0.99)) * SS * SS * 255;
    const salt = strHash(L.id) + 1, n = ys.length, mix = L.mix || 'solid';
    const run = Math.max(3, Math.round((lay.size * 0.14) / cellW)), sc = Math.max(4 * cellW, lay.size * 0.9);
    for (let rr = 0; rr < ch; rr++) {
      for (let cc = 0; cc < cw; cc++) {
        let sum = 0;
        for (let dy = 0; dy < SS; dy++) { let o2 = ((rr * SS + dy) * W + cc * SS) * 4 + 3; for (let dx = 0; dx < SS; dx++, o2 += 4) sum += img[o2]; }
        if (sum <= thr) continue;
        const c = c0 + cc, r = r0 + rr, i = r * cols + c;
        let kk = 0;
        if (n > 1 && mix !== 'solid') {
          if (mix === 'letters' || mix === 'patches') {
            // locate line (and glyph) in the text's own frame
            const dxs = (c + 0.5) * cellW - ax, dys = (r + 0.5) * cellH - ay;
            const lx = dxs * cs + dys * sn, ly = -dxs * sn + dys * cs;
            let li2 = 0, best = Infinity;
            lay.lines.forEach((ln, j) => { if (!ln.text.trim()) return; const d = Math.abs(ly - (ln.baseline - lay.ascent * 0.35)); if (d < best) { best = d; li2 = j; } });
            const ln = lay.lines[li2];
            if (mix === 'letters' && ln.bounds) {
              const px2 = lx - ln.x; let j = 0; while (j < ln.bounds.length - 2 && px2 >= ln.bounds[j + 1]) j++;
              kk = (j + li2 * 3) % n;
            } else {
              const v = fbm(lx / sc, ly / sc, salt + 11 + li2 * 7);
              kk = Math.min(n - 1, Math.floor(clamp((v - 0.22) / 0.56, 0, 0.999) * n));
            }
          } else kk = pickMix(mix, n, i, c, r, salt, sc, run);
        }
        yarnIndex[i] = ys[kk];
        layerOf[i] = li;
      }
    }
  };

  const paint = (L, li) => {
    const cells = L.cells || {};
    for (const key in cells) {
      const v = cells[key];
      if (v == null) continue;
      const yi = yid.get(v);
      if (yi === undefined) continue;
      const comma = key.indexOf(',');
      const x = +key.slice(0, comma), y = +key.slice(comma + 1);
      const c = Math.floor(x / cellW), r = Math.floor(y / cellH);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const i = r * cols + c;
      yarnIndex[i] = yi; layerOf[i] = li;
    }
  };

  doc.layers.forEach((L, li) => {
    if (!L || L.visible === false) return;
    if (L.type === 'fill') block(L, li, -1, -1, sheetW + 1, sheetH + 1);
    else if (L.type === 'rect') {
      const o = layerOrigin(doc, L, P); if (!o) return;
      let x = o.x + (+L.x || 0), y = o.y + (+L.y || 0), w = +L.w || 0, h = +L.h || 0;
      if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
      block(L, li, x, y, x + w, y + h);
    } else if (L.type === 'text') text(L, li);
    else if (L.type === 'paint') paint(L, li);
  });

  const palette = doc.yarns.map((y) => ({ id: y.id, name: y.name, hex: y.hex, rgb: hexToRgb(y.hex), heather: y.heather ?? 0.3, fuzz: y.fuzz ?? 0.3 }));
  return { cols, rows, cellW, cellH, yarnIndex, layerOf, palette, seed };
}
