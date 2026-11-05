import { code, hi, newDeck, type Card } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View, Zone } from '../core/types';
import { base, fx, humans, log, rankWord, stackZone, type Base } from './shared';

interface S extends Base {
  piles: Card[][];
  table: { down: Card[]; up: Card[] }[];
  flipped: boolean[];
  phase: 'flip' | 'resolve' | 'over';
  battles: number;
  limit: number;
  atWar: number;
  result: string;
  says: (string | undefined)[];
}

function setup(s: S, ctx: Ctx) {
  const deck = newDeck(ctx.rng);
  s.piles = [deck.slice(0, 26), deck.slice(26)];
  s.table = [{ down: [], up: [] }, { down: [], up: [] }];
  s.flipped = [false, false];
  s.phase = 'flip';
  s.battles = 0;
  s.atWar = 0;
  s.result = '';
  s.says = [undefined, undefined];
  s.deal++;
  fx(s, 'shuffle');
}

function flip(s: S, i: Seat) {
  const pile = s.piles[i];
  if (s.atWar) {
    // three face down (or as many as possible, keeping one to turn up)
    const k = Math.min(3, Math.max(0, pile.length - 1));
    for (let j = 0; j < k; j++) s.table[i].down.push(pile.shift()!);
  }
  if (pile.length) s.table[i].up.push(pile.shift()!);
  s.flipped[i] = true;
}

function resolve(s: S, ctx: Ctx) {
  const a = s.table[0].up[s.table[0].up.length - 1], b = s.table[1].up[s.table[1].up.length - 1];
  const all = () => [...s.table[0].down, ...s.table[0].up, ...s.table[1].down, ...s.table[1].up];
  const finishIf = () => {
    const done = s.piles.findIndex((p, i) => !p.length && !s.table[i].up.length);
    if (s.piles.some((p) => !p.length) && !s.atWar) {
      const w = s.piles[0].length ? 0 : 1;
      s.result = `${s.names[w]} takes every card`;
      s.phase = 'over';
      fx(s, 'win');
      return true;
    }
    void done;
    if (s.limit && s.battles >= s.limit) {
      const w = s.piles[0].length >= s.piles[1].length ? 0 : 1;
      s.result = `${s.names[w]} wins on cards, ${s.piles[w].length} to ${s.piles[1 - w].length}`;
      s.phase = 'over';
      fx(s, 'win');
      return true;
    }
    return false;
  };
  if (!a || !b || hi(a) === hi(b)) {
    // war! (if someone has nothing left to fight with, they lose)
    if (!s.piles[0].length || !s.piles[1].length) {
      const w = s.piles[0].length ? 0 : 1;
      s.piles[w].push(...ctx.rng.shuffle(all()));
      s.table = [{ down: [], up: [] }, { down: [], up: [] }];
      s.atWar = 0;
      s.result = `${s.names[w]} wins the war and the game`;
      s.phase = 'over';
      fx(s, 'win');
      return;
    }
    s.atWar++;
    s.says = ['War!', 'War!'];
    log(s, `War over two ${rankWord(a.r, true)}`);
    fx(s, 'allin');
    s.phase = 'flip';
    s.flipped = [false, false];
    return;
  }
  const w = hi(a) > hi(b) ? 0 : 1;
  const won = all();
  s.piles[w].push(...ctx.rng.shuffle(won));
  s.says = [undefined, undefined];
  s.says[w] = s.atWar ? `Wins the war: ${won.length} cards` : `Takes it with the ${rankWord((w ? b : a).r)}`;
  s.table = [{ down: [], up: [] }, { down: [], up: [] }];
  s.atWar = 0;
  s.battles++;
  fx(s, 'collect');
  if (finishIf()) return;
  s.phase = 'flip';
  s.flipped = [false, false];
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'over') return a.t === 'rematch' ? void setup(s, ctx) : 'The game is over';
  if (s.phase !== 'flip') return 'Hold on';
  if (a.t !== 'flip') return 'Flip your card';
  if (s.flipped[seat]) return 'Waiting for your opponent';
  flip(s, seat);
  fx(s, 'draw');
  if (s.flipped.every(Boolean)) s.phase = 'resolve';
}

