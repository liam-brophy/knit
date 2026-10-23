// The stage: one view transform shared by the knitted fabric (KnitRenderer), the Chart view (Canvas 2D) and the
// overlay (guides, selection, handles, cursors). The view is stored in INCHES (centre + px per inch) so it stays
// put when the knit scale changes; renderer gets { scale: device px per stitch, cx, cy: cell coords at centre }.
import { S, mutate, sealHistory, select, layerById, selLayer, setActiveYarn, emit } from './store.js';
import { panels, paintKey, textMetrics, layerOrigin } from './modules.js';
import { chartImage, drawChartView } from './chart.js';
import { $, toast } from './ui.js';

// Cell-coordinate convention passed to the renderer: cell c spans [c, c+1). If a renderer expects cell centres
// at integers, set this to -0.5.
const RENDER_CELL_OFFSET = 0;
const MIN_PPI = 6, MAX_PPI = 96 * 24;

export function createStage({ renderer, onHover }) {
  const stage = $('#stage'), fab = $('#fabric'), chv = $('#chartcv'), ov = $('#ov'), splitter = $('#splitter');
  const cctx = chv.getContext('2d'), octx = ov.getContext('2d');
  let W = 1, H = 1, dpr = 1, img = null, theme = readTheme();
  const V = S.view; // { mode, ppi, vx, vy, split }
  if (!V.ppi) Object.assign(V, { ppi: 40, vx: 3, vy: 4.5 });

  /* ---------------- transform ---------------- */
  const ch = () => S.chart;
  const xf = () => {
    const c = ch(); const cellW = c ? c.cellW : 1 / 18, cellH = c ? c.cellH : 1 / 18;
    return { W, H, dpr, scale: V.ppi * cellW, aspect: cellH / cellW, cx: V.vx / cellW, cy: V.vy / cellH, cellW, cellH };
  };
  const inToScreen = (x, y) => ({ x: W / 2 + (x - V.vx) * V.ppi, y: H / 2 + (y - V.vy) * V.ppi });
  const screenToIn = (sx, sy) => ({ x: V.vx + (sx - W / 2) / V.ppi, y: V.vy + (sy - H / 2) / V.ppi });
  const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const cellAt = (sx, sy) => {
    const c = ch(); if (!c) return null; const p = screenToIn(sx, sy);
    const cc = Math.floor(p.x / c.cellW), rr = Math.floor(p.y / c.cellH);
    return { c: cc, r: rr, inside: cc >= 0 && rr >= 0 && cc < c.cols && rr < c.rows };
  };

  /* ---------------- sizing + drawing ---------------- */
  function resize() {
    const r = stage.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height); dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const cv of [chv, ov]) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    renderer && renderer.resize(W, H, dpr);
    placeSplitter(); request();
  }
  const ro = new ResizeObserver(resize); ro.observe(stage);

  let raf = 0;
  function request() { if (!raf) raf = requestAnimationFrame(draw); }
  function draw() {
    raf = 0;
    const X = xf();
    if (V.mode !== 'chart' && renderer && ch()) {
      renderer.setView({ scale: X.scale * dpr, cx: X.cx - RENDER_CELL_OFFSET, cy: X.cy - RENDER_CELL_OFFSET });
      try { renderer.render(); } catch (e) { console.warn('render failed', e); }
    }
    if (V.mode !== 'fabric') drawChartView(cctx, ch(), img, X, theme);
    drawOverlay();
  }

  function setChart(chart, { rebuildImage = true } = {}) { if (rebuildImage) img = chart ? chartImage(chart) : null; request(); }

  function placeSplitter() {
    const on = V.mode === 'split'; splitter.hidden = !on;
    const x = Math.round(W * V.split);
    chv.style.clipPath = on ? `inset(0 ${Math.max(0, W - x)}px 0 0)` : '';
    splitter.style.left = x + 'px';
  }
  function setMode(m) { V.mode = m; stage.dataset.view = m; placeSplitter(); request(); }

  /* ---------------- zoom / pan ---------------- */
  function zoomAt(sx, sy, k) {
    const before = screenToIn(sx, sy);
    V.ppi = Math.min(MAX_PPI, Math.max(MIN_PPI, V.ppi * k));
    const after = screenToIn(sx, sy);
    V.vx += before.x - after.x; V.vy += before.y - after.y;
    emit({ what: 'none', view: true }); request();
  }
  function fit() {
    const P = panels(S.doc), pad = W < 600 ? 24 : 56;
    V.ppi = Math.max(MIN_PPI, Math.min((W - pad * 2) / P.sheet.w, (H - pad * 2) / P.sheet.h));
    V.vx = P.sheet.w / 2; V.vy = P.sheet.h / 2;
    emit({ what: 'none', view: true }); request();
  }
  const zoomPct = () => Math.round((V.ppi / 96) * 100);

  /* ---------------- geometry of layers ---------------- */
  function layerBox(L) {
    if (!L || L.visible === false) return null;
    if (L.type === 'rect') {
      const o = layerOrigin(S.doc, L); if (!o) return null;
      let x = o.x + L.x, y = o.y + L.y, w = L.w, h = L.h; if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
      return { x, y, w, h };
    }
    if (L.type === 'text') { const m = textMetrics(L, S.doc); return m ? { x: m.x, y: m.y, w: m.w, h: m.h, m } : null; }
    return null;
  }
  const HANDLES = { rect: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], text: ['nw', 'ne', 'se', 'sw'] };
  const hpos = (b, k) => ({ x: b.x + (k.includes('w') ? 0 : k.includes('e') ? b.w : b.w / 2), y: b.y + (k.includes('n') ? 0 : k.includes('s') ? b.h : b.h / 2) });
  function handleAt(sx, sy) {
    const L = selLayer(); const b = layerBox(L); if (!b) return null;
    for (const k of HANDLES[L.type] || []) { const p = hpos(b, k), s = inToScreen(p.x, p.y); if (Math.abs(s.x - sx) <= 7 && Math.abs(s.y - sy) <= 7) return k; }
    return null;
  }
  function hitLayer(sx, sy) {
    const p = screenToIn(sx, sy), inB = (b) => b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    const cur = selLayer(); if (cur && inB(layerBox(cur))) return cur;
    const Ls = S.doc.layers;
    for (let i = Ls.length - 1; i >= 0; i--) { const L = Ls[i]; if (L.type !== 'text' && L.type !== 'rect') continue; if (inB(layerBox(L))) return L; }
    return null;
  }

  /* ---------------- overlay ---------------- */
  function drawOverlay() {
    const o = octx; o.setTransform(dpr, 0, 0, dpr, 0, 0); o.clearRect(0, 0, W, H);
    if (!S.doc) return;
    const P = panels(S.doc), g = S.doc.guides || {};
    const R = (r) => { const a = inToScreen(r.x, r.y), b = inToScreen(r.x + r.w, r.y + r.h); return [a.x, a.y, b.x - a.x, b.y - a.y]; };
    const line = (col, w = 1, dash = []) => { o.strokeStyle = col; o.lineWidth = w; o.setLineDash(dash); };
    const sh = R(P.sheet), tr = R(P.trim);
    if (g.trim) { // dim the bleed area
      o.fillStyle = 'rgba(255,255,255,.5)'; o.beginPath(); o.rect(...sh); o.rect(tr[0], tr[1] + tr[3], tr[2], -tr[3]); o.fill();
      line('rgba(255,255,255,.75)', 3); o.strokeRect(...tr); line('#141414', 1); o.strokeRect(...tr);
    }
    if (g.bleed) { line('#d64545', 1); o.strokeRect(sh[0] - 0.5, sh[1] - 0.5, sh[2] + 1, sh[3] + 1); }
    if (g.spine) for (const f of P.folds || []) {
      const a = inToScreen(f, 0), b = inToScreen(f, P.sheet.h);
      line('rgba(255,255,255,.75)', 3); o.beginPath(); o.moveTo(a.x, a.y); o.lineTo(b.x, b.y); o.stroke();
      line('#141414', 1, [6, 4]); o.beginPath(); o.moveTo(a.x, a.y); o.lineTo(b.x, b.y); o.stroke();
    }
    if (g.safe) { line('#3d7bd9', 1, [2, 3]); for (const k of ['front', 'back', 'spine']) if (P.safe[k]) o.strokeRect(...R(P.safe[k])); }
    o.setLineDash([]);
    // hover box for a layer under the cursor (select tool)
    if (S.tool === 'select' && hoverLayer && hoverLayer.id !== S.sel) { const b = layerBox(hoverLayer); if (b) { line('rgba(255,255,255,.7)', 3); o.strokeRect(...R(b)); line(theme.sel, 1, [4, 3]); o.strokeRect(...R(b)); o.setLineDash([]); } }
    // selection
    const L = selLayer(), b = layerBox(L);
    if (b) {
      const r = R(b); line('rgba(255,255,255,.8)', 3.5); o.strokeRect(...r); line(theme.sel, 1.25); o.strokeRect(...r);
      if (L.type === 'text' && b.m) { const a = inToScreen(b.m.anchor.x, b.m.anchor.y); o.fillStyle = '#fff'; o.beginPath(); o.arc(a.x, a.y, 4, 0, Math.PI * 2); o.fill(); line(theme.sel, 1.25); o.stroke(); }
      for (const k of HANDLES[L.type] || []) { const p = inToScreen(hpos(b, k).x, hpos(b, k).y); o.fillStyle = '#fff'; o.beginPath(); o.arc(p.x, p.y, 5, 0, Math.PI * 2); o.fill(); line(theme.sel, 1.25); o.stroke(); }
      if (drag && (drag.kind === 'move' || drag.kind === 'resize')) { // live readout
        const txt = L.type === 'text' ? `${(+L.size).toFixed(2)} in · ${Math.round(L.size / S.chart.cellH)} rows` : `${b.w.toFixed(2)} × ${b.h.toFixed(2)} in`;
        const pos = `x ${(+L.x).toFixed(3)}  y ${(+L.y).toFixed(3)}`;
        pill(o, `${pos}  ·  ${txt}`, r[0] + r[2] / 2, r[1] + r[3] + 16);
      }
    }
    // paint cursor: outline the brush cells
    if (hover && ['pencil', 'eraser', 'fill', 'eyedropper'].includes(S.tool) && hover.inside && !panning) {
      const c = S.chart, n = S.tool === 'pencil' || S.tool === 'eraser' ? brush : 1, h0 = Math.floor((n - 1) / 2);
      const a = inToScreen((hover.c - h0) * c.cellW, (hover.r - h0) * c.cellH), b2 = inToScreen((hover.c - h0 + n) * c.cellW, (hover.r - h0 + n) * c.cellH);
      line('rgba(0,0,0,.6)', 3); o.strokeRect(a.x, a.y, b2.x - a.x, b2.y - a.y);
      line(S.tool === 'eraser' ? '#ffffff' : '#ffffff', 1); o.strokeRect(a.x, a.y, b2.x - a.x, b2.y - a.y);
      if (S.tool === 'pencil' || S.tool === 'fill') { const y = S.doc.yarns.find((q) => q.id === S.activeYarn); if (y) { o.fillStyle = y.hex; o.globalAlpha = 0.55; o.fillRect(a.x, a.y, b2.x - a.x, b2.y - a.y); o.globalAlpha = 1; } }
    }
  }
  function pill(o, text, x, y) {
    o.font = `500 12px ${theme.mono}`; const w = o.measureText(text).width + 20;
    x = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x)); y = Math.min(H - 14, y);
    o.fillStyle = '#141414'; o.beginPath(); o.roundRect ? o.roundRect(x - w / 2, y - 11, w, 22, 11) : o.rect(x - w / 2, y - 11, w, 22); o.fill();
    o.fillStyle = '#fff'; o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillText(text, x, y + 0.5); o.textAlign = 'left';
  }

  /* ---------------- painting ---------------- */
  let brush = 1;
  function paintLayer(create) {
    const Ls = S.doc.layers;
    for (let i = Ls.length - 1; i >= 0; i--) if (Ls[i].type === 'paint') return Ls[i];
    if (!create) return null;
    const L = { id: 'paint', type: 'paint', name: 'Painted stitches', visible: true, cells: {} };
    Ls.push(L); return L;
  }
  function paintCells(cells, yarnId, key) {
    const c = S.chart; if (!c) return;
    const yi = yarnId ? S.doc.yarns.findIndex((y) => y.id === yarnId) : -1;
    mutate((d) => {
      const L = paintLayer(true); if (!L.visible) { L.visible = true; toast('Painted stitches layer was hidden — showing it'); }
      for (const [cc, rr] of cells) {
        if (cc < 0 || rr < 0 || cc >= c.cols || rr >= c.rows) continue;
        const k = paintKey(d, cc, rr, c);
        if (yarnId) L.cells[k] = yarnId; else delete L.cells[k];
        if (yi >= 0) { c.yarnIndex[rr * c.cols + cc] = yi; patchImg(cc, rr, yi); }
      }
    }, { key, source: 'paint', gesture: true });
  }
  function patchImg(cc, rr, yi) { if (!img) return; const x = img.getContext('2d'); x.fillStyle = S.doc.yarns[yi].hex; x.fillRect(cc, rr, 1, 1); }
  function brushCells(cc, rr) { const out = [], h0 = Math.floor((brush - 1) / 2); for (let j = 0; j < brush; j++) for (let i = 0; i < brush; i++) out.push([cc - h0 + i, rr - h0 + j]); return out; }
  function lineCells(a, b) { // Bresenham
    const out = []; let x0 = a.c, y0 = a.r; const x1 = b.c, y1 = b.r, dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
    for (;;) { out.push(...brushCells(x0, y0)); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
    return out;
  }
  function flood(cc, rr) {
    const c = S.chart, { cols, rows } = c, start = rr * cols + cc, target = c.yarnIndex[start];
    const yi = S.doc.yarns.findIndex((y) => y.id === S.activeYarn); if (yi < 0 || yi === target) return;
    const seen = new Uint8Array(cols * rows), stack = [start], out = []; seen[start] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % cols, y = (i / cols) | 0; out.push([x, y]);
      if (out.length > 250000) break;
      const nb = [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, y > 0 ? i - cols : -1, y < rows - 1 ? i + cols : -1];
      for (const n of nb) if (n >= 0 && !seen[n] && c.yarnIndex[n] === target) { seen[n] = 1; stack.push(n); }
    }
    paintCells(out, S.activeYarn, 'fill-' + (++gestureN)); sealHistory();
    toast(`Filled ${out.length.toLocaleString()} stitches`);
  }
  function eyedrop(cell) {
    const c = S.chart, p = c.palette[c.yarnIndex[cell.r * c.cols + cell.c]];
    const id = p && (p.id || (S.doc.yarns[c.yarnIndex[cell.r * c.cols + cell.c]] || {}).id);
    if (id) { setActiveYarn(id); toast(`Paint colour: ${p.name || id}`, 1400); }
  }

  /* ---------------- pointer interaction ---------------- */
  let drag = null, gestureN = 0, hover = null, hoverLayer = null, panning = false, spaceDown = false;
  const touches = new Map();
  let pinch = null;

  function cursorFor(sx, sy) {
    if (spaceDown || S.tool === 'pan') return drag && drag.kind === 'pan' ? 'grabbing' : 'grab';
    if (S.tool === 'select') {
      const hk = handleAt(sx, sy); if (hk) return { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }[hk];
      return hitLayer(sx, sy) ? 'move' : 'default';
    }
    if (S.tool === 'eyedropper') return 'copy';
    return 'crosshair';
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.target !== stage && !(e.target instanceof HTMLCanvasElement)) return;
    stage.focus({ preventScroll: true });
    const p = local(e);
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, p);
      if (touches.size === 2) { // cancel any one-finger gesture → pinch/pan
        if (drag && drag.kind !== 'pan' && drag.key) { /* keep what was done; it's one undo step */ }
        drag = null; const [a, b] = [...touches.values()];
        pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ppi0: V.ppi, w0: screenToIn((a.x + b.x) / 2, (a.y + b.y) / 2) };
        return;
      }
      if (touches.size > 2) return;
    }
    stage.setPointerCapture(e.pointerId);
    const isPan = e.button === 1 || spaceDown || S.tool === 'pan';
    if (isPan) { drag = { kind: 'pan', x0: p.x, y0: p.y, vx: V.vx, vy: V.vy }; panning = true; stage.dataset.cursor = 'grabbing'; e.preventDefault(); return; }
    if (e.button !== 0) return;
    const cell = cellAt(p.x, p.y);
    const key = 'g' + (++gestureN);
    if (S.tool === 'select') {
      const hk = handleAt(p.x, p.y), L0 = selLayer();
      if (hk && L0) { drag = { kind: 'resize', hk, key, L: L0.id, b0: layerBox(L0), snap: JSON.parse(JSON.stringify(L0)) }; return; }
      const L = hitLayer(p.x, p.y);
      if (L) { if (L.id !== S.sel) select(L.id); drag = { kind: 'move', key, L: L.id, p0: screenToIn(p.x, p.y), x0: +L.x, y0: +L.y, moved: false }; }
      else { select(null); drag = null; }
      request(); return;
    }
    if (!cell || !cell.inside || !S.chart) return;
    if (S.tool === 'eyedropper' || (e.altKey && (S.tool === 'pencil' || S.tool === 'fill'))) { eyedrop(cell); return; }
    if (S.tool === 'fill') { flood(cell.c, cell.r); return; }
    if (S.tool === 'pencil' || S.tool === 'eraser') {
      drag = { kind: 'paint', key, last: cell, yarn: S.tool === 'pencil' ? S.activeYarn : null };
      paintCells(brushCells(cell.c, cell.r), drag.yarn, key);
    }
  });

  stage.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, p);
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        V.ppi = Math.min(MAX_PPI, Math.max(MIN_PPI, pinch.ppi0 * d / pinch.d0));
        V.vx = pinch.w0.x - (m.x - W / 2) / V.ppi; V.vy = pinch.w0.y - (m.y - H / 2) / V.ppi;
        emit({ what: 'none', view: true }); request(); return;
      }
    }
    hover = cellAt(p.x, p.y);
    onHover && onHover(hover);
    if (!drag) {
      stage.dataset.cursor = cursorFor(p.x, p.y);
      const hl = S.tool === 'select' ? hitLayer(p.x, p.y) : null;
      if (hl !== hoverLayer) hoverLayer = hl;
      request(); return;
    }
    if (drag.kind === 'pan') { V.vx = drag.vx - (p.x - drag.x0) / V.ppi; V.vy = drag.vy - (p.y - drag.y0) / V.ppi; emit({ what: 'none', view: true }); request(); return; }
    if (drag.kind === 'paint') {
      if (!hover) return;
      if (hover.c !== drag.last.c || hover.r !== drag.last.r) { paintCells(lineCells(drag.last, hover), drag.yarn, drag.key); drag.last = hover; }
      request(); return;
    }
    if (drag.kind === 'move') {
      const q = screenToIn(p.x, p.y); let dx = q.x - drag.p0.x, dy = q.y - drag.p0.y;
      if (!drag.moved && Math.hypot(dx, dy) * V.ppi < 3) return;
      drag.moved = true;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const r3 = (v) => Math.round(v * 1000) / 1000;
      mutate(() => { const L = layerById(drag.L); if (L) { L.x = r3(drag.x0 + dx); L.y = r3(drag.y0 + dy); } }, { key: drag.key, source: 'drag', gesture: true });
      request(); return;
    }
    if (drag.kind === 'resize') { doResize(screenToIn(p.x, p.y), e.shiftKey); request(); }
  });

  function doResize(q, shift) {
    const L = layerById(drag.L); if (!L) return; const b = drag.b0, k = drag.hk, s0 = drag.snap, r3 = (v) => Math.round(v * 1000) / 1000;
    if (L.type === 'rect') {
      let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
      if (k.includes('w')) x0 = Math.min(q.x, x1 - 0.05); if (k.includes('e')) x1 = Math.max(q.x, x0 + 0.05);
      if (k.includes('n')) y0 = Math.min(q.y, y1 - 0.05); if (k.includes('s')) y1 = Math.max(q.y, y0 + 0.05);
      const o = layerOrigin(S.doc, L) || { x: 0, y: 0 };
      mutate(() => { L.x = r3(x0 - o.x); L.y = r3(y0 - o.y); L.w = r3(x1 - x0); L.h = r3(y1 - y0); }, { key: drag.key, source: 'drag', gesture: true });
    } else if (L.type === 'text') {
      const F = hpos(b, { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[k]), C = hpos(b, k);
      const vx = C.x - F.x, vy = C.y - F.y, s = Math.max(0.05, ((q.x - F.x) * vx + (q.y - F.y) * vy) / (vx * vx + vy * vy || 1));
      const o = layerOrigin(S.doc, L) || { x: 0, y: 0 };
      const ax = o.x + s0.x, ay = o.y + s0.y;
      mutate(() => { L.size = r3(Math.max(0.05, s0.size * s)); L.x = r3(F.x + (ax - F.x) * s - o.x); L.y = r3(F.y + (ay - F.y) * s - o.y); }, { key: drag.key, source: 'drag', gesture: true });
    }
  }

  const end = (e) => {
    if (e.pointerType === 'touch') { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; }
    if (drag) { sealHistory(); drag = null; }
    panning = false;
    const p = local(e); stage.dataset.cursor = cursorFor(p.x, p.y); request();
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('pointerleave', () => { hover = null; hoverLayer = null; onHover && onHover(null); request(); });
  stage.addEventListener('auxclick', (e) => e.preventDefault());
  stage.addEventListener('wheel', (e) => {
    e.preventDefault(); const p = local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
    if (e.ctrlKey || e.metaKey) zoomAt(p.x, p.y, Math.exp(-dy * 0.01));
    else if (e.shiftKey || Math.abs(dx) > 0.5) { V.vx += (e.shiftKey && !dx ? dy : dx) / V.ppi; if (!e.shiftKey) V.vy += dy / V.ppi; emit({ what: 'none', view: true }); request(); }
    else zoomAt(p.x, p.y, Math.exp(-dy * 0.0016));
  }, { passive: false });

  // split-view swipe handle
  splitter.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); splitter.setPointerCapture(e.pointerId);
    const mv = (ev) => { const r = stage.getBoundingClientRect(); V.split = Math.min(0.98, Math.max(0.02, (ev.clientX - r.left) / r.width)); placeSplitter(); };
    const up = () => { splitter.removeEventListener('pointermove', mv); splitter.removeEventListener('pointerup', up); };
    splitter.addEventListener('pointermove', mv); splitter.addEventListener('pointerup', up);
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { theme = readTheme(); request(); });

  return {
    request, setChart, setMode, fit, zoomAt, zoomPct, resize,
    zoomBy: (k) => zoomAt(W / 2, H / 2, k),
    setSpace: (v) => { spaceDown = v; if (!drag) stage.dataset.cursor = v ? 'grab' : 'default'; },
    refreshTheme: () => { theme = readTheme(); request(); },
    setBrush: (n) => { brush = Math.max(1, Math.min(15, n)); request(); return brush; }, brush: () => brush,
    nudge: (dx, dy) => { const L = selLayer(); if (!L || (L.type !== 'text' && L.type !== 'rect')) return false; mutate(() => { L.x = Math.round((+L.x + dx) * 1000) / 1000; L.y = Math.round((+L.y + dy) * 1000) / 1000; }, { key: 'nudge-' + L.id }); return true; },
    layerBox, inToScreen, screenToIn, cellAt, xf, size: () => ({ W, H }),
    visibleCentre: () => ({ x: V.vx, y: V.vy }),
  };
}

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
  return { stage: v('--stage', '#f4f3ef'), plate: v('--panel', '#ffffff'), ink: v('--fg', '#141414'), sel: v('--sel', '#141414'), mono: v('--f-mono', 'sans-serif') };
}
