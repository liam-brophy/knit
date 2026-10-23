// Small DOM helpers + precise numeric fields (units, arrow-key nudging, scrub-to-change, unit conversion).

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
export const svg = (inner, cls) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); if (cls) s.setAttribute('class', cls); s.innerHTML = inner; return s; };
export const ICON = {
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  fill: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 14l6-6 10 10"/>',
  paint: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>',
  grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  brush: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>',
  alignL: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>', alignC: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>', alignR: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const UNIT_TO_IN = { in: 1, '"': 1, mm: 1 / 25.4, cm: 1 / 2.54, pt: 1 / 72, pc: 1 / 6, px: 1 / 96 };

/** Evaluate "6.125", "152mm", "1/8", "6+0.25", "2*3" safely (numbers + - * / ( ) only, plus a unit suffix). */
export function parseNumber(str, unit) {
  let s = String(str).trim().toLowerCase().replace(/,/g, '.').replace(/×/g, '*');
  let factor = 1;
  if (unit === 'in') {
    const m = s.match(/(mm|cm|pt|pc|px|in|")\s*$/);
    if (m) { factor = UNIT_TO_IN[m[1]]; s = s.slice(0, m.index); }
  } else s = s.replace(/[a-z%°"]+\s*$/, '');
  if (!/^[\d.\s+\-*/()]+$/.test(s)) return NaN;
  const v = evalExpr(s.replace(/\s+/g, ''));
  return isFinite(v) ? v * factor : NaN;
}
function evalExpr(s) {
  let i = 0;
  const num = () => { const m = /^\d*\.?\d+|^\d+\.?/.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); };
  const atom = () => { if (s[i] === '-') { i++; return -atom(); } if (s[i] === '+') { i++; return atom(); } if (s[i] === '(') { i++; const v = sum(); if (s[i++] !== ')') throw 0; return v; } return num(); };
  const prod = () => { let v = atom(); while (s[i] === '*' || s[i] === '/') { const op = s[i++]; const b = atom(); v = op === '*' ? v * b : v / b; } return v; };
  const sum = () => { let v = prod(); while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const b = prod(); v = op === '+' ? v + b : v - b; } return v; };
  try { const v = sum(); return i === s.length ? v : NaN; } catch { return NaN; }
}

/**
 * Numeric field. opts: { value, unit, prefix, step, min, max, dec, title, onInput(v, {final}) }
 * Returns element with .set(v) (skips while focused) and .get().
 */
export function numField(o) {
  const dec = o.dec ?? 3, step = o.step ?? 0.01;
  const inp = h('input', { type: 'text', inputmode: 'decimal', spellcheck: 'false', autocomplete: 'off', 'aria-label': o.label || o.title || o.prefix || '' });
  const pre = o.prefix ? h('span', { class: 'pre', title: 'Drag to scrub' }, o.prefix) : null;
  const wrap = h('div', { class: 'num', title: o.title || '' }, pre, inp, o.unit ? h('span', { class: 'unit' }, o.unit === 'in' ? 'in' : o.unit) : null);
  let value = o.value;
  const fmt = (v) => (v == null || !isFinite(v) ? '' : (+v.toFixed(dec)).toString());
  const show = () => { inp.value = fmt(value); };
  const commit = (v, final) => {
    if (!isFinite(v)) { wrap.classList.add('bad'); return; }
    wrap.classList.remove('bad');
    v = clamp(v, o.min ?? -Infinity, o.max ?? Infinity);
    if (o.int) v = Math.round(v);
    value = v; o.onInput && o.onInput(v, { final });
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commit(parseNumber(inp.value, o.unit), true); show(); inp.select(); e.preventDefault(); }
    else if (e.key === 'Escape') { show(); inp.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
      const cur = parseNumber(inp.value, o.unit); commit((isFinite(cur) ? cur : value) + k, true); show();
    }
  });
  inp.addEventListener('blur', () => { const v = parseNumber(inp.value, o.unit); if (isFinite(v) && Math.abs(v - value) > 1e-9) commit(v, true); wrap.classList.remove('bad'); show(); });
  inp.addEventListener('focus', () => setTimeout(() => inp.select(), 0));
  const scrub = (el) => {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      const x0 = e.clientX, v0 = value; let moved = false;
      const mv = (ev) => { const dx = ev.clientX - x0; if (Math.abs(dx) > 2) moved = true; if (moved) { commit(v0 + Math.round(dx / 3) * step * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1), false); show(); } };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); if (moved) commit(value, true); else inp.focus(); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
  };
  scrub(pre); wrap._scrub = scrub;
  wrap.set = (v) => { value = v; if (document.activeElement !== inp) show(); };
  wrap.get = () => value;
  wrap.input = inp;
  show();
  return wrap;
}

/** Labelled row: label (scrubs the field if it is a numField) + control. */
export function row(label, ctl, title) {
  const lab = h('label', { title: title || '' }, label);
  if (ctl && ctl._scrub) { lab.classList.add('scrub'); ctl._scrub(lab); }
  else if (ctl && ctl.id) lab.htmlFor = ctl.id;
  return h('div', { class: 'fr' }, lab, ctl);
}

/** Range slider + numeric field. */
export function slider(o) {
  const r = h('input', { type: 'range', min: o.min, max: o.max, step: o.step, 'aria-label': o.label || '' });
  const n = numField({ ...o, onInput: (v, m) => { r.value = v; o.onInput(v, m); } });
  r.value = o.value;
  r.addEventListener('input', () => { n.set(+r.value); o.onInput(+r.value, { final: false }); });
  r.addEventListener('change', () => o.onInput(+r.value, { final: true }));
  const el = h('div', { class: 'rng' }, r, n);
  el.set = (v) => { if (document.activeElement !== r) r.value = v; n.set(v); };
  el._scrub = n._scrub;
  return el;
}

/** Segmented control. items: [{value, label, title, icon}] */
export function seg(items, value, onChange, cls = 'sm') {
  const el = h('div', { class: 'seg ' + cls, role: 'group' });
  const btns = items.map((it) => {
    const b = h('button', { type: 'button', title: it.title || '', 'aria-pressed': String(it.value === value), 'aria-label': it.aria || it.title || it.label });
    if (it.icon) b.append(svg(it.icon)); if (it.label) b.append(it.label);
    b.addEventListener('click', () => { el.set(it.value); onChange(it.value); });
    el.append(b); return b;
  });
  el.set = (v) => btns.forEach((b, i) => b.setAttribute('aria-pressed', String(items[i].value === v)));
  return el;
}

export function select(options, value, onChange, attrs = {}) {
  const el = h('select', attrs, options.map((o) => h('option', { value: o.value }, o.label)));
  el.value = value; el.addEventListener('change', () => onChange(el.value));
  el.set = (v) => { if (document.activeElement !== el) el.value = v; };
  return el;
}

let toastT = 0;
export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}
export const fmtIn = (v, d = 3) => (+(+v).toFixed(d)).toString();
