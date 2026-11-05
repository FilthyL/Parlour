/**
 * Seeded guilloche back generator — the engraved line-work you see on
 * banknotes and the backs of fine playing cards, done procedurally.
 *
 * Draws two plates (white = ink):
 *   field  — the coloured back with paper-white line-work knocked out
 *   accent — metallic frame lines, medallion rings and corner fans
 *
 * Every motif is built to have 180° rotational symmetry (even lobe counts,
 * odd harmonics, centred lattices), so a back looks the same either way up,
 * like a real card.
 */
import { makeRng, type Rng } from '../../core/rng';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface BackDesign {
  latticeLambda: number;
  latticeAmp: number;
  latticeGap: number;
  harmonic: number;
  rotate: boolean;
  lobes: number;
  layers: number;
  rosette: 'hypo' | 'epi' | 'rose';
  ratio: number;
  cornerLobes: number;
  ribbonWaves: number;
}

export function designFromSeed(seed: number): BackDesign {
  const r = makeRng(seed ^ 0xbac4);
  return {
    latticeLambda: r.range(16, 30),
    latticeAmp: r.range(3, 7.5),
    latticeGap: r.range(5.2, 7.4),
    harmonic: r.pick([0, 0.22, 0.35]),
    rotate: r.chance(0.5),
    lobes: 2 * (5 + r.int(8)), // even: 10..24
    layers: 3 + r.int(4),
    rosette: r.pick(['hypo', 'epi', 'rose'] as const),
    ratio: r.range(0.42, 0.78),
    cornerLobes: 2 * (3 + r.int(4)),
    ribbonWaves: 2 * (9 + r.int(8)),
  };
}

