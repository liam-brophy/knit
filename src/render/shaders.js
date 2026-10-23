// GLSL for the knit renderer. Everything is evaluated analytically per pixel in chart space,
// so any tile of any export is bit-identical to the same pixels in a single big render
// (no screen-space dependency → no tile seams, no overlap needed beyond the 2× box filter).
//
// Coordinates: X = column units (1 = one stitch width), R = row units (row 0 at top).
// Physical space used for geometry: P = (X, R * aspect) in stitch widths, y DOWN.
// Stitch-local space: origin at the V's bottom point, y UP, mirrored per leg.

export const VS = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FS_KNIT = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D uYarn;     // R8UI cols x rows, yarn index per cell
uniform sampler2D uCellCol;   // SRGB8_ALPHA8 mipmapped cell colours (LOD / far field)
uniform vec4 uPal[16];        // linear rgb, heather
uniform vec4 uPal2[16];       // fuzz, 0, 0, 0
uniform ivec2 uDims;          // cols, rows
uniform float uAspect;        // row pitch / stitch width (cellH / cellW)
uniform vec2 uOrigin;         // (col,row) at target pixel (0,0) = top-left corner
uniform vec2 uScale;          // target px per column, px per row
uniform vec2 uTarget;         // target size px
uniform vec2 uPixOff;         // global pixel offset of this tile (grain anchoring)
uniform vec3 uLight;          // unit vector, y UP, z toward viewer
uniform float uIrr, uHalo, uPlies, uTwist, uContrast;
uniform vec3 uBg;             // linear background
uniform uint uSeed;
uniform int uMode;            // 0 screen sRGB, 1 linear (export, downsampled later)
uniform int uSS;              // samples per pixel (1 or 4)
uniform int uQual;            // 2 full, 1 reduced AO/shadow
uniform float uLod;           // 0 = full geometry, 1 = averaged colour only
out vec4 oCol;

const float PI = 3.14159265;

uint pcg(uint v){ uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
uint hc(int x, int y, uint z){ return pcg(uint(x) * 0x9E3779B1u ^ pcg(uint(y) * 0x85EBCA6Bu ^ pcg(z ^ uSeed))); }
vec4 rnd4(int x, int y, uint z){ uint a = hc(x, y, z); uint b = pcg(a); uint c = pcg(b); uint d = pcg(c);
  return vec4(float(a >> 8u), float(b >> 8u), float(c >> 8u), float(d >> 8u)) / 16777215.0; }
float hn(vec2 i){ return float(hc(int(i.x), int(i.y), 0x51u) >> 8u) / 16777215.0; }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hn(i), hn(i + vec2(1,0)), u.x), mix(hn(i + vec2(0,1)), hn(i + vec2(1,1)), u.x), u.y); }
float fbm2(vec2 p){ return 0.62 * vnoise(p) + 0.38 * vnoise(p * 2.13 + 17.1); }

int yarnAt(int c, int r){
  if (c < 0 || r < 0 || c >= uDims.x || r >= uDims.y) return -1;
  return min(int(texelFetch(uYarn, ivec2(c, r), 0).r), 15);
}

