#!/usr/bin/env node
/**
 * Card press — stage 1: ink separation.
 *
 * Takes the public-domain Vector Playing Cards SVGs and separates each card
 * into printing plates, the way a print shop would before a press run:
 *
 *   paper · black · red · blue · yellow(gold)
 *
 * 1. Rasterise the SVG at SS× the target size.
 * 2. For every pixel, project its colour onto each "paper → ink" line in RGB
 *    space. The ink with the smallest perpendicular residual wins, and the
 *    projection length is that ink's coverage. This keeps tints (a light
 *    blue sash becomes ~40 % blue coverage) and anti-aliased edges against
 *    paper.
 * 3. Clear the thin outer keyline. Real cards have none, and the renderer
 *    gives the card its own edge.
 * 4. Box-downsample every plate by SS×SS. This gives smooth, anti-aliased
 *    coverage at the target size.
 * 5. Pack the plates losslessly into one RGB PNG per card (double height):
 *       top half    R = red   G = blue   B = black
 *       bottom half R = gold  G = mask   B = 0
 *    No alpha channel is used, so browser premultiplication can't damage
 *    the plates.
 *
 * Stage 2 (the reprint, with seeded paper, custom inks, misregistration and
 * an embossed linen finish) runs in the browser: src/render/press/.
 */
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'vendor/vector-playing-cards');
const OUT = path.join(root, 'public/press');
const W = 400; // output width in px (plates are scaled on the GPU)
const SS = 3; // supersampling factor

const INKS = [
  // name, sRGB of the source art's ink
  ['black', [0, 0, 0]],
  ['red', [223, 0, 0]],
  ['blue', [17, 86, 161]],
  ['gold', [226, 210, 0]],
];
const PAPER = [255, 255, 255];

const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const suits = ['S', 'H', 'D', 'C'];
const codes = suits.flatMap((s) => ranks.map((r) => r + s));

// Precompute ink direction vectors
const inkVec = INKS.map(([, c]) => {
  const v = [c[0] - PAPER[0], c[1] - PAPER[1], c[2] - PAPER[2]];
  const len2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  return { v, len2 };
});

function separatePixel(r, g, b, out) {
  // out: [black, red, blue, gold] coverages 0..1
  out[0] = out[1] = out[2] = out[3] = 0;
  const p0 = r - PAPER[0], p1 = g - PAPER[1], p2 = b - PAPER[2];
  if (p0 * p0 + p1 * p1 + p2 * p2 < 30) return; // paper
  let best = -1, bestRes = Infinity, bestT = 0;
  for (let i = 0; i < inkVec.length; i++) {
    const { v, len2 } = inkVec[i];
    let t = (p0 * v[0] + p1 * v[1] + p2 * v[2]) / len2;
    if (t <= 0) continue;
    if (t > 1) t = 1;
    const d0 = p0 - t * v[0], d1 = p1 - t * v[1], d2 = p2 - t * v[2];
    // weight residual: prefer chromatic inks for chromatic pixels
    const res = d0 * d0 + d1 * d1 + d2 * d2;
    if (res < bestRes) { bestRes = res; best = i; bestT = t; }
  }
  if (best < 0) return;
  // Residual too large means the pixel is a dark chromatic mix (e.g. dark
  // shading on the court art), so print it as an overprint with black.
  if (bestRes > 9000 && best !== 0) {
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    out[0] = Math.min(1, (1 - lum) * 0.6);
  }
  out[best] = Math.max(out[best], bestT);
}

async function separate(code) {
  const svgPath = path.join(SRC, `${code}.svg`);
  // resvg/librsvg reject "pt" units on the root element; drop them
  const svg = fs.readFileSync(svgPath, 'utf8').replace(/(width|height)="([\d.]+)pt"/g, '$1="$2"');
  const big = W * SS;
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 * SS * (W / 167.087) })
    .resize({ width: big })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bw = info.width, bh = info.height;
  const H = Math.floor(bh / SS);
  const plates = [0, 1, 2, 3].map(() => new Float32Array(W * H));
  const mask = new Float32Array(W * H);
  const cov = [0, 0, 0, 0];
  const keyline = Math.round(big * 0.014); // clear the outer stroke band
  // rounded-rect geometry for the keyline band (source corner radius ≈ 6 % of width)
  const rad = big * 0.06;
  const insideBand = (x, y) => {
    // distance to the rounded-rect border (negative inside)
    const cx = Math.min(Math.max(x, rad), bw - rad), cy = Math.min(Math.max(y, rad), bh - rad);
    const dx = x - cx, dy = y - cy;
    if ((x < rad || x > bw - rad) && (y < rad || y > bh - rad)) return rad - Math.hypot(dx, dy) < keyline;
    return Math.min(x, y, bw - 1 - x, bh - 1 - y) < keyline;
  };
  const inv = 1 / (SS * SS);
  for (let y = 0; y < H * SS; y++) {
    const oy = (y / SS) | 0;
    for (let x = 0; x < W * SS; x++) {
      const i = (y * bw + x) * 4;
      const a = data[i + 3] / 255;
      const o = oy * W + ((x / SS) | 0);
      mask[o] += a * inv;
      if (a < 0.02 || insideBand(x, y)) continue;
      // composite over paper first (transparent → paper)
      const r = data[i] * a + 255 * (1 - a), g = data[i + 1] * a + 255 * (1 - a), b = data[i + 2] * a + 255 * (1 - a);
      separatePixel(r, g, b, cov);
      plates[0][o] += cov[0] * inv;
      plates[1][o] += cov[1] * inv;
      plates[2][o] += cov[2] * inv;
      plates[3][o] += cov[3] * inv;
    }
  }
  const out = Buffer.alloc(W * H * 2 * 3);
  for (let p = 0; p < W * H; p++) {
    const t = p * 3, b = (W * H + p) * 3;
    out[t] = Math.round(Math.min(1, plates[1][p]) * 255); // red
    out[t + 1] = Math.round(Math.min(1, plates[2][p]) * 255); // blue
    out[t + 2] = Math.round(Math.min(1, plates[0][p]) * 255); // black
    out[b] = Math.round(Math.min(1, plates[3][p]) * 255); // gold
    out[b + 1] = Math.round(Math.min(1, mask[p]) * 255); // card mask
    out[b + 2] = 0;
  }
  await sharp(out, { raw: { width: W, height: H * 2, channels: 3 } })
    .png({ compressionLevel: 9, palette: false, effort: 10 })
    .toFile(path.join(OUT, 'plates', `${code}.png`));
  return { w: W, h: H };
}

fs.mkdirSync(path.join(OUT, 'plates'), { recursive: true });
let dims;
const t0 = Date.now();
for (const code of codes) {
  dims = await separate(code);
  process.stdout.write(code + ' ');
}
fs.writeFileSync(
  path.join(OUT, 'manifest.json'),
  JSON.stringify({ version: 1, width: dims.w, height: dims.h, codes, source: 'Vector Playing Cards by Byron Knoll (public domain)' }, null, 2),
);
console.log(`\nSeparated ${codes.length} cards in ${((Date.now() - t0) / 1000).toFixed(1)}s → public/press`);
