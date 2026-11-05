/**
 * Shared machinery for trick-taking games: suit following, trumps, trick
 * winners, a pause to show each finished trick, card-choosing heuristics for
 * the CPU, and the standard table views (hands, trick, won piles).
 */
import { code, hi, sortHand, type Card, type Suit } from '../../core/cards';
import type { Action, CardView, FxEvent, Seat, View, Zone } from '../../core/types';

export interface Played {
  seat: Seat;
  card: Card;
}

export interface TrickBase {
  n: number;
  names: string[];
  cpu: boolean[];
  hands: Card[][];
  trick: Played[];
  lastTrick: Played[];
  leader: Seat;
  turn: Seat;
  won: Card[][];
  tricks: number[];
  trump: Suit | null;
  dealer: Seat;
  deal: number;
  fx: FxEvent[];
  fxn: number;
  log: string[];
  /** seat that won the trick being shown (pause before collecting) */
  collecting: Seat | null;
}

export const fx = (s: { fx: FxEvent[]; fxn: number }, k: string) => {
  s.fx.push({ n: ++s.fxn, k });
  if (s.fx.length > 12) s.fx.shift();
};
export const log = (s: { log: string[] }, m: string) => {
  s.log.push(m);
  if (s.log.length > 80) s.log.shift();
};

/** Effective suit (Euchre's left bower belongs to trump). */
export type SuitOf = (c: Card) => Suit;
/** Card strength within the trick: higher wins. */
export type Power = (c: Card, lead: Suit, trump: Suit | null) => number;

export const plainSuit: SuitOf = (c) => c.s;
export const plainPower: Power = (c, lead, trump) => (trump && c.s === trump ? 100 + hi(c) : c.s === lead ? hi(c) : 0);

export function trickWinner(trick: Played[], trump: Suit | null, power: Power = plainPower, suitOf: SuitOf = plainSuit): Played {
  const lead = suitOf(trick[0].card);
  return trick.reduce((best, p) => {
    const pc = power(p.card, lead, trump), pb = power(best.card, lead, trump);
    // power() is computed against the led suit; off-suit non-trumps are 0
    const ps = suitOf(p.card) === lead || (trump && suitOf(p.card) === trump) ? pc : 0;
    const bs = suitOf(best.card) === lead || (trump && suitOf(best.card) === trump) ? pb : 0;
    return ps > bs ? p : best;
  });
}

/** Cards in hand that may legally be played to this trick. */
export function followable(hand: Card[], trick: Played[], suitOf: SuitOf = plainSuit): Card[] {
  if (!trick.length) return hand;
  const lead = suitOf(trick[0].card);
  const same = hand.filter((c) => suitOf(c) === lead);
  return same.length ? same : hand;
}

export function nextSeat(s: { n: number }, i: Seat, skip?: (j: Seat) => boolean) {
  for (let k = 1; k <= s.n; k++) {
    const j = (i + k) % s.n;
    if (!skip?.(j)) return j;
  }
  return i;
}

/** Deal `count` cards each starting left of the dealer, one at a time. */
export function dealRound(deck: Card[], n: number, dealer: Seat, count: number): Card[][] {
  const hands: Card[][] = Array.from({ length: n }, () => []);
  for (let r = 0; r < count; r++) for (let k = 1; k <= n; k++) hands[(dealer + k) % n].push(deck.pop()!);
  return hands;
}

export const SUIT_ORDER_ALT: Suit[] = ['S', 'H', 'C', 'D'];

/** Sort a hand with trumps last and colours alternating. */
export function sortForView(hand: Card[], trump: Suit | null, power?: (c: Card) => number) {
  const order = trump ? [...SUIT_ORDER_ALT.filter((x) => x !== trump), trump] : SUIT_ORDER_ALT;
  if (!power) return sortHand(hand, { suitOrder: order });
  return [...hand].sort((a, b) => order.indexOf(a.s) - order.indexOf(b.s) || power(a) - power(b));
}

// ---------------------------------------------------------------- CPU

export interface ChooseOpts {
  trump: Suit | null;
  power?: Power;
  suitOf?: SuitOf;
  /** true = try to take this trick, false = try to lose it */
  wantWin: boolean;
  partner?: Seat;
  seat: Seat;
  n: number;
}

