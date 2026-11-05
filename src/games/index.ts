import type { Family, GameDef } from '../core/types';
import { holdem } from './holdem';
import { omaha } from './omaha';
import { draw } from './draw';
import { hearts } from './hearts';
import { spades } from './spades';
import { euchre } from './euchre';
import { ohhell } from './ohhell';
import { whist } from './whist';

export const GAMES: GameDef[] = [holdem, omaha, draw, hearts, spades, euchre, ohhell, whist];

export const FAMILIES: { id: Family; blurb: string }[] = [
  { id: 'Poker', blurb: 'Bet, bluff and read the table.' },
  { id: 'Casino', blurb: 'You against the house.' },
  { id: 'Trick-taking', blurb: 'Win the tricks you bid, or dodge the ones that hurt.' },
  { id: 'Rummy', blurb: 'Draw, meld and go out first.' },
  { id: 'Shedding', blurb: 'Be the first to empty your hand.' },
  { id: 'Family', blurb: 'Quick, friendly, for every age.' },
  { id: 'Classic', blurb: 'Old favourites with their own boards and rhythms.' },
  { id: 'Duel', blurb: 'Head to head, fast hands.' },
];

export const gameById = (id: string) => GAMES.find((g) => g.meta.id === id);
