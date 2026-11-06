/**
 * Table geometry: seats on a squircle ring (the viewer always at the bottom,
 * play passing clockwise to their left), anchor points per seat, and the
 * card transforms for each zone layout.
 */
import type { Anchor, CardView, Zone } from '../core/types';
import { superPoint } from './plate';

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
  /** half-sizes of the seat ring (zones use these as table units) */
  rx: number;
  ry: number;
  cw: number;
  ch: number;
  portrait: boolean;
  /** the plate (the playing surface) in px */
  plate: { x: number; y: number; w: number; h: number };
  seats: SeatGeo[];
}

export const CARD_RATIO = 581 / 400;
const RING_N = 4; // seats sit on a squircle, the same curve as the plate

export function computeGeo(W: number, H: number, n: number, viewer: number, opts: { topPad: number; actionH: number }): Geo {
  const portrait = H > W * 1.05;
  // the board dominates; cards are deliberately small against it
  const cw = Math.max(34, Math.min(portrait ? W * 0.1 : W * 0.046, H * (portrait ? 0.07 : 0.082), 80));
  const ch = cw * CARD_RATIO;
  // on phones your own hand stays readable while the board still dominates
  const handScale = portrait ? 1.6 : 1.22;
  const margin = Math.max(10, Math.min(W, H) * 0.018);
  // the plate runs full height; the seat ring lives above the player's hand
  const plate = { x: margin, y: opts.topPad + 2, w: W - margin * 2, h: H - opts.topPad - 2 - margin };
  const cx = W / 2;
  const handY = H - opts.actionH - ch * handScale * 0.5 - 6;
  const top = plate.y + ch * 0.5;
  const bottom = handY + ch * 0.08;
  const cy = (top + bottom) / 2;
  const ry = ((bottom - top) / 2) * 0.92;
  const rx = (plate.w / 2) * (portrait ? 0.64 : 0.85);
  const seats: SeatGeo[] = [];
  for (let i = 0; i < n; i++) {
    const k = (i - viewer + n) % n;
    // opponents spread evenly over the arc above you, leaving a gap round your hand
    const gap = ((portrait ? 42 : 30) * Math.PI) / 180;
    const ang = k === 0 ? Math.PI / 2 : Math.PI / 2 + gap + ((2 * Math.PI - 2 * gap) * (k - 0.5)) / (n - 1);
    const onRing = (f: number) => {
      const [x, y] = superPoint(ang, rx * f, ry * f, RING_N);
      return { x: cx + x, y: cy + y };
    };
    if (k === 0) {
      seats.push({
        k,
        ang,
        plaque: portrait ? { x: Math.min(W * 0.17, 66), y: handY + ch * handScale * 0.32 } : { x: plate.x + Math.max(84, plate.w * 0.075), y: handY + ch * handScale * 0.18 },
        hand: { x: cx, y: handY },
        handScale,
        front: onRing(0.5),
        bet: onRing(0.46),
        side: { x: cx + cw * 3.4, y: handY },
        meld: onRing(0.55),
      });
    } else {
      seats.push({
        k,
        ang,
        plaque: onRing(1.0),
        hand: onRing(0.8),
        handScale: portrait ? 0.56 : 0.62,
        front: onRing(0.58),
        bet: onRing(0.56),
        side: onRing(0.92),
        meld: onRing(0.56),
      });
    }
  }
  return { W, H, cx, cy, rx, ry, cw, ch, portrait, plate, seats };
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
      for (let i = 0; i < n; i++) {
        const c = z.cards[i];
        const slot = c.pos != null ? c.pos - (z.center ?? (slots - 1) / 2) : i - (slots - 1) / 2;
        out.push({ card: c, pose: { x: p.x + slot * gap, y: p.y, rot: c.rot ?? 0, scale, z: zBase + (c.pos ?? i) } });
      }
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
    const c0 = z.center ?? (slots - 1) / 2;
    return { x: p.x - c0 * gap - cw / 2, y: p.y - ch / 2, w: (slots - 1) * gap + cw, h: ch, cw, ch, slots, gap };
  }
  return { x: p.x - cw / 2, y: p.y - ch / 2, w: cw, h: ch, cw, ch, slots: 1, gap: 0 };
}
