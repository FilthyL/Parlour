/**
 * The playing surface: a squircle "test plate" (a superellipse, the same
 * curve as the card backs' contour bands) with concentric contour lines.
 * A few of the lines are dashed and drift slowly, like dye in a water tunnel.
 */

/** A point on a superellipse of half-sizes a, b with exponent n at angle t. */
export function superPoint(t: number, a: number, b: number, n = 4): [number, number] {
  const c = Math.cos(t), s = Math.sin(t);
  return [a * Math.sign(c) * Math.abs(c) ** (2 / n), b * Math.sign(s) * Math.abs(s) ** (2 / n)];
}

export function squirclePath(cx: number, cy: number, a: number, b: number, n = 4, steps = 180) {
  let d = '';
  for (let i = 0; i < steps; i++) {
    const [x, y] = superPoint((i / steps) * Math.PI * 2, a, b, n);
    d += `${i ? 'L' : 'M'}${(cx + x).toFixed(1)} ${(cy + y).toFixed(1)}`;
  }
  return d + 'Z';
}

/** SVG markup for a plate filling a w × h box. */
export function plateSVG(w: number, h: number, o: { lines?: number; n?: number } = {}) {
  const n = o.n ?? 4.2;
  const cx = w / 2, cy = h / 2;
  const a = w / 2 - 2, b = h / 2 - 2;
  const lines = o.lines ?? 9;
  const contour: string[] = [];
  for (let k = 1; k <= lines; k++) {
    // bands tighten toward the middle, like contours round a stagnation point
    const f = 1 - (k / (lines + 1)) ** 0.85 * 0.92;
    const cls = k % 3 === 0 ? 'drift' : k % 3 === 1 ? 'line strong' : 'line';
    contour.push(`<path class="${cls}" style="--k:${k}" d="${squirclePath(cx, cy, a * f, b * (f * 0.94 + 0.06 * f * f), n)}"/>`);
  }
  return `<svg class="plate-svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" aria-hidden="true" preserveAspectRatio="none">
    <path class="plate-fill" d="${squirclePath(cx, cy, a, b, n)}"/>
    <g class="contours">${contour.join('')}</g>
    <path class="plate-edge" d="${squirclePath(cx, cy, a, b, n)}"/>
  </svg>`;
}
