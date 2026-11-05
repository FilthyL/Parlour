/** Small helpers shared by the shedding and family games. */
import { code, sortHand, type Card } from '../core/cards';
import type { Action, CardView, FxEvent, Seat, Zone } from '../core/types';

export interface Base {
  n: number;
  names: string[];
  cpu: boolean[];
  deal: number;
  fx: FxEvent[];
  fxn: number;
  log: string[];
}

export const fx = (s: { fx: FxEvent[]; fxn: number }, k: string) => {
  s.fx.push({ n: ++s.fxn, k });
  if (s.fx.length > 12) s.fx.shift();
};
export const log = (s: { log: string[] }, m: string) => {
  s.log.push(m);
  if (s.log.length > 80) s.log.shift();
};

export function base(players: { name: string; kind: string }[]): Base {
  return { n: players.length, names: players.map((p) => p.name), cpu: players.map((p) => p.kind === 'cpu'), deal: 0, fx: [], fxn: 0, log: [] };
}

export const humans = (s: Base) => s.names.map((_, i) => i).filter((i) => !s.cpu[i]);

export function handZone(
  seat: Seat,
  viewer: Seat,
  hand: Card[],
  o: { act?: (c: Card) => Action | undefined; sel?: boolean; reveal?: boolean; sort?: boolean; hi?: (c: Card) => boolean; dim?: (c: Card) => boolean; aceHigh?: boolean } = {},
): Zone {
  const mine = seat === viewer;
  const cards = mine && o.sort !== false ? sortHand(hand, { aceHigh: o.aceHigh ?? true }) : hand;
  return {
    id: 'h' + seat,
    at: { seat, slot: 'hand' },
    lay: 'fan',
    cards: cards.map(
      (c): CardView => ({
        id: c.id,
        f: mine || o.reveal ? code(c) : undefined,
        act: o.act?.(c),
        sel: mine && o.sel ? true : undefined,
        hi: o.hi?.(c),
        dim: o.dim?.(c),
      }),
    ),
  };
}

export function stackZone(id: string, cards: Card[], at: Zone['at'], o: { faceUp?: boolean; deck?: boolean; act?: Action; scale?: number; label?: string; top?: number } = {}): Zone {
  const show = cards.slice(-(o.top ?? 6));
  return {
    id,
    at,
    lay: 'stack',
    deck: o.deck,
    act: o.act,
    scale: o.scale,
    count: cards.length,
    label: o.label,
    cards: show.map((c) => ({ id: c.id, f: o.faceUp ? code(c) : undefined, rot: o.faceUp ? ((c.id.charCodeAt(c.id.length - 1) % 9) - 4) * 1.6 : 0 })),
  };
}

export const rankWord = (r: number, plural = false) => {
  const w = ({ 1: 'Ace', 11: 'Jack', 12: 'Queen', 13: 'King' } as Record<number, string>)[r] ?? String(r);
  return plural ? (r === 6 ? 'Sixes' : `${w}s`) : w;
};
