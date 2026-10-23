// Export dialog: knitted PNG (renderer.renderRegion), knitting chart PNG, project JSON save / open.
// Saving uses the host downloads capability exactly as the contract describes; without it the save buttons are
// disabled with an explanation (opening a project still works).
import { S, setDoc } from './store.js';
import { panels, serialize, deserialize } from './modules.js';
import { chartPNG } from './chart.js';
import { $, h, toast } from './ui.js';

let downloads = null, dlChecked = false;
export async function getDownloads() {
  if (dlChecked) return downloads;
  if (window.claude && window.claude.use) {
    // Inside a Claude artifact: use the host's downloads capability.
    try { downloads = await window.claude.use('downloads'); } catch { downloads = null; }
  } else {
    // Standalone site (knit.liam.site): ordinary browser downloads.
    downloads = { async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { status: 'saved' };
    } };
  }
  dlChecked = true; return downloads;
}

const WHAT = [
  { id: 'sheet', label: 'Full sheet with bleed', rect: (P) => P.sheet },
  { id: 'trim', label: 'Trimmed (no bleed)', rect: (P) => P.trim },
  { id: 'front', label: 'Front cover only', rect: (P) => P.front },
  { id: 'spine', label: 'Spine', rect: (P) => P.spine },
  { id: 'back', label: 'Back cover', rect: (P) => P.back },
];

export function createExport({ renderer, afterCompose }) {
  const dlg = $('#exportDlg');
  let what = 'sheet', dpi = 300, fmt = 'jpeg', busy = false;
  const slug = () => (S.doc.name || 'stitch-setter').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cover';

  function regionPx() {
    const P = panels(S.doc), w = WHAT.find((q) => q.id === what), r = w && w.rect(P);
    if (!r) return null;
    return { r, widthPx: Math.round(r.w * dpi), heightPx: Math.round(r.h * dpi) };
  }
  function buildWhat() {
    const P = panels(S.doc), box = $('#exWhat'); box.replaceChildren();
    for (const w of WHAT) {
      const r = w.rect(P), ok = !!r && r.w > 0;
      if (!ok && what === w.id) what = 'sheet';
      const inp = h('input', { type: 'radio', name: 'exWhat', value: w.id, disabled: !ok });
      inp.checked = what === w.id;
      inp.addEventListener('change', () => { what = w.id; updateSize(); });
      box.append(h('label', { class: ok ? '' : 'dis', title: ok ? '' : 'Only in a full-wrap layout' }, inp, w.label, h('span', { class: 'val' }, ok ? `${r.w.toFixed(3)} × ${r.h.toFixed(3)} in` : 'wrap only')));
    }
  }
  function updateSize() {
    const rp = regionPx();
    $('#exSize').textContent = rp ? `${rp.widthPx} × ${rp.heightPx} px · ${(rp.widthPx * rp.heightPx / 1e6).toFixed(1)} MP` : '';
  }
  for (const b of $('#exDpi').querySelectorAll('button')) b.addEventListener('click', () => { dpi = +b.dataset.dpi; for (const q of $('#exDpi').querySelectorAll('button')) q.setAttribute('aria-pressed', String(q === b)); updateSize(); });

  for (const b of $('#exFmt').querySelectorAll('button')) b.addEventListener('click', () => { fmt = b.dataset.fmt; for (const q of $('#exFmt').querySelectorAll('button')) q.setAttribute('aria-pressed', String(q === b)); });

  async function save(filename, blob) {
    const d = await getDownloads();
    if (!d) { toast('Saving files isn’t available here'); return false; }
    try { await d.save({ filename, data: blob }); toast(`Saved ${filename}`); return true; }
    catch (e) {
      const code = (e && (e.code || e.message)) || '';
      toast(/declined/.test(code) ? 'Save cancelled' : /rate_limited/.test(code) ? 'Too many saves in a row — try again in a moment' : /too_large/.test(code) ? 'That file is too large to save here — try 300 dpi or a smaller region' : 'Could not save the file');
      return false;
    }
  }
  const progress = (msg) => { $('#exProgress').hidden = !msg; $('#exProgressMsg').textContent = msg || ''; for (const b of ['#exPng', '#exChart', '#exJson']) $(b).disabled = !!msg || !downloads; };

  $('#exPng').addEventListener('click', async () => {
    if (busy) return; const rp = regionPx(); if (!rp) return;
    busy = true; progress(`Rendering ${rp.widthPx} × ${rp.heightPx} px…`);
    try {
      await afterCompose();
      const c = S.chart, r = rp.r;
      const blob = await renderer.renderRegion({ x0: r.x / c.cellW, y0: r.y / c.cellH, x1: (r.x + r.w) / c.cellW, y1: (r.y + r.h) / c.cellH, widthPx: rp.widthPx, heightPx: rp.heightPx, format: fmt, quality: 0.93 });
      window.__lastExport = { kind: fmt, what, dpi, widthPx: rp.widthPx, heightPx: rp.heightPx, size: blob && blob.size };
      await save(`${slug()}-${what}-${dpi}dpi.${fmt === 'jpeg' ? 'jpg' : 'png'}`, blob);
    } catch (e) { console.warn(e); toast('Export failed: ' + (e && e.message || e)); }
    finally { busy = false; progress(''); }
  });
  $('#exChart').addEventListener('click', async () => {
    if (busy) return; busy = true; progress('Drawing chart…');
    try { await afterCompose(); const blob = await chartPNG(S.doc, S.chart, S.doc.name); await save(`${slug()}-chart.png`, blob); }
    catch (e) { console.warn(e); toast('Chart export failed'); }
    finally { busy = false; progress(''); }
  });
  $('#exJson').addEventListener('click', async () => {
    await save(`${slug()}.stitchsetter.json`, new Blob([serialize(S.doc)], { type: 'application/json' }));
  });
  $('#openFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const doc = deserialize(await f.text()); setDoc(doc); dlg.close(); toast(`Opened ${doc.name || f.name}`); }
    catch (err) { toast('That file isn’t a Stitch Setter project'); }
  });

  async function open() {
    buildWhat(); updateSize();
    const d = await getDownloads();
    const note = $('#dlNote');
    note.hidden = !!d; note.textContent = d ? '' : 'Saving files isn’t available in this view, so export is turned off. You can still open a project.';
    progress('');
    if (!dlg.open) dlg.showModal();
  }
  return { open, save };
}
