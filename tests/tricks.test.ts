import { describe, expect, it } from 'vitest';
import { simulate } from '../src/core/runner';
import { hearts } from '../src/games/hearts';
import { spades } from '../src/games/spades';

function noLeaks(def: any, n: number, seed: number) {
  let checked = 0;
  simulate(def, n, seed, {
    onStep: (st) => {
      for (let v = 0; v < n; v++) {
        for (const z of def.view(st, v).zones) {
          if (z.id.startsWith('h') && z.id !== 'h' + v) for (const c of z.cards) { expect(c.f).toBeUndefined(); checked++; }
        }
      }
    },
  });
  expect(checked).toBeGreaterThan(100);
}

describe('Hearts', () => {
  for (const seed of [1, 2, 3]) it(`full game to 100 (seed ${seed}) keeps 52 cards and 26 points a hand`, () => {
    const { state } = simulate(hearts, 4, seed, {
      onStep: (st) => {
        const cards = st.hands.flat().length + st.won.flat().length + st.trick.length + (st.phase === 'pass' ? st.passes.filter(Boolean).flat().length : 0);
        expect(cards).toBe(52);
      },
    });
    expect(Math.max(...state.scores)).toBeGreaterThanOrEqual(100);
    expect(state.scores.reduce((a: number, b: number) => a + b, 0) % 26).toBe(0);
  });
  it('hides other hands', () => noLeaks(hearts, 4, 11));
});

describe('Spades', () => {
  for (const seed of [4, 5]) it(`full game to 500 (seed ${seed})`, () => {
    const { state } = simulate(spades, 4, seed, {
      onStep: (st) => expect(st.hands.flat().length + st.won.flat().length + st.trick.length).toBe(52),
    });
    expect(state.phase).toBe('over');
    expect(Math.max(...state.score) >= 500 || Math.min(...state.score) <= -200).toBe(true);
  });
  it('hides other hands', () => noLeaks(spades, 4, 12));
});
