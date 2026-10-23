// Knit — app shell: compose pipeline, header, tools, view modes, keyboard, status, autosave.
import { S, on, mutate, undo, redo, canUndo, canRedo, setDoc, setTool, select, selLayer, init, loadInitialDoc, sealHistory } from './store.js';
import { DOC_PRESETS, createDoc, composeChart, createKnitRenderer, fontCss, serialize } from './modules.js';
import { createStage } from './stage.js';
import { createPanels, addLayer, moveLayer, deleteLayer, duplicateLayer } from './panels.js';
import { createExport, getDownloads } from './export.js';
import { $, $$, h, toast } from './ui.js';

export async function start() {
  const { doc, restored } = loadInitialDoc();
  init(doc);

  // Knit uses one light theme; older docs saved with the dark v3 backdrop get the new working-surface colour.
  if (S.doc && S.doc.render && /^#1a1a1a$/i.test(S.doc.render.background || '')) S.doc.render.background = '#f4f3ef';

  /* ---------- renderer ---------- */
  let renderer = null;
  try { renderer = createKnitRenderer($('#fabric')); }
  catch (e) { console.warn('Knit renderer unavailable:', e); toast('The knitted preview needs WebGL2 — showing the chart', 5000); }

  /* ---------- stage + panels ---------- */
  const stage = createStage({ renderer, onHover: showHover });
  const panelsApi = createPanels({ stage });
  const exporter = createExport({ renderer, afterCompose: () => flushCompose() });

  /* ---------- compose pipeline (debounced; view changes only call render) ---------- */
  let timer = 0, pending = null, waiters = [];
  const fontReady = new Map();
  function fontsFor(d) {
    const ps = [];
    for (const L of d.layers) if (L.type === 'text' && L.visible !== false) {
      const css = fontCss(L, 40);
      if (!fontReady.has(css)) fontReady.set(css, Promise.race([document.fonts.load(css, L.text || 'A').catch(() => null), new Promise((r) => setTimeout(r, 2500))]).then(() => true));
      ps.push(fontReady.get(css));
    }
    return Promise.all(ps);
  }
  const renderSettings = () => ({ ...S.doc.render, seed: S.doc.knit.seed });
  function scheduleCompose(delay = 16) {
    pending = pending || 'compose';
    if (!timer) timer = setTimeout(runCompose, delay);
  }
  async function runCompose() {
    timer = 0; const what = pending; pending = null;
    try {
      if (what === 'compose') {
        await fontsFor(S.doc);
        const t0 = performance.now();
        S.chart = composeChart(S.doc);
        S.composeMs = performance.now() - t0;
        renderer && renderer.setChart(S.chart, renderSettings());
        stage.setChart(S.chart);
      } else if (what === 'render' && S.chart) { renderer && renderer.setChart(S.chart, renderSettings()); stage.request(); }
    } catch (e) { console.error('compose failed', e); }
    updateStatus();
    if (!pending && !timer) { const w = waiters; waiters = []; w.forEach((f) => f()); }
  }
  function flushCompose() { return !timer && !pending ? Promise.resolve() : new Promise((r) => waiters.push(r)); }
  document.fonts && document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', () => scheduleCompose(30));

  on((ev) => {
    if (ev.what === 'compose') scheduleCompose(ev.source === 'drag' || ev.source === 'paint' ? 0 : 24);
    else if (ev.what === 'render') { if (pending !== 'compose') pending = 'render'; if (!timer) timer = setTimeout(runCompose, 16); }
    if (ev.fit) flushCompose().then(() => stage.fit());
    stage.request();
    syncChrome(ev);
  });

  /* ---------- header ---------- */
  const presetSel = $('#preset');
  for (const [id, p] of Object.entries(DOC_PRESETS)) presetSel.append(h('option', { value: id }, p.label));
  presetSel.addEventListener('change', () => { const id = presetSel.value; presetSel.value = ''; setDoc(createDoc(id)); toast(`New document from “${DOC_PRESETS[id].label}” — ⌘Z to go back`); });
  $('#undo').addEventListener('click', () => undo());
  $('#redo').addEventListener('click', () => redo());
  $('#exportBtn').addEventListener('click', () => exporter.open());

  /* ---------- tools / views / guides / zoom ---------- */
  for (const b of $$('#tools .tool[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
  for (const b of $$('#viewSeg button')) b.addEventListener('click', () => setView(b.dataset.view));
  for (const b of $$('#guideToggles .tg')) b.addEventListener('click', () => mutate((d) => { d.guides[b.dataset.guide] = !d.guides[b.dataset.guide]; }, { history: false, what: 'none' }));
  $('#zoomIn').addEventListener('click', () => stage.zoomBy(1.25));
  $('#zoomOut').addEventListener('click', () => stage.zoomBy(0.8));
  $('#zoomFit').addEventListener('click', () => stage.fit());
  $('#zoomVal').addEventListener('click', () => stage.fit());
  $('#activeYarnBtn').addEventListener('click', () => { $('#yarnPanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); setTool('pencil'); });

  function setView(m) {
    if (!renderer && m !== 'chart') { toast('The knitted preview needs WebGL2'); m = 'chart'; }
    stage.setMode(m); for (const b of $$('#viewSeg button')) b.setAttribute('aria-pressed', String(b.dataset.view === m));
  }

  function syncChrome() {
    $('#undo').disabled = !canUndo(); $('#redo').disabled = !canRedo();
    $('#docName').textContent = S.doc.name || 'Untitled';
    for (const b of $$('#tools .tool[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === S.tool));
    for (const b of $$('#guideToggles .tg')) b.setAttribute('aria-pressed', String(!!S.doc.guides[b.dataset.guide]));
    $('#zoomVal').textContent = stage.zoomPct() + '%';
    updateStatus();
  }

  /* ---------- status bar ---------- */
  let lastHover = null;
  function showHover(cell) { lastHover = cell; updateStatus(); }
  function updateStatus() {
    const c = S.chart; if (!c) return;
    const hv = lastHover;
    if (hv && hv.inside) {
      const yi = c.yarnIndex[hv.r * c.cols + hv.c], y = S.doc.yarns[yi];
      $('#stCursor').textContent = `st ${c.cols - hv.c} · row ${c.rows - hv.r}`;
      $('#stYarn').replaceChildren(...(y ? [h('i', { style: { background: y.hex } }), y.name] : []));
    } else { $('#stCursor').textContent = `${c.cols} sts × ${c.rows} rows`; $('#stYarn').replaceChildren(); }
    const paint = ['pencil', 'eraser'].includes(S.tool) ? ` · brush ${stage.brush()}` : '';
    $('#stDims').textContent = `${c.cols} × ${c.rows}${paint}`;
    $('#stCompose').textContent = `compose ${S.composeMs.toFixed(0)} ms`;
  }

  /* ---------- keyboard ---------- */
  const isField = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (isField(e.target)) {
      if (e.key === 'Escape') e.target.blur();
      return; // native editing (incl. the field's own undo)
    }
    if ($('#exportDlg').open) return;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && (k === '0')) { e.preventDefault(); stage.fit(); return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); stage.zoomBy(1.25); return; }
    if (mod && k === '-') { e.preventDefault(); stage.zoomBy(0.8); return; }
    if (mod && k === 'e') { e.preventDefault(); exporter.open(); return; }
    if (mod && k === 's') { e.preventDefault(); getDownloads().then((d) => d ? exporter.save(`${(S.doc.name || 'cover').replace(/[^\w-]+/g, '-')}.stitchsetter.json`, new Blob([serialize(S.doc)], { type: 'application/json' })) : toast('Saving files isn’t available here')); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicateLayer(); return; }
    if (mod && k === ']') { e.preventDefault(); moveLayer(1); return; }
    if (mod && k === '[') { e.preventDefault(); moveLayer(-1); return; }
    if (mod) return;
    if (e.key === ' ') { e.preventDefault(); if (!e.repeat) stage.setSpace(true); return; }
    const tools = { v: 'select', b: 'pencil', e: 'eraser', g: 'fill', i: 'eyedropper', h: 'pan' };
    if (tools[k]) { setTool(tools[k]); return; }
    if (k === 't') { e.preventDefault(); setTool('select'); addLayer('text', stage); requestAnimationFrame(() => { const ta = $('#propText'); if (ta) { ta.focus(); ta.select(); } }); return; }
    if (k === '1' || k === '2' || k === '3') { setView(['fabric', 'chart', 'split'][+k - 1]); return; }
    if (k === '=' || k === '+') { stage.zoomBy(1.25); return; }
    if (k === '-' || k === '_') { stage.zoomBy(0.8); return; }
    if (k === '[') { stage.setBrush(stage.brush() - 1); updateStatus(); return; }
    if (k === ']') { stage.setBrush(stage.brush() + 1); updateStatus(); return; }
    if (e.key === 'Escape') { select(null); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (selLayer()) { e.preventDefault(); deleteLayer(); } return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (arrows && S.chart && selLayer()) { e.preventDefault(); const m = e.shiftKey ? 10 : 1; stage.nudge(arrows[0] * m * S.chart.cellW, arrows[1] * m * S.chart.cellH); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') stage.setSpace(false); if (e.key.startsWith('Arrow')) sealHistory(); });
  window.addEventListener('blur', () => stage.setSpace(false));

  /* ---------- go ---------- */
  stage.setMode('fabric'); setView(renderer ? 'fabric' : 'chart');
  syncChrome();
  scheduleCompose(0);
  await flushCompose();
  stage.fit();
  if (restored) toast('Restored your last session — pick a preset to start over');
  // downloads capability: probe once so the export dialog can explain when saving is unavailable
  getDownloads().then((d) => { if (!d) $('#exportBtn').title = 'Export — saving files isn’t available here (you can still open a project)'; });

  window.__studio = {
    get doc() { return S.doc; }, get chart() { return S.chart; }, renderer, stage, S,
    setDoc: (d, o) => setDoc(d, o), compose: () => { scheduleCompose(0); return flushCompose(); }, flush: flushCompose,
    createDoc, select, setTool, setView, undo, redo, exporter, panels: panelsApi,
  };
}
