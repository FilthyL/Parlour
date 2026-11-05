/**
 * Composes this site's own card faces ("flow" editions).
 *
 * Every face is a small CFD study. The pips, or the court letter, are solid
 * obstacles in a solved potential flow. The ground shows banded speed
 * contours, isolines and streamlines. Each rank has its own flow character:
 *
 *   number cards  steady diagonal stream with seeded wake vortices
 *   ace           strong circulation round one big pip and a shed pair
 *   jack          a fast jet with a Kármán vortex street in its wake
 *   queen         a single dominant swirl wrapping the letter
 *   king          rising flow, circulation, and a crown of three vortices
 *
 * Red suits use the warm map and black suits the cool map, so colour still
 * reads as suit at a glance.
 */
import type { FlowEdition } from './editions';
import { MAPS, lut, sample as sampleMap } from './colormaps';
import { obstacleDistance, paintLines, sampleGrid, solveFlow, type Vortex } from './flow';
import { SUIT_PATHS, isRed, type SuitKey } from './suits';
import type { PaperTile } from './paper';
import { TILE } from './paper';
import { makeRng, hashString } from '../../core/rng';
import glyphData from './glyphs.json';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export interface Surface {
  ctx: Ctx;
}
export type MakeSurface = (w: number, h: number) => Surface;

const GLYPHS = glyphData.glyphs as Record<string, { d: string; x: number; y: number; w: number; h: number }>;
const pathCache = new Map<string, Path2D>();
const P = (d: string) => {
  let p = pathCache.get(d);
  if (!p) pathCache.set(d, (p = new Path2D(d)));
  return p;
};

interface Pip {
  x: number;
  y: number;
  size: number;
  flip: boolean;
}

/** Standard pip positions (fractions of the card) for ranks 2–10. */
function pipLayout(rank: number, W: number, H: number): Pip[] {
  const L = 0.305, M = 0.5, R = 0.695;
  const t = 0.205, b = 0.795;
  const rows4 = [t, t + (b - t) / 3, t + (2 * (b - t)) / 3, b];
  const spots: [number, number][] = [];
  const col = (x: number, ys: number[]) => ys.forEach((y) => spots.push([x, y]));
  switch (rank) {
    case 2: col(M, [t, b]); break;
    case 3: col(M, [t, 0.5, b]); break;
    case 4: col(L, [t, b]); col(R, [t, b]); break;
    case 5: col(L, [t, b]); col(R, [t, b]); col(M, [0.5]); break;
    case 6: col(L, [t, 0.5, b]); col(R, [t, 0.5, b]); break;
    case 7: col(L, [t, 0.5, b]); col(R, [t, 0.5, b]); col(M, [0.3525]); break;
    case 8: col(L, [t, 0.5, b]); col(R, [t, 0.5, b]); col(M, [0.3525, 0.6475]); break;
    case 9: col(L, rows4); col(R, rows4); col(M, [0.5]); break;
    case 10: col(L, rows4); col(R, rows4); col(M, [0.305, 0.695]); break;
  }
  const size = (rank >= 9 ? 0.165 : rank >= 7 ? 0.175 : 0.19) * W;
  return spots.map(([fx, fy]) => ({ x: fx * W, y: fy * H, size, flip: fy > 0.5 + 1e-6 }));
}

function suitPath(ctx: Ctx, suit: SuitKey, x: number, y: number, size: number, flip: boolean) {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.rotate(Math.PI);
  ctx.scale(size / 100, size / 100);
  ctx.translate(-50, -50);
  return P(SUIT_PATHS[suit]);
}

// Sub-paths are painted one by one, so overlapping lobes (the club) union
// cleanly instead of cancelling under the non-zero rule.
const SUBPATHS: Record<string, string[]> = {};
const subpaths = (suit: SuitKey) => (SUBPATHS[suit] ??= SUIT_PATHS[suit].split(/(?=M)/).map((d) => d.trim()).filter(Boolean));

function fillSuit(ctx: Ctx, suit: SuitKey, x: number, y: number, size: number, flip: boolean, fill: string | CanvasGradient) {
  suitPath(ctx, suit, x, y, size, flip);
  ctx.fillStyle = fill;
  for (const d of subpaths(suit)) ctx.fill(P(d));
  ctx.restore();
}