/** A sensible card for a trick, given whether we want to win it. */
export function chooseCard(legal: Card[], trick: Played[], o: ChooseOpts): Card {
  const power = o.power ?? plainPower;
  const suitOf = o.suitOf ?? plainSuit;
  const strength = (c: Card) => power(c, suitOf(c), o.trump) + (o.trump && suitOf(c) === o.trump ? 0 : 0);
  const byLow = [...legal].sort((a, b) => strength(a) - strength(b));
  if (!trick.length) {
    if (o.wantWin) {
      // lead a high non-trump if we have one, else our best card
      const nonTrump = byLow.filter((c) => !o.trump || suitOf(c) !== o.trump);
      const aces = nonTrump.filter((c) => hi(c) === 14);
      return aces[0] ?? (nonTrump.length ? nonTrump[nonTrump.length - 1] : byLow[byLow.length - 1]);
    }
    const nonTrump = byLow.filter((c) => !o.trump || suitOf(c) !== o.trump);
    return nonTrump[0] ?? byLow[0];
  }
  const lead = suitOf(trick[0].card);
  const best = trickWinner(trick, o.trump, power, suitOf);
  const wouldWin = (c: Card) => trickWinner([...trick, { seat: o.seat, card: c }], o.trump, power, suitOf).card === c;
  const partnerWinning = o.partner != null && best.seat === o.partner;
  const lastToPlay = trick.length === o.n - 1;
  const winners = byLow.filter(wouldWin);
  const losers = byLow.filter((c) => !wouldWin(c));
  if (o.wantWin && !partnerWinning) {
    if (winners.length) return lastToPlay ? winners[0] : winners[winners.length > 1 && !lastToPlay ? 0 : 0];
    return dumpLow(losers.length ? losers : byLow, lead, suitOf, o.trump);
  }
  // happy to lose (or partner is winning): throw the highest card that still loses
  if (losers.length) {
    const sameSuit = losers.filter((c) => suitOf(c) === lead);
    return (sameSuit.length ? sameSuit : losers)[(sameSuit.length ? sameSuit : losers).length - 1];
  }
  return lastToPlay ? byLow[byLow.length - 1] : byLow[0];
}

function dumpLow(cards: Card[], _lead: Suit, suitOf: SuitOf, trump: Suit | null) {
  const nonTrump = cards.filter((c) => !trump || suitOf(c) !== trump);
  const pool = nonTrump.length ? nonTrump : cards;
  return [...pool].sort((a, b) => hi(a) - hi(b))[0];
}

// ---------------------------------------------------------------- views

export interface ViewOpts {
  playable?: Card[]; // viewer's legal plays (only when it's their turn)
  selectable?: boolean;
  handPower?: (c: Card) => number;
  extraZones?: Zone[];
  trickAt?: { x: number; y: number };
  showWonPiles?: boolean;
}

export function trickZones(s: TrickBase, viewer: Seat, o: ViewOpts = {}): Zone[] {
  const zones: Zone[] = [];
  for (let i = 0; i < s.n; i++) {
    const mine = i === viewer;
    const hand = mine ? sortForView(s.hands[i], s.trump, o.handPower) : s.hands[i];
    zones.push({
      id: 'h' + i,
      at: { seat: i, slot: 'hand' },
      lay: 'fan',
      cards: hand.map(
        (c): CardView => ({
          id: c.id,
          f: mine ? code(c) : undefined,
          act: mine && o.playable?.includes(c) ? { t: 'play', card: c.id } : undefined,
          sel: mine && o.selectable ? true : undefined,
          dim: mine && o.playable && o.playable.length > 0 && !o.playable.includes(c) ? true : undefined,
        }),
      ),
    });
  }
  const shown = s.trick.length ? s.trick : [];
  zones.push({
    id: 'trick',
    at: o.trickAt ?? { x: 0, y: -0.04 },
    lay: 'trick',
    cards: shown.map((p) => ({ id: p.card.id, f: code(p.card), from: p.seat, hi: s.collecting != null && p.seat === s.collecting })),
  });
  if (o.showWonPiles !== false) {
    for (let i = 0; i < s.n; i++) {
      if (!s.won[i].length) continue;
      zones.push({
        id: 'won' + i,
        at: { seat: i, slot: 'front' },
        lay: 'stack',
        scale: 0.6,
        cards: s.won[i].slice(-4).map((c, k) => ({ id: c.id, rot: ((k * 47 + i * 13) % 17) - 8 })),
      });
    }
  }
  return [...zones, ...(o.extraZones ?? [])];
}

export function playAction(a: Action, hand: Card[]): Card | null {
  if (a.t !== 'play') return null;
  return hand.find((c) => c.id === a.card) ?? null;
}

export const SUIT_WORD: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export function baseView(s: TrickBase, viewer: Seat, game: string, extra: Partial<View>): View {
  return {
    game,
    viewer,
    seats: [],
    zones: [],
    buttons: [],
    deal: s.deal,
    dealer: s.dealer,
    fx: s.fx,
    log: s.log.slice(-40),
    ...extra,
  };
}
