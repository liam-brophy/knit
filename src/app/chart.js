// Knitting chart drawing: the on-stage Chart view (same view transform as the fabric) and the Chart PNG export.
// Knitting convention: stitches numbered from the RIGHT, rows from the BOTTOM; heavier line every 10.
import { panels } from './modules.js';

export function chartImage(chart) {
  const c = document.createElement('canvas'); c.width = chart.cols; c.height = chart.rows;
  const x = c.getContext('2d'), d = x.createImageData(chart.cols, chart.rows), N = chart.cols * chart.rows;
  const pal = chart.palette.map((p) => p.rgb.map((v) => Math.round(v * 255)));
  for (let i = 0; i < N; i++) { const p = pal[chart.yarnIndex[i]] || [0, 0, 0], o = i * 4; d.data[o] = p[0]; d.data[o + 1] = p[1]; d.data[o + 2] = p[2]; d.data[o + 3] = 255; }
  x.putImageData(d, 0, 0);
  return c;
}

const NICE = [1, 2, 5, 10, 20, 50, 100];
const pickStep = (px, min) => NICE.find((n) => n * px >= min) || 100;

/**
 * Draw the chart view. xf: { W, H, dpr, scale (css px / stitch), aspect, cx, cy } ; colours from CSS.
 */
export function drawChartView(ctx, chart, img, xf, theme) {
  const { W, H, dpr, scale, aspect, cx, cy } = xf, sy = scale * aspect;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = theme.stage; ctx.fillRect(0, 0, W, H);
  if (!chart || !img) return;
  const ox = W / 2 - cx * scale, oy = H / 2 - cy * sy; // screen pos of cell (0,0) top-left
  const { cols, rows } = chart;
  // visible cell range
  const c0 = Math.max(0, Math.floor(-ox / scale)), c1 = Math.min(cols, Math.ceil((W - ox) / scale));
  const r0 = Math.max(0, Math.floor(-oy / sy)), r1 = Math.min(rows, Math.ceil((H - oy) / sy));
  if (c1 <= c0 || r1 <= r0) return;
  // drop shadow under the sheet
  ctx.strokeStyle = '#141414'; ctx.lineWidth = 1; ctx.strokeRect(ox - 0.5, oy - 0.5, cols * scale + 1, rows * sy + 1);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, c0, r0, c1 - c0, r1 - r0, ox + c0 * scale, oy + r0 * sy, (c1 - c0) * scale, (r1 - r0) * sy);
  // grid
  const snapX = (x) => Math.round(x * dpr) / dpr + 0.5 / dpr;
  if (scale >= 4) {
    const a = Math.min(0.32, (scale - 4) / 14 * 0.32 + 0.06);
    ctx.lineWidth = 1 / dpr; ctx.strokeStyle = `rgba(0,0,0,${a})`; ctx.beginPath();
    for (let c = c0; c <= c1; c++) if ((cols - c) % 10) { const x = snapX(ox + c * scale); ctx.moveTo(x, oy + r0 * sy); ctx.lineTo(x, oy + r1 * sy); }
    for (let r = r0; r <= r1; r++) if ((rows - r) % 10) { const y = snapX(oy + r * sy); ctx.moveTo(ox + c0 * scale, y); ctx.lineTo(ox + c1 * scale, y); }
    ctx.stroke();
  }
  if (scale >= 1.2) {
    ctx.lineWidth = Math.max(1, Math.min(2, scale / 8)); ctx.strokeStyle = `rgba(0,0,0,${scale >= 4 ? 0.7 : 0.35})`; ctx.beginPath();
    for (let c = c0; c <= c1; c++) if ((cols - c) % 10 === 0) { const x = ox + c * scale; ctx.moveTo(x, oy + r0 * sy); ctx.lineTo(x, oy + r1 * sy); }
    for (let r = r0; r <= r1; r++) if ((rows - r) % 10 === 0) { const y = oy + r * sy; ctx.moveTo(ox + c0 * scale, y); ctx.lineTo(ox + c1 * scale, y); }
    ctx.stroke();
  }
  // numbers: rows on the right, stitches along the bottom (clamped to the viewport)
  const gutR = 34, gutB = 18;
  const rx = Math.min(W - gutR, ox + cols * scale + 4), by = Math.min(H - gutB, oy + rows * sy + 3);
  ctx.font = `500 10px ${theme.mono}`; ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.plate;
  ctx.fillRect(rx - 2, Math.max(0, oy + r0 * sy), gutR, Math.min(H, (r1 - r0) * sy));
  ctx.fillRect(Math.max(0, ox + c0 * scale), by - 1, Math.min(W, (c1 - c0) * scale), gutB);
  ctx.fillStyle = theme.ink; ctx.textAlign = 'left';
  const rs = pickStep(sy, 13);
  for (let r = r0; r < r1; r++) { const n = rows - r; if (n % rs === 0 || n === 1) ctx.fillText(String(n), rx + 2, oy + (r + 0.5) * sy); }
  ctx.textAlign = 'center';
  const cs = pickStep(scale, n10w(ctx));
  for (let c = c0; c < c1; c++) { const n = cols - c; if (n % cs === 0 || n === 1) ctx.fillText(String(n), ox + (c + 0.5) * scale, by + gutB / 2); }
}
const n10w = (ctx) => ctx.measureText('000').width + 6;

