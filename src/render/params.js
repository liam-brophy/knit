// Per-stitch irregularity, computed once per setChart on the CPU and uploaded as an RGBA32F
// texture (3 texels per cell). Deterministic from (seed, c, r) — independent of view/tiling.
//   A = (dx [cols], dy [rows], widthScale, tiltL)   B = (tiltR, radiusScale, lengthScale, heightJitter)
//   C = (tone, plyPhase, 0, 0)   (yarn index lives in its own R8UI texture)

function mix32(x) {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
export function hash3(a, b, c) {
  return mix32(Math.imul(a | 0, 0x9e3779b1) ^ mix32(Math.imul(b | 0, 0x85ebca6b) ^ mix32((c | 0) + 0x632be5ab)));
}
const U = (h) => (h >>> 8) / 16777216;

function valueNoise(seed, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const h = (i, j) => U(hash3(ix + i, iy + j, seed));
  return (h(0, 0) * (1 - ux) + h(1, 0) * ux) * (1 - uy) + (h(0, 1) * (1 - ux) + h(1, 1) * ux) * uy;
}

/** @returns Float32Array(cols*3*rows*4) laid out as a (cols*3) × rows RGBA texture. */
export function buildStitchParams(chart, { seed = 7, irregularity = 0.5 } = {}) {
  const { cols, rows } = chart;
  const k = irregularity;
  const out = new Float32Array(cols * 3 * rows * 4);
  const S = seed | 0;
  const row = new Float32Array(rows * 4);
  for (let r = 0; r < rows; r++) {
    for (let j = 0; j < 4; j++) row[r * 4 + j] = U(hash3(r, j, S ^ 0x51)) - 0.5;
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = (j) => U(hash3(c, r, S * 131 + j)) - 0.5;
      // slow drift (fabric not perfectly flat/regular) + per-row tension + per-stitch noise
      const driftX = valueNoise(S + 1, c * 0.09, r * 0.06) - 0.5;
      const driftY = valueNoise(S + 2, c * 0.06, r * 0.11) - 0.5;
      const dye = valueNoise(S + 3, c * 0.035, r * 0.05) - 0.5;
      const dx = (driftX * 0.10 + row[r * 4] * 0.05 + h(0) * 0.06) * k;
      const dy = (driftY * 0.10 + row[r * 4 + 1] * 0.08 + h(1) * 0.06) * k;
      const wS = 1 + (h(2) * 0.08 + row[r * 4 + 2] * 0.06) * k;
      const tiltL = h(3) * 0.10 * k, tiltR = h(4) * 0.10 * k;
      const rad = 1 + (h(5) * 0.16 + row[r * 4 + 3] * 0.10) * k;
      const len = 1 + h(6) * 0.18 * k;
      const hJ = h(7) * 0.16 * k;
      const tone = (h(8) * 0.12 + dye * 0.12) * k;
      const ph = U(hash3(c, r, S * 977 + 9)) * 37;
      const o = (r * cols * 3 + c * 3) * 4;
      out[o] = dx; out[o + 1] = dy; out[o + 2] = wS; out[o + 3] = tiltL;
      out[o + 4] = tiltR; out[o + 5] = rad; out[o + 6] = len; out[o + 7] = hJ;
      out[o + 8] = tone; out[o + 9] = ph; out[o + 10] = 0; out[o + 11] = 0;
    }
  }
  return out;
}
