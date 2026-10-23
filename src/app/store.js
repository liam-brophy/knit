// App state: the document (plain JSON), selection, tool, view, undo/redo history, autosave.
import { createDoc, deserialize, serialize } from './modules.js';

const AUTOSAVE_KEY = 'stitch-setter-v3:doc';
const listeners = new Set();

export const S = {
  doc: null,
  chart: null,
  sel: null,            // selected layer id
  tool: 'select',
  activeYarn: null,     // yarn id used by pencil / fill
  view: { mode: 'fabric', scale: 4, cx: 0, cy: 0, split: 0.5 },
  composeMs: 0,
};

/* ---------------- history ---------------- */
const undoStack = [], redoStack = [];
let lastKey = null, lastT = 0;
const MAX_HIST = 120;
const snap = () => JSON.stringify(S.doc);

/**
 * Change the document. fn(doc) mutates in place.
 * opts.key: coalesce consecutive edits with the same key (slider drags, typing, one canvas gesture) into one undo step.
 * opts.gesture: the key names one pointer gesture — coalesce however long it takes.
 * opts.history=false: not undoable (view guides etc). opts.what: 'compose' (default) | 'render' (render settings only) | 'none'.
 */
export function mutate(fn, opts = {}) {
  const now = performance.now();
  if (opts.history !== false) {
    if (!(opts.key && opts.key === lastKey && (opts.gesture || now - lastT < 1500))) {
      undoStack.push(snap()); if (undoStack.length > MAX_HIST) undoStack.shift();
      redoStack.length = 0;
    }
    lastKey = opts.key || null; lastT = now;
  }
  fn(S.doc);
  emit({ what: opts.what || 'compose', source: opts.source });
}
/** Break coalescing so the next mutate starts a new undo step (call at gesture end). */
export function sealHistory() { lastKey = null; }

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(snap()); S.doc = JSON.parse(undoStack.pop()); lastKey = null;
  fixSelection(); emit({ what: 'compose', structural: true }); return true;
}
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(snap()); S.doc = JSON.parse(redoStack.pop()); lastKey = null;
  fixSelection(); emit({ what: 'compose', structural: true }); return true;
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

/** Replace the whole document (preset / open). Undoable unless opts.history === false. */
export function setDoc(doc, opts = {}) {
  if (opts.history !== false && S.doc) { undoStack.push(snap()); redoStack.length = 0; }
  S.doc = doc; lastKey = null;
  fixSelection();
  emit({ what: 'compose', structural: true, fit: opts.fit !== false });
}

function fixSelection() {
  const d = S.doc;
  if (S.sel && !d.layers.some((l) => l.id === S.sel)) S.sel = null;
  if (!S.activeYarn || !d.yarns.some((y) => y.id === S.activeYarn)) S.activeYarn = (d.yarns[3] || d.yarns[d.yarns.length - 1] || {}).id || null;
}

export function select(id) { S.sel = id; emit({ what: 'none', selection: true }); }
export function setTool(t) { S.tool = t; emit({ what: 'none', tool: true }); }
export function setActiveYarn(id) { S.activeYarn = id; emit({ what: 'none', yarn: true }); }

export const layerById = (id) => S.doc.layers.find((l) => l.id === id);
export const yarnById = (id) => S.doc.yarns.find((y) => y.id === id);
export const selLayer = () => (S.sel ? layerById(S.sel) : null);

export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(ev) { for (const fn of listeners) fn(ev); if (ev.what !== 'none') scheduleAutosave(); }

/* ---------------- autosave ---------------- */
let saveT = 0;
function scheduleAutosave() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(AUTOSAVE_KEY, serialize(S.doc)); } catch { /* storage unavailable or full */ } }, 600);
}
export function loadInitialDoc() {
  try {
    const s = localStorage.getItem(AUTOSAVE_KEY);
    if (s) return { doc: deserialize(s), restored: true };
  } catch { /* ignore */ }
  return { doc: createDoc('john'), restored: false };
}
export function init(doc) { S.doc = doc; fixSelection(); }