/** Export the full knitting chart as a PNG Blob. */
export function chartPNG(doc, chart, title) {
  const { cols, rows, cellW, cellH } = chart, aspect = cellH / cellW;
  const cw = Math.max(5, Math.min(16, Math.floor(6400 / cols))), ch = cw * aspect;
  const mL = 28, mR = 52, mT = 70, mB = 40;
  const counts = new Array(chart.palette.length).fill(0);
  for (let i = 0; i < chart.yarnIndex.length; i++) counts[chart.yarnIndex[i]]++;
  const used = chart.palette.map((p, i) => ({ ...p, i, n: counts[i] })).filter((p) => p.n);
  const legendCols = Math.max(1, Math.floor((cols * cw + mL + mR - 40) / 230));
  const legendH = 24 + Math.ceil(used.length / legendCols) * 24;
  const W = Math.ceil(mL + cols * cw + mR), H = Math.ceil(mT + rows * ch + mB + legendH);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#141414'; x.font = '500 22px "Fraunces", Georgia, serif'; x.textBaseline = 'alphabetic';
  x.fillText(title || doc.name || 'Chart', mL, 32);
  x.font = '400 12px "Figtree", sans-serif'; x.fillStyle = '#6c6c68';
  const g = doc.knit.gauge;
  x.fillText(`${cols} sts × ${rows} rows · ${doc.knit.stsPerInch} sts/in printed · gauge ${g.sts} sts × ${g.rows} rows / 4 in · knits to ${(cols / (g.sts / 4)).toFixed(1)} × ${(rows / (g.rows / 4)).toFixed(1)} in · read from bottom right`, mL, 52);
  // cells
  x.imageSmoothingEnabled = false;
  x.drawImage(chartImage(chart), mL, mT, cols * cw, rows * ch);
  // grid
  x.lineWidth = 1; x.strokeStyle = 'rgba(0,0,0,.22)'; x.beginPath();
  for (let c = 0; c <= cols; c++) { const X = Math.round(mL + c * cw) + 0.5; x.moveTo(X, mT); x.lineTo(X, mT + rows * ch); }
  for (let r = 0; r <= rows; r++) { const Y = Math.round(mT + r * ch) + 0.5; x.moveTo(mL, Y); x.lineTo(mL + cols * cw, Y); }
  x.stroke();
  x.lineWidth = 2; x.strokeStyle = 'rgba(0,0,0,.75)'; x.beginPath();
  for (let c = 0; c <= cols; c++) if ((cols - c) % 10 === 0 || c === 0) { const X = Math.round(mL + c * cw); x.moveTo(X, mT); x.lineTo(X, mT + rows * ch); }
  for (let r = 0; r <= rows; r++) if ((rows - r) % 10 === 0 || r === 0) { const Y = Math.round(mT + r * ch); x.moveTo(mL, Y); x.lineTo(mL + cols * cw, Y); }
  x.stroke();
  // panel boundaries: trim (red dashed), folds (cyan)
  const P = panels(doc), toX = (inch) => mL + (inch / cellW) * cw, toY = (inch) => mT + (inch / cellH) * ch;
  x.save(); x.lineWidth = 2; x.setLineDash([8, 5]); x.strokeStyle = '#d0342c';
  x.strokeRect(toX(P.trim.x), toY(P.trim.y), toX(P.trim.x + P.trim.w) - toX(P.trim.x), toY(P.trim.y + P.trim.h) - toY(P.trim.y));
  x.setLineDash([]); x.strokeStyle = '#0a9fb5';
  for (const f of P.folds || []) { x.beginPath(); x.moveTo(toX(f), mT - 8); x.lineTo(toX(f), mT + rows * ch + 8); x.stroke(); }
  x.restore();
  // numbers
  x.fillStyle = '#141414'; x.font = '500 10px "Figtree", sans-serif'; x.textBaseline = 'middle';
  const rs = pickStep(ch, 12), cs = pickStep(cw, 22);
  x.textAlign = 'left';
  for (let r = 0; r < rows; r++) { const n = rows - r; if (n % rs === 0 || n === 1) x.fillText(String(n), mL + cols * cw + 6, mT + (r + 0.5) * ch); }
  x.textAlign = 'center';
  for (let c = 0; c < cols; c++) { const n = cols - c; if (n % cs === 0 || n === 1) x.fillText(String(n), mL + (c + 0.5) * cw, mT + rows * ch + 12); }
  x.textAlign = 'right'; x.fillStyle = '#6c6c68';
  x.fillText('row', W - 6, mT - 10); x.textAlign = 'left'; x.fillText('stitch →', mL, mT + rows * ch + 28);
  // legend
  let ly = mT + rows * ch + mB + 8;
  x.font = '600 11px "Figtree", sans-serif'; x.fillStyle = '#6c6c68'; x.textBaseline = 'alphabetic';
  x.fillText('YARNS', mL, ly); ly += 10;
  x.font = '400 12px "IBM Plex Sans", sans-serif';
  used.forEach((p, k) => {
    const col = k % legendCols, row = Math.floor(k / legendCols), X = mL + col * 230, Y = ly + row * 24;
    x.fillStyle = p.hex; x.fillRect(X, Y, 16, 16); x.strokeStyle = 'rgba(0,0,0,.3)'; x.lineWidth = 1; x.strokeRect(X + 0.5, Y + 0.5, 15, 15);
    x.fillStyle = '#141414'; x.textBaseline = 'middle';
    x.fillText(`${p.name || 'Yarn'}  ${p.hex.toUpperCase()}  · ${p.n.toLocaleString()} sts`, X + 24, Y + 8);
  });
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}
