// Stitch Setter v3 — document model (plain JSON). Owner: model.
// Document space is inches, origin = top-left of the full printed sheet INCLUDING bleed, x right, y down.

export const DOC_VERSION = 3;

/* ---------- trim sizes ---------- */
const mm = (v) => Math.round((v / 25.4) * 100) / 100;
export const TRIM_PRESETS = [
  { id: '5x8', label: '5 × 8 in', w: 5, h: 8 },
  { id: '5.25x8', label: '5.25 × 8 in', w: 5.25, h: 8 },
  { id: '5.5x8.5', label: '5.5 × 8.5 in (digest)', w: 5.5, h: 8.5 },
  { id: '6x9', label: '6 × 9 in (US trade)', w: 6, h: 9 },
  { id: '6.14x9.21', label: '6.14 × 9.21 in (royal, 156 × 234 mm)', w: 6.14, h: 9.21 },
  { id: '7x10', label: '7 × 10 in', w: 7, h: 10 },
  { id: 'a-format', label: 'A-format 110 × 178 mm (4.33 × 7.01 in)', w: mm(110), h: mm(178) },
  { id: 'b-format', label: 'B-format 129 × 198 mm (5.06 × 7.81 in)', w: 5.06, h: 7.81 },
  { id: 'demy', label: 'Demy 138 × 216 mm (5.43 × 8.5 in)', w: 5.43, h: 8.5 },
  { id: 'c-format', label: 'C-format 135 × 216 mm (5.31 × 8.5 in)', w: 5.31, h: 8.5 },
  { id: 'custom', label: 'Custom…', w: null, h: null },
];

/* ---------- spine paper ---------- */
// caliper = inches per PAGE (2 pages per leaf); ppi = pages per inch. Approximate — confirm with the printer.
export const SPINE_PAPERS = [
  { id: 'white-50', label: '50 lb white offset (≈444 PPI)', caliper: 0.002252, ppi: 444 },
  { id: 'cream-50', label: '50 lb cream (≈400 PPI)', caliper: 0.0025, ppi: 400 },
  { id: 'natural-55', label: '55 lb natural hi-bulk (≈360 PPI)', caliper: 0.00278, ppi: 360 },
  { id: 'coated-70', label: '70 lb coated / colour (≈530 PPI)', caliper: 0.00189, ppi: 530 },
];

/* ---------- yarn shades ---------- */
// 16 realistic wool shades. heather 0..1 = tonal fibre variation, fuzz 0..1 = halo.
export const YARN_PRESETS = [
  { name: 'Fjord', hex: '#7f9cc6', heather: 0.35, fuzz: 0.3 },        // comp top field (blue)
  { name: 'Lagoon', hex: '#62b5ae', heather: 0.35, fuzz: 0.3 },       // comp bottom field (teal)
  { name: 'Snowdrop', hex: '#f4f1e8', heather: 0.15, fuzz: 0.35 },    // comp title (cream white)
  { name: 'Midnight', hex: '#203063', heather: 0.3, fuzz: 0.25 },     // comp navy
  { name: 'Spruce', hex: '#2c6b52', heather: 0.35, fuzz: 0.25 },      // comp green
  { name: 'Marmalade', hex: '#d9824e', heather: 0.3, fuzz: 0.3 },     // fleck orange
  { name: 'Rosehip', hex: '#e3a3a0', heather: 0.3, fuzz: 0.3 },       // fleck pink
  { name: 'Oatmeal', hex: '#e3ded4', heather: 0.4, fuzz: 0.35 },
  { name: 'Mustard', hex: '#d4a83c', heather: 0.3, fuzz: 0.25 },
  { name: 'Conker', hex: '#8b5434', heather: 0.3, fuzz: 0.25 },
  { name: 'Cornflower', hex: '#5a8fd8', heather: 0.3, fuzz: 0.25 },
  { name: 'Peat', hex: '#2c2a28', heather: 0.25, fuzz: 0.2 },
  { name: 'Foxglove', hex: '#e88ab0', heather: 0.3, fuzz: 0.25 },
  { name: 'Moss', hex: '#3a9d6f', heather: 0.3, fuzz: 0.25 },
  { name: 'Brick', hex: '#b5513a', heather: 0.3, fuzz: 0.25 },
  { name: 'Slate', hex: '#6d7178', heather: 0.4, fuzz: 0.3 },
];

export const FONT_CHOICES = ['Zilla Slab', 'Roboto Slab', 'Fraunces', 'Libre Caslon Text', 'DM Serif Display',
  'Abril Fatface', 'Alfa Slab One', 'Archivo Black', 'Rubik', 'Silkscreen'];

