# Stitch Setter v3 — knitted cover studio (binding contract)

**Goal (priority order).** A book designer sets type and colour blocks on a real knitting chart and gets a
**print-resolution image that looks like photographed stockinette** — the same class of rendering as
KnitCanvas (`reference/knitcanvas/*.jpg`) — for a front cover or a **full wrap (back + spine + front)** at any
trim size, with bleed. It should feel like a real knitting tool: a chart with true stitch proportions that you
can paint on, a yarn palette of named shades, and a knitted preview that updates as you edit.
v2 (physics: pull/tear/dirt) is shelved in git history (commit c5a861f, `legacy/v2/`) — do not import from it except `legacy/v2/src/chart.js`
as a reference for text→coverage logic.

What "looks real" means (study `reference/knitcanvas/kc-hens-macro-6x.jpg`, `kc-hens-2x.jpg`, `kc-flowers-1x.jpg`):
- Each stitch is a **V of two fat, rounded legs** (each ≈ half the stitch width, ≈1.3–1.5 row pitches long,
  tilted ≈25–35° from vertical), meeting at the bottom. Legs are **plied yarn**: 2–4 plies with clear diagonal
  twist streaks, fine fibres along the plies, tonal variation inside one colour (lighter/darker fibres).
- **Interlock**: the bottom point of each V sits ON TOP of the tops of the V below; each V's upper ends tuck
  BEHIND the V above. Deep dark crevices between columns and in the centre of each V. No outlines, no grid.
- Soft directional light (top-left), round shading across each leg, sheen streaks along fibres, ambient
  occlusion in crevices. Small irregularity per stitch (width, tilt, offset, tension) and per row, so it's
  hand-made, not tiled. A single isolated stitch of contrast colour reads as a clean small V.
- Colours stay faithful to the chosen yarn shade (designer picks hex; rendered mid-tones ≈ that hex).

## Stack & delivery
- Plain ESM JS, **raw WebGL2** for the knit renderer (three.js allowed but not required), Canvas 2D for the
  chart view and text rasterisation. esbuild bundles `src/main.js` → `build.mjs` → ONE file
  `dist/stitch-setter.html` starting with `<title>Stitch Setter</title>`, Google Fonts `<link>`, `<style>`,
  markup, inline `<script>`; no doctype/html/head/body; no runtime network except Google Fonts.
- Saving files: `const d = window.claude && window.claude.use ? await window.claude.use('downloads') : null;`
  then `await d.save({filename, data: blob})` on a click (allowed: png, pdf, json, svg…). Handle `null`
  (hide/disable save UI with a short explanation) and rejection codes (`declined`, `rate_limited`, `too_large`).
- Tests: `node test/*.test.mjs` (pure logic), Playwright e2e/screenshots with headless Chromium:
  `NODE_PATH=$(npm root -g)`, args `['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']`
  (WebGL2 + float colour buffers available). Scratch output in `.scratch/`.

## Units & geometry (shared)
- Document space is **inches**, origin = top-left of the full printed sheet INCLUDING bleed, x right, y down.
- `layout: 'front'` → sheet = bleed + front + bleed. `layout: 'wrap'` → sheet = bleed + back + spine + front + bleed
  (back and front both = trim size; spine width from `spine.width` or computed `pageCount * paper.caliper`).
- `panels(doc)` returns rects (inches) for `back`, `spine`, `front`, `sheet`, `trim` (whole trimmed area), plus
  `safe` insets (default 0.25 in) — used for guides and for anchoring layers.
- Knit scale: `doc.knit.stsPerInch` (printed stitches per inch, e.g. 18) and gauge ratio
  `doc.knit.gauge = {sts, rows}` per 4 in (row height = stitch width × sts/rows). Chart:
  `cols = round(sheetW * stsPerInch)`, `rows = round(sheetH * stsPerInch * rows/sts)`.
  `cellW = sheetW/cols`, `cellH = sheetH/rows` (inches). Cell (c,r), r=0 TOP row; index `i = r*cols + c`.

