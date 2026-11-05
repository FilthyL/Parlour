import type { Rng } from './rng';

export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

/** r: 1 (ace) … 13 (king) */
export interface Card {
  id: string;
  r: number;
  s: Suit;
}

export const code = (c: Card) => RANK_LABELS[c.r - 1] + c.s;
export const isRedSuit = (s: Suit) => s === 'H' || s === 'D';
export const rankName = (r: number) =>
  ({ 1: 'Ace', 11: 'Jack', 12: 'Queen', 13: 'King' } as Record<number, string>)[r] ?? String(r);
export const rankPlural = (r: number) => (r === 6 ? 'Sixes' : rankName(r) + 's');
export const label = (c: Card) => RANK_LABELS[c.r - 1] + SUIT_SYMBOL[c.s];

let deal = 0;
/**
 * A freshly shuffled deck (or shoe). Card ids are assigned *after* the
 * shuffle and are unique per deal, so an id reveals nothing about the card.
 */
export function newDeck(rng: Rng, opts: { decks?: number; ranks?: number[]; exclude?: (c: { r: number; s: Suit }) => boolean } = {}): Card[] {
  const ranks = opts.ranks ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const out: { r: number; s: Suit }[] = [];
  for (let d = 0; d < (opts.decks ?? 1); d++)
    for (const s of SUITS) for (const r of ranks) if (!opts.exclude?.({ r, s })) out.push({ r, s });
  rng.shuffle(out);
  const tag = (++deal).toString(36) + rng.int(1e6).toString(36);
  return out.map((c, i) => ({ id: `${tag}.${i}`, r: c.r, s: c.s }));
}

/** Ace-high value (2…14). */
export const hi = (c: Card) => (c.r === 1 ? 14 : c.r);

export function sortHand(cards: Card[], opts: { aceHigh?: boolean; suitOrder?: Suit[] } = {}) {
  const order = opts.suitOrder ?? ['S', 'H', 'C', 'D'];
  const v = (c: Card) => (opts.aceHigh === false ? c.r : hi(c));
  return [...cards].sort((a, b) => order.indexOf(a.s) - order.indexOf(b.s) || v(a) - v(b));
}