export const MIXES = ['solid', 'patches', 'stripe', 'letters', 'speckle'];

/* ---------- small utils ---------- */
const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
let _uid = 0;
export function uid(prefix = 'l') {
  _uid = (_uid + 1) % 1e6;
  return prefix + Date.now().toString(36).slice(-4) + _uid.toString(36) + Math.floor(Math.random() * 1296).toString(36);
}
function uniqueId(prefix, taken) { let i = 1; while (taken.has(prefix + i)) i++; return prefix + i; }

/* ---------- defaults ---------- */
export const DEFAULT_RENDER = { light: { azimuth: 135, elevation: 50 }, irregularity: 0.5, halo: 0.3, plies: 3, twist: 0.6, contrast: 1.0, background: '#1a1a1a' };
export const DEFAULT_GUIDES = { trim: true, bleed: true, spine: true, safe: true, safeInset: 0.25, spineSafeInset: 0.0625 };

function baseDoc() {
  return {
    version: DOC_VERSION,
    name: 'Untitled',
    trim: { w: 6, h: 9, preset: '6x9' },
    layout: 'front',
    bleed: 0.125,
    spine: { mode: 'width', width: 0.9, pageCount: 320, caliper: 0.0025, paper: 'cream-50' },
    knit: { stsPerInch: 18, gauge: { sts: 20, rows: 28 }, seed: 7 },
    yarns: [],
    layers: [],
    render: clone(DEFAULT_RENDER),
    guides: clone(DEFAULT_GUIDES),
  };
}

const LAYER_DEFAULTS = {
  fill: { type: 'fill', name: 'Ground', visible: true, yarn: null, yarns: [], mix: 'solid', flecks: null },
  rect: { type: 'rect', name: 'Colour block', visible: true, panel: null, x: 0, y: 0, w: 2, h: 1, yarn: null, yarns: [], mix: 'solid', feather: 0, flecks: null },
  text: { type: 'text', name: 'Text', visible: true, text: 'Text', font: 'Zilla Slab', weight: 600, italic: false, size: 1,
    x: 0, y: 0, align: 'center', anchor: 'middle', rotate: 0, tracking: 0, leading: 1, fill: 0.45, yarns: [], mix: 'solid', panel: null },
  paint: { type: 'paint', name: 'Painted stitches', visible: true, cells: {} },
};

/* ---------- geometry ---------- */
export function spineWidth(doc) {
  const s = doc.spine || {};
  if (s.mode === 'pages') return Math.max(0, num(s.pageCount, 0) * num(s.caliper, 0.0025));
  return Math.max(0, num(s.width, 0));
}

const R = (x, y, w, h) => ({ x, y, w, h });
const inset = (r, ix, iy = ix) => R(r.x + ix, r.y + iy, Math.max(0, r.w - 2 * ix), Math.max(0, r.h - 2 * iy));

/** Panel rects in sheet inches. back/spine only for layout 'wrap'. */
export function panels(doc) {
  const b = Math.max(0, num(doc.bleed, 0)), W = doc.trim.w, H = doc.trim.h;
  const g = doc.guides || {}, si = num(g.safeInset, 0.25), ssi = num(g.spineSafeInset, 0.0625);
  const out = {};
  if (doc.layout === 'wrap') {
    const s = spineWidth(doc);
    out.back = R(b, b, W, H);
    out.spine = R(b + W, b, s, H);
    out.front = R(b + W + s, b, W, H);
    out.trim = R(b, b, 2 * W + s, H);
    out.folds = [b + W, b + W + s];
  } else {
    out.front = R(b, b, W, H);
    out.trim = R(b, b, W, H);
    out.folds = [];
  }
  out.sheet = R(0, 0, out.trim.w + 2 * b, H + 2 * b);
  out.bleed = b;
  out.safe = { inset: si, front: inset(out.front, si) };
  if (out.back) { out.safe.back = inset(out.back, si); out.safe.spine = inset(out.spine, Math.min(ssi, out.spine.w / 2), si); }
  return out;
}

export function chartDims(doc) {
  const { sheet } = panels(doc);
  const spi = Math.max(1, num(doc.knit.stsPerInch, 18));
  const g = doc.knit.gauge || { sts: 20, rows: 28 };
  const ratio = num(g.rows, 28) / Math.max(1e-6, num(g.sts, 20));
  const cols = Math.max(1, Math.round(sheet.w * spi));
  const rows = Math.max(1, Math.round(sheet.h * spi * ratio));
  return { cols, rows, cellW: sheet.w / cols, cellH: sheet.h / rows };
}

