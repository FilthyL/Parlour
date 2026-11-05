import { describe, expect, it } from 'vitest';
import { simulate } from '../src/core/runner';
import { crazy8 } from '../src/games/crazy8';
import { gofish } from '../src/games/gofish';
import { oldmaid } from '../src/games/oldmaid';
import { war } from '../src/games/war';

describe('Crazy Eights', () => {
  for (const n of [2, 4, 7]) it(`${n} players play to 100`, () => {
    const { state } = simulate(crazy8, n, 70 + n, { onStep: (st) => expect(st.hands.flat().length + st.stock.length + st.pile.length).toBe(52) });
    expect(Math.max(...state.scores)).toBeGreaterThanOrEqual(100);
  });
});

describe('Go Fish', () => {
  for (const n of [2, 3, 6]) it(`${n} players make all 13 books`, () => {
    const { state } = simulate(gofish, n, 80 + n, {
      onStep: (st) => expect(st.hands.flat().length + st.stock.length + st.books.flat().flat().length).toBe(52),
    });
    expect(state.books.reduce((a: number, b: any[]) => a + b.length, 0)).toBe(13);
  });
});

describe('Old Maid', () => {
  for (const n of [2, 4, 6]) it(`${n} players: one queen is left`, () => {
    const { state } = simulate(oldmaid, n, 90 + n, { onStep: (st) => expect(st.hands.flat().length + st.pairs.length).toBe(51) });
    const left = state.hands.flat();
    expect(left.length).toBe(1);
    expect(left[0].r).toBe(12);
  });
});

describe('War', () => {
  it('short game ends after the battle limit or a sweep', () => {
    const { state } = simulate(war, 2, 5, {
      onStep: (st) => expect(st.piles.flat().length + st.table.reduce((a: number, t: any) => a + t.down.length + t.up.length, 0)).toBe(52),
    });
    expect(state.phase).toBe('over');
  });
  it('long game runs to a sweep', () => {
    const { state } = simulate(war, 2, 6, { options: { limit: 0 } });
    expect(state.piles.some((p: any[]) => p.length === 52)).toBe(true);
  });
});