function poly(ctx: Ctx, pts: (t: number) => [number, number], steps: number, from = 0, to = Math.PI * 2) {
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const [x, y] = pts(from + ((to - from) * i) / steps);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
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

/** A rosette curve of the chosen family, radius ≈ R, with `lobes` lobes. */
function rosettePoint(kind: BackDesign['rosette'], lobes: number, R: number, ratio: number, phase: number) {
  if (kind === 'rose') {
    return (t: number): [number, number] => {
      const rr = R * (ratio + (1 - ratio) * Math.abs(Math.cos((lobes / 2) * (t + phase))));
      return [rr * Math.cos(t), rr * Math.sin(t)];
    };
  }
  // hypo/epitrochoid with integer lobe count → closes after 2π
  const sgn = kind === 'hypo' ? -1 : 1;
  const r = R / (lobes + 1);
  const big = kind === 'hypo' ? R + r : R - r; // keep outer extent ≈ R
  const d = r * (1 + ratio * 2.2);
  const k = (big + sgn * r) / r;
  const norm = R / (Math.abs(big + sgn * r) + d);
  return (t: number): [number, number] => {
    const a = t + phase;
    const x = (big + sgn * r) * Math.cos(a) - sgn * d * Math.cos(k * a);
    const y = (big + sgn * r) * Math.sin(a) - d * Math.sin(k * a);
    return [x * norm, y * norm];
  };
}

export function drawBack(field: Ctx, accent: Ctx, W: number, H: number, seed: number) {
  const D = designFromSeed(seed);
  const rng: Rng = makeRng(seed ^ 0xfee1);
  const s = W / 400; // design is authored at 400px width
  const m = 22 * s; // white border, like a real back
  const pw = W - 2 * m, ph = H - 2 * m;
  const cx = W / 2, cy = H / 2;

  for (const c of [field, accent]) {
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, H);
  }

  // ---- field: solid ink panel
  field.fillStyle = '#fff';
  roundRect(field, m, m, pw, ph, 10 * s);
  field.fill();

  // ---- lattice knocked out of the field (woven double sinusoids)
  field.save();
  roundRect(field, m + 9 * s, m + 9 * s, pw - 18 * s, ph - 18 * s, 6 * s);
  field.clip();
  field.strokeStyle = '#000';
  field.lineWidth = 0.95 * s;
  field.translate(cx, cy);
  if (D.rotate) field.rotate(Math.PI / 4);
  const ext = Math.hypot(W, H) / 2 + 20 * s;
  const lam = D.latticeLambda * s, amp = D.latticeAmp * s, gap = D.latticeGap * s;
  const wave = (x: number) => Math.sin((2 * Math.PI * x) / lam) + D.harmonic * Math.sin((6 * Math.PI * x) / lam);
  for (const dir of [1, -1]) {
    for (let k = -Math.ceil(ext / gap); k <= Math.ceil(ext / gap); k++) {
      const y0 = k * gap;
      field.beginPath();
      for (let x = -ext; x <= ext; x += 1.5 * s) {
        const y = y0 + dir * amp * wave(x);
        if (x === -ext) field.moveTo(x, y);
        else field.lineTo(x, y);
      }
      field.stroke();
    }
  }
  field.restore();

  // ---- central medallion: paper disc with ink rosette line-work
  const MR = Math.min(pw, ph) * 0.3;
  field.fillStyle = '#000';
  field.beginPath();
  field.ellipse(cx, cy, MR * 1.02, MR * 1.02 * 1.18, 0, 0, Math.PI * 2);
  field.fill();
  field.strokeStyle = '#fff';
  field.lineWidth = 0.85 * s;
  for (let L = 0; L < D.layers; L++) {
    const R = MR * (0.95 - L * (0.5 / D.layers));
    const f = rosettePoint(D.rosette, D.lobes, R, D.ratio, (L * Math.PI) / D.lobes / 1.5);
    field.save();
    field.translate(cx, cy);
    field.scale(1, 1.18);
    poly(field, f, 1400);
    field.stroke();
    // a second, phase-shifted pass gives the meshed "moiré" look
    const g = rosettePoint(D.rosette, D.lobes, R * 0.985, D.ratio, (L * Math.PI) / D.lobes / 1.5 + Math.PI / D.lobes);
    poly(field, g, 1400);
    field.stroke();
    field.restore();
  }

  // ---- corner fans (quarter rosettes), drawn in all four corners → symmetric
  const CR = Math.min(pw, ph) * 0.2;
  const corners: [number, number, number][] = [
    [m + 9 * s, m + 9 * s, 0],
    [W - m - 9 * s, m + 9 * s, Math.PI / 2],
    [W - m - 9 * s, H - m - 9 * s, Math.PI],
    [m + 9 * s, H - m - 9 * s, (3 * Math.PI) / 2],
  ];
  for (const [x, y, rot] of corners) {
    field.save();
    field.translate(x, y);
    field.rotate(rot);
    field.fillStyle = '#000';
    field.beginPath();
    field.moveTo(0, 0);
    field.arc(0, 0, CR, 0, Math.PI / 2);
    field.closePath();
    field.fill();
    field.strokeStyle = '#fff';
    field.lineWidth = 0.8 * s;
    for (let L = 0; L < 4; L++) {
      const f = rosettePoint('rose', D.cornerLobes * 2, CR * (0.92 - L * 0.17), 0.55, (L * Math.PI) / (D.cornerLobes * 2));
      poly(field, f, 500, 0, Math.PI / 2);
      field.stroke();
    }
    field.restore();
    // accent arc
    accent.save();
    accent.translate(x, y);
    accent.rotate(rot);
    accent.strokeStyle = '#fff';
    accent.lineWidth = 1.6 * s;
    accent.beginPath();
    accent.arc(0, 0, CR + 2.5 * s, 0, Math.PI / 2);
    accent.stroke();
    accent.restore();
  }

  // ---- accent: frame with a wave ribbon
  accent.strokeStyle = '#fff';
  accent.lineWidth = 1.4 * s;
  roundRect(accent, m + 3.5 * s, m + 3.5 * s, pw - 7 * s, ph - 7 * s, 8 * s);
  accent.stroke();
  accent.lineWidth = 0.9 * s;
  roundRect(accent, m + 8 * s, m + 8 * s, pw - 16 * s, ph - 16 * s, 6 * s);
  accent.stroke();
  // ribbon between the two frame lines on all four sides (180° symmetric)
  const inset = 5.75 * s, ra = 1.6 * s;
  const sides: [number, number, number, number][] = [
    [m + 16 * s, m + inset, W - m - 16 * s, m + inset],
    [W - m - inset, m + 16 * s, W - m - inset, H - m - 16 * s],
    [W - m - 16 * s, H - m - inset, m + 16 * s, H - m - inset],
    [m + inset, H - m - 16 * s, m + inset, m + 16 * s],
  ];
  accent.lineWidth = 0.7 * s;
  for (const [x1, y1, x2, y2] of sides) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const waves = Math.round((len / (pw + ph)) * D.ribbonWaves * 2);
    for (const ph0 of [0, Math.PI]) {
      accent.beginPath();
      for (let i = 0; i <= 240; i++) {
        const t = i / 240;
        const off = ra * Math.sin(t * waves * Math.PI * 2 + ph0);
        const px = x1 + ux * len * t - uy * off, py = y1 + uy * len * t + ux * off;
        if (i === 0) accent.moveTo(px, py);
        else accent.lineTo(px, py);
      }
      accent.stroke();
    }
  }

  // ---- accent: medallion rings and heart rosette
  accent.save();
  accent.translate(cx, cy);
  accent.scale(1, 1.18);
  accent.lineWidth = 1.5 * s;
  accent.beginPath();
  accent.arc(0, 0, MR * 1.02, 0, Math.PI * 2);
  accent.stroke();
  accent.lineWidth = 0.7 * s;
  accent.beginPath();
  accent.arc(0, 0, MR * 1.07, 0, Math.PI * 2);
  accent.stroke();
  const heart = rosettePoint(D.rosette === 'rose' ? 'hypo' : 'rose', D.lobes / 2, MR * 0.3, 0.5, rng.next() * 0.2);
  accent.lineWidth = 1.0 * s;
  poly(accent, heart, 900);
  accent.stroke();
  accent.beginPath();
  accent.arc(0, 0, MR * 0.06, 0, Math.PI * 2);
  accent.fillStyle = '#fff';
  accent.fill();
  accent.restore();
}
