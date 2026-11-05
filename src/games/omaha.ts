import type { GameDef } from '../core/types';
import { createPoker, pokerAct, pokerAuto, pokerCpu, pokerStep, pokerToAct, pokerView, type PokerState } from './poker/engine';

const cfg = { variant: 'omaha' as const, holeCards: 4, limit: 'PL' as const, label: 'Pot-limit Omaha' };

export const omaha: GameDef<PokerState> = {
  meta: {
    id: 'omaha',
    name: 'Omaha',
    family: 'Poker',
    players: { min: 2, max: 9, def: 6 },
    blurb: "Four hole cards, use exactly two. Pot-limit betting, and the nuts change every street.",
    hero: ['AS', 'KS', 'AH', 'KH', 'QD'],
    length: '20–40 min',
    options: [
      { id: 'stack', label: 'Starting chips', type: 'select', default: 1000, choices: [{ value: 500, label: '500' }, { value: 1000, label: '1,000' }, { value: 2500, label: '2,500' }] },
      { id: 'bigBlind', label: 'Big blind', type: 'select', default: 20, choices: [{ value: 10, label: '10' }, { value: 20, label: '20' }, { value: 50, label: '50' }] },
      { id: 'risingBlinds', label: 'Blinds rise every 8 hands', type: 'toggle', default: true },
    ],
    rules: [
      ['Goal', 'Win chips with the best five-card hand at showdown, or by making everyone fold. The last player with chips wins.'],
      ['The deal', "Each player gets <em>four</em> hole cards. Blinds, the button, and the betting rounds (pre-flop, flop, turn, river) work exactly as in Texas Hold'em."],
      ['Exactly two', 'Your hand must use <em>exactly two</em> of your hole cards and <em>exactly three</em> board cards. Four hearts on the board and one in your hand is not a flush.'],
      ['Pot limit', 'The largest raise you can make is the size of the pot after you call. The bet slider stops at that amount, marked Max.'],
    ],
  },
  create: (players, ctx, options) => createPoker(cfg, players, ctx, options),
  toAct: pokerToAct,
  act: pokerAct,
  auto: pokerAuto,
  step: pokerStep,
  cpu: pokerCpu,
  view: (s, viewer) => pokerView(s, viewer, 'omaha'),
  over: (s) => s.phase === 'over',
};