/** Top-left of the panel a layer is positioned in (layer.panel), or sheet origin. null if that panel doesn't exist. */
export function layerOrigin(doc, layer, P = panels(doc)) {
  if (!layer || !layer.panel) return { x: 0, y: 0 };
  const p = P[layer.panel];
  return p ? { x: p.x, y: p.y } : null;
}

/* ---------- layers / yarns ---------- */
function contrastYarn(doc, avoidId) {
  const lum = (h) => { const n = parseInt(String(h).slice(1), 16) || 0; return 0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255); };
  const ys = doc.yarns || [];
  const base = ys.find((y) => y.id === avoidId);
  if (!base) return ys[0] ? ys[0].id : null;
  let best = null, bd = -1;
  for (const y of ys) { const d = Math.abs(lum(y.hex) - lum(base.hex)); if (d > bd) { bd = d; best = y.id; } }
  return best;
}

/** A new layer with sensible defaults, positioned on the front panel. */
export function newLayer(type, doc) {
  const def = LAYER_DEFAULTS[type];
  if (!def) throw new Error('newLayer: unknown type ' + type);
  const L = clone(def);
  L.id = uid(type[0]);
  const fill = doc && (doc.layers || []).find((l) => l.type === 'fill');
  const firstYarn = doc && doc.yarns && doc.yarns[0] ? doc.yarns[0].id : null;
  const W = doc ? doc.trim.w : 6, H = doc ? doc.trim.h : 9;
  if (type === 'fill') L.yarn = firstYarn;
  if (type === 'rect') { Object.assign(L, { panel: 'front', x: 0.75, y: H / 2 - 0.75, w: W - 1.5, h: 1.5 }); L.yarn = doc ? contrastYarn(doc, fill && fill.yarn) : null; }
  if (type === 'text') {
    Object.assign(L, { panel: 'front', x: W / 2, y: H / 2, size: Math.round(W * 0.16 * 100) / 100 });
    const y = doc ? contrastYarn(doc, fill && fill.yarn) : null; L.yarns = y ? [y] : [];
  }
  return L;
}

/** A new yarn: the first preset shade not already in the palette, with a unique id. */
export function newYarn(doc) {
  const ys = (doc && doc.yarns) || [];
  const used = new Set(ys.map((y) => y.hex.toLowerCase()));
  const p = YARN_PRESETS.find((y) => !used.has(y.hex.toLowerCase())) || YARN_PRESETS[ys.length % YARN_PRESETS.length];
  return { id: uniqueId('y', new Set(ys.map((y) => y.id))), ...clone(p) };
}

export const MAX_YARNS = 16;

/* ---------- presets ---------- */
const Y = (id, name) => { const p = YARN_PRESETS.find((y) => y.name === name); return { id, ...clone(p) }; };
const JOHN_YARNS = [Y('y1', 'Fjord'), Y('y2', 'Lagoon'), Y('y3', 'Snowdrop'), Y('y4', 'Midnight'), Y('y5', 'Spruce'), Y('y6', 'Marmalade'), Y('y7', 'Rosehip')];
const FLECKS = { density: 0.008, yarns: ['y6', 'y7'] };
// Measured from reference/liam-comp-john-of-john.jpg (6 × 9 front): field split ≈ 54% down,
// "John" ≈ 3.2 in wide, baseline 1.9 in; "of" baseline 2.7 in; lower "John" baseline 6.1 in.
const SPLIT = 4.9;
function johnLayers(wrap) {
  const T = (o) => ({ ...clone(LAYER_DEFAULTS.text), panel: 'front', font: 'Zilla Slab', weight: 600, align: 'center', anchor: 'baseline', tracking: 0.01, leading: 1, ...o });
  return [
    { ...clone(LAYER_DEFAULTS.fill), id: 'ground', name: 'Blue field', yarn: 'y1', flecks: clone(FLECKS) },
    wrap
      ? { ...clone(LAYER_DEFAULTS.rect), id: 'teal', name: 'Teal field', panel: null, x: 0, y: 0.125 + SPLIT, w: 2 * 6 + 0.8 + 0.25, h: 9.25 - (0.125 + SPLIT), yarn: 'y2', feather: 0.08, flecks: clone(FLECKS) }
      : { ...clone(LAYER_DEFAULTS.rect), id: 'teal', name: 'Teal field', panel: 'front', x: -0.125, y: SPLIT, w: 6.25, h: 9.125 - SPLIT, yarn: 'y2', feather: 0.08, flecks: clone(FLECKS) },
    T({ id: 't-john1', name: 'John (top)', text: 'John', size: 1.62, x: 3.02, y: 1.92, fill: 0.45, yarns: ['y3'] }),
    T({ id: 't-of', name: 'of', text: 'of', size: 0.62, x: 2.88, y: 2.72, fill: 0.45, yarns: ['y3'] }),
    T({ id: 't-john2', name: 'John (lower)', text: 'John', size: 1.62, x: 3.0, y: 6.12, fill: 0.45, yarns: ['y4', 'y5'], mix: 'speckle' }),
  ];
}