## Document model — `src/model/doc.js` (owner: model)
```js
export const TRIM_PRESETS   // [{id:'6x9', label:'6 × 9 in (US trade)', w:6, h:9}, 5x8, 5.25x8, 5.5x8.5, 6.14x9.21, 7x10, 'b-format' 5.06x7.81, 'a-format' 4.33x7.01, 'royal' 6.14x9.21?, custom]
export function createDoc(presetId = 'john') -> Doc
export function panels(doc) -> { sheet, trim, back?, spine?, front, safe: {...} }
export function chartDims(doc) -> { cols, rows, cellW, cellH }
export function serialize(doc) / deserialize(json) -> Doc   // versioned, tolerant of missing fields
export const DOC_PRESETS    // 'john' (front only, recreates Liam's comp), 'john-wrap' (same as full wrap with spine + back text), 'patchwork' (inspiration-post style)
Doc = {
  version: 3,
  trim: { w: 6, h: 9 }, layout: 'front' | 'wrap', bleed: 0.125,
  spine: { mode: 'width' | 'pages', width: 0.9, pageCount: 320, caliper: 0.0025 },
  knit: { stsPerInch: 18, gauge: { sts: 20, rows: 28 }, seed: 7 },
  yarns: [ { id: 'y1', name: 'Fjord', hex: '#7f9cc6', heather: 0.35, fuzz: 0.3 }, ... ],   // up to 16 shades
  layers: [ Layer, ... ]           // bottom → top; painted stitches are the top-most 'paint' layer
  render: { light: { azimuth: 135, elevation: 50 }, irregularity: 0.5, halo: 0.3, plies: 3, twist: 0.6,
            contrast: 1.0, background: '#1a1a1a' },
  guides: { trim: true, bleed: true, spine: true, safe: true }
}
Layer =
  | { id, type: 'fill',  name, visible, yarn }                                         // whole sheet
  | { id, type: 'rect',  name, visible, x, y, w, h, yarn, mix?, yarns? }               // inches; colour blocks, bands
  | { id, type: 'text',  name, visible, text, font, weight, italic, size, x, y, align: 'left'|'center'|'right',
      anchor: 'top'|'middle'|'baseline', rotate: 0|90|-90, tracking, leading, fill (0.15..0.85 coverage threshold),
      yarns: [yarnId...], mix: 'solid'|'patches'|'stripe'|'letters'|'speckle', panel?: 'front'|'spine'|'back' }
      // size = font size in inches (em); x,y = anchor point in inches; multi-line text with \n
  | { id, type: 'paint', name, visible, cells: { "<x_in>,<y_in>": yarnId | null } } // hand-painted stitches stored by
      // cell-centre position in inches (rounded to 1e-3) so they survive grid changes; null = erase to what's below
```
`Doc` is plain JSON (no class instances).

