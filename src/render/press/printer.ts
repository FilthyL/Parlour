/**
 * Card press — stage 2: the reprint. Pure pixel maths that runs in a worker,
 * or on the main thread as a fallback.
 *
 * For each pixel:
 *   c = paper ink                                     (edition stock colour)
 *   for plate in [gold, blue, red, black]:            (press order)
 *       cov  = bilinear(plate, x + Δx_p, y + Δy_p)    (seeded misregistration)
 *       cov  = dotGain(cov) · density(x, y)           (ink spread and unevenness)
 *       c   *= mix(1, ink_p, cov)                     (multiply, like real ink)
 *   c *= paperShade(x + ox, y + oy)                   (fibres and embossed linen)
 *   c *= edgeShade(distance to card edge)             (a hint of edge wear)
 */
import type { Edition, RGB } from './editions';
import { TILE, type PaperTile } from './paper';
import { makeRng } from '../../core/rng';

const n = (c: RGB): RGB => [c[0] / 255, c[1] / 255, c[2] / 255];

function edgeFactor(x: number, y: number, W: number, H: number, rad: number) {
  const cx = Math.min(Math.max(x, rad), W - rad), cy = Math.min(Math.max(y, rad), H - rad);
  const inCorner = (x < rad || x > W - rad) && (y < rad || y > H - rad);
  const d = inCorner ? rad - Math.hypot(x - cx, y - cy) : Math.min(x, y, W - 1 - x, H - 1 - y);
  return d >= 5 ? 1 : 0.93 + 0.07 * Math.max(0, d / 5);
}

export interface FaceResult {
  face: Uint8ClampedArray;
  foil: Uint8ClampedArray | null;
}

/**
 * @param src RGBA pixels of a double-height plate image (W × 2H)
 */
export function reprintFace(
  src: Uint8ClampedArray,
  W: number,
  H: number,
  paper: PaperTile,
  ed: Edition,
  seed: number,
  cardIndex: number,
): FaceResult {
  const rng = makeRng((seed ^ Math.imul(cardIndex + 1, 0x9e3779b1)) >>> 0);
  const deck = makeRng(seed ^ 0x0ff5e7);
  // Per-deck misregistration (the press setup) plus per-card jitter (the sheet)
  const off = (base: number) => base + (rng.next() - 0.5) * 0.12;
  const regR = [off((deck.next() - 0.5) * 0.7), off((deck.next() - 0.5) * 0.7)];
  const regB = [off((deck.next() - 0.5) * 0.7), off((deck.next() - 0.5) * 0.7)];
  const ox = rng.int(TILE), oy = rng.int(TILE);
  const dox = rng.int(TILE), doy = rng.int(TILE);
  const paperC = n(ed.paper), K = n(ed.black), R = n(ed.red), B = n(ed.blue), G = n(ed.gold);
  const rad = W * 0.06;
  const out = new Uint8ClampedArray(W * H * 4);
  const foil = new Uint8ClampedArray(W * H * 4);
  let goldSum = 0;
  const bottom = W * H * 4;

  const sample = (x: number, y: number, ch: number) => {
    // bilinear sample of a plate channel in the top half
    const x0 = x | 0, y0 = y | 0;
    const fx = x - x0, fy = y - y0;
    const xa = x0 < 0 ? 0 : x0 >= W ? W - 1 : x0, xb = x0 + 1 >= W ? W - 1 : x0 + 1 < 0 ? 0 : x0 + 1;
    const ya = y0 < 0 ? 0 : y0 >= H ? H - 1 : y0, yb = y0 + 1 >= H ? H - 1 : y0 + 1 < 0 ? 0 : y0 + 1;
    const a = src[(ya * W + xa) * 4 + ch], b = src[(ya * W + xb) * 4 + ch];
    const c = src[(yb * W + xa) * 4 + ch], d = src[(yb * W + xb) * 4 + ch];
    return (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) / 255;
  };
  const gain = (c: number) => (c <= 0 ? 0 : 1 - (1 - c) ** 1.12);

  for (let y = 0; y < H; y++) {
    const ty = ((y + oy) & (TILE - 1)) * TILE, dy = ((y + doy) & (TILE - 1)) * TILE;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const mask = src[bottom + i + 1] / 255;
      if (mask <= 0.001) continue;
      const dens = 1 + paper.dens[dy + ((x + dox) & (TILE - 1))] * 0.07;
      let r = paperC[0], g = paperC[1], b = paperC[2];
      // gold / yellow plate
      const cg = gain(src[bottom + i] / 255) * dens;
      if (cg > 0) {
        r *= 1 - cg + cg * G[0]; g *= 1 - cg + cg * G[1]; b *= 1 - cg + cg * G[2];
        goldSum += cg;
        foil[i] = foil[i + 1] = foil[i + 2] = 255;
        foil[i + 3] = Math.min(255, cg * 255);
      }
      // blue plate (misregistered)
      const cb = gain(sample(x + regB[0], y + regB[1], 1)) * dens;
      if (cb > 0) { r *= 1 - cb + cb * B[0]; g *= 1 - cb + cb * B[1]; b *= 1 - cb + cb * B[2]; }
      // red plate (misregistered)
      const cr = gain(sample(x + regR[0], y + regR[1], 0)) * dens;
      if (cr > 0) { r *= 1 - cr + cr * R[0]; g *= 1 - cr + cr * R[1]; b *= 1 - cr + cr * R[2]; }
      // key (black) plate is the registration reference
      const ck = Math.min(1, gain(src[i + 2] / 255) * (0.97 + (dens - 1) * 0.5));
      if (ck > 0) { r *= 1 - ck + ck * K[0]; g *= 1 - ck + ck * K[1]; b *= 1 - ck + ck * K[2]; }
      const sh = paper.shade[ty + ((x + ox) & (TILE - 1))] * edgeFactor(x, y, W, H, rad);
      out[i] = r * sh * 255;
      out[i + 1] = g * sh * 255;
      out[i + 2] = b * sh * 255;
      out[i + 3] = mask * 255;
    }
  }
  return { face: out, foil: goldSum > 400 ? foil : null };
}

