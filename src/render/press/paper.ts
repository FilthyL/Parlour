/**
 * Procedural card stock. Produces a tileable 512×512 field of
 *   shade  — multiplicative light from the paper's fibres and the embossed
 *            linen finish (≈ 0.9 … 1.06)
 *   dens   — low-frequency ink-density variation in −1 … 1, so plates never
 *            print perfectly flat
 * Everything comes from one seed, so the same deck reprints identically.
 */
import { makeRng } from '../../core/rng';

export const TILE = 512;

/** Tileable value noise with the given lattice size (cells across the tile). */
function lattice(rng: () => number, gx: number, gy: number) {
  const v = new Float32Array(gx * gy);
  for (let i = 0; i < v.length; i++) v[i] = rng() * 2 - 1;
  return (x: number, y: number) => {
    // x, y in tile pixels
    const fx = (x / TILE) * gx, fy = (y / TILE) * gy;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    let tx = fx - x0, ty = fy - y0;
    tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
    ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
    const xa = ((x0 % gx) + gx) % gx, xb = (xa + 1) % gx;
    const ya = ((y0 % gy) + gy) % gy, yb = (ya + 1) % gy;
    const a = v[ya * gx + xa], b = v[ya * gx + xb], c = v[yb * gx + xa], d = v[yb * gx + xb];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

export interface PaperTile {
  shade: Float32Array;
  dens: Float32Array;
}

export function makePaper(seed: number): PaperTile {
  const rng = makeRng(seed ^ 0x5eed);
  const r = () => rng.next();
  // cloud (pulp unevenness)
  const c1 = lattice(r, 8, 8), c2 = lattice(r, 16, 16), c3 = lattice(r, 64, 64);
  // fibres: stretched noise in two directions
  const fA = lattice(r, 48, 256), fB = lattice(r, 256, 40);
  // linen weave: very fine stretched noise both ways (a woven, non-periodic
  // texture, so it doesn't moiré when the card is scaled down)
  const lA = lattice(r, 128, 512), lB = lattice(r, 512, 128);
  // ink density field
  const d1 = lattice(r, 4, 4), d2 = lattice(r, 12, 12);

  const N = TILE * TILE;
  const height = new Float32Array(N);
  const base = new Float32Array(N);
  const dens = new Float32Array(N);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      const cloud = 0.55 * c1(x, y) + 0.3 * c2(x, y) + 0.15 * c3(x, y);
      const fibre = Math.max(0, fA(x, y)) ** 3 * 0.6 + Math.max(0, fB(x, y)) ** 3 * 0.4;
      base[i] = 1 + cloud * 0.018 - fibre * 0.05;
      height[i] = lA(x, y) * 0.5 + lB(x, y) * 0.5;
      dens[i] = 0.7 * d1(x, y) + 0.3 * d2(x, y);
    }
  }
  // Light the linen height-field from the upper left (finite differences)
  const shade = new Float32Array(N);
  const k = 0.07;
  for (let y = 0; y < TILE; y++) {
    const ym = ((y - 1 + TILE) % TILE) * TILE, yp = ((y + 1) % TILE) * TILE, yr = y * TILE;
    for (let x = 0; x < TILE; x++) {
      const xm = (x - 1 + TILE) % TILE, xp = (x + 1) % TILE;
      const dx = height[yr + xm] - height[yr + xp];
      const dy = height[ym + x] - height[yp + x];
      shade[yr + x] = base[yr + x] * (1 + k * (dx + dy));
    }
  }
  return { shade, dens };
}
