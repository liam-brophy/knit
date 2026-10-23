// Rails: Document, Layers (left); Yarns, selected-layer Properties, Render (right).
// Each section rebuilds only when its structure changes, otherwise its fields are synced in place (fields skip
// syncing while focused, so typing is never interrupted).
import { S, mutate, sealHistory, select, layerById, yarnById, selLayer, setActiveYarn, on } from './store.js';
import { TRIM_PRESETS, SPINE_PAPERS, FONT_CHOICES, MIXES, MAX_YARNS, panels, chartDims, spineWidth, newLayer, newYarn, layerOrigin } from './modules.js';
import { $, h, svg, ICON, numField, row, slider, seg, select as sel, toast, fmtIn } from './ui.js';

export const uploadedFonts = [];
const WEIGHTS = [[300, 'Lt'], [400, 'Rg'], [500, 'Md'], [600, 'SmBd'], [700, 'Bd'], [800, 'XBd'], [900, 'Blk']];

export function createPanels({ stage }) {
  const sections = [docSection(), layersSection(stage), yarnSection(), propsSection(stage), renderSection()];
  const sync = (ev) => { for (const s of sections) s.sync(ev); };
  on((ev) => { if (ev.view) return; sync(ev); });
  sync({});
  return { sync, addLayer: (t) => addLayer(t, stage) };
}

/* ---------------------------------------------------------------- helpers */
function section(el, buildFn, keyFn) {
  let key = null, syncs = [];
  return {
    sync() {
      const k = keyFn();
      if (k !== key) { key = k; syncs = []; el.replaceChildren(); buildFn(el, (fn) => syncs.push(fn)); }
      for (const f of syncs) f();
    },
  };
}
const edit = (fn, key, what) => mutate(fn, { key, what });
const r3 = (v) => Math.round(v * 1000) / 1000;

function yarnChips(getIds, setIds, { multi = true } = {}) {
  const wrap = h('div', { class: 'ychips' });
  const btns = S.doc.yarns.map((y) => {
    const b = h('button', { type: 'button', class: 'ychip', title: `${y.name} ${y.hex}${multi ? ' — click to toggle, ⇧-click to use only this' : ''}` }, h('i', { style: { background: y.hex } }), y.name);
    b.addEventListener('click', (e) => {
      let ids = getIds().slice();
      if (!multi || e.shiftKey) ids = [y.id];
      else if (ids.includes(y.id)) { if (ids.length > 1) ids = ids.filter((q) => q !== y.id); }
      else ids.push(y.id);
      setIds(ids);
    });
    wrap.append(b); return [y.id, b];
  });
  wrap.sync = () => { const ids = getIds(); for (const [id, b] of btns) b.setAttribute('aria-pressed', String(ids.includes(id))); };
  return wrap;
}