function view(s: S, viewer: Seat): View {
  const zones: Zone[] = [];
  for (let i = 0; i < 2; i++) {
    zones.push(stackZone('pile' + i, s.piles[i], { seat: i, slot: 'hand' }, { deck: i === 0, label: `${s.piles[i].length}`, act: s.phase === 'flip' && i === viewer && !s.flipped[i] ? { t: 'flip' } : undefined }));
    const t = s.table[i];
    zones.push({
      id: 'battle' + i,
      at: { x: 0, y: i === viewer ? 0.18 : -0.24 },
      lay: 'row',
      gap: 0.32,
      cards: [...t.down.map((c) => ({ id: c.id })), ...t.up.map((c) => ({ id: c.id, f: code(c) }))],
    });
  }
  const buttons: View['buttons'] = [];
  if (s.phase === 'flip' && !s.flipped[viewer] && !s.cpu[viewer]) buttons.push({ label: s.atWar ? 'Go to war' : 'Flip', a: { t: 'flip' }, kind: 'primary', key: 'f' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return {
    game: 'war',
    viewer,
    seats: s.names.map((name, i) => ({ name, cpu: s.cpu[i], score: `${s.piles[i].length} cards`, say: s.says[i], active: s.phase === 'flip' && !s.flipped[i], win: s.phase === 'over' && s.result.startsWith(name) })),
    zones,
    buttons,
    prompt: s.phase === 'flip' ? (s.flipped[viewer] ? 'Waiting…' : s.atWar ? 'War! Three down, one up' : 'Flip your top card') : undefined,
    status: `Battle ${s.battles}${s.limit ? ` of ${s.limit}` : ''}`,
    banner: s.phase === 'over' ? { title: s.result, tone: s.result.startsWith(s.names[viewer]) ? 'win' : 'info' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    fx: s.fx,
    over: s.phase === 'over',
  };
}

export const war: GameDef<S> = {
  meta: {
    id: 'war',
    name: 'War',
    family: 'Duel',
    players: { min: 2, max: 2, def: 2 },
    blurb: 'Flip, compare, and when the cards tie, go to war.',
    hero: ['AS', 'AH', 'KC', 'KD', '2S'],
    length: '5–15 min',
    options: [{ id: 'limit', label: 'Game length', type: 'select', default: 150, choices: [{ value: 150, label: 'Short: 150 battles' }, { value: 0, label: 'Until one player has every card' }] }],
    rules: [
      ['Deal', 'The deck is split evenly between two players, face down.'],
      ['Battle', 'Both players turn up their top card. The higher card (ace high) takes both, and they go to the bottom of the winner’s pile.'],
      ['War', 'When the cards tie, each player puts three cards face down and one face up. The higher new card takes everything on the table. Ties keep the war going.'],
      ['Winning', 'Take every card to win. In a short game, whoever holds more cards after 150 battles wins.'],
    ],
  },
  create: (players, ctx, options) => {
    const s: S = { ...base(players), piles: [], table: [], flipped: [], phase: 'flip', battles: 0, limit: Number(options.limit ?? 150), atWar: 0, result: '', says: [] };
    setup(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'flip' ? [0, 1].filter((i) => !s.flipped[i]) : s.phase === 'over' ? humans(s) : []),
  act,
  auto: (s) => (s.phase === 'resolve' ? 900 : null),
  step: (s, ctx) => resolve(s, ctx),
  cpu: (s, seat) => (s.phase === 'flip' && !s.flipped[seat] ? { t: 'flip' } : null),
  view,
  over: (s) => s.phase === 'over',
};

export const _log = log;
