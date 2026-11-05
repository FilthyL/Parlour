/**
 * A small CFD solver for card faces.
 *
 * Incompressible, irrotational flow is described by a stream function ψ with
 * ∇²ψ = 0 in the fluid. Write ψ = ψa + φ, where ψa is the analytic part
 * (uniform free stream + smoothed point vortices) and φ is a correction
 * that makes every obstacle (pips, court letters) a streamline:
 *
 *   ∇²φ = 0 in the fluid
 *   φ = Cₖ − ψa on obstacle k   (Cₖ = mean ψa over the obstacle)
 *   φ = 0 on the outer boundary
 *
 * φ is solved with red-black successive over-relaxation (SOR) on a coarse
 * grid. The renderer then interpolates ψ and the speed |∇ψ| to full
 * resolution and draws CFD-style banded speed contours, isolines and
 * streamlines.
 */

export interface Vortex {
  x: number; // card px
  y: number;
  g: number; // circulation (px² per unit time; sign = spin)
  core: number; // px
}

export interface FlowSpec {
  W: number;
  H: number;
  cell: number; // grid cell size in px
  angle: number; // free-stream direction (radians, 0 = left→right, screen coords)
  U: number;
  vortices: Vortex[];
  obstacle: Uint8Array; // GW*GH, 1 = solid
  iterations?: number;
}

export interface FlowField {
  GW: number;
  GH: number;
  cell: number;
  psi: Float32Array;
  speed: Float32Array; // in units of U
  grad: Float32Array; // |∇speed| per px (for isoline anti-aliasing)
}

export function solveFlow(spec: FlowSpec): FlowField {
  const { W, H, cell, U } = spec;
  const GW = Math.ceil(W / cell), GH = Math.ceil(H / cell);
  const N = GW * GH;
  const ca = Math.cos(spec.angle), sa = Math.sin(spec.angle);
  const psiA = new Float32Array(N);
  for (let j = 0; j < GH; j++) {
    const y = (j + 0.5) * cell - H / 2;
    for (let i = 0; i < GW; i++) {
      const x = (i + 0.5) * cell - W / 2;
      // free stream along (ca, sa): ψ = U (y·ca − x·sa)
      let p = U * (y * ca - x * sa);
      for (const v of spec.vortices) {
        const dx = (i + 0.5) * cell - v.x, dy = (j + 0.5) * cell - v.y;
        p += (v.g / (4 * Math.PI)) * Math.log(dx * dx + dy * dy + v.core * v.core);
      }
      psiA[j * GW + i] = p;
    }
  }
  // connected obstacle components → one streamline constant each
  const comp = new Int32Array(N).fill(-1);
  const consts: number[] = [];
  const stack: number[] = [];
  for (let k = 0; k < N; k++) {
    if (!spec.obstacle[k] || comp[k] >= 0) continue;
    const id = consts.length;
    let sum = 0, cnt = 0;
    stack.push(k);
    comp[k] = id;
    while (stack.length) {
      const c = stack.pop()!;
      sum += psiA[c];
      cnt++;
      const ci = c % GW, cj = (c / GW) | 0;
      const nb = [ci > 0 ? c - 1 : -1, ci < GW - 1 ? c + 1 : -1, cj > 0 ? c - GW : -1, cj < GH - 1 ? c + GW : -1];
      for (const q of nb) if (q >= 0 && spec.obstacle[q] && comp[q] < 0) { comp[q] = id; stack.push(q); }
    }
    consts.push(sum / cnt);
  }
  const phi = new Float32Array(N);
  const fixed = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const i = k % GW, j = (k / GW) | 0;
    if (comp[k] >= 0) { phi[k] = consts[comp[k]] - psiA[k]; fixed[k] = 1; }
    else if (i === 0 || j === 0 || i === GW - 1 || j === GH - 1) { phi[k] = 0; fixed[k] = 1; }
  }
  const omega = 1.93;
  const iters = spec.iterations ?? 420;
  for (let it = 0; it < iters; it++) {
    for (let color = 0; color < 2; color++) {
      for (let j = 1; j < GH - 1; j++) {
        let i = 1 + ((j + color) & 1);
        for (; i < GW - 1; i += 2) {
          const k = j * GW + i;
          if (fixed[k]) continue;
          const avg = 0.25 * (phi[k - 1] + phi[k + 1] + phi[k - GW] + phi[k + GW]);
          phi[k] += omega * (avg - phi[k]);
        }
      }
    }
  }
  const psi = new Float32Array(N);
  for (let k = 0; k < N; k++) psi[k] = psiA[k] + phi[k];
  const speed = new Float32Array(N);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const k = j * GW + i;
      if (comp[k] >= 0) continue;
      const l = i > 0 ? psi[k - 1] : psi[k], r = i < GW - 1 ? psi[k + 1] : psi[k];
      const u = j > 0 ? psi[k - GW] : psi[k], d = j < GH - 1 ? psi[k + GW] : psi[k];
      const gx = (r - l) / ((i > 0 && i < GW - 1 ? 2 : 1) * cell);
      const gy = (d - u) / ((j > 0 && j < GH - 1 ? 2 : 1) * cell);
      speed[k] = Math.hypot(gx, gy) / U;
    }
  }
  // inside obstacles, carry the edge speed inward so interpolation is clean
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k < N; k++) {
      if (comp[k] < 0 || speed[k] > 0) continue;
      const i = k % GW;
      let s = 0, c = 0;
      for (const q of [i > 0 ? k - 1 : -1, i < GW - 1 ? k + 1 : -1, k - GW, k + GW]) {
        if (q >= 0 && q < N && speed[q] > 0) { s += speed[q]; c++; }
      }
      if (c) speed[k] = (s / c) * 0.98;
    }
  }
  const grad = new Float32Array(N);
  for (let j = 1; j < GH - 1; j++) {
    for (let i = 1; i < GW - 1; i++) {
      const k = j * GW + i;
      grad[k] = Math.hypot(speed[k + 1] - speed[k - 1], speed[k + GW] - speed[k - GW]) / (2 * cell);
    }
  }
  return { GW, GH, cell, psi, speed, grad };
}