/* ---------------------------------------------------------------- Document */
function docSection() {
  const el = $('#docBody');
  return section(el, (el, add) => {
    const d = () => S.doc;
    const name = h('input', { type: 'text', class: 'tx', id: 'docNameIn', spellcheck: 'false' });
    name.addEventListener('input', () => edit((D) => { D.name = name.value; }, 'name', 'none'));
    add(() => { if (document.activeElement !== name) name.value = d().name || ''; });
    el.append(row('Name', name));

    const layout = seg([{ value: 'front', label: 'Front', title: 'Front cover only' }, { value: 'wrap', label: 'Full wrap', title: 'Back + spine + front' }], d().layout, (v) => setLayout(v), 'sm full');
    add(() => layout.set(d().layout));
    el.append(row('Layout', layout));

    const trimSel = sel(TRIM_PRESETS.map((t) => ({ value: t.id, label: t.label })), d().trim.preset || 'custom', (v) => {
      const t = TRIM_PRESETS.find((q) => q.id === v);
      edit((D) => { D.trim.preset = v; if (t && t.w) { D.trim.w = t.w; D.trim.h = t.h; } }, null);
    }, { id: 'trimPreset', 'aria-label': 'Trim size' });
    add(() => trimSel.set(TRIM_PRESETS.some((t) => t.id === d().trim.preset) ? d().trim.preset : 'custom'));
    el.append(row('Trim', trimSel));
    const setTrim = (k) => (v, m) => edit((D) => { D.trim[k] = v; const t = TRIM_PRESETS.find((q) => q.w === D.trim.w && q.h === D.trim.h); D.trim.preset = t ? t.id : 'custom'; }, 'trim' + k);
    const tw = numField({ prefix: 'W', unit: 'in', value: d().trim.w, min: 1, max: 30, step: 0.125, title: 'Trim width (accepts mm, cm, pt: e.g. 152mm)', onInput: setTrim('w') });
    const th = numField({ prefix: 'H', unit: 'in', value: d().trim.h, min: 1, max: 30, step: 0.125, title: 'Trim height', onInput: setTrim('h') });
    add(() => { tw.set(d().trim.w); th.set(d().trim.h); });
    el.append(row('', h('div', { class: 'pair' }, tw, th)));
    const bleed = numField({ unit: 'in', value: d().bleed, min: 0, max: 1, step: 0.0625, title: 'Bleed on every outside edge', onInput: (v) => edit((D) => { D.bleed = v; }, 'bleed') });
    add(() => bleed.set(d().bleed));
    el.append(row('Bleed', bleed));

    if (d().layout === 'wrap') {
      el.append(h('div', { class: 'sub' }, 'Spine'));
      const mode = seg([{ value: 'width', label: 'Width', title: 'Enter spine width directly' }, { value: 'pages', label: 'Page count', title: 'Compute from page count × paper caliper' }], d().spine.mode, (v) => edit((D) => { D.spine.mode = v; }), 'sm full');
      el.append(row('Spine', mode));
      if (d().spine.mode === 'width') {
        const sw = numField({ unit: 'in', value: d().spine.width, min: 0, max: 4, step: 0.0625, onInput: (v) => edit((D) => { D.spine.width = v; }, 'spinew') });
        add(() => sw.set(d().spine.width)); el.append(row('Width', sw));
      } else {
        const pc = numField({ unit: 'pp', value: d().spine.pageCount, min: 4, max: 2000, step: 2, int: true, dec: 0, title: 'Page count', onInput: (v) => edit((D) => { D.spine.pageCount = v; }, 'pages') });
        const papers = [...SPINE_PAPERS.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom caliper' }];
        const paper = sel(papers, d().spine.paper || 'custom', (v) => { const p = SPINE_PAPERS.find((q) => q.id === v); edit((D) => { D.spine.paper = v; if (p) D.spine.caliper = p.caliper; }); }, { 'aria-label': 'Paper' });
        const cal = numField({ unit: 'in/pg', value: d().spine.caliper, min: 0.0005, max: 0.02, step: 0.0001, dec: 5, title: 'Caliper per page (inches)', onInput: (v) => edit((D) => { D.spine.caliper = v; D.spine.paper = (SPINE_PAPERS.find((p) => p.caliper === v) || { id: 'custom' }).id; }, 'cal') });
        add(() => { pc.set(d().spine.pageCount); paper.set(d().spine.paper || 'custom'); cal.set(d().spine.caliper); });
        el.append(row('Pages', pc), row('Paper', paper), row('Caliper', cal));
      }
      const ro = h('div', { class: 'readout' }); add(() => { const w = spineWidth(d()); ro.innerHTML = `Spine <b>${fmtIn(w)} in</b> (${(w * 25.4).toFixed(1)} mm) · ${Math.round(w * d().knit.stsPerInch)} sts wide`; });
      el.append(ro);
    }

    el.append(h('div', { class: 'sub' }, 'Knit'));
    const spi = numField({ unit: 'sts/in', value: d().knit.stsPerInch, min: 4, max: 40, step: 0.5, dec: 2, title: 'Printed stitches per inch — sets how big the stitches look on the cover', onInput: (v) => edit((D) => { D.knit.stsPerInch = v; }, 'spi') });
    add(() => spi.set(d().knit.stsPerInch));
    el.append(row('Scale', spi, 'Printed stitches per inch'));
    const gs = numField({ prefix: 'sts', value: d().knit.gauge.sts, min: 4, max: 60, step: 1, dec: 1, title: 'Gauge: stitches per 4 in (from a yarn label)', onInput: (v) => edit((D) => { D.knit.gauge.sts = v; }, 'gs') });
    const gr = numField({ prefix: 'rows', value: d().knit.gauge.rows, min: 4, max: 80, step: 1, dec: 1, title: 'Gauge: rows per 4 in', onInput: (v) => edit((D) => { D.knit.gauge.rows = v; }, 'gr') });
    add(() => { gs.set(d().knit.gauge.sts); gr.set(d().knit.gauge.rows); });
    el.append(row('Gauge /4 in', h('div', { class: 'pair' }, gs, gr), 'Gauge per 4 in — sets the stitch proportions (row height = stitch width × sts / rows)'));
    const seed = numField({ prefix: '#', value: d().knit.seed, min: 0, max: 99999, step: 1, int: true, dec: 0, title: 'Random seed for mixes, flecks and hand-made irregularity', onInput: (v) => edit((D) => { D.knit.seed = v; }, 'seed') });
    const reroll = h('button', { type: 'button', class: 'btn s', title: 'New random seed' }, 'Reroll');
    reroll.addEventListener('click', () => edit((D) => { D.knit.seed = Math.floor(Math.random() * 99999); }));
    add(() => seed.set(d().knit.seed));
    el.append(row('Seed', h('div', { class: 'pair' }, seed, reroll)));
    const ro = h('div', { class: 'readout', id: 'knitReadout' });
    add(() => {
      const D = d(), c = chartDims(D), g = D.knit.gauge, P = panels(D);
      ro.innerHTML = `Chart <b>${c.cols} × ${c.rows}</b> sts × rows<br>Sheet ${fmtIn(P.sheet.w, 3)} × ${fmtIn(P.sheet.h, 3)} in · stitch ${(c.cellW * 25.4).toFixed(2)} × ${(c.cellH * 25.4).toFixed(2)} mm<br>Knits to <b>${(c.cols / (g.sts / 4)).toFixed(1)} × ${(c.rows / (g.rows / 4)).toFixed(1)} in</b> at gauge`;
    });
    el.append(ro);
  }, () => [S.doc.layout, S.doc.spine.mode].join('|'));
}

function setLayout(v) {
  mutate((D) => {
    if (D.layout === v) return;
    const P0 = panels(D); D.layout = v; const P1 = panels(D), dx = P1.front.x - P0.front.x;
    for (const L of D.layers) {
      if (L.type !== 'rect' && L.type !== 'text') continue;
      const o = layerOrigin({ ...D, layout: P0.back ? 'wrap' : 'front' }, L) || { x: 0, y: 0 };
      const fullWidth = L.type === 'rect' && o.x + L.x <= 0.01 && o.x + L.x + L.w >= P0.sheet.w - 0.01;
      if (fullWidth) { // a band across the whole sheet stays across the whole sheet
        const oy = o.y; L.panel = null; L.x = 0; L.w = r3(P1.sheet.w); L.y = r3(L.y + oy);
      } else if (!L.panel) L.x = r3(L.x + dx); // sheet-relative layers stay on the front
      // back/spine layers are kept (not drawn) when leaving wrap and reappear when switching back
    }
  });
}

/* ---------------------------------------------------------------- Layers */
const TYPE_ICON = { text: ICON.text, rect: ICON.rect, fill: ICON.fill, paint: ICON.paint };
function layersSection(stage) {
  const list = $('#layers');
  let renaming = null;
  const build = () => {
    if (renaming) return;
    list.replaceChildren();
    const Ls = S.doc.layers;
    for (let i = Ls.length - 1; i >= 0; i--) {
      const L = Ls[i];
      const eye = h('button', { type: 'button', class: 'eye', title: L.visible ? 'Hide layer' : 'Show layer', 'aria-label': L.visible ? 'Hide' : 'Show' }, svg(L.visible ? ICON.eye : ICON.eyeOff));
      eye.addEventListener('click', (e) => { e.stopPropagation(); edit((D) => { const l = D.layers.find((q) => q.id === L.id); l.visible = !l.visible; }); });
      const grip = h('span', { class: 'grip', title: 'Drag to reorder' }, svg(ICON.grip));
      const nm = h('span', { class: 'nm', title: 'Double-click to rename' }, L.name || L.type);
      const ys = L.type === 'text' || ((L.type === 'rect' || L.type === 'fill') && L.mix !== 'solid' && L.yarns && L.yarns.length) ? L.yarns : L.type === 'paint' ? [] : [L.yarn];
      const chips = h('span', { class: 'chips' }, (ys || []).slice(0, 4).map((id) => { const y = yarnById(id); return y ? h('i', { style: { background: y.hex }, title: y.name }) : null; }));
      if (L.type === 'paint') chips.append(h('span', { class: 'val' }, String(Object.keys(L.cells || {}).length)));
      const li = h('li', { class: 'layer' + (L.visible ? '' : ' hidden'), tabindex: '0', 'aria-selected': String(L.id === S.sel), 'data-id': L.id }, grip, eye, h('span', { class: 'ty' }, svg(TYPE_ICON[L.type] || ICON.rect)), nm, chips);
      li.addEventListener('click', () => select(L.id));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') startRename(); if (e.key === 'F2') startRename(); });
      const startRename = () => {
        renaming = L.id;
        const inp = h('input', { type: 'text', value: L.name || '', 'aria-label': 'Layer name' });
        nm.replaceChildren(inp); inp.focus(); inp.select();
        const done = (ok) => { if (renaming !== L.id) return; renaming = null; if (ok && inp.value.trim()) edit((D) => { D.layers.find((q) => q.id === L.id).name = inp.value.trim(); }); else build(); };
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
        inp.addEventListener('blur', () => done(true));
        inp.addEventListener('click', (e) => e.stopPropagation());
      };
      nm.addEventListener('dblclick', startRename);
      grip.addEventListener('pointerdown', (e) => dragReorder(e, li, L.id));
      list.append(li);
    }
  };
  function dragReorder(e, li, id) {
    e.preventDefault(); const g = e.currentTarget; g.setPointerCapture(e.pointerId); li.classList.add('dragging');
    let target = null;
    const mv = (ev) => {
      for (const x of list.children) x.classList.remove('drop-before', 'drop-after');
      const items = [...list.children]; target = null;
      for (const it of items) { const r = it.getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { target = { el: it, before: true }; break; } }
      if (!target && items.length) target = { el: items[items.length - 1], before: false };
      if (target) target.el.classList.add(target.before ? 'drop-before' : 'drop-after');
    };
    const up = () => {
      g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); li.classList.remove('dragging');
      for (const x of list.children) x.classList.remove('drop-before', 'drop-after');
      if (!target || target.el === li) return;
      const tid = target.el.dataset.id;
      mutate((D) => {
        const from = D.layers.findIndex((l) => l.id === id); const [L] = D.layers.splice(from, 1);
        let to = D.layers.findIndex((l) => l.id === tid);
        // the list is shown top-first: "before" in the list = above = later in the array
        to = target.before ? to + 1 : to; D.layers.splice(to, 0, L);
      });
    };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
  }
  $('#addText').addEventListener('click', () => addLayer('text', stage));
  $('#addRect').addEventListener('click', () => addLayer('rect', stage));
  $('#layerUp').addEventListener('click', () => moveLayer(1));
  $('#layerDown').addEventListener('click', () => moveLayer(-1));
  $('#layerDel').addEventListener('click', () => deleteLayer());
  $('#layerDup').addEventListener('click', () => duplicateLayer());
  return { sync: () => { build(); const L = selLayer(); for (const b of ['#layerUp', '#layerDown', '#layerDel', '#layerDup']) $(b).disabled = !L; } };
}

