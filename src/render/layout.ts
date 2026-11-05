/**
 * Table geometry: seats on an ellipse (the viewer always at the bottom,
 * play passing clockwise to their left), anchor points per seat, and the
 * card transforms for each zone layout.
 */
import type { Anchor, CardView, Zone } from '../core/types';

export interface Pt {
  x: number;
  y: number;
}
export interface Pose {
  x: number;
  y: number;
  rot: number;
  scale: number;
  z: number;
}

export interface SeatGeo {
  k: number; // position index relative to the viewer (0 = viewer)
  ang: number; // radians, screen coords (π/2 = bottom)
  plaque: Pt;
  hand: Pt;
  handScale: number;
  front: Pt;
  bet: Pt;
  side: Pt;
  meld: Pt;
}

export interface Geo {
  W: number;
  H: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  cw: number;
  ch: number;
  portrait: boolean;
  seats: SeatGeo[];
}

export const CARD_RATIO = 581 / 400;

export function computeGeo(W: number, H: number, n: number, viewer: number, opts: { topPad: number; actionH: number }): Geo {
  const portrait = H > W * 1.05;
  const cw = Math.max(38, Math.min(portrait ? W * 0.125 : W * 0.06, H * 0.105, 100));
  const ch = cw * CARD_RATIO;
  const handScale = portrait ? 1.12 : 1.28;
  const handY = H - opts.actionH - ch * handScale * 0.5 - 6;
  const top = opts.topPad + ch * 0.35;
  const bottom = handY + ch * 0.12;
  const cx = W / 2;
  const cy = (top + bottom) / 2;
  const ry = ((bottom - top) / 2) * 0.94;
  const rx = portrait ? W * 0.43 : Math.min(W * 0.43, ry * 2.05);
  const seats: SeatGeo[] = [];
  for (let i = 0; i < n; i++) {
    const k = (i - viewer + n) % n;
    const ang = Math.PI / 2 + (k * 2 * Math.PI) / n;
    const ex = Math.cos(ang), ey = Math.sin(ang);
    const onRail = (f: number) => ({ x: cx + ex * rx * f, y: cy + ey * ry * f });
    if (k === 0) {
      seats.push({
        k,
        ang,
        plaque: portrait ? { x: Math.min(W * 0.2, 90), y: handY - ch * handScale * 0.62 } : { x: Math.max(100, cx - Math.min(W * 0.3, cw * handScale * 3.6)), y: handY - ch * handScale * 0.5 - 30 },
        hand: { x: cx, y: handY },
        handScale,
        front: onRail(0.6),
        bet: onRail(0.58),
        side: { x: cx + cw * 3.4, y: handY },
        meld: onRail(0.66),
      });
    } else {
      seats.push({
        k,
        ang,
        plaque: onRail(1.0),
        hand: onRail(0.78),
        handScale: portrait ? 0.52 : 0.58,
        front: onRail(0.6),
        bet: onRail(0.6),
        side: onRail(0.92),
        meld: onRail(0.58),
      });
    }
  }
  return { W, H, cx, cy, rx, ry, cw, ch, portrait, seats };
}

export function anchorPt(g: Geo, a: Anchor): { p: Pt; seat?: SeatGeo; slot?: string } {
  if ('seat' in a) {
    const s = g.seats[a.seat];
    if (!s) return { p: { x: g.cx, y: g.cy } };
    let p = s[a.slot as keyof SeatGeo] as Pt;
    if (a.n && a.n > 1 && a.i != null) {
      // several zones on one seat (split hands): spread them along the rail
      const sc = a.slot === 'hand' ? s.handScale : 1;
      const step = g.cw * sc * (s.k === 0 ? 2.1 : 1.7);
      const tx = -Math.sin(s.ang), ty = Math.cos(s.ang);
      const off = (a.i - (a.n - 1) / 2) * step;
      p = { x: p.x - tx * off, y: p.y - ty * off };
    }
    return { p, seat: s, slot: a.slot };
  }
  const [x, y] = g.portrait && a.p ? a.p : [a.x, a.y];
  return { p: { x: g.cx + x * g.rx, y: g.cy + y * g.ry } };
}

