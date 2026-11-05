import { newDeck, type Card } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View, Zone } from '../core/types';
import { base, fx, handZone, humans, log, rankWord, stackZone, type Base } from './shared';

interface S extends Base {
  hands: Card[][];
  pairs: Card[];
  phase: 'draw' | 'over';
  turn: Seat;
  out: boolean[];
  says: (string | undefined)[];
  loser: Seat;
  lastTaken: string | null;
}

/** Discard every pair in a hand (same rank). */
function dropPairs(s: S, i: Seat) {
  const byRank = new Map<number, Card[]>();
  for (const c of s.hands[i]) byRank.set(c.r, [...(byRank.get(c.r) ?? []), c]);
  let dropped = 0;
  for (const cs of byRank.values()) {
    for (let k = 0; k + 1 < cs.length; k += 2) {
      s.pairs.push(cs[k], cs[k + 1]);
      s.hands[i] = s.hands[i].filter((c) => c !== cs[k] && c !== cs[k + 1]);
      dropped++;
    }
  }
  return dropped;
}

/** The player you draw from: the next player still holding cards. */
function source(s: S, i: Seat): Seat {
  for (let k = 1; k < s.n; k++) {
    const j = (i + k) % s.n;
    if (s.hands[j].length) return j;
  }
  return -1;
}

function nextTurn(s: S, from: Seat) {
  for (let i = 0; i < s.n; i++) s.out[i] = s.hands[i].length === 0;
  const left = s.hands.map((h, i) => (h.length ? i : -1)).filter((i) => i >= 0);
  if (left.length <= 1) {
    s.loser = left[0] ?? -1;
    s.phase = 'over';
    log(s, `${s.names[s.loser]} is left holding the Old Maid`);
    fx(s, 'win');
    return;
  }
  for (let k = 1; k <= s.n; k++) {
    const j = (from + k) % s.n;
    if (s.hands[j].length) {
      s.turn = j;
      return;
    }
  }
}

function setup(s: S, ctx: Ctx) {
  // remove one queen: its partner becomes the Old Maid
  const deck = newDeck(ctx.rng, { exclude: (c) => c.r === 12 && c.s === 'C' });
  s.hands = s.names.map(() => []);
  let i = 0;
  while (deck.length) s.hands[i++ % s.n].push(deck.pop()!);
  s.pairs = [];
  s.out = s.names.map(() => false);
  s.says = s.names.map(() => undefined);
  s.loser = -1;
  s.lastTaken = null;
  s.phase = 'draw';
  s.deal++;
  fx(s, 'shuffle');
  for (let p = 0; p < s.n; p++) dropPairs(s, p);
  s.turn = ctx.rng.int(s.n);
  nextTurn(s, (s.turn + s.n - 1) % s.n);
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'over') return a.t === 'rematch' ? void setup(s, ctx) : 'The game is over';
  if (seat !== s.turn) return "It isn't your turn";
  const from = source(s, seat);
  const card = s.hands[from]?.find((c) => c.id === a.card);
  if (a.t !== 'take' || !card) return `Pick one of ${s.names[from]}'s cards`;
  s.hands[from] = s.hands[from].filter((c) => c !== card);
  s.hands[seat].push(card);
  s.lastTaken = card.id;
  s.says = s.names.map(() => undefined);
  const dropped = dropPairs(s, seat);
  s.says[seat] = dropped ? `A pair of ${rankWord(card.r, true)}` : card.r === 12 ? undefined : 'No match';
  log(s, `${s.names[seat]} draws from ${s.names[from]}${dropped ? ' and makes a pair' : ''}`);
  fx(s, dropped ? 'chips' : 'draw');
  // the holder shuffles what is left so nobody can track the queen
  ctx.rng.shuffle(s.hands[from]);
  ctx.rng.shuffle(s.hands[seat]);
  nextTurn(s, seat);
}

function view(s: S, viewer: Seat): View {
  const myTurn = s.phase === 'draw' && s.turn === viewer;
  const from = myTurn ? source(s, viewer) : -1;
  const zones: Zone[] = s.names.map((_, i) =>
    handZone(i, viewer, s.hands[i], {
      sort: false,
      reveal: s.phase === 'over',
      act: i === from ? (c) => ({ t: 'take', card: c.id }) : undefined,
      hi: i === viewer ? (c) => c.id === s.lastTaken : undefined,
    }),
  );
  zones.push(stackZone('pairs', s.pairs, { x: 0, y: -0.08 }, { faceUp: true, deck: true, label: `${s.pairs.length / 2} pairs`, top: 8 }));
  const buttons: View['buttons'] = [];
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return {
    game: 'oldmaid',
    viewer,
    seats: s.names.map((name, i) => ({ name, cpu: s.cpu[i], sub: s.hands[i].length ? `${s.hands[i].length} cards` : 'Safe', say: s.says[i], active: s.phase === 'draw' && s.turn === i, out: s.out[i] && s.phase !== 'over', win: s.phase === 'over' && i !== s.loser })),
    zones,
    buttons,
    prompt: myTurn ? `Pick a card from ${s.names[from]}'s hand` : s.phase === 'draw' ? `${s.names[s.turn]} is choosing from ${s.names[source(s, s.turn)]}…` : undefined,
    status: `${s.pairs.length / 2} pairs down · the Queen of Clubs is missing`,
    banner: s.phase === 'over' ? { title: s.loser === viewer ? "You're the Old Maid!" : `${s.names[s.loser]} is the Old Maid`, lines: ['Everyone else is safe.'], tone: s.loser === viewer ? 'lose' : 'win' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    fx: s.fx,
    over: s.phase === 'over',
  };
}

export const oldmaid: GameDef<S> = {
  meta: {
    id: 'oldmaid',
    name: 'Old Maid',
    family: 'Family',
    players: { min: 2, max: 6, def: 4 },
    blurb: 'Pair off your cards and whatever you do, don’t get stuck with the lone queen.',
    hero: ['QS', 'QH', 'QD', '5C', '5H'],
    length: '5–10 min',
    rules: [
      ['Setup', 'One queen is taken out of the deck, so one queen can never be paired: she is the <em>Old Maid</em>. All the cards are dealt, and everyone puts down any pairs.'],
      ['Play', 'On your turn, draw one card, face down, from the next player’s hand. If it pairs with a card you hold, put the pair down.'],
      ['Going out', 'Players who run out of cards are safe and leave the game.'],
      ['Losing', 'Whoever is left holding the Old Maid at the end loses.'],
    ],
  },
  create: (players, ctx) => {
    const s: S = { ...base(players), hands: [], pairs: [], phase: 'draw', turn: 0, out: [], says: [], loser: -1, lastTaken: null };
    setup(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'over' ? humans(s) : [s.turn]),
  act,
  cpu: (s, seat, ctx) => {
    if (s.phase !== 'draw' || s.turn !== seat) return null;
    const from = source(s, seat);
    return { t: 'take', card: ctx.rng.pick(s.hands[from]).id };
  },
  view,
  over: (s) => s.phase === 'over',
};
