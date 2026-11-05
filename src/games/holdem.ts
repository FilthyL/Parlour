import type { GameDef } from '../core/types';
import { createPoker, pokerAct, pokerAuto, pokerCpu, pokerStep, pokerToAct, pokerView, type PokerState } from './poker/engine';

const cfg = { variant: 'holdem' as const, holeCards: 2, limit: 'NL' as const, label: "No-limit Hold'em" };

export const holdem: GameDef<PokerState> = {
  meta: {
    id: 'holdem',
    name: "Texas Hold'em",
    family: 'Poker',
    players: { min: 2, max: 9, def: 6 },
    blurb: 'Two hole cards, five on the board, and no limit on the betting.',
    hero: ['AS', 'AH', 'KD', 'QS', 'JC'],
    length: '20–40 min',
    options: [
      { id: 'stack', label: 'Starting chips', type: 'select', default: 1000, choices: [{ value: 500, label: '500' }, { value: 1000, label: '1,000' }, { value: 2500, label: '2,500' }, { value: 5000, label: '5,000' }] },
      { id: 'bigBlind', label: 'Big blind', type: 'select', default: 20, choices: [{ value: 10, label: '10' }, { value: 20, label: '20' }, { value: 50, label: '50' }] },
      { id: 'risingBlinds', label: 'Blinds rise every 8 hands', type: 'toggle', default: true },
    ],
    rules: [
      ['Goal', 'Win chips by holding the best five-card hand at showdown, or by making everyone else fold. The last player with chips wins the table.'],
      ['The deal', 'The button moves one seat left each hand. The two players to its left post the small and big blinds. Everyone gets two private <em>hole cards</em>.'],
      ['Betting rounds', 'Betting happens before the flop, after the <em>flop</em> (three shared cards), after the <em>turn</em> (a fourth) and after the <em>river</em> (a fifth). On your turn you can fold, check, call, bet or raise. A raise must be at least as large as the previous bet or raise. You can go all-in at any time.'],
      ['Showdown', 'Make the best five-card hand from your two hole cards and the five board cards. If players are all-in for different amounts, side pots are split separately.'],
      ['Hand ranks', 'From high to low: straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, one pair, high card. A royal flush is the ace-high straight flush.'],
      ['Heads-up', 'With two players left, the button posts the small blind and acts first before the flop.'],
    ],
  },
  create: (players, ctx, options) => createPoker(cfg, players, ctx, options),
  toAct: pokerToAct,
  act: pokerAct,
  auto: pokerAuto,
  step: pokerStep,
  cpu: pokerCpu,
  view: (s, viewer) => pokerView(s, viewer, 'holdem'),
  over: (s) => s.phase === 'over',
};