/** Card poses for one zone. */
export function zonePoses(g: Geo, z: Zone): { card: CardView; pose: Pose }[] {
  const { p, seat, slot } = anchorPt(g, z.at);
  const isViewerHand = seat?.k === 0 && slot === 'hand';
  const scale = (z.scale ?? 1) * (slot === 'hand' ? seat!.handScale : seat && slot === 'front' ? (seat.k === 0 ? 1 : 0.78) : 1);
  const cw = g.cw * scale, ch = g.ch * scale;
  const n = z.cards.length;
  const out: { card: CardView; pose: Pose }[] = [];
  const zBase = isViewerHand ? 600 : 100;
  switch (z.lay) {
    case 'fan': {
      const maxW = isViewerHand ? Math.min(g.W * 0.92, cw * 9) : cw * 2.4;
      const step = n > 1 ? Math.min(isViewerHand ? cw * 0.62 : cw * 0.32, (maxW - cw) / (n - 1)) : 0;
      const spread = isViewerHand ? Math.min(22, n * 2.2) : Math.min(12, n * 3);
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) - 0.5 : 0;
        const rot = t * spread;
        const lift = isViewerHand ? -Math.abs(t) * Math.abs(t) * ch * 0.18 * -1 : 0;
        out.push({
          card: z.cards[i],
          pose: { x: p.x + (i - (n - 1) / 2) * step, y: p.y + lift + (isViewerHand ? Math.abs(t) * ch * 0.06 : 0), rot, scale, z: zBase + i },
        });
      }
      break;
    }
    case 'row': {
      const gap = (z.gap ?? 1.08) * cw;
      const slots = Math.max(n, z.slots ?? 0);
      for (let i = 0; i < n; i++) out.push({ card: z.cards[i], pose: { x: p.x + (i - (slots - 1) / 2) * gap, y: p.y, rot: 0, scale, z: zBase + i } });
      break;
    }
    case 'stack': {
      for (let i = 0; i < n; i++) {
        const c = z.cards[i];
        const d = (i - (n - 1)) * 0.6;
        out.push({ card: c, pose: { x: p.x + d * 0.4, y: p.y + d, rot: c.rot ?? 0, scale, z: zBase + i } });
      }
      break;
    }
    case 'trick': {
      for (let i = 0; i < n; i++) {
        const c = z.cards[i];
        const s = c.from != null ? g.seats[c.from] : undefined;
        const ang = s ? s.ang : Math.PI / 2;
        out.push({
          card: c,
          pose: { x: p.x + Math.cos(ang) * cw * 0.62, y: p.y + Math.sin(ang) * ch * 0.42, rot: c.rot ?? ((i * 37) % 11) - 5, scale, z: zBase + i },
        });
      }
      break;
    }
    case 'grid': {
      const cols = z.cols ?? 3;
      const rows = Math.ceil(n / cols);
      const gx = cw * (z.gap ?? 1.06), gy = ch * (z.gap ?? 1.06);
      for (let i = 0; i < n; i++) {
        const c = i % cols, r = Math.floor(i / cols);
        out.push({ card: z.cards[i], pose: { x: p.x + (c - (cols - 1) / 2) * gx, y: p.y + (r - (rows - 1) / 2) * gy, rot: 0, scale, z: zBase + i } });
      }
      break;
    }
    case 'column': {
      const step = ch * (z.gap ?? 0.26);
      for (let i = 0; i < n; i++) out.push({ card: z.cards[i], pose: { x: p.x, y: p.y + i * step, rot: 0, scale, z: zBase + i } });
      break;
    }
  }
  return out;
}

export function zoneBox(g: Geo, z: Zone) {
  const { p, seat, slot } = anchorPt(g, z.at);
  const scale = (z.scale ?? 1) * (slot === 'hand' ? seat!.handScale : 1);
  const cw = g.cw * scale, ch = g.ch * scale;
  if (z.lay === 'row') {
    const slots = Math.max(z.cards.length, z.slots ?? 0, 1);
    const gap = (z.gap ?? 1.08) * cw;
    return { x: p.x - ((slots - 1) / 2) * gap - cw / 2, y: p.y - ch / 2, w: (slots - 1) * gap + cw, h: ch, cw, ch, slots, gap };
  }
  return { x: p.x - cw / 2, y: p.y - ch / 2, w: cw, h: ch, cw, ch, slots: 1, gap: 0 };
}