function strokeSuit(ctx: Ctx, suit: SuitKey, x: number, y: number, size: number, flip: boolean, style: string | CanvasGradient, width: number) {
  suitPath(ctx, suit, x, y, size, flip);
  ctx.strokeStyle = style;
  ctx.lineWidth = (width * 100) / size;
  ctx.lineJoin = 'round';
  for (const d of subpaths(suit)) ctx.stroke(P(d));
  ctx.restore();
}

function glyph(ctx: Ctx, rank: string, x: number, y: number, height: number, flip = false, cx = 0, cy = 0) {
  // draws a rank glyph with its bounding box top-left at (x, y)
  const g = GLYPHS[rank];
  const sc = height / g.h;
  ctx.save();
  if (flip) {
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI);
    ctx.translate(-cx, -cy);
  }
  ctx.translate(x - g.x * sc, y - g.y * sc);
  ctx.scale(sc, sc);
  return { p: P(g.d), w: g.w * sc, sc };
}

function metal(ctx: Ctx, stops: string[], x0: number, y0: number, x1: number, y1: number) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const RANK_NAMES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export interface ComposeResult {
  face: Uint8ClampedArray;
  foil: Uint8ClampedArray;
}

/** Obstacle mask on the solver grid from a draw callback. */
function rasterMask(make: MakeSurface, GW: number, GH: number, cell: number, draw: (ctx: Ctx) => void) {
  const s = make(GW, GH);
  s.ctx.clearRect(0, 0, GW, GH);
  s.ctx.save();
  s.ctx.scale(1 / cell, 1 / cell);
  draw(s.ctx);
  s.ctx.restore();
  const d = s.ctx.getImageData(0, 0, GW, GH).data;
  const m = new Uint8Array(GW * GH);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 110 ? 1 : 0;
  // fill enclosed counters (the bowl of a Q, the eye of a club): any fluid
  // cell not reachable from the border is solid
  const seen = new Uint8Array(GW * GH);
  const q: number[] = [];
  for (let i = 0; i < GW; i++) q.push(i, (GH - 1) * GW + i);
  for (let j = 0; j < GH; j++) q.push(j * GW, j * GW + GW - 1);
  while (q.length) {
    const k = q.pop()!;
    if (seen[k] || m[k]) continue;
    seen[k] = 1;
    const i = k % GW, j = (k / GW) | 0;
    if (i > 0) q.push(k - 1);
    if (i < GW - 1) q.push(k + 1);
    if (j > 0) q.push(k - GW);
    if (j < GH - 1) q.push(k + GW);
  }
  for (let k = 0; k < m.length; k++) if (!seen[k]) m[k] = 1;
  return m;
}

function smooth(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Distance (px) from a point to an axis-aligned box. */
function boxDist(x: number, y: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
  return Math.hypot(dx, dy);
}

/** Final pass: card stock texture, gloss, edge, rounded corners. */
function finish(px: Uint8ClampedArray, W: number, H: number, paper: PaperTile, light: boolean, seed: number) {
  const rng = makeRng(seed);
  const ox = rng.int(TILE), oy = rng.int(TILE);
  const rad = W * 0.055;
  const amp = light ? 0.28 : 0.55;
  for (let y = 0; y < H; y++) {
    const ty = ((y + oy) & (TILE - 1)) * TILE;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const cx = Math.min(Math.max(x + 0.5, rad), W - rad), cy = Math.min(Math.max(y + 0.5, rad), H - rad);
      const inCorner = (x + 0.5 < rad || x + 0.5 > W - rad) && (y + 0.5 < rad || y + 0.5 > H - rad);
      const mask = inCorner ? Math.max(0, Math.min(1, rad - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5)) : 1;
      if (mask <= 0) { px[i + 3] = 0; continue; }
      let s = 1 + (paper.shade[ty + ((x + ox) & (TILE - 1))] - 1) * amp;
      // lacquer gloss: a soft diagonal band of light
      if (!light) {
        const d = (x / W - y / H) * 1.1 + 0.18;
        s += 0.05 * Math.exp(-d * d * 18);
      }
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (edge < 4) s *= 0.9 + 0.025 * edge;
      px[i] = Math.min(255, px[i] * s);
      px[i + 1] = Math.min(255, px[i + 1] * s);
      px[i + 2] = Math.min(255, px[i + 2] * s);
      px[i + 3] = mask * 255;
    }
  }
}

