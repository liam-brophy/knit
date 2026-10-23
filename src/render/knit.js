// Knit — photographic stockinette renderer (raw WebGL2).
// See ARCHITECTURE.md "Knit renderer". Shading is fully analytic per pixel in chart space
// (3D plied-leg stitch model, height-as-depth interlock resolved by max over neighbouring legs,
// AO + soft shadows from the analytic height field), so export tiles are seam-free by construction.
import { VS, FS_KNIT, FS_DOWN } from './shaders.js';
import { buildStitchParams } from './params.js';

const DEFAULTS = {
  light: { azimuth: 135, elevation: 50 }, irregularity: 0.5, halo: 0.3, plies: 3, twist: 0.6,
  contrast: 1.0, background: '#1a1a1a', seed: 7,
};

export function srgbToLinear(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
export function hexToRgb(hex) {
  let h = String(hex || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Light direction (y up, z toward viewer). azimuth: degrees CCW from +x (135 = top-left). */
export function lightVector(az, el) {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
}

/** Pixels-per-stitch → { lod, ss, qual } (exported for tests). */
export function lodFor(pxPerStitch) {
  const lod = pxPerStitch >= 4.5 ? 0 : pxPerStitch <= 2.8 ? 1 : (4.5 - pxPerStitch) / 1.7;
  const ss = pxPerStitch < 14 ? 4 : 1;
  const qual = pxPerStitch < 14 ? 0 : pxPerStitch < 20 ? 1 : 2;
  return { lod, ss, qual };
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('knit shader: ' + log);
  }
  return s;
}
function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('knit link: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export function createKnitRenderer(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false,
    preserveDrawingBuffer: true, powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not available');
  const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  // GL resources live in `res`; they are re-created after a context loss (webglcontextrestored).
  let knit, down, vao, vbo, yarnTex, colTex, paramTex;
  function initGL() {
    knit = program(gl, FS_KNIT);
    down = program(gl, FS_DOWN);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    yarnTex = gl.createTexture();
    colTex = gl.createTexture();
    paramTex = gl.createTexture();
    gl.getExtension('EXT_color_buffer_float');
  }
  initGL();
  let contextLost = false;
  const onLost = (e) => { e.preventDefault(); contextLost = true; };
  const onRestored = () => {
    contextLost = false;
    initGL();
    paramKey = '';
    if (chart) setChart(chart, settings);
    render();
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  let paramKey = '';

  let chart = null;
  let settings = { ...DEFAULTS };
  let palLin = new Float32Array(64), pal2 = new Float32Array(64);
  const view = { scale: 24, cx: 0, cy: 0 };
  let cssW = canvas.clientWidth || canvas.width, cssH = canvas.clientHeight || canvas.height, dpr = 1;
  let disposed = false;
  let lastStats = { ms: 0, passes: 0 };

  function aspect() { return chart ? chart.cellH / chart.cellW : 0.71; }

  function setChart(ch, rs = {}) {
    chart = ch;
    settings = { ...DEFAULTS, ...rs, light: { ...DEFAULTS.light, ...(rs.light || {}) } };
    if (contextLost || gl.isContextLost()) { paramKey = ''; return; }   // re-uploaded on restore
    const { cols, rows } = ch;
    if (cols * 3 > maxTex || rows > maxTex) throw new Error(`chart ${cols}x${rows} exceeds GPU texture limit ${maxTex}`);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, yarnTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, cols, rows, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, ch.yarnIndex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // per-stitch irregularity: only rebuilt when dims / seed / irregularity change (not on every paint)
    const pKey = `${cols}x${rows}:${settings.seed ?? 7}:${settings.irregularity ?? 0.5}`;
    if (pKey !== paramKey) {
      const prm = buildStitchParams(ch, { seed: settings.seed ?? 7, irregularity: settings.irregularity ?? 0.5 });
      gl.bindTexture(gl.TEXTURE_2D, paramTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, cols * 3, rows, 0, gl.RGBA, gl.FLOAT, prm);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      paramKey = pKey;
    }

    palLin = new Float32Array(64); pal2 = new Float32Array(64);
    const pal = ch.palette || [];
    const p8 = [];
    for (let i = 0; i < 16; i++) {
      const y = pal[i] || pal[0] || { rgb: [0.5, 0.5, 0.5] };
      const rgb = y.rgb || hexToRgb(y.hex);
      palLin[i * 4] = srgbToLinear(rgb[0]);
      palLin[i * 4 + 1] = srgbToLinear(rgb[1]);
      palLin[i * 4 + 2] = srgbToLinear(rgb[2]);
      palLin[i * 4 + 3] = y.heather ?? 0.3;
      pal2[i * 4] = y.fuzz ?? 0.3;
      p8.push(rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)));
    }
    // cell colour texture (sRGB, mipmapped) for the far-field LOD
    const n = cols * rows, buf = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const c = p8[Math.min(15, ch.yarnIndex[i])];
      buf[i * 4] = c[0]; buf[i * 4 + 1] = c[1]; buf[i * 4 + 2] = c[2]; buf[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, colTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Addition: update doc.render-style settings without re-uploading the chart. */
  function setRenderSettings(rs = {}) {
    const prevKey = `${settings.seed}:${settings.irregularity}`;
    settings = { ...settings, ...rs, light: { ...settings.light, ...(rs.light || {}) } };
    if (chart && `${settings.seed}:${settings.irregularity}` !== prevKey) setChart(chart, settings);
  }

  function setView(v = {}) {
    if (v.scale != null) view.scale = Math.max(0.25, v.scale);
    if (v.cx != null) view.cx = v.cx;
    if (v.cy != null) view.cy = v.cy;
  }

  function resize(w, h, d = 1) {
    cssW = w; cssH = h; dpr = d || 1;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    if (canvas.style) { canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; }
  }

  // Draw the knit pass for a target of W×H px whose top-left pixel corner is chart point (ox, oy),
  // at sx px per column, sy px per row.
  function drawKnit(W, H, ox, oy, sx, sy, mode, pixOff = [0, 0]) {
    const { u } = knit;
    gl.useProgram(knit.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, yarnTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, colTex);
    gl.uniform1i(u.uYarn, 0);
    gl.uniform1i(u.uCellCol, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, paramTex);
    gl.uniform1i(u.uParams, 2);
    gl.uniform4fv(u.uPal, palLin);
    gl.uniform4fv(u.uPal2, pal2);
    gl.uniform2i(u.uDims, chart.cols, chart.rows);
    gl.uniform1f(u.uAspect, aspect());
    gl.uniform2f(u.uOrigin, ox, oy);
    gl.uniform2f(u.uScale, sx, sy);
    gl.uniform2f(u.uTarget, W, H);
    if (u.uPixOff) gl.uniform2f(u.uPixOff, pixOff[0], pixOff[1]);
    const L = settings.light;
    gl.uniform3fv(u.uLight, lightVector(L.azimuth ?? 135, Math.max(5, Math.min(89, L.elevation ?? 50))));
    gl.uniform1f(u.uIrr, settings.irregularity ?? 0.5);
    gl.uniform1f(u.uHalo, settings.halo ?? 0.3);
    gl.uniform1f(u.uPlies, Math.max(1, Math.min(4, Math.round(settings.plies ?? 3))));
    gl.uniform1f(u.uTwist, settings.twist ?? 0.6);
    gl.uniform1f(u.uContrast, settings.contrast ?? 1);
    gl.uniform3fv(u.uBg, hexToRgb(settings.background).map(srgbToLinear));
    gl.uniform1ui(u.uSeed, (settings.seed ?? 7) >>> 0);
    gl.uniform1i(u.uMode, mode);
    const { lod, ss, qual } = lodFor(sx);
    gl.uniform1i(u.uSS, ss);
    gl.uniform1i(u.uQual, qual);
    gl.uniform1f(u.uLod, lod);
    gl.viewport(0, 0, W, H);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function viewOrigin() {
    const W = canvas.width, H = canvas.height, s = view.scale, a = aspect();
    return { ox: view.cx - W / 2 / s, oy: view.cy - H / 2 / (s * a), sx: s, sy: s * a };
  }

  function render() {
    if (disposed || contextLost || gl.isContextLost()) return;
    const t0 = performance.now();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!chart) {
      const bg = hexToRgb(settings.background);
      gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const { ox, oy, sx, sy } = viewOrigin();
    drawKnit(canvas.width, canvas.height, ox, oy, sx, sy, 0);
    lastStats = { ms: performance.now() - t0, passes: 1, drawCalls: 1 };
  }

  function rect() {
    return canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: cssW, height: cssH };
  }
  function clientToCell(clientX, clientY) {
    const b = rect();
    const kx = canvas.width / (b.width || 1), ky = canvas.height / (b.height || 1);
    const { ox, oy, sx, sy } = viewOrigin();
    return { x: ox + ((clientX - b.left) * kx) / sx, y: oy + ((clientY - b.top) * ky) / sy };
  }
  function pickCell(clientX, clientY) {
    if (!chart) return null;
    const p = clientToCell(clientX, clientY);
    const c = Math.floor(p.x), r = Math.floor(p.y);
    if (c < 0 || r < 0 || c >= chart.cols || r >= chart.rows) return null;
    return { c, r };
  }
  /** Client coords of chart point (c, r) — cell corners at integers (cell i spans [i, i+1]). */
  function cellToClient(c, r) {
    const b = rect();
    const kx = canvas.width / (b.width || 1), ky = canvas.height / (b.height || 1);
    const { ox, oy, sx, sy } = viewOrigin();
    return { x: b.left + ((c - ox) * sx) / kx, y: b.top + ((r - oy) * sy) / ky };
  }

  async function renderRegion({ x0 = 0, y0 = 0, x1, y1, widthPx, heightPx, supersample = 2, grain = 0.006, tileSize = 1024,
    format = 'png', quality = 0.92, onProgress } = {}) {
    if (!chart) throw new Error('renderRegion: no chart');
    if (contextLost || gl.isContextLost()) throw new Error('renderRegion: WebGL context lost');
    const mime = format === 'jpeg' || format === 'jpg' ? 'image/jpeg' : 'image/png';
    x1 = x1 ?? chart.cols; y1 = y1 ?? chart.rows;
    widthPx = Math.max(1, Math.round(widthPx));
    heightPx = Math.max(1, Math.round(heightPx ?? (widthPx * (y1 - y0) * aspect()) / (x1 - x0)));
    const sx = widthPx / (x1 - x0), sy = heightPx / (y1 - y0);
    const ss = supersample === 1 ? 1 : 2;
    const T = Math.max(16, Math.min(tileSize | 0, Math.floor(Math.min(maxTex, 2048) / ss)));   // output tile (≤ 2048 internal)

    // targets
    const hiTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, hiTex);
    const hiFmt = hasFloat ? gl.RGBA16F : gl.RGBA8;
    gl.texStorage2D(gl.TEXTURE_2D, 1, hiFmt, T * ss, T * ss);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const hiFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, hiFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hiTex, 0);
    const loTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, loTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, T, T);
    const loFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, loFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, loTex, 0);

    const out = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(widthPx, heightPx) : Object.assign(document.createElement('canvas'), { width: widthPx, height: heightPx });
    const ctx = out.getContext('2d');
    const px = new Uint8Array(T * T * 4);
    const nx = Math.ceil(widthPx / T), ny = Math.ceil(heightPx / T);
    let done = 0;
    try {
      for (let ty = 0; ty < ny; ty++) {
        for (let tx = 0; tx < nx; tx++) {
          const X = tx * T, Y = ty * T;
          const w = Math.min(T, widthPx - X), h = Math.min(T, heightPx - Y);
          // hi-res pass: tile of w*ss × h*ss, top-left at chart point of output pixel (X, Y)
          gl.bindFramebuffer(gl.FRAMEBUFFER, ss === 1 ? loFb : hiFb);
          const mode = ss === 1 ? 0 : 1;
          drawKnit(w * ss, h * ss, x0, y0, sx * ss, sy * ss, mode, [X * ss, Y * ss]);
          if (ss !== 1) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, loFb);
            gl.useProgram(down.p);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hiTex);
            gl.uniform1i(down.u.uSrc, 0);
            gl.uniform2f(down.u.uPixOff, X, Y);
            gl.uniform2f(down.u.uTarget, w, h);
            gl.uniform1f(down.u.uGrain, grain);
            gl.viewport(0, 0, w, h);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          }
          if (gl.isContextLost()) throw new Error('renderRegion: WebGL context lost during export');
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          // flip rows (GL is bottom-up)
          const img = ctx.createImageData(w, h);
          for (let r = 0; r < h; r++) img.data.set(px.subarray((h - 1 - r) * w * 4, (h - r) * w * 4), r * w * 4);
          ctx.putImageData(img, X, Y);
          done++;
          if (onProgress) onProgress(done / (nx * ny));
          await new Promise((res) => setTimeout(res, 0));
        }
      }
    } finally {
      if (!gl.isContextLost()) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(hiFb); gl.deleteFramebuffer(loFb);
      gl.deleteTexture(hiTex); gl.deleteTexture(loTex);
    }
    if (out.convertToBlob) return out.convertToBlob(mime === 'image/jpeg' ? { type: mime, quality } : { type: mime });
    return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), mime, quality));
  }

  function dispose() {
    disposed = true;
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    gl.deleteTexture(yarnTex); gl.deleteTexture(colTex); gl.deleteTexture(paramTex);
    gl.deleteBuffer(vbo); gl.deleteVertexArray(vao);
    gl.deleteProgram(knit.p); gl.deleteProgram(down.p);
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  }

  return {
    setChart, setView, resize, render, pickCell, cellToClient, renderRegion, dispose,
    setRenderSettings,
    get contextLost() { return contextLost; },
    // additions
    getView: () => ({ ...view }),
    clientToCell,
    get stats() { return lastStats; },
    gl,
  };
}