## Composition — `src/model/compose.js` (owner: model)
```js
export function composeChart(doc, { createCanvas }) -> Chart
Chart = { cols, rows, cellW, cellH, yarnIndex: Uint8Array(N) /* index into doc.yarns */, layerOf: Int16Array(N),
          palette: [{hex, rgb:[0..1], heather, fuzz}] }
export function cellAtInches(doc, xIn, yIn) -> {c, r}     // and inverse cellCentre(doc, c, r) -> {x, y}
```
Text rasterisation: per text layer, draw into a supersampled (≥4×) mask in cell space respecting the cell aspect
(letters keep true shape in inches), rotation for spine text, tracking/leading, then a cell is yarn when coverage
> (1 − fill). Mixes as v1 (`legacy/v2/src/chart.js`): patches (fbm), stripe (self-striping along knitting order),
letters, speckle — deterministic from `knit.seed`. Must be fast: 13 × 9.5 in at 18 sts/in ≈ 240 × 240 cells
→ recompose < 60 ms. Fonts must be loaded before compose (app's job). Node tests can inject a fake canvas.

## Knit renderer — `src/render/knit.js` (+ helpers) (owner: render)
```js
export function createKnitRenderer(canvas) -> KnitRenderer
KnitRenderer = {
  setChart(chart, renderSettings)     // upload cell → yarn index texture + palette; rebuild stitch variants
  setView({ scale /* device px per stitch width */, cx, cy /* chart-cell coords at canvas centre */ })
  resize(cssW, cssH, dpr)
  render()                           // draw current view; must stay interactive (< 50 ms at 2–3 MP)
  pickCell(clientX, clientY) -> {c, r} | null
  cellToClient(c, r) -> {x, y}       // for overlays (guides, selection boxes) drawn by the app
  renderRegion({ x0, y0, x1, y1 /* cells, fractional ok */, widthPx, heightPx }) -> Promise<Blob>  // PNG, tiled
                                     // (tile ≤ 2048 px with overlap so shading/AO/shadows have no seams); must do
                                     // 13.25 × 9.25 in at 600 dpi (7950 × 5550) without running out of memory
  dispose()
}
```
Required approach (keeps it photographic and resolution-independent):
1. **Stitch model**: each leg is a 3D tube along a curved centreline (bottom-centre of the cell → upper outer
   corner, overshooting above the cell by ~0.4–0.6 row pitch), radius ≈ 0.26 stitch widths, with
   **height** decreasing toward the top (tucks behind the next row) and the V bottom highest. Plies: helical
   sub-tubes around the leg axis (count = `plies`, twist = `twist`), each with fibre noise along the ply.
2. **G-buffer pass**: draw every stitch (instanced quads, 2 legs each, or one full-screen pass that evaluates
   the ≤ 6 neighbouring stitches per pixel) writing **height to depth** (so interlock resolves), normal,
   albedo (yarn colour × heather/fibre variation), and a mask. Per-stitch random irregularity from the seed.
3. **Lighting pass**: wrapped diffuse + anisotropic fibre sheen (Kajiya–Kay style along the ply direction),
   **AO from the height field**, soft self-shadowing by marching the height field toward the light, crevices dark.
4. **Fuzz/halo pass**: thin translucent fibres (procedural) mostly along legs, a few stray hairs crossing
   crevices; strength from `render.halo` and yarn `fuzz`.
5. Tone: linear lighting, gentle filmic tone map that keeps the picked hex as the mid-tone; optional grain.
   Antialias by derivative-aware shading + supersampling in exports (render tiles at 2× and downsample).
LOD: below ~6 px per stitch, fall back to a cheaper shading that preserves average colour (no moiré).

## App — `src/main.js`, `src/app/**`, `build.mjs`, `test/e2e.mjs` (owner: app)
Layout (desktop): header (name, document presets, Undo/Redo, Export); **left rail**: Document (layout
front/wrap, trim preset/custom, bleed, spine width or page count × paper, knit scale sts/in with readout of
cols × rows and "knits to W × H in at gauge", gauge sts/rows) and **Layers** list (add Text / Colour block /
reorder / hide / delete / select); **centre stage** with view switch **Fabric | Chart | Split**, zoom/pan,
overlays for trim, bleed, spine folds, safe area (toggles), selection box with drag-to-move and resize
handles for text/rect layers, and stitch-paint tools (Pencil, Eraser, Fill, Eyedropper) that write the
paint layer; **right rail**: Yarn palette (shade swatches with name, hex, heather, fuzz; add/remove; click
to choose the paint colour) and the selected layer's properties (text, font incl. uploaded fonts, weight,
size in inches with stitch-height readout, align, anchor, rotate, tracking, leading, stitch fill, yarns +
mix, position numbers), plus Render settings (light direction dial, irregularity, halo, plies, twist).
The **Chart** view is a real knitting chart: cells with true proportions, yarn colours, thin grid with
heavier lines every 10 stitches, row numbers on the right, stitch numbers along the bottom (knitting
convention: count from bottom-right), panel boundaries marked.
Export dialog: what (full sheet with bleed / trimmed / front only / spine / back), resolution (300 / 600 dpi),
PNG via `renderRegion`; Chart PNG; project `.json` save + open; autosave to localStorage (try/catch).
Phone: rails stack under the stage; no horizontal scroll. Theme-aware tokens light + dark (see
`legacy/v2/src/ui/styles.css` / reference v1 for the established look). Expose
`window.__studio = { doc, chart, renderer, setDoc, compose }` for e2e.