export function composeFace(
  make: MakeSurface,
  W: number,
  H: number,
  code: string,
  ed: FlowEdition,
  paper: PaperTile,
  seed: number,
): ComposeResult {
  const rankStr = code.slice(0, -1), suit = code.slice(-1) as SuitKey;
  const rank = RANK_NAMES.indexOf(rankStr) + 1;
  const red = isRed(suit);
  const rng = makeRng((seed ^ hashString(code)) >>> 0);
  const S = make(W, H);
  const ctx = S.ctx;
  const [sr, sg, sb] = ed.stock;
  ctx.fillStyle = `rgb(${sr},${sg},${sb})`;
  ctx.fillRect(0, 0, W, H);

  // ---------- geometry ----------
  const idxW = W * 0.13, idxH = H * 0.17;
  const idx0 = { x0: W * 0.035, y0: H * 0.03, x1: W * 0.035 + idxW, y1: H * 0.03 + idxH };
  const idx1 = { x0: W - idx0.x1, y0: H - idx0.y1, x1: W - idx0.x0, y1: H - idx0.y0 };
  const cell = 4;
  const GW = Math.ceil(W / cell), GH = Math.ceil(H / cell);
  const vortices: Vortex[] = [];
  let angle = ((32 + rng.range(-8, 8)) * Math.PI) / 180;
  let U = 1;
  let pips: Pip[] = [];
  let drawObstacle: (c: Ctx) => void;
  const courtLetter = rank >= 11 ? rankStr : null;
  const letterH = H * 0.36;
  let letterBox = { x: 0, y: 0, w: 0, h: letterH };
  let reach = 30; // how far the hairlines reach from an obstacle (px)

  if (rank === 1) {
    const size = suit === 'S' ? W * 0.46 : W * 0.4;
    pips = [{ x: W / 2, y: H / 2, size, flip: false }];
    angle = ((rng.range(20, 36) + (red ? 180 : 0)) * Math.PI) / 180;
    vortices.push({ x: W / 2, y: H / 2, g: (red ? -1 : 1) * 2 * Math.PI * size * 0.3, core: size * 0.35 });
    drawObstacle = (c) => fillSuit(c, suit, W / 2, H / 2, size * 1.1, false, '#000');
    reach = 70;
  } else if (courtLetter) {
    const g = GLYPHS[courtLetter];
    const lw = (g.w / g.h) * letterH;
    letterBox = { x: W / 2 - lw / 2, y: H / 2 - letterH / 2, w: lw, h: letterH };
    const cx = W / 2, cy = H / 2;
    if (courtLetter === 'K') {
      angle = -Math.PI / 2; // rising
      vortices.push({ x: cx, y: cy, g: 2 * Math.PI * W * 0.08 * (red ? 1 : -1), core: W * 0.14 });
    } else if (courtLetter === 'Q') {
      U = 0.6;
      angle = Math.PI / 4;
      vortices.push({ x: cx, y: cy, g: 2 * Math.PI * W * 0.2 * (red ? -1 : 1), core: W * 0.14 });
    } else {
      angle = 0;
      U = 1.1;
    }
    drawObstacle = (c) => {
      const { p } = glyph(c, courtLetter, letterBox.x, letterBox.y, letterH);
      c.fillStyle = '#000';
      c.fill(p);
      c.lineWidth = 34;
      c.strokeStyle = '#000';
      c.stroke(p);
      c.restore();
    };
    reach = 64;
  } else {
    pips = pipLayout(rank, W, H);
    drawObstacle = (c) => pips.forEach((p) => fillSuit(c, suit, p.x, p.y, p.size * 1.16, p.flip, '#000'));
    reach = rank <= 3 ? 64 : rank <= 6 ? 42 : 30;
  }

  // ---------- solve the flow ----------
  const obstacle = rasterMask(make, GW, GH, cell, drawObstacle);
  const field = solveFlow({ W, H, cell, angle, U, vortices, obstacle });
  const dist = obstacleDistance(obstacle, GW, GH, cell);

  // ---------- hairlines on white ----------
  const img = ctx.getImageData(0, 0, W, H);
  const lineRGB = red ? ed.lineRed : ed.lineBlack;
  const map = MAPS[ed.lineMap];
  const pad = W * 0.06;
  const weight = (x: number, y: number) => {
    if (x < pad || y < pad || x > W - pad || y > H - pad) return 0;
    const di = Math.min(boxDist(x, y, idx0.x0, idx0.y0, idx0.x1, idx0.y1), boxDist(x, y, idx1.x0, idx1.y0, idx1.x1, idx1.y1));
    if (di < 6) return 0;
    const d = sampleGrid(dist, GW, GH, cell, x + 0.5, y + 0.5);
    if (d < cell * 0.75) return 0; // never draw inside a solid
    const edge = smooth(0, 14, Math.min(x - pad, y - pad, W - pad - x, H - pad - y));
    return Math.exp(-d / reach) * edge * smooth(6, 16, di);
  };
  paintLines(img.data, W, H, field, {
    color: ed.lineMode === 'map'
      ? (t, o) => sampleMap(map, 0.15 + t * 0.8, o)
      : (_t, o) => { o[0] = lineRGB[0]; o[1] = lineRGB[1]; o[2] = lineRGB[2]; },
    alpha: ed.lineAlpha,
    spacing: courtLetter || rank === 1 ? 6.5 : 6,
    width: 0.85,
    band: red ? ed.bandRed : ed.bandBlack,
    bandAlpha: ed.bandAlpha,
    bandFrom: 1.05 * U,
    bandTo: 1.75 * U,
    contourAt: -1,
  }, weight);
  ctx.putImageData(img, 0, 0);

  // ---------- foil (face + mask) ----------
  const F = make(W, H);
  const fctx = F.ctx;
  fctx.clearRect(0, 0, W, H);
  const foilFill = (c: Ctx) => (c === fctx ? '#fff' : metal(c, ed.foil, 0, 0, W, H));
  const ink = (c: Ctx, y0: number, y1: number) => metal(c, red ? ed.inkRed : ed.inkBlack, 0, y0, 0, y1);

  // ---------- pips (a paper-white keyline keeps hairlines off the ink) ----------
  for (const p of pips) strokeSuit(ctx, suit, p.x, p.y, p.size, p.flip, `rgb(${sr},${sg},${sb})`, 4);
  for (const p of pips) fillSuit(ctx, suit, p.x, p.y, p.size, p.flip, ink(ctx, p.y - p.size / 2, p.y + p.size / 2));

  if (rank === 1) {
    const p = pips[0];
    // engraved contours inside the ace: fine paper-white rings following the pip
    ctx.save();
    const clipPath = new Path2D();
    clipPath.addPath(P(SUIT_PATHS[suit]), new DOMMatrix().translate(p.x, p.y).scale(p.size / 100).translate(-50, -50));
    ctx.clip(clipPath);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 0.8;
    for (let k = 1; k < 30; k++) {
      ctx.beginPath();
      const R = (p.size * k) / 40;
      for (let s = 0; s <= 360; s += 2) {
        const a = (s * Math.PI) / 180;
        const rr2 = R * (1 + 0.05 * Math.sin(a * 10 + k * 0.6));
        const x = p.x + rr2 * Math.cos(a), y = p.y + p.size * 0.05 + rr2 * Math.sin(a);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    for (const c of [ctx, fctx]) strokeSuit(c, suit, p.x, p.y, p.size + 9, false, foilFill(c), 1.2);
    if (suit === 'S') {
      for (const c of [ctx, fctx]) {
        c.strokeStyle = foilFill(c);
        for (const [rr0, lw] of [[0.72, 1.1], [0.76, 0.6]] as const) {
          c.lineWidth = lw;
          c.beginPath();
          c.arc(p.x, p.y, p.size * rr0, 0, Math.PI * 2);
          c.stroke();
        }
      }
    }
  }

  // ---------- court: a monumental letter, engraved ----------
  if (courtLetter) {
    // paper keyline
    {
      const { p, sc } = glyph(ctx, courtLetter, letterBox.x, letterBox.y, letterH);
      ctx.strokeStyle = `rgb(${sr},${sg},${sb})`;
      ctx.lineWidth = 8 / sc;
      ctx.lineJoin = 'round';
      ctx.stroke(p);
      ctx.fillStyle = ink(ctx, -800, 50);
      ctx.fill(p);
      ctx.restore();
    }
    // engraving: fine diagonal hatching cut into the letter
    ctx.save();
    const { p: lp } = glyph(ctx, courtLetter, letterBox.x, letterBox.y, letterH);
    const m = ctx.getTransform();
    ctx.restore();
    ctx.save();
    const clip = new Path2D();
    clip.addPath(lp, m);
    ctx.clip(clip);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 0.75;
    for (let k = -H; k < W + H; k += 4) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k - H * 0.55, H);
      ctx.stroke();
    }
    ctx.restore();
    // gilt inline offset from the letter
    for (const c of [ctx, fctx]) {
      const { p, sc } = glyph(c, courtLetter, letterBox.x, letterBox.y, letterH);
      c.strokeStyle = foilFill(c);
      c.lineWidth = 1.1 / sc;
      c.stroke(p);
      c.restore();
    }
    // flanking pips and a fine frame
    const ps = W * 0.12;
    const pa = { x: W * 0.25, y: H * 0.255 }, pb = { x: W * 0.75, y: H * 0.745 };
    for (const [q, flip] of [[pa, false], [pb, true]] as const) {
      strokeSuit(ctx, suit, q.x, q.y, ps, flip, `rgb(${sr},${sg},${sb})`, 3);
      fillSuit(ctx, suit, q.x, q.y, ps, flip, ink(ctx, q.y - ps / 2, q.y + ps / 2));
    }
    const fi = W * 0.19;
    for (const c of [ctx, fctx]) {
      c.strokeStyle = foilFill(c);
      c.lineWidth = 0.9;
      roundRect(c, fi, H * 0.12, W - 2 * fi, H * 0.76, 10);
      c.stroke();
    }
  }

  // ---------- indices ----------
  const gh = H * 0.082;
  const drawIndex = (c: Ctx, flip: boolean, mask: boolean) => {
    const g = GLYPHS[rankStr];
    const gw = (g.w / g.h) * gh;
    const colX = idx0.x0 + idxW / 2;
    const gx = colX - gw / 2, gy = idx0.y0 + H * 0.014;
    const ss = W * 0.078;
    const sy = gy + gh + ss / 2 + H * 0.014;
    const { p } = glyph(c, rankStr, gx, gy, gh, flip, W / 2, H / 2);
    c.fillStyle = mask ? '#fff' : ink(c, -700, 0);
    c.fill(p);
    c.restore();
    c.save();
    if (flip) {
      c.translate(W / 2, H / 2);
      c.rotate(Math.PI);
      c.translate(-W / 2, -H / 2);
    }
    fillSuit(c, suit, colX, sy, ss, false, mask ? '#fff' : ink(c, sy - ss / 2, sy + ss / 2));
    c.restore();
  };
  drawIndex(ctx, false, false);
  drawIndex(ctx, true, false);

  const out = ctx.getImageData(0, 0, W, H).data;
  finish(out, W, H, paper, true, seed ^ hashString(code));
  const foil = fctx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < foil.length; i += 4) { foil[i] = foil[i + 1] = foil[i + 2] = 255; }
  return { face: out, foil };
}