/** Bilinear sample of a grid field at card pixel coordinates. */
export function sampleGrid(f: Float32Array, GW: number, GH: number, cell: number, x: number, y: number) {
  const gx = x / cell - 0.5, gy = y / cell - 0.5;
  let i = Math.floor(gx), j = Math.floor(gy);
  const fx = gx - i, fy = gy - j;
  if (i < 0) i = 0;
  if (j < 0) j = 0;
  if (i > GW - 2) i = GW - 2;
  if (j > GH - 2) j = GH - 2;
  const k = j * GW + i;
  const a = f[k], b = f[k + 1], c = f[k + GW], d = f[k + GW + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export interface FieldStyle {
  lut: Uint8ClampedArray; // 256×RGB
  bands: number;
  s0: number; // speed scale: t = tanh(s / s0)
  gamma: number;
  bandMix: number; // 0 = smooth, 1 = fully posterised bands
  edge: [number, number, number, number]; // isoline rgba (0-255, a 0-1)
  stream: [number, number, number, number]; // streamline rgba
  streamSpacing: number; // px between streamlines
}

/**
 * Paint the flow into `out` (RGBA, premultiplied by `weight`), blending over
 * what's already there. `weight(x, y)` in 0..1 lets the caller fade the field
 * out under indices and frames.
 */
export function paintField(
  out: Uint8ClampedArray,
  W: number,
  H: number,
  F: FlowField,
  st: FieldStyle,
  weight: (x: number, y: number) => number,
) {
  const { GW, GH, cell } = F;
  const N = st.bands;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const w = weight(x, y);
      if (w <= 0) continue;
      const px = x + 0.5, py = y + 0.5;
      const sp = sampleGrid(F.speed, GW, GH, cell, px, py);
      const gs = sampleGrid(F.grad, GW, GH, cell, px, py);
      // tanh tone curve: dark free stream, bright shoulders, no hard clipping
      const t0 = Math.tanh(sp / st.s0);
      const dt0 = (1 - t0 * t0) / st.s0;
      const t = t0 ** st.gamma;
      const tg = t0 > 1e-4 ? st.gamma * t0 ** (st.gamma - 1) * dt0 : dt0; // chain rule
      const tb = (Math.floor(t * N) + 0.5) / N;
      const tt = t * (1 - st.bandMix) + tb * st.bandMix;
      const li = Math.min(255, Math.max(0, (tt * 255) | 0)) * 3;
      let r = st.lut[li], g = st.lut[li + 1], b = st.lut[li + 2];
      // band isoline (anti-aliased by distance in px)
      const f = t * N - Math.floor(t * N);
      const gt = Math.max(1e-4, gs * tg * N);
      const de = Math.min(f, 1 - f) / gt;
      if (de < 1.4) {
        const a = st.edge[3] * (1 - de / 1.4);
        r += (st.edge[0] - r) * a; g += (st.edge[1] - g) * a; b += (st.edge[2] - b) * a;
      }
      // streamlines = iso-ψ
      if (st.stream[3] > 0 && sp > 0.02) {
        const q = sampleGrid(F.psi, GW, GH, cell, px, py) / st.streamSpacing;
        const fq = q - Math.floor(q);
        const dq = (Math.min(fq, 1 - fq) * st.streamSpacing) / sp; // px distance
        if (dq < 1.1) {
          const a = st.stream[3] * (1 - dq / 1.1);
          r += (st.stream[0] - r) * a; g += (st.stream[1] - g) * a; b += (st.stream[2] - b) * a;
        }
      }
      const i = (y * W + x) * 4;
      out[i] += (r - out[i]) * w;
      out[i + 1] += (g - out[i + 1]) * w;
      out[i + 2] += (b - out[i + 2]) * w;
    }
  }
}