// Per-stitch parameters are precomputed on the CPU (params.js) into an RGBA32F texture
// 3 texels wide per cell: A = (dx, dy, wS, tiltL)  B = (tiltR, rad, len, hJ)  C = (tone, phase, -, -); yarn comes from uYarn
uniform highp sampler2D uParams;
struct St { vec2 O; float wS; float tiltL; float tiltR; float rad; float len; float hJ; float tone; float ph; int yarn; };
St stitchParams(int c, int r){
  St s;
  if (c < 0 || r < 0 || c >= uDims.x || r >= uDims.y){ s.yarn = -1; return s; }
  vec4 A = texelFetch(uParams, ivec2(c * 3, r), 0);
  vec4 B = texelFetch(uParams, ivec2(c * 3 + 1, r), 0);
  vec4 C = texelFetch(uParams, ivec2(c * 3 + 2, r), 0);
  s.O = vec2(float(c) + 0.5 + A.x, (float(r) + 1.0 + A.y) * uAspect);
  s.wS = A.z; s.tiltL = A.w; s.tiltR = B.x; s.rad = B.y; s.len = B.z; s.hJ = B.w;
  s.tone = C.x; s.ph = C.y; s.yarn = min(int(texelFetch(uYarn, ivec2(c, r), 0).r), 15);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Stitch model. Each V = two plump LOBES (right lobe below; left lobes are mirrored), in stitch-
// local space: y up, units = stitch widths, origin = cell bottom-centre. A lobe is a tapered
// capsule swept along a slightly bowed segment from the V point (narrow, high — it sits on top
// of the row below) up to a broad rounded upper end (lower — it tucks under the next row's V point).
const float Y0 = -0.20;   // V point centre, row pitches below the cell bottom
const float Y1 = 0.50;    // upper-end centre, row pitches above the cell bottom
const float X0 = 0.085;   // x of the V point centre
const float X1 = 0.325;   // x of the upper-end centre
const float BOW = 0.04;  // outward bow of the lobe
const float RT = 0.160;   // radius at the V point
const float RB = 0.272;   // radius at the broad upper end
const float ZD = 0.50;    // height drop from point to upper end

// hand-spun unevenness of the strand along the lobe (cheap, deterministic per stitch & leg)
float wobble(float t, float ph){ return 1.0 + 0.055 * sin(t * 11.0 + ph) + 0.035 * sin(t * 23.0 + 1.7 * ph); }
struct Lobe { float h; float t; vec2 dv; float rr; vec2 D; float len; float q2; };

Lobe lobe(vec2 L, St s, float tilt){
  Lobe o; o.h = -1e3;
  float a = uAspect;
  vec2 B = vec2(X0, Y0 * a);
  vec2 T = vec2(X1 + tilt, Y1 * a * s.len);
  vec2 D = T - B;
  float l2 = dot(D, D);
  float t = dot(L - B, D) / l2;
  float tc = clamp(t, 0.0, 1.0);
  vec2 Nn = vec2(D.y, -D.x) * inversesqrt(l2);
  vec2 C = B + D * tc + Nn * (BOW * sin(3.14159 * tc));
  float rr = mix(RT, RB, smoothstep(0.0, 0.92, tc)) * s.rad * wobble(tc, s.ph + tilt * 40.0);
  vec2 dv = L - C;
  float q2 = dot(dv, dv) / (rr * rr);
  if (q2 >= 1.0) return o;
  float z = 1.0 - ZD * smoothstep(0.05, 1.0, tc) + s.hJ;
  o.h = z + rr * sqrt(1.0 - q2);
  o.t = t; o.dv = dv; o.rr = rr; o.D = D * inversesqrt(l2); o.len = sqrt(l2); o.q2 = q2;
  return o;
}
float lobeH(vec2 L, St s, float tilt){
  // height-only fast path (same maths as lobe())
  float a = uAspect;
  vec2 B = vec2(X0, Y0 * a);
  vec2 D = vec2(X1 + tilt, Y1 * a * s.len) - B;
  float l2 = dot(D, D);
  float tc = clamp(dot(L - B, D) / l2, 0.0, 1.0);
  vec2 C = B + D * tc + vec2(D.y, -D.x) * inversesqrt(l2) * (BOW * sin(3.14159 * tc));
  float rr = mix(RT, RB, smoothstep(0.0, 0.92, tc)) * s.rad * wobble(tc, s.ph + tilt * 40.0);
  vec2 dv = L - C;
  float q2 = dot(dv, dv) / (rr * rr);
  if (q2 >= 1.0) return -1e3;
  return 1.0 - ZD * smoothstep(0.05, 1.0, tc) + s.hJ + rr * sqrt(1.0 - q2);
}

// Height field: max over the stitches that can reach P (2 columns × ≤ 3 rows), 2 lobes each.
float field(vec2 P, out ivec4 best){
  float fx = P.x - floor(P.x);
  int c0 = int(floor(P.x));
  float rowf = P.y / uAspect;
  int r0 = int(floor(rowf));
  float fy = rowf - float(r0);
  int cA = fx < 0.5 ? c0 - 1 : c0, cB = cA + 1;
  int rA = fy < 0.60 ? r0 - 1 : r0;     // V point of the row above reaches down into this row
  int rB = fy > 0.80 ? r0 + 1 : r0;     // upper ends of the row below reach up into this row
  float hb = -0.35;
  best = ivec4(c0, r0, 0, -1);
  for (int r = rA; r <= rB; r++){
    for (int c = cA; c <= cB; c++){
      St s = stitchParams(c, r);
      if (s.yarn < 0) continue;
      vec2 L = vec2((P.x - s.O.x) / s.wS, s.O.y - P.y);
      float hR = lobeH(L, s, s.tiltR);
      float hL = lobeH(vec2(-L.x, L.y), s, s.tiltL);
      if (hR > hb){ hb = hR; best = ivec4(c, r, 1, s.yarn); }
      if (hL > hb){ hb = hL; best = ivec4(c, r, -1, s.yarn); }
    }
  }
  return hb;
}
float fieldH(vec2 P){ ivec4 b; return field(P, b); }

vec3 palCol(int y){ return uPal[y].rgb; }

// shoulder tone map: identity below k, soft roll-off above → yarn hex stays the mid-tone
vec3 shoulder(vec3 c){
  const float k = 0.80;
  vec3 e = max(c - k, 0.0);
  return min(c, vec3(k)) + (1.0 - k) * (1.0 - exp(-e / (1.0 - k)));
}

vec3 cellColour(vec2 P){
  vec2 uv = vec2(P.x, P.y / uAspect) / vec2(uDims);
  float lod = log2(max(1.0 / uScale.x, 1e-4)) + 0.5;
  return textureLod(uCellCol, uv, max(lod, 0.0)).rgb;
}

vec3 shadeAt(vec2 P, float pxW){
  // pxW = stitch widths per pixel (footprint)
  ivec4 b;
  float h = field(P, b);
  int c = b.x, r = b.y; float side = float(b.z); int yi = b.w;

  int cu = int(floor(P.x)), ru = int(floor(P.y / uAspect));
  int yu = yarnAt(cu, ru);
  if (yu < 0 && yi < 0) return uBg;

  vec3 L3 = uLight;
  vec3 col;
  float fuzzAmt;

  if (yi < 0 || b.z == 0){
    // deep crevice: backing strands, nearly black, tinted by the yarn there
    int yy = yu >= 0 ? yu : yi;
    vec3 ba = palCol(max(yy, 0));
    fuzzAmt = uPal2[max(yy, 0)].x;
    col = ba * (0.06 + 0.10 * uHalo * fuzzAmt) * (0.5 + 1.0 * vnoise(P * vec2(46.0, 13.0)));
    // when crevices become sub-pixel, fuzz and neighbouring strands fill them (photographic averaging)
    col = mix(col, ba * 0.24, smoothstep(0.07, 0.20, 1.0 / uScale.x));
  } else {
    St s = stitchParams(c, r);
    vec2 Lc = vec2((P.x - s.O.x) / s.wS, s.O.y - P.y);
    Lc.x *= side;
    float tilt = side > 0.0 ? s.tiltR : s.tiltL;
    Lobe lb = lobe(Lc, s, tilt);
    float t = lb.t, rr = lb.rr;
    float tc = clamp(t, 0.0, 1.0);
    vec2 Dn = lb.D;                        // along the lobe (upward)
    vec2 N = vec2(Dn.y, -Dn.x);            // across (outward)
    float sq = sqrt(max(1.0 - lb.q2, 0.0));
    float sqc = max(sq, 0.08);
    float q = clamp(dot(lb.dv, N) / rr, -1.0, 1.0);

    // macro normal: swept sphere + falling height along the lobe
    vec2 grad = -lb.dv / (rr * sqc);
    float xs = clamp((tc - 0.05) / 0.95, 0.0, 1.0);
    grad += Dn * (-ZD * 6.0 * xs * (1.0 - xs) / 0.95 / lb.len) * step(0.0, t) * step(t, 1.0);

    // plies: helical sub-strands, twisted along the lobe
    float theta = asin(q);
    float sArc = t * lb.len;
    float nP = max(uPlies, 1.0);
    float across = nP * 0.62;
    float twistK = across / (PI * RB) * (0.30 + 1.6 * uTwist);
    float p = (theta / PI + 0.5) * across - sArc * twistK + s.ph + side * 0.37;
    vec2 gradp = (across / PI) / (rr * max(sqrt(max(1.0 - q * q, 0.0)), 0.15)) * N - twistK * Dn;
    float plyPeriodPx = 1.0 / (length(gradp) * pxW);
    float plyFade = smoothstep(1.6, 4.0, plyPeriodPx) * step(1.5, nP);
    float u = fract(p);
    float bulge = sin(PI * u);
    grad -= plyFade * 0.16 * PI * cos(PI * u) * gradp * rr;

    // fibres: streaks running along each ply (fibre direction ⟂ gradp) + crimp
    vec2 fd = normalize(vec2(-gradp.y, gradp.x));
    float fibAlong = dot(Lc, fd);
    // fibre octaves: each kept only while its stripes are ≥ ~1 px, renormalised over the active
    // octaves → crisp fibre texture at every print scale without sub-pixel shimmer
    float fN = 0.0, fW = 0.0, amp = 1.0, fq = 2.5;
    for (int k = 0; k < 4; k++){
      float per = plyPeriodPx / fq;
      float w = smoothstep(0.9, 2.0, per) * amp;
      if (w > 0.002) fN += w * (vnoise(vec2(p * fq + float(k) * 7.13, fibAlong * fq * 0.55 + s.ph * float(k + 1))) - 0.5);
      fW += w; amp *= 0.75; fq *= 2.1;
    }
    float fibFade = smoothstep(0.0, 0.5, fW);
    float fib = clamp(0.5 + 1.5 * fN / max(fW, 1e-3), 0.0, 1.0);
    fib = mix(0.5, fib, fibFade);
    float f2 = fib, f3 = 0.5;
    if (fibFade > 0.001) f3 = vnoise(vec2(p * 4.5 - 5.0, fibAlong * 1.1 + 3.0 * s.ph));
    float plyId = floor(p);
    float plyTone = float(hc(int(plyId), c * 7 + r * 131 + int(side), 9u) >> 8u) / 16777215.0;
    grad -= (fib - 0.5) * 0.35 * fibFade * normalize(gradp);
    vec3 n = normalize(vec3(-grad.x * side, -grad.y, 1.0));

    // albedo: yarn + heathered fibre streaks (dark and light) + ply tone + per-stitch tone
    vec3 baseAlb = palCol(yi);
    float heather = uPal[yi].a;
    fuzzAmt = uPal2[yi].x;
    float lum = dot(baseAlb, vec3(0.2126, 0.7152, 0.0722));
    // tonal streaks need ~2 px per ply to read; fade with a looser threshold than fibres
    float tonFade = smoothstep(1.0, 2.6, plyPeriodPx);
    float var = (fib - 0.5) * (0.40 + 1.2 * heather) * fibFade
              + (plyTone - 0.5) * (0.12 + 0.45 * heather) * tonFade + s.tone;
    // blotchy tonal patches along the strand (dye / fibre density), visible at print scale
    float blot = sin(sArc * 9.0 + s.ph * 3.1 + side) * 0.5 + sin(sArc * 17.0 - s.ph * 1.3 + q * 2.0) * 0.5;
    var += blot * (0.05 + 0.16 * heather);
    vec3 alb = baseAlb * (1.0 + var);
    if (fibFade <= 0.001 && tonFade > 0.001) f3 = vnoise(vec2(p * 4.5 - 5.0, fibAlong * 1.1 + 3.0 * s.ph));
    float dsel = smoothstep(0.56, 0.78, mix(0.5, f3, tonFade));
    alb *= 1.0 - (0.20 + 0.85 * heather) * 0.75 * dsel * tonFade;            // dark fibres along the twist
    float lsel = smoothstep(0.64, 0.86, f2) * fibFade;
    alb = mix(alb, mix(vec3(lum), baseAlb, 0.8) * (1.25 + 0.6 * (1.0 - lum)), heather * 0.6 * lsel); // light flecks
    alb = max(alb, 0.0);

    // ambient occlusion: analytic height field ring + depth + tube flanks + ply grooves
    int nAO = uQual >= 2 ? 4 : uQual == 1 ? 2 : 0;
    float occ = 0.0;
    for (int k = 0; k < 4; k++){
      if (k >= nAO) break;
      float ang = (float(k) + 0.5) * (2.0 * PI / float(nAO)) + 0.6;
      vec2 dir = vec2(cos(ang), sin(ang) * 0.8);
      float h1 = fieldH(P + dir * 0.15);
      occ += clamp((h1 - h) / 0.22, 0.0, 1.0);
    }
    float ao = nAO > 0 ? 1.0 - occ / float(max(nAO, 1)) * 0.9 : 0.85 - 0.30 * (1.0 - smoothstep(0.55, 1.05, h));
    float cav = smoothstep(0.35, 1.25, h);
    float farLift = smoothstep(0.07, 0.20, 1.0 / uScale.x);
    ao *= mix(0.22, 1.0, cav);
    ao *= mix(mix(0.18, 0.45, farLift), 1.0, pow(sq, 0.7));             // dark flanks: the lobe rolls away
    // tuck band: the upper end disappears under the next row's V point
    ao *= mix(1.0, mix(0.30, 0.70, farLift), smoothstep(0.62, 1.12, t));
    ao = mix(ao, 0.25 + 0.75 * ao, farLift);
    ao *= mix(1.0, 0.18 + 0.82 * pow(bulge, 0.45), plyFade);          // ply grooves

    // soft cast shadows: march the height field toward the light (P is y down)
    vec2 ld = normalize(vec2(L3.x, -L3.y) + 1e-5);
    float tanE = L3.z / max(length(L3.xy), 1e-3);
    float sh = 1.0;
    int nSh = uQual >= 2 ? 3 : uQual == 1 ? 1 : 0;
    for (int k = 1; k <= 3; k++){
      if (k > nSh) break;
      float dd = 0.075 * float(k) * (3.0 / float(max(nSh, 1)));
      float hs = fieldH(P + ld * dd);
      sh = min(sh, 1.0 - smoothstep(0.0, 0.12, hs - (h + dd * tanE)) * 0.7);
    }

    // lighting: wrapped diffuse (little wrap → strong round falloff) + Kajiya-Kay fibre sheen
    float wrap = 0.18;
    float diff = max((dot(n, L3) + wrap) / (1.0 + wrap), 0.0);
    vec3 H = normalize(L3 + vec3(0.0, 0.0, 1.0));
    vec3 fw = vec3(fd.x * side, fd.y, 0.0);
    vec3 T3 = normalize(fw - n * dot(fw, n));
    float TH = dot(T3, H);
    float kk = sqrt(max(1.0 - TH * TH, 0.0));
    float spec1 = pow(kk, 28.0) * 0.20;
    float spec2 = pow(kk, 10.0) * 0.07;
    float flatDiff = (L3.z + wrap) / (1.0 + wrap);
    const float Ka = 0.14, Kd = 1.0;
    float S = (Ka * ao + Kd * diff * sh * mix(1.0, ao, 0.75)) / (Ka + Kd * flatDiff);
    S = pow(max(S, 0.0), uContrast);
    float sheenMask = sh * ao * (0.25 + 0.75 * fib) * mix(1.0, bulge * bulge, plyFade * 0.85);
    col = alb * S * 1.45 + (vec3(spec1) * mix(vec3(1.0), baseAlb / max(lum, 0.05), 0.75) + spec2 * alb) * sheenMask;

    col *= mix(1.0, 0.60, farLift);   // keep the mean constant while sub-pixel crevices are lifted
    // halo: fuzz scatters a little light into the crevices
    col = mix(col, alb * (0.18 + 0.25 * fib), clamp((1.0 - ao) * 0.45 * uHalo * (0.4 + fuzzAmt), 0.0, 1.0));
  }

  // stray fibres: thin translucent hairs from nearby stitches
  float fz = uHalo * (0.3 + fuzzAmt * 1.4);
  if (fz > 0.001 && pxW < 0.08){
    int c0 = int(floor(P.x)), r0 = int(floor(P.y / uAspect));
    float hairW = 0.0055;
    float wpx = max(hairW, pxW * 0.7);
    float cover = hairW / wpx;          // sub-pixel hairs fade instead of aliasing
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
      int cc = c0 + i, rw = r0 + j;
      int y = yarnAt(cc, rw);
      if (y < 0) continue;
      uint hh = hc(cc, rw, 20u);
      for (int k = 0; k < 3; k++){
        hh = pcg(hh);
        vec4 hr = vec4(float(hh & 255u), float((hh >> 8) & 255u), float((hh >> 16) & 255u), float(hh >> 24)) / 255.0;
        if (hr.w > fz * 0.8) continue;
        vec2 a0 = vec2(float(cc) + hr.x, (float(rw) + hr.y) * uAspect);
        float ang = (hr.z - 0.5) * 2.4 + PI * 0.5;
        float ln = 0.22 + 0.5 * fract(hr.x * 7.31 + hr.w * 3.1);
        vec2 dv = vec2(cos(ang), -sin(ang)) * ln;
        vec2 pa = P - a0;
        float tt = clamp(dot(pa, dv) / dot(dv, dv), 0.0, 1.0);
        vec2 cp = a0 + dv * tt + vec2(-dv.y, dv.x) * 0.25 * sin(tt * PI) * (hr.y - 0.5);
        float dist = length(P - cp);
        float al = (1.0 - smoothstep(wpx * 0.4, wpx * 1.3, dist)) * cover * 0.45 * sin(PI * tt);
        vec3 hcol = palCol(y) * (0.8 + 0.5 * hr.z);
        col = mix(col, hcol, clamp(al, 0.0, 1.0));
      }
    }
  }
  return col;
}