function johnDoc() {
  const d = baseDoc();
  Object.assign(d, { name: 'John of John — front', yarns: clone(JOHN_YARNS), layers: johnLayers(false) });
  d.layers.push({ ...clone(LAYER_DEFAULTS.paint), id: 'paint' });
  return d;
}

function johnWrapDoc() {
  const d = johnDoc();
  d.name = 'John of John — full wrap';
  d.layout = 'wrap';
  d.spine = { mode: 'pages', width: 0.8, pageCount: 320, caliper: 0.0025, paper: 'cream-50' }; // 0.8 in
  d.layers = johnLayers(true);
  const T = (o) => ({ ...clone(LAYER_DEFAULTS.text), font: 'Zilla Slab', weight: 700, tracking: 0.06, ...o });
  d.layers.push(
    // spine: x is the spine centre line, anchor 'middle' keeps the rotated text centred across the spine
    T({ id: 's-title', name: 'Spine title', panel: 'spine', text: 'JOHN OF JOHN', size: 0.42, rotate: 90, align: 'left', anchor: 'middle', x: 0.4, y: 0.55, yarns: ['y3'], fill: 0.5 }),
    T({ id: 's-author', name: 'Spine author (placeholder)', panel: 'spine', text: 'AUTHOR NAME', size: 0.36, weight: 600, rotate: 90, align: 'right', anchor: 'middle', x: 0.4, y: 8.0, yarns: ['y4'], fill: 0.55 }),
    T({ id: 's-pub', name: 'Spine publisher (placeholder)', panel: 'spine', text: 'P', size: 0.36, rotate: 0, align: 'center', anchor: 'baseline', x: 0.4, y: 8.62, yarns: ['y4'], fill: 0.5, tracking: 0 }),
    T({ id: 'b-line', name: 'Back line', panel: 'back', text: 'one name,\ntwo lives', size: 0.62, weight: 600, align: 'center', anchor: 'top', x: 3, y: 1.5, leading: 1.1, tracking: 0.02, yarns: ['y3'], fill: 0.5 }),
    { ...clone(LAYER_DEFAULTS.rect), id: 'b-barcode', name: 'Barcode area (placeholder)', panel: 'back', x: 3.6, y: 7.35, w: 2.0, h: 1.2, yarn: 'y3' },
    { ...clone(LAYER_DEFAULTS.paint), id: 'paint' },
  );
  return d;
}

function patchworkDoc() {
  const d = baseDoc();
  d.name = 'Patchwork';
  d.knit = { stsPerInch: 14, gauge: { sts: 18, rows: 24 }, seed: 21 };
  d.yarns = [Y('y1', 'Oatmeal'), Y('y2', 'Mustard'), Y('y3', 'Conker'), Y('y4', 'Cornflower'), Y('y5', 'Peat'), Y('y6', 'Foxglove'), Y('y7', 'Moss'), Y('y8', 'Brick')];
  d.render.halo = 0.45;
  const pal = ['y2', 'y3', 'y4', 'y5', 'y6', 'y7', 'y8'];
  d.layers = [
    { ...clone(LAYER_DEFAULTS.fill), id: 'ground', name: 'Oatmeal ground', yarn: 'y1' },
    { ...clone(LAYER_DEFAULTS.text), id: 't-words', name: 'Words', panel: 'front', text: 'Stories\nare made\nof wool', font: 'Archivo Black', weight: 400,
      size: 1.2, x: 3, y: 4.5, align: 'center', anchor: 'middle', leading: 1.12, tracking: 0, fill: 0.5, yarns: pal, mix: 'patches' },
    { ...clone(LAYER_DEFAULTS.paint), id: 'paint' },
  ];
  return d;
}