/** Approximate Euclidean distance (px) from every grid cell to the nearest obstacle (two-pass chamfer). */
export function obstacleDistance(obstacle: Uint8Array, GW: number, GH: number, cell: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(GW * GH);
  for (let k = 0; k < d.length; k++) d[k] = obstacle[k] ? 0 : INF;
  const a = 1, b = Math.SQRT2;
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i;
    let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + a);
    if (j > 0) {
      v = Math.min(v, d[k - GW] + a);
      if (i > 0) v = Math.min(v, d[k - GW - 1] + b);
      if (i < GW - 1) v = Math.min(v, d[k - GW + 1] + b);
    }
    d[k] = v;
  }
  for (let j = GH - 1; j >= 0; j--) for (let i = GW - 1; i >= 0; i--) {
    const k = j * GW + i;
    let v = d[k];
    if (i < GW - 1) v = Math.min(v, d[k + 1] + a);
    if (j < GH - 1) {
      v = Math.min(v, d[k + GW] + a);
      if (i < GW - 1) v = Math.min(v, d[k + GW + 1] + b);
      if (i > 0) v = Math.min(v, d[k + GW - 1] + b);
    }
    d[k] = v;
  }
  for (let k = 0; k < d.length; k++) d[k] *= cell;
  return d;
}

export interface LineStyle {
  /** colour of a hairline at normalised speed t (0..1) */
  color: (t: number, out: number[]) => void;
  alpha: number;
  spacing: number; // px between streamlines
  width: number; // px
  band: [number, number, number];
  bandAlpha: number;
  bandFrom: number; // speed where the soft band starts (×U)
  bandTo: number; // speed where it is fully tinted
  contourAt: number; // one speed isoline drawn as a slightly bolder contour
}

/**
 * The face treatment: on white stock, draw the solved flow as hairline
 * streamlines, a single speed contour, and one soft tinted band on the
 * accelerating shoulders of each obstacle. Everything fades with
 * `weight(x, y)` (the caller makes it fall off with distance from the pips).
 */
export function paintLines(out: Uint8ClampedArray, W: number, H: number, F: FlowField, st: LineStyle, weight: (x: number, y: number) => number) {
  const { GW, GH, cell } = F;
  const col = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const w = weight(x, y);
      if (w <= 0.003) continue;
      const px = x + 0.5, py = y + 0.5;
      const sp = sampleGrid(F.speed, GW, GH, cell, px, py);
      const i = (y * W + x) * 4;
      let r = out[i], g = out[i + 1], b = out[i + 2];
      // one soft band: a smooth tint where the flow speeds up past the obstacle
      if (st.bandAlpha > 0 && sp > st.bandFrom) {
        const u = Math.min(1, (sp - st.bandFrom) / (st.bandTo - st.bandFrom));
        const a = st.bandAlpha * w * u * u * (3 - 2 * u);
        r += (st.band[0] - r) * a; g += (st.band[1] - g) * a; b += (st.band[2] - b) * a;
      }
      const t = Math.tanh(sp / 1.8);
      st.color(t, col);
      // a single speed contour, slightly bolder than the hairlines
      const gs = Math.max(1e-4, sampleGrid(F.grad, GW, GH, cell, px, py));
      const dc = st.contourAt > 0 ? Math.abs(sp - st.contourAt) / gs : 1e9;
      if (dc < st.width + 0.6) {
        const a = Math.min(1, st.alpha * 1.5) * w * (1 - dc / (st.width + 0.6));
        r += (col[0] - r) * a; g += (col[1] - g) * a; b += (col[2] - b) * a;
      }
      // streamlines (iso-ψ)
      if (sp > 0.03) {
        const q = sampleGrid(F.psi, GW, GH, cell, px, py) / st.spacing;
        const fq = q - Math.floor(q);
        const dq = (Math.min(fq, 1 - fq) * st.spacing) / sp;
        if (dq < st.width) {
          const a = st.alpha * w * (1 - dq / st.width);
          r += (col[0] - r) * a; g += (col[1] - g) * a; b += (col[2] - b) * a;
        }
      }
      out[i] = r; out[i + 1] = g; out[i + 2] = b;
    }
  }
}