// Far-field appearance (< ~6 px/stitch): cell colour × a band-limited knit texture — column
// striation (crevices between columns and the V centre slit) and the scalloped row breaks —
// each harmonic faded out before it reaches the pixel Nyquist limit, so no moiré.
vec3 farField(vec2 cr){
  vec2 P = vec2(cr.x, cr.y * uAspect);
  vec3 base = cellColour(P) * 0.46;
  float sx = uScale.x, sy = uScale.y;
  float x = fract(cr.x) - 0.5;                  // 0 at column centre
  float w1 = smoothstep(2.2, 3.5, sx);          // period 1 stitch
  float w2 = smoothstep(4.4, 7.0, sx);          // period 1/2 stitch
  float wr = smoothstep(2.4, 4.0, sy);          // period 1 row
  float col1 = 0.5 + 0.5 * cos(2.0 * PI * x);   // 1 at centre, 0 at column edges
  float col2 = 0.5 - 0.5 * cos(4.0 * PI * x);   // 0 at centre slit and at edges
  float rowv = 0.5 + 0.5 * cos(2.0 * PI * (cr.y + 0.30 - 0.45 * abs(x)));   // scalloped row break
  float m = 1.0;
  m *= mix(1.0, 0.86 + 0.18 * col1, w1);
  m *= mix(1.0, 0.85 + 0.25 * col2, w2);
  m *= mix(1.0, 0.90 + 0.14 * rowv, wr);
  // fine fibre/stitch-to-stitch tone so large fields are not flat
  float n = hn(floor(cr * vec2(1.0, 1.0)) + 13.0);
  m *= 1.0 + (n - 0.5) * 0.10 * w1;
  return base * m * 1.10;
}