export const DOC_PRESETS = {
  john: { label: 'John of John (front)', create: johnDoc },
  'john-wrap': { label: 'John of John (full wrap)', create: johnWrapDoc },
  patchwork: { label: 'Patchwork type', create: patchworkDoc },
  blank: { label: 'Blank', create: () => { const d = baseDoc(); d.yarns = [Y('y1', 'Oatmeal'), Y('y2', 'Midnight')]; d.layers = [{ ...clone(LAYER_DEFAULTS.fill), id: 'ground', yarn: 'y1' }, { ...clone(LAYER_DEFAULTS.paint), id: 'paint' }]; return d; } },
};

export function createDoc(presetId = 'john') {
  const p = DOC_PRESETS[presetId] || DOC_PRESETS.john;
  return normalize(p.create());
}

/* ---------- (de)serialisation ---------- */
export function serialize(doc) {
  return JSON.stringify({ ...doc, version: DOC_VERSION }, null, 1);
}

function mergeDefaults(def, v) {
  if (!isObj(def)) return v === undefined || v === null || typeof v !== typeof def ? clone(def) : v;
  const out = {};
  const src = isObj(v) ? v : {};
  for (const k of Object.keys(def)) out[k] = mergeDefaults(def[k], src[k]);
  for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
  return out;
}

function normLayer(l, yarnIds) {
  if (!isObj(l) || !LAYER_DEFAULTS[l.type]) return null;
  const def = LAYER_DEFAULTS[l.type];
  const L = { ...clone(def), ...l };
  for (const k of Object.keys(def)) {
    const d = def[k];
    if (typeof d === 'number' && !(typeof L[k] === 'number' && Number.isFinite(L[k]))) L[k] = d;
    if (typeof d === 'boolean' && typeof L[k] !== 'boolean') L[k] = d;
    if (typeof d === 'string' && typeof L[k] !== 'string') L[k] = d;
    if (Array.isArray(d) && !Array.isArray(L[k])) L[k] = clone(d);
  }
  if (typeof L.id !== 'string' || !L.id) L.id = uid(l.type[0]);
  if (l.type === 'text') {
    L.rotate = [0, 90, -90].includes(L.rotate) ? L.rotate : (L.rotate === 270 ? -90 : 0);
    if (!['left', 'center', 'right'].includes(L.align)) L.align = 'center';
    if (!['top', 'middle', 'baseline'].includes(L.anchor)) L.anchor = 'middle';
    if (!MIXES.includes(L.mix)) L.mix = 'solid';
    L.fill = clamp(L.fill, 0.05, 0.95);
    L.yarns = L.yarns.filter((id) => yarnIds.has(id));
  }
  if (l.type === 'rect' || l.type === 'fill') {
    if (!MIXES.includes(L.mix)) L.mix = 'solid';
    L.yarns = L.yarns.filter((id) => yarnIds.has(id));
    if (L.flecks && !isObj(L.flecks)) L.flecks = null;
    if (L.flecks) L.flecks = { density: clamp(num(L.flecks.density, 0), 0, 0.1), yarns: (L.flecks.yarns || []).filter((id) => yarnIds.has(id)) };
  }
  if (l.type === 'paint' && !isObj(L.cells)) L.cells = {};
  if (L.panel !== undefined && !['front', 'spine', 'back', null].includes(L.panel)) L.panel = null;
  return L;
}

