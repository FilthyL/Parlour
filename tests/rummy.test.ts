import { describe, expect, it } from 'vitest';
import { simulate } from '../src/core/runner';
import { bestMelds, isRun, isSet, layOffAll } from '../src/core/util/melds';
import { gin } from '../src/games/gin';
import { rummy } from '../src/games/rummy';
import type { Card } from '../src/core/cards';

let k = 0;
const C = (s: string): Card => {
  const r = s.slice(0, -1), suit = s.slice(-1) as Card['s'];
  return { id: `${s}#${k++}`, r: r === 'A' ? 1 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : Number(r), s: suit };
};
const H = (...x: string[]) => x.map(C);

describe('melds', () => {
  it('recognises sets and runs (ace low)', () => {
    expect(isSet(H('7S', '7H', '7D'))).toBe(true);
    expect(isSet(H('7S', '7S', '7D'))).toBe(false);
    expect(isRun(H('AS', '2S', '3S'))).toBe(true);
    expect(isRun(H('QS', 'KS', 'AS'))).toBe(false);
    expect(isRun(H('4H', '6H', '5H'))).toBe(true);
  });
  it('finds the arrangement with least deadwood', () => {
    // 7-7-7 set vs 5-6-7 run overlap: best uses both via the other sevens
    const a = bestMelds(H('5H', '6H', '7H', '7S', '7D', '7C', 'KS', 'QD', '2C', '3D'));
    expect(a.dw).toBe(10 + 10 + 2 + 3);
    const g = bestMelds(H('AS', '2S', '3S', '4S', '9H', '9D', '9C', 'JH', 'QH', 'KH'));
    expect(g.dw).toBe(0);
  });
  it('lays off in chains', () => {
    const r = layOffAll([H('5C', '6C', '7C')], H('8C', '9C', 'KD'));
    expect(r.laid.length).toBe(2);
    expect(r.rest.length).toBe(1);
  });
});

describe('Gin Rummy', () => {
  for (const seed of [1, 2, 3]) it(`plays to 100 (seed ${seed}) with 52 cards always accounted for`, () => {
    const { state } = simulate(gin, 2, seed, { onStep: (st) => expect(st.hands.flat().length + st.stock.length + st.pile.length).toBe(52) });
    expect(Math.max(...state.scores)).toBeGreaterThanOrEqual(100);
  });
});

describe('Rummy', () => {
  for (const n of [2, 4, 6]) it(`${n} players play to 100`, () => {
    const { state } = simulate(rummy, n, 50 + n, {
      onStep: (st) => {
        const total = st.hands.flat().length + st.stock.length + st.pile.length + st.melds.reduce((a: number, m: any) => a + m.cards.length, 0);
        expect(total).toBe(52);
        for (const m of st.melds) expect(isSet(m.cards) || isRun(m.cards)).toBe(true);
      },
    });
    expect(Math.max(...state.scores)).toBeGreaterThanOrEqual(100);
  });
});