vec3 srgbEncode(vec3 c){
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main(){
  vec2 px = vec2(gl_FragCoord.x, uTarget.y - gl_FragCoord.y) + uPixOff;   // y down, absolute pixel centre
  float pxW = 1.0 / uScale.x;
  vec3 acc = vec3(0.0);
  if (uLod < 0.999){
    int n = uSS;
    for (int k = 0; k < 4; k++){
      if (k >= n) break;
      vec2 o = n == 1 ? vec2(0.0) : vec2[4](vec2(-0.125, -0.375), vec2(0.375, -0.125), vec2(0.125, 0.375), vec2(-0.375, 0.125))[k];
      vec2 cr = uOrigin + (px + o) / uScale;
      vec2 P = vec2(cr.x, cr.y * uAspect);
      acc += shadeAt(P, pxW * (n == 1 ? 1.0 : 0.5));
    }
    acc /= float(n);
  }
  if (uLod > 0.001){
    vec2 cr = uOrigin + px / uScale;
    vec2 P = vec2(cr.x, cr.y * uAspect);
    vec3 far;
    if (cr.x < 0.0 || cr.y < 0.0 || cr.x >= float(uDims.x) || cr.y >= float(uDims.y)) far = uBg;
    else far = farField(cr);
    acc = mix(acc, far, uLod);
  }
  vec3 c = shoulder(acc);
  if (uMode == 0){
    oCol = vec4(srgbEncode(c), 1.0);
  } else {
    oCol = vec4(c, 1.0);
  }
}`;

// 2x2 box downsample of a linear buffer → sRGB 8-bit (export tiles). Light film grain anchored to
// absolute output pixels so tiles join exactly.
export const FS_DOWN = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform vec2 uPixOff;     // absolute output pixel of this tile's top-left
uniform vec2 uTarget;     // output tile size
uniform float uGrain;
out vec4 oCol;
uint pcg(uint v){ uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
vec3 srgbEncode(vec3 c){
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main(){
  ivec2 o = ivec2(gl_FragCoord.xy) * 2;
  vec3 c = texelFetch(uSrc, o, 0).rgb + texelFetch(uSrc, o + ivec2(1,0), 0).rgb
         + texelFetch(uSrc, o + ivec2(0,1), 0).rgb + texelFetch(uSrc, o + ivec2(1,1), 0).rgb;
  c *= 0.25;
  vec3 s = srgbEncode(c);
  // grain: absolute pixel coordinate (y down)
  ivec2 ap = ivec2(uPixOff) + ivec2(int(gl_FragCoord.x), int(uTarget.y) - 1 - int(gl_FragCoord.y));
  float g = float(pcg(uint(ap.x) * 1973u ^ pcg(uint(ap.y) * 9277u)) >> 8u) / 16777215.0 - 0.5;
  s += g * uGrain;
  oCol = vec4(s, 1.0);
}`;