export function addLayer(type, stage) {
  const L = newLayer(type, S.doc);
  // place at the visible centre (panel-relative), clamped into the front panel if it's on screen
  const c = stage.visibleCentre(), P = panels(S.doc), panelName = ['front', 'back', 'spine'].find((k) => P[k] && c.x >= P[k].x && c.x <= P[k].x + P[k].w) || 'front';
  L.panel = panelName === 'spine' && type === 'rect' ? 'spine' : panelName;
  const o = P[L.panel];
  if (type === 'text') { L.x = r3(Math.min(o.w, Math.max(0, c.x - o.x))); L.y = r3(Math.min(o.h, Math.max(0, c.y - o.y))); if (L.panel === 'spine') { L.rotate = 90; L.size = r3(Math.min(L.size, o.w * 0.6)); L.x = r3(o.w / 2); } }
  else { L.w = Math.min(L.w, o.w); L.x = r3(Math.max(0, Math.min(o.w - L.w, c.x - o.x - L.w / 2))); L.y = r3(Math.max(0, Math.min(o.h - L.h, c.y - o.y - L.h / 2))); }
  mutate((D) => { // insert below the paint layer so painted stitches stay on top
    const pi = D.layers.map((l) => l.type).lastIndexOf('paint');
    D.layers.splice(pi >= 0 ? pi : D.layers.length, 0, L);
  });
  select(L.id);
  return L;
}
export function moveLayer(dir) {
  const L = selLayer(); if (!L) return;
  mutate((D) => { const i = D.layers.findIndex((l) => l.id === L.id), j = i + dir; if (j < 0 || j >= D.layers.length) return; D.layers.splice(i, 1); D.layers.splice(j, 0, L); });
}
export function deleteLayer() {
  const L = selLayer(); if (!L) return;
  mutate((D) => { D.layers = D.layers.filter((l) => l.id !== L.id); }); select(null);
  toast(`Deleted “${L.name}” — ⌘Z to undo`);
}
export function duplicateLayer() {
  const L = selLayer(); if (!L || L.type === 'fill' || L.type === 'paint') return;
  const C = JSON.parse(JSON.stringify(L)); C.id = L.type[0] + Math.random().toString(36).slice(2, 8); C.name = L.name + ' copy'; C.x = r3(+C.x + 0.25); C.y = r3(+C.y + 0.25);
  mutate((D) => { const i = D.layers.findIndex((l) => l.id === L.id); D.layers.splice(i + 1, 0, C); }); select(C.id);
}

