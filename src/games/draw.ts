import type { GameDef } from '../core/types';
import { createPoker, pokerAct, pokerAuto, pokerCpu, pokerStep, pokerToAct, pokerView, type PokerState } from './poker/engine';

const cfg = { variant: 'draw' as const, holeCards: 5, limit: 'NL' as const, label: 'No-limit Five Card Draw' };

export const draw: GameDef<PokerState> = {
  meta: {
    id: 'draw',
    name: 'Five Card Draw',
    family: 'Poker',
    players: { min: 2, max: 6, def: 5 },
    blurb: 'The classic home game: five private cards, one draw, two betting rounds.',
    hero: ['KH', 'KD', 'KC', '7S', '7H'],
    length: '20–30 min',
    options: [
      { id: 'stack', label: 'Starting chips', type: 'select', default: 1000, choices: [{ value: 500, label: '500' }, { value: 1000, label: '1,000' }, { value: 2500, label: '2,500' }] },
      { id: 'bigBlind', label: 'Big blind', type: 'select', default: 20, choices: [{ value: 10, label: '10' }, { value: 20, label: '20' }, { value: 50, label: '50' }] },
      { id: 'risingBlinds', label: 'Blinds rise every 8 hands', type: 'toggle', default: true },
    ],
    rules: [
      ['Goal', 'Hold the best five-card poker hand at showdown, or win the pot when everyone else folds.'],
      ['The deal', 'Blinds are posted by the two players left of the button. Everyone is dealt five private cards, then there is a round of betting.'],
      ['The draw', 'Starting left of the button, each player still in may discard up to three cards (four if they keep an Ace) and draw replacements, or stand pat. Tap the cards you want to replace, then press Draw selected.'],
      ['Second round', 'After the draw there is one more betting round, then the showdown. Hands rank as in all poker: straight flush down to high card.'],
    ],
  },
  create: (players, ctx, options) => createPoker(cfg, players, ctx, options),
  toAct: pokerToAct,
  act: pokerAct,
  auto: pokerAuto,
  step: pokerStep,
  cpu: pokerCpu,
  view: (s, viewer) => pokerView(s, viewer, 'draw'),
  over: (s) => s.phase === 'over',
};