/** Reprint a back from its field/accent plates (white = ink, read from R). */
export function reprintBack(
  field: Uint8ClampedArray,
  accent: Uint8ClampedArray,
  W: number,
  H: number,
  paper: PaperTile,
  ed: Edition,
  seed: number,
): FaceResult {
  const rng = makeRng(seed ^ 0xb4c);
  const ox = rng.int(TILE), oy = rng.int(TILE);
  const paperC = n(ed.paper), F = n(ed.back), A = n(ed.backLine);
  const rad = W * 0.06;
  const out = new Uint8ClampedArray(W * H * 4);
  const foil = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const ty = ((y + oy) & (TILE - 1)) * TILE;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // rounded-rect card mask (anti-aliased)
      const cx = Math.min(Math.max(x + 0.5, rad), W - rad), cy = Math.min(Math.max(y + 0.5, rad), H - rad);
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const mask = Math.max(0, Math.min(1, rad - dist + 0.5));
      if (mask <= 0) continue;
      const dens = 1 + paper.dens[ty + ((x + ox) & (TILE - 1))] * 0.08;
      let r = paperC[0], g = paperC[1], b = paperC[2];
      const cf = Math.min(1, (field[i] / 255) * dens);
      if (cf > 0) { r *= 1 - cf + cf * F[0]; g *= 1 - cf + cf * F[1]; b *= 1 - cf + cf * F[2]; }
      const ca = accent[i] / 255;
      if (ca > 0) {
        // metallic ink sits on top of the field
        r = r * (1 - ca) + A[0] * ca; g = g * (1 - ca) + A[1] * ca; b = b * (1 - ca) + A[2] * ca;
        foil[i] = foil[i + 1] = foil[i + 2] = 255;
        foil[i + 3] = ca * 255;
      }
      const sh = paper.shade[ty + ((x + ox) & (TILE - 1))] * edgeFactor(x, y, W, H, rad);
      out[i] = r * sh * 255;
      out[i + 1] = g * sh * 255;
      out[i + 2] = b * sh * 255;
      out[i + 3] = mask * 255;
    }
  }
  return { face: out, foil };
}