/* ---------------------------------------------------------------- Yarns */
let editYarn = null, lastActive = null;
function yarnSection() {
  const list = $('#yarns'), body = $('#yarnEdit');
  const buildList = () => {
    list.replaceChildren();
    for (const y of S.doc.yarns) {
      const it = h('div', { class: 'yw', tabindex: '0', role: 'option', 'aria-selected': String(y.id === (editYarn || S.activeYarn)), title: `${y.name} — click to paint with this shade` },
        h('span', { class: 'sw', style: { background: y.hex } }), h('span', { class: 'nm' }, y.name), h('span', { class: 'hx' }, y.hex),
        h('span', { class: 'pt', title: y.id === S.activeYarn ? 'Active paint colour' : '' }, y.id === S.activeYarn ? svg(ICON.brush) : null));
      const pick = () => { editYarn = y.id; setActiveYarn(y.id); };
      it.addEventListener('click', pick); it.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      list.append(it);
    }
  };
  const ed = section(body, (el, add) => {
    const id = editYarn; const Y = () => yarnById(id); if (!Y()) return;
    const set = (fn, key) => edit((D) => { const y = D.yarns.find((q) => q.id === id); if (y) fn(y); }, key + id);
    const name = h('input', { type: 'text', class: 'tx', spellcheck: 'false', 'aria-label': 'Shade name' });
    name.addEventListener('input', () => set((y) => { y.name = name.value; }, 'yn', 'none'));
    const color = h('input', { type: 'color', 'aria-label': 'Shade colour' });
    color.addEventListener('input', () => set((y) => { y.hex = color.value; }, 'yc'));
    const hex = h('input', { type: 'text', class: 'tx', spellcheck: 'false', 'aria-label': 'Hex', style: { fontFamily: 'var(--f-mono)' } });
    hex.addEventListener('change', () => { let v = hex.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + [...v.slice(1)].map((c) => c + c).join(''); if (/^#[0-9a-f]{6}$/i.test(v)) set((y) => { y.hex = v.toLowerCase(); }, 'yh'); else toast('Use a 6-digit hex like #7f9cc6'); });
    const heather = slider({ min: 0, max: 1, step: 0.01, dec: 2, value: Y().heather, label: 'Heather', onInput: (v) => set((y) => { y.heather = v; }, 'yhe') });
    const fuzz = slider({ min: 0, max: 1, step: 0.01, dec: 2, value: Y().fuzz, label: 'Fuzz', onInput: (v) => set((y) => { y.fuzz = v; }, 'yfu') });
    add(() => { const y = Y(); if (!y) return; if (document.activeElement !== name) name.value = y.name; color.value = y.hex; if (document.activeElement !== hex) hex.value = y.hex; heather.set(y.heather); fuzz.set(y.fuzz); });
    el.append(row('Name', name), row('Colour', h('div', { class: 'colorin' }, h('span', { class: 'cw' }, color), hex)), row('Heather', heather, 'Tonal fibre variation within the shade'), row('Fuzz', fuzz, 'Halo of loose fibres'));
  }, () => editYarn + '|' + S.doc.yarns.length);
  $('#yarnAdd').addEventListener('click', () => {
    if (S.doc.yarns.length >= MAX_YARNS) return toast(`Up to ${MAX_YARNS} shades`);
    const y = newYarn(S.doc); mutate((D) => { D.yarns.push(y); }); editYarn = y.id; setActiveYarn(y.id);
  });
  $('#yarnDel').addEventListener('click', () => {
    const id = editYarn || S.activeYarn; const D0 = S.doc; if (!id || D0.yarns.length <= 1) return toast('Keep at least one shade');
    const y = yarnById(id);
    mutate((D) => {
      D.yarns = D.yarns.filter((q) => q.id !== id); const fb = D.yarns[0].id;
      for (const L of D.layers) {
        if (L.yarn === id) L.yarn = fb;
        if (Array.isArray(L.yarns)) { L.yarns = L.yarns.filter((q) => q !== id); if (L.type === 'text' && !L.yarns.length) L.yarns = [fb]; }
        if (L.flecks && L.flecks.yarns) L.flecks.yarns = L.flecks.yarns.filter((q) => q !== id);
        if (L.cells) for (const k in L.cells) if (L.cells[k] === id) delete L.cells[k];
      }
    });
    editYarn = null; setActiveYarn(S.doc.yarns[0].id); toast(`Removed ${y ? y.name : 'shade'} — ⌘Z to undo`);
  });
  return {
    sync() {
      if (editYarn && !yarnById(editYarn)) editYarn = null;
      if (!editYarn || S.activeYarn !== lastActive) editYarn = S.activeYarn; // the editor follows the paint colour (eyedropper etc.)
      lastActive = S.activeYarn;
      buildList(); ed.sync(); $('#yarnDel').disabled = S.doc.yarns.length <= 1;
      const y = yarnById(S.activeYarn); $('#activeYarnChip').style.background = y ? y.hex : 'transparent';
      $('#activeYarnBtn').title = `Paint colour: ${y ? y.name + ' ' + y.hex : '—'} (click a shade in Yarns to change)`;
    },
  };
}
export function setEditYarn(id) { editYarn = id; }

/* ---------------------------------------------------------------- Properties */
function propsSection(stage) {
  const el = $('#props');
  return section(el, (el, add) => {
    const L0 = selLayer();
    $('#propTitle').textContent = L0 ? { text: 'Text', rect: 'Colour block', fill: 'Ground fill', paint: 'Painted stitches' }[L0.type] : 'Layer';
    if (!L0) {
      el.append(h('p', { class: 'hint' }, 'Select a layer on the stage or in Layers. ', h('span', { class: 'kbd' }, 'T'), ' adds text; paint stitches with ', h('span', { class: 'kbd' }, 'B'), ' pencil, ', h('span', { class: 'kbd' }, 'G'), ' fill, ', h('span', { class: 'kbd' }, 'I'), ' eyedropper.'));
      return;
    }
    const id = L0.id, L = () => layerById(id) || L0;
    const set = (fn, key, what) => edit((D) => { const l = D.layers.find((q) => q.id === id); if (l) fn(l); }, key ? key + id : null, what);
    const NF = (k, o) => { const f = numField({ value: L()[k], ...o, onInput: (v) => set((l) => { l[k] = v; }, k) }); add(() => f.set(L()[k])); return f; };

    if (L0.type === 'text') {
      const ta = h('textarea', { spellcheck: 'false', 'aria-label': 'Text', id: 'propText', rows: '2' });
      ta.addEventListener('input', () => set((l) => { l.text = ta.value; }, 'text'));
      add(() => { if (document.activeElement !== ta) ta.value = L().text; });
      el.append(ta);
      const fonts = [...FONT_CHOICES, ...uploadedFonts];
      if (!fonts.includes(L0.font)) fonts.push(L0.font);
      const font = sel(fonts.map((f) => ({ value: f, label: f })), L0.font, (v) => set((l) => { l.font = v; }), { 'aria-label': 'Typeface' });
      const up = h('label', { class: 'btn s', title: 'Upload a font (TTF, OTF, WOFF, WOFF2) — used for this session' }, 'Upload font…', h('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2', hidden: true, onchange: (e) => uploadFont(e.target.files[0], (fam) => set((l) => { l.font = fam; })) }));
      add(() => font.set(L().font));
      el.append(row('Font', font));
      el.append(row('', h('div', { style: { display: 'flex', justifyContent: 'flex-start' } }, up)));
      const weight = sel(WEIGHTS.map(([v, n]) => ({ value: String(v), label: `${v} ${n}` })), String(L0.weight), (v) => set((l) => { l.weight = +v; }), { 'aria-label': 'Weight' });
      const ital = seg([{ value: false, label: 'Roman', title: 'Upright' }, { value: true, label: 'Italic', title: 'Italic' }], !!L0.italic, (v) => set((l) => { l.italic = v; }));
      add(() => { weight.set(String(L().weight)); ital.set(!!L().italic); });
      el.append(row('Weight', weight));
      el.append(row('Style', ital));
      const size = NF('size', { unit: 'in', min: 0.05, max: 20, step: 0.05, title: 'Font size (em) in inches — also accepts pt/mm, e.g. 72pt' });
      const sizeRo = h('div', { class: 'readout' });
      add(() => { const c = S.chart; if (c) sizeRo.innerHTML = `${(L().size * 72).toFixed(1)} pt em · <b>${Math.round(L().size / c.cellH)} rows</b> × ${Math.round(L().size / c.cellW)} sts`; });
      el.append(row('Size', size), sizeRo);
      const align = seg([{ value: 'left', icon: ICON.alignL, title: 'Align left' }, { value: 'center', icon: ICON.alignC, title: 'Align centre' }, { value: 'right', icon: ICON.alignR, title: 'Align right' }], L0.align, (v) => set((l) => { l.align = v; }));
      const anchor = seg([{ value: 'top', label: 'Top', title: 'Y = top of the first line' }, { value: 'middle', label: 'Mid', title: 'Y = middle of the text block' }, { value: 'baseline', label: 'Base', title: 'Y = first baseline' }], L0.anchor, (v) => set((l) => { l.anchor = v; }));
      add(() => { align.set(L().align); anchor.set(L().anchor); });
      el.append(row('Align', align), row('Anchor', anchor));
      const rot = seg([{ value: 0, label: '0°', title: 'Horizontal' }, { value: 90, label: '90°', title: 'Rotated clockwise — reads top to bottom (US spine)' }, { value: -90, label: '−90°', title: 'Rotated anticlockwise — reads bottom to top (UK/EU spine)' }], L0.rotate, (v) => set((l) => { l.rotate = v; }));
      add(() => rot.set(L().rotate));
      el.append(row('Rotate', rot));
      const tr = NF('tracking', { unit: 'em', min: -0.2, max: 1, step: 0.005, title: 'Tracking in em' });
      const ld = NF('leading', { unit: '×', min: 0.5, max: 3, step: 0.01, dec: 2, title: 'Leading as a multiple of size' });
      el.append(row('Track / lead', h('div', { class: 'pair' }, tr, ld)));
      const fill = slider({ min: 0.15, max: 0.85, step: 0.01, dec: 2, value: L0.fill, label: 'Stitch fill', title: 'How much of a stitch a letter must cover to be knitted — raise to keep thin serifs', onInput: (v) => set((l) => { l.fill = v; }, 'fill') });
      add(() => fill.set(L().fill));
      el.append(row('Stitch fill', fill, 'How much of a stitch a letter must cover to be knitted in its yarn. Raise to keep thin serifs.'));
    }

    if (L0.type === 'text' || L0.type === 'rect') {
      const P = panels(S.doc);
      const opts = [{ value: '', label: 'Sheet' }, ...['front', 'spine', 'back'].filter((k) => P[k]).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }))];
      const panelSel = sel(opts, L0.panel || '', (v) => set((l) => { // keep the same position on the sheet
        const o0 = layerOrigin(S.doc, l) || { x: 0, y: 0 }; l.panel = v || null; const o1 = layerOrigin(S.doc, l) || { x: 0, y: 0 };
        l.x = r3(l.x + o0.x - o1.x); l.y = r3(l.y + o0.y - o1.y);
      }), { 'aria-label': 'Position relative to' });
      add(() => panelSel.set(L().panel || ''));
      el.append(h('div', { class: 'sub' }, 'Position'), row('Relative to', panelSel, 'X/Y are measured from the top-left of this panel'));
      const x = NF('x', { prefix: 'X', unit: 'in', min: -40, max: 40, step: 0.0625 }), y = NF('y', { prefix: 'Y', unit: 'in', min: -40, max: 40, step: 0.0625 });
      el.append(row('', h('div', { class: 'pair' }, x, y)));
      if (L0.type === 'rect') {
        const w = NF('w', { prefix: 'W', unit: 'in', min: 0.01, max: 40, step: 0.0625 }), hh = NF('h', { prefix: 'H', unit: 'in', min: 0.01, max: 40, step: 0.0625 });
        el.append(row('', h('div', { class: 'pair' }, w, hh)));
        const feather = NF('feather', { unit: 'in', min: 0, max: 2, step: 0.02, title: 'Feather the edges into the stitches below (dithered)' });
        el.append(row('Feather', feather));
      }
      const quick = h('div', { class: 'row-btns', style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } });
      const centreH = h('button', { type: 'button', class: 'btn s', title: 'Centre horizontally in its panel' }, 'Centre ↔');
      centreH.addEventListener('click', () => { const b = stage.layerBox(L()); const pn = P[L().panel] || P.sheet; if (b) set((l) => { l.x = r3(l.x + (pn.x + pn.w / 2) - (b.x + b.w / 2)); }); });
      const centreV = h('button', { type: 'button', class: 'btn s', title: 'Centre vertically in its panel' }, 'Centre ↕');
      centreV.addEventListener('click', () => { const b = stage.layerBox(L()); const pn = P[L().panel] || P.sheet; if (b) set((l) => { l.y = r3(l.y + (pn.y + pn.h / 2) - (b.y + b.h / 2)); }); });
      quick.append(centreH, centreV); el.append(row('', quick));
    }

    if (L0.type === 'text' || L0.type === 'rect' || L0.type === 'fill') {
      el.append(h('div', { class: 'sub' }, 'Yarns'));
      const multiAllowed = true;
      const getIds = () => { const l = L(); return l.type === 'text' ? l.yarns : (l.mix !== 'solid' && l.yarns && l.yarns.length ? l.yarns : [l.yarn].filter(Boolean)); };
      const setIds = (ids) => set((l) => {
        if (l.type === 'text') { l.yarns = ids; if (ids.length > 1 && l.mix === 'solid') l.mix = 'patches'; }
        else { l.yarn = ids[0]; l.yarns = ids; if (ids.length > 1 && l.mix === 'solid') l.mix = 'patches'; if (ids.length === 1) l.mix = 'solid'; }
      });
      const chips = yarnChips(getIds, setIds, { multi: multiAllowed });
      add(() => chips.sync());
      el.append(chips);
      const mixSel = sel(MIXES.map((m) => ({ value: m, label: { solid: 'Solid (first yarn)', patches: 'Patches', stripe: 'Self-striping', letters: 'By letter', speckle: 'Speckle' }[m] || m })), L0.mix || 'solid', (v) => set((l) => { l.mix = v; }), { 'aria-label': 'Mix' });
      add(() => { mixSel.set(L().mix || 'solid'); mixSel.disabled = getIds().length < 2; });
      el.append(row('Mix', mixSel, 'How several yarns are combined'));
      if (L0.type !== 'text') {
        const fl = () => L().flecks || { density: 0, yarns: [] };
        const dens = slider({ min: 0, max: 0.06, step: 0.001, dec: 3, value: fl().density, label: 'Flecks', onInput: (v) => set((l) => { l.flecks = { ...(l.flecks || { yarns: [] }), density: v }; }, 'fd') });
        const fy = yarnChips(() => fl().yarns || [], (ids) => set((l) => { l.flecks = { ...(l.flecks || { density: 0.01 }), yarns: ids }; }));
        add(() => { dens.set(fl().density); fy.sync(); });
        el.append(row('Flecks', dens, 'Share of stitches knitted in a contrast fleck yarn'), fy);
      }
    }

    if (L0.type === 'paint') {
      const n = h('div', { class: 'readout' }); add(() => { n.innerHTML = `<b>${Object.keys(L().cells || {}).length.toLocaleString()}</b> painted stitches (stored by position, so they survive grid changes)`; });
      const clear = h('button', { type: 'button', class: 'btn s' }, 'Clear all painted stitches');
      clear.addEventListener('click', () => set((l) => { l.cells = {}; }));
      el.append(n, clear, h('p', { class: 'hint' }, 'Paint with ', h('span', { class: 'kbd' }, 'B'), ' pencil, ', h('span', { class: 'kbd' }, 'E'), ' eraser, ', h('span', { class: 'kbd' }, 'G'), ' fill; ', h('span', { class: 'kbd' }, '['), ' ', h('span', { class: 'kbd' }, ']'), ' change brush size; ', h('span', { class: 'kbd' }, 'Alt'), '-click picks a shade.'));
    }
  }, () => { const L = selLayer(); return L ? [L.id, L.type, S.doc.yarns.map((y) => y.id + y.name + y.hex).join(), uploadedFonts.length, S.doc.layout].join('|') : 'none'; });
}