/**
 * Flow-edition back: smooth contour bands. One continuous field (a
 * superellipse distance from the medallion, so the bands follow the card's
 * shape) is mapped through the edition's colormap with no posterising, and
 * fine isolines mark evenly spaced levels. It's 180° symmetric and has no
 * randomness, so every back in the deck is identical.
 */
export function composeBack(make: MakeSurface, W: number, H: number, ed: FlowEdition, paper: PaperTile, seed: number): ComposeResult {
  const S = make(W, H);
  const ctx = S.ctx;
  const [sr, sg, sb] = ed.backStock;
  ctx.fillStyle = `rgb(${sr},${sg},${sb})`;
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const MR = W * 0.2;
  const m = W * 0.06, rr = 10;
  const img = ctx.getImageData(0, 0, W, H);
  const px = img.data;
  const table = lut(MAPS[ed.backMap]);
  const a = W / 2 - m, b = H / 2 - m;
  const pw = 2.6; // superellipse exponent: circles near the centre, rounded rectangles near the edge
  const levels = 14;
  const field = (x: number, y: number) => {
    const u = Math.abs(x - cx) / a, v = Math.abs(y - cy) / b;
    const r = (u ** pw + v ** pw) ** (1 / pw);
    return Math.max(0, (r - MR / a) / (1 - MR / a));
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < m || y < m || x > W - m || y > H - m) continue;
      const qx = Math.min(Math.max(x, m + rr), W - m - rr), qy = Math.min(Math.max(y, m + rr), H - m - rr);
      const dEdge = rr - Math.hypot(x - qx, y - qy);
      if (dEdge < 0) continue;
      const fx = x + 0.5, fy = y + 0.5;
      const t = field(fx, fy);
      // smooth colour: light at the medallion, deepening outward
      const tc = 1 - Math.min(1, t) ** 0.85;
      const li = Math.min(255, Math.max(0, (tc * 235 + 10) | 0)) * 3;
      let r = table[li], g = table[li + 1], bl = table[li + 2];
      // isolines at even levels, anti-aliased with a finite-difference gradient
      const gx = field(fx + 0.5, fy) - field(fx - 0.5, fy), gy = field(fx, fy + 0.5) - field(fx, fy - 0.5);
      const gm = Math.max(1e-5, Math.hypot(gx, gy) * levels);
      const f = t * levels - Math.floor(t * levels);
      const d = Math.min(f, 1 - f) / gm;
      if (d < 1 && t > 0) {
        const al = 0.28 * (1 - d);
        r += (255 - r) * al; g += (255 - g) * al; bl += (255 - bl) * al;
      }
      const i = (y * W + x) * 4;
      const e = Math.min(1, dEdge / 1.2);
      px[i] += (r - px[i]) * e;
      px[i + 1] += (g - px[i + 1]) * e;
      px[i + 2] += (bl - px[i + 2]) * e;
    }
  }
  ctx.putImageData(img, 0, 0);

  const F = make(W, H);
  const fctx = F.ctx;
  fctx.clearRect(0, 0, W, H);
  for (const c of [ctx, fctx]) {
    const fill = c === fctx ? '#fff' : metal(c, ed.foil, 0, 0, W, H);
    c.strokeStyle = fill;
    c.fillStyle = fill;
    c.lineWidth = 1.6;
    roundRect(c, m - 0.5, m - 0.5, W - 2 * m + 1, H - 2 * m + 1, rr);
    c.stroke();
    c.lineWidth = 0.7;
    roundRect(c, m - 5, m - 5, W - 2 * m + 10, H - 2 * m + 10, rr + 4);
    c.stroke();
    // medallion
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy, MR * 1.08, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 0.7;
    c.beginPath();
    c.arc(cx, cy, MR * 1.16, 0, Math.PI * 2);
    c.stroke();
    // radiating hairlines inside the medallion
    c.lineWidth = 0.6;
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * MR * 0.5, cy + Math.sin(a) * MR * 0.5);
      c.lineTo(cx + Math.cos(a) * MR * 1.0, cy + Math.sin(a) * MR * 1.0);
      c.stroke();
    }
  }
  // medallion core: the four suits, point-symmetric
  ctx.fillStyle = `rgb(${sr},${sg},${sb})`;
  ctx.beginPath();
  ctx.arc(cx, cy, MR * 0.46, 0, Math.PI * 2);
  ctx.fill();
  const s4: [SuitKey, number][] = [['S', -1], ['H', 0], ['C', 1], ['D', 2]];
  for (const c of [ctx, fctx]) {
    const fill = c === fctx ? '#fff' : metal(c, ed.foil, cx - MR, cy - MR, cx + MR, cy + MR);
    for (const [s, k] of s4) {
      const a = (k * Math.PI) / 2;
      fillSuit(c, s, cx + Math.cos(a) * MR * 0.22, cy + Math.sin(a) * MR * 0.22, MR * 0.26, false, fill);
    }
  }
  const out = ctx.getImageData(0, 0, W, H).data;
  finish(out, W, H, paper, false, seed ^ 0xb00c);
  const foil = fctx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < foil.length; i += 4) foil[i] = foil[i + 1] = foil[i + 2] = 255;
  return { face: out, foil };
}
