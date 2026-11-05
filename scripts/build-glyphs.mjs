#!/usr/bin/env node
/**
 * Extracts the rank glyphs (A 2–10 J Q K) from Bodoni Moda (SIL OFL) as SVG
 * path data, and measures the court-art frame in each court plate. The card
 * composer can then draw indices as true vectors inside a worker, with no
 * font loading, and lay the court art into its own frame.
 */
import opentype from 'opentype.js';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontFile = path.join(root, 'node_modules/@fontsource/bodoni-moda/files/bodoni-moda-latin-700-normal.woff');
const buf = fs.readFileSync(fontFile);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const glyphs = {};
for (const r of ranks) {
  const size = 1000;
  let p;
  if (r === '10') {
    // tighten the pair so "10" fits an index column
    const one = font.getPath('1', 0, 0, size), zero = font.getPath('0', 0, 0, size);
    const b1 = one.getBoundingBox();
    const shift = b1.x2 - b1.x1 + 20;
    const z = font.getPath('0', -font.getPath('0', 0, 0, size).getBoundingBox().x1 + shift + b1.x1, 0, size);
    p = new opentype.Path();
    p.extend(one);
    p.extend(z);
    void zero;
  } else p = font.getPath(r, 0, 0, size);
  const bb = p.getBoundingBox();
  glyphs[r] = { d: p.toPathData(2), x: bb.x1, y: bb.y1, w: bb.x2 - bb.x1, h: bb.y2 - bb.y1 };
}

// ---- court frames: find the long straight keylines of the art frame
const frames = {};
for (const s of ['S', 'H', 'D', 'C']) for (const r of ['J', 'Q', 'K']) {
  const code = r + s;
  const { data, info } = await sharp(path.join(root, 'public/press/plates', code + '.png')).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height / 2, ch = info.channels;
  const ink = (x, y) => Math.max(data[(y * W + x) * ch], data[(y * W + x) * ch + 1], data[(y * W + x) * ch + 2]);
  const colRun = new Array(W).fill(0), rowRun = new Array(H).fill(0);
  for (let x = 0; x < W; x++) { let run = 0, best = 0; for (let y = 0; y < H; y++) { if (ink(x, y) > 110) { run++; if (run > best) best = run; } else run = 0; } colRun[x] = best; }
  for (let y = 0; y < H; y++) { let run = 0, best = 0; for (let x = 0; x < W; x++) { if (ink(x, y) > 110) { run++; if (run > best) best = run; } else run = 0; } rowRun[y] = best; }
  const cols = colRun.map((v, i) => [v, i]).filter(([v]) => v > H * 0.55).map(([, i]) => i);
  const rows = rowRun.map((v, i) => [v, i]).filter(([v]) => v > W * 0.45).map(([, i]) => i);
  frames[code] = { x1: Math.min(...cols), x2: Math.max(...cols), y1: Math.min(...rows), y2: Math.max(...rows) };
}
fs.writeFileSync(path.join(root, 'src/render/press/glyphs.json'), JSON.stringify({ font: 'Bodoni Moda 700 (SIL OFL)', glyphs, frames }));
console.log('glyphs:', Object.keys(glyphs).join(' '));
console.log('frames:', JSON.stringify(frames));