function normalize(d) {
  d.version = DOC_VERSION;
  // yarns
  const seen = new Set();
  d.yarns = (Array.isArray(d.yarns) ? d.yarns : []).filter(isObj).slice(0, MAX_YARNS).map((y) => {
    const o = { id: y.id, name: String(y.name || 'Yarn'), hex: /^#[0-9a-f]{6}$/i.test(y.hex) ? y.hex : '#888888', heather: clamp(num(y.heather, 0.3), 0, 1), fuzz: clamp(num(y.fuzz, 0.3), 0, 1) };
    if (typeof o.id !== 'string' || !o.id || seen.has(o.id)) o.id = uniqueId('y', seen);
    seen.add(o.id);
    return o;
  });
  if (!d.yarns.length) d.yarns = [Y('y1', 'Oatmeal')];
  const ids = new Set(d.yarns.map((y) => y.id));
  d.layers = (Array.isArray(d.layers) ? d.layers : []).map((l) => normLayer(l, ids)).filter(Boolean);
  if (!['front', 'wrap'].includes(d.layout)) d.layout = 'front';
  d.trim.w = Math.max(0.5, num(d.trim.w, 6)); d.trim.h = Math.max(0.5, num(d.trim.h, 9));
  d.bleed = clamp(num(d.bleed, 0.125), 0, 2);
  if (!['width', 'pages'].includes(d.spine.mode)) d.spine.mode = 'width';
  d.knit.stsPerInch = clamp(num(d.knit.stsPerInch, 18), 1, 60);
  return d;
}

/** Legacy v1/v2 flat settings ({text, groundA, groundB, split, yarns:[hex], lines, format…}) → v3 doc. */
function fromLegacy(s) {
  const d = baseDoc();
  const fmt = { '6x9': [6, 9], '5.5x8.5': [5.5, 8.5], '5x8': [5, 8], '4x5': [4, 5], '1x1': [5, 5] }[s.format] || [6, 9];
  d.trim = { w: fmt[0], h: fmt[1], preset: s.format in { '6x9': 1, '5.5x8.5': 1, '5x8': 1 } ? s.format : 'custom' };
  d.knit = { stsPerInch: Math.round((num(s.cols, 108)) / fmt[0]), gauge: { sts: num(s.gaugeSts, 20), rows: num(s.gaugeRows, 28) }, seed: num(s.seed, 7) };
  const yarns = [];
  const add = (hex) => { let y = yarns.find((q) => q.hex.toLowerCase() === String(hex).toLowerCase()); if (!y) { y = { id: 'y' + (yarns.length + 1), name: 'Yarn ' + (yarns.length + 1), hex, heather: 0.3, fuzz: 0.3 }; yarns.push(y); } return y.id; };
  const gA = add(s.groundA || '#7f9cc6'), gB = add(s.groundB || s.groundA || '#7f9cc6');
  const pal = (s.yarns || []).slice(0, 12).map(add);
  const fl = [s.fleckA, s.fleckB].filter(Boolean).map(add);
  d.yarns = yarns.slice(0, MAX_YARNS);
  const flecks = s.flecks ? { density: clamp(s.flecks / 1000, 0, 0.1), yarns: fl } : null;
  d.layers.push({ ...clone(LAYER_DEFAULTS.fill), id: 'ground', yarn: gA, flecks });
  if (gB !== gA) d.layers.push({ ...clone(LAYER_DEFAULTS.rect), id: 'ground-b', panel: null, x: 0, y: d.bleed + fmt[1] * num(s.split, 0.5), w: fmt[0] + 1, h: fmt[1], yarn: gB, flecks });
  const lines = String(s.text || '').split('\n');
  const size = (num(s.size, 0) || 0.16 * num(s.cols, 108)) / d.knit.stsPerInch; // design units ≈ stitches
  const lead = num(s.leading, 1) * size;
  let y = fmt[1] * num(s.valign, 0.3), k = 0;
  lines.forEach((t) => {
    if (!t.trim()) { y += lead * 0.5; return; }
    const cfg = (s.lines && s.lines[k]) || { scale: 100, yarns: [0], mix: 'solid' };
    const fs = size * num(cfg.scale, 100) / 100;
    y += fs * num(s.leading, 1) * 0.5;
    d.layers.push({ ...clone(LAYER_DEFAULTS.text), id: 't' + k, name: t, panel: 'front', text: t, font: s.font || 'Zilla Slab', weight: num(s.weight, 600), size: fs,
      x: fmt[0] / 2, y, anchor: 'middle', align: 'center', tracking: num(s.tracking, 0), fill: num(s.fill, 0.45),
      yarns: (cfg.yarns || [0]).map((i) => pal[i]).filter(Boolean), mix: (cfg.yarns || []).length > 1 ? cfg.mix || 'patches' : 'solid' });
    y += fs * num(s.leading, 1) * 0.5; k++;
  });
  d.layers.push({ ...clone(LAYER_DEFAULTS.paint), id: 'paint' });
  return d;
}

/** Parse a JSON string or object; tolerant of missing fields, old versions and legacy v1/v2 settings. */
export function deserialize(json) {
  let o = json;
  if (typeof json === 'string') o = JSON.parse(json);
  if (!isObj(o)) throw new Error('deserialize: not a Stitch Setter document');
  if (!('layers' in o) && ('text' in o || 'groundA' in o)) return normalize(fromLegacy(o));
  const def = baseDoc();
  const d = mergeDefaults(def, o);
  d.yarns = Array.isArray(o.yarns) ? clone(o.yarns) : [];
  d.layers = Array.isArray(o.layers) ? clone(o.layers) : [];
  return normalize(d);
}