async function uploadFont(file, done) {
  if (!file) return;
  try {
    const fam = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[^\w\s-]/g, ' ').trim() || 'Uploaded font';
    const ff = new FontFace(fam, await file.arrayBuffer()); await ff.load(); document.fonts.add(ff);
    if (!uploadedFonts.includes(fam)) uploadedFonts.push(fam);
    done(fam); toast(`Loaded ${fam} (this session only — re-upload after reopening)`);
  } catch (e) { toast('Could not load that font file'); }
}

/* ---------------------------------------------------------------- Render */
function renderSection() {
  const el = $('#renderBody');
  return section(el, (el, add) => {
    const R = () => S.doc.render;
    const set = (fn, key) => mutate((D) => fn(D.render), { key: 'r' + key, what: 'render' });
    // light dial: azimuth (degrees, 0 = from the right, 90 = from the top, counter-clockwise), drag to set
    const dial = h('div', { class: 'dial', tabindex: '0', role: 'slider', 'aria-label': 'Light direction', 'aria-valuemin': '0', 'aria-valuemax': '359', title: 'Light direction — drag (arrow keys nudge)' });
    const s = svg('<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" opacity=".4"/><line id="dl" x1="12" y1="12" x2="12" y2="2" stroke-width="1"/><circle id="dk" cx="12" cy="2" r="2.4" fill="var(--accent)" stroke="var(--panel)" stroke-width="1"/>');
    dial.append(s);
    const place = () => { const a = R().light.azimuth * Math.PI / 180, rr = 9.5 * (1 - (R().light.elevation - 10) / 160); const x = 12 + Math.cos(a) * rr, y = 12 - Math.sin(a) * rr; s.querySelector('#dk').setAttribute('cx', x); s.querySelector('#dk').setAttribute('cy', y); s.querySelector('#dl').setAttribute('x2', x); s.querySelector('#dl').setAttribute('y2', y); dial.setAttribute('aria-valuenow', String(Math.round(R().light.azimuth))); };
    const fromEv = (e) => { const r = dial.getBoundingClientRect(); const a = Math.atan2(-(e.clientY - r.top - r.height / 2), e.clientX - r.left - r.width / 2) * 180 / Math.PI; return Math.round((a + 360) % 360); };
    dial.addEventListener('pointerdown', (e) => {
      dial.setPointerCapture(e.pointerId); set((r) => { r.light.azimuth = fromEv(e); }, 'az');
      const mv = (ev) => set((r) => { r.light.azimuth = fromEv(ev); }, 'az');
      const up = () => { dial.removeEventListener('pointermove', mv); dial.removeEventListener('pointerup', up); sealHistory(); };
      dial.addEventListener('pointermove', mv); dial.addEventListener('pointerup', up);
    });
    dial.addEventListener('keydown', (e) => { const k = { ArrowLeft: 5, ArrowUp: 5, ArrowRight: -5, ArrowDown: -5 }[e.key]; if (k) { e.preventDefault(); set((r) => { r.light.azimuth = (r.light.azimuth + k * (e.shiftKey ? 3 : 1) + 360) % 360; }, 'az'); } });
    const az = numField({ unit: '°', value: R().light.azimuth, min: 0, max: 360, step: 1, dec: 0, title: 'Light azimuth (135° = top-left)', onInput: (v) => set((r) => { r.light.azimuth = v % 360; }, 'az') });
    const el2 = numField({ unit: '°', value: R().light.elevation, min: 10, max: 89, step: 1, dec: 0, title: 'Light height above the fabric', onInput: (v) => set((r) => { r.light.elevation = v; }, 'el') });
    add(() => { place(); az.set(R().light.azimuth); el2.set(R().light.elevation); });
    el.append(h('div', { class: 'lightrow' }, dial, h('div', { class: 'secbody' }, row('From', az), row('Height', el2))));
    const S1 = (k, label, min, max, step, dec, title) => { const sl = slider({ min, max, step, dec, value: R()[k], label, onInput: (v) => set((r) => { r[k] = v; }, k) }); add(() => sl.set(R()[k])); el.append(row(label, sl, title)); };
    S1('irregularity', 'Irregularity', 0, 1, 0.01, 2, 'Hand-made variation per stitch and per row');
    S1('halo', 'Halo', 0, 1, 0.01, 2, 'Fuzz and stray fibres');
    S1('plies', 'Plies', 1, 4, 1, 0, 'Number of plies in each leg');
    S1('twist', 'Twist', 0, 1, 0.01, 2, 'Ply twist angle');
    S1('contrast', 'Contrast', 0.5, 1.6, 0.01, 2, 'Depth of shading');
    const bg = h('input', { type: 'color', 'aria-label': 'Background' });
    bg.addEventListener('input', () => set((r) => { r.background = bg.value; }, 'bg'));
    add(() => { bg.value = R().background || '#f4f3ef'; });
    el.append(row('Backdrop', h('div', { class: 'colorin' }, h('span', { class: 'cw' }, bg), h('span', { class: 'hint' }, 'Behind the fabric'))));
  }, () => 'render');
}
