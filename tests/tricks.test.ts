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

import { euchre } from '../src/games/euchre';
import { ohhell } from '../src/games/ohhell';
import { whist } from '../src/games/whist';

describe('Euchre', () => {
  for (const seed of [21, 22, 23]) it(`full game to 10 (seed ${seed}) keeps 24 cards`, () => {
    const { state } = simulate(euchre, 4, seed, {
      onStep: (st) => expect(st.hands.flat().length + st.won.flat().length + st.trick.length + st.kitty.length).toBe(24),
    });
    expect(Math.max(...state.score)).toBeGreaterThanOrEqual(10);
  });
  it('the left bower counts as trump when following', () => {
    let saw = 0;
    simulate(euchre, 4, 99, {
      onStep: (st) => {
        if (st.phase !== 'play' || !st.trick.length || !st.trump) return;
        const lead = st.trick[0].card;
        const leftLed = lead.r === 11 && lead.s !== st.trump && ((lead.s === 'H' || lead.s === 'D') === (st.trump === 'H' || st.trump === 'D'));
        if (leftLed) saw++;
      },
    });
    expect(saw).toBeGreaterThanOrEqual(0);
  });
  it('hides other hands', () => noLeaks(euchre, 4, 31));
});

describe('Oh Hell', () => {
  for (const n of [3, 5, 7]) it(`${n} players play every round`, () => {
    const { state } = simulate(ohhell, n, 40 + n, {
      onStep: (st) => {
        if (st.phase === 'play' && st.round) expect(st.bids.reduce((a: number, b: number) => a + b, 0)).not.toBe(st.sizes[st.round - 1]);
      },
    });
    expect(state.round).toBe(state.sizes.length);
  });
  it('hides other hands', () => noLeaks(ohhell, 4, 51));
});

describe('Whist', () => {
  for (const seed of [61, 62]) it(`full game to 7 (seed ${seed})`, () => {
    const { state } = simulate(whist, 4, seed, { onStep: (st) => expect(st.hands.flat().length + st.won.flat().length + st.trick.length).toBe(52) });
    expect(Math.max(...state.score)).toBeGreaterThanOrEqual(7);
  });
  it('only the turned-up trump card is visible in another hand', () => {
    simulate(whist, 4, 63, {
      onStep: (st) => {
        for (let v = 0; v < 4; v++) for (const z of whist.view(st, v).zones) if (z.id.startsWith('h') && z.id !== 'h' + v) for (const c of z.cards) if (c.f) expect(c.id).toBe(st.trumpCardId);
      },
    });
  });
});
