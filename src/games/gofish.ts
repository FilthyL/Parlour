import { newDeck, type Card } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View, Zone } from '../core/types';
import { base, fx, handZone, humans, log, rankWord, stackZone, type Base } from './shared';

interface S extends Base {
  hands: Card[][];
  stock: Card[];
  books: Card[][][]; // per player, each book is four cards
  phase: 'ask' | 'over';
  turn: Seat;
  says: (string | undefined)[];
  /** ranks each player is known to hold (they asked for them) */
  known: number[][];
  lastAsk: { from: Seat; to: Seat; rank: number; got: number } | null;
  result: string;
}

function layBooks(s: S, i: Seat) {
  const byRank = new Map<number, Card[]>();
  for (const c of s.hands[i]) byRank.set(c.r, [...(byRank.get(c.r) ?? []), c]);
  for (const [r, cs] of byRank) {
    if (cs.length === 4) {
      s.books[i].push(cs);
      s.hands[i] = s.hands[i].filter((c) => c.r !== r);
      s.known.forEach((k) => {
        const idx = k.indexOf(r);
        if (idx >= 0) k.splice(idx, 1);
      });
      log(s, `${s.names[i]} lays down a book of ${rankWord(r, true)}`);
      fx(s, 'win');
    }
  }
}

function refill(s: S, i: Seat) {
  if (!s.hands[i].length && s.stock.length) s.hands[i].push(s.stock.pop()!);
}

function finished(s: S) {
  return s.books.reduce((a, b) => a + b.length, 0) === 13;
}

function advance(s: S) {
  if (finished(s)) {
    const most = Math.max(...s.books.map((b) => b.length));
    const ws = s.names.filter((_, i) => s.books[i].length === most);
    s.result = `${ws.join(' & ')} win${ws.length > 1 ? '' : 's'} with ${most} books`;
    s.phase = 'over';
    return;
  }
  // next player who has cards (or can draw)
  for (let k = 1; k <= s.n; k++) {
    const j = (s.turn + k) % s.n;
    refill(s, j);
    if (s.hands[j].length) {
      s.turn = j;
      return;
    }
  }
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'over') {
    if (a.t !== 'rematch') return 'The game is over';
    return void setup(s, ctx);
  }
  if (seat !== s.turn) return "It isn't your turn";
  if (a.t !== 'ask') return 'Ask a player for a rank';
  const target = Number(a.target);
  let rank = Number(a.rank);
  if (!rank && Array.isArray(a.cards)) rank = s.hands[seat].find((c) => c.id === (a.cards as string[])[0])?.r ?? 0;
  if (target === seat || !(target >= 0 && target < s.n) || !s.hands[target].length) return 'Ask someone who has cards';
  if (!s.hands[seat].some((c) => c.r === rank)) return 'You can only ask for a rank you hold';
  const got = s.hands[target].filter((c) => c.r === rank);
  s.known[seat] = [...new Set([...s.known[seat], rank])];
  s.says = s.names.map(() => undefined);
  s.says[seat] = `${s.names[target]}, any ${rankWord(rank, true)}?`;
  if (got.length) {
    s.hands[target] = s.hands[target].filter((c) => c.r !== rank);
    s.hands[seat].push(...got);
    s.known[target] = s.known[target].filter((r) => r !== rank);
    s.says[target] = `Here: ${got.length}`;
    s.lastAsk = { from: seat, to: target, rank, got: got.length };
    log(s, `${s.names[seat]} takes ${got.length} ${rankWord(rank, got.length > 1)} from ${s.names[target]}`);
    fx(s, 'chips');
    layBooks(s, seat);
    refill(s, target);
    refill(s, seat);
    if (finished(s) || !s.hands[seat].length) return advance(s);
    return; // go again
  }
  s.says[target] = 'Go fish!';
  s.lastAsk = { from: seat, to: target, rank, got: 0 };
  log(s, `${s.names[target]}: go fish`);
  fx(s, 'fold');
  if (s.stock.length) {
    const c = s.stock.pop()!;
    s.hands[seat].push(c);
    layBooks(s, seat);
    if (c.r === rank) {
      s.says[seat] = `Fished a ${rankWord(rank)}!`;
      log(s, `${s.names[seat]} fishes the ${rankWord(rank)} and goes again`);
      refill(s, seat);
      if (s.hands[seat].length && !finished(s)) return;
    }
  }
  advance(s);
}

function setup(s: S, ctx: Ctx) {
  const deck = newDeck(ctx.rng);
  const size = s.n <= 3 ? 7 : 5;
  s.hands = s.names.map(() => []);
  for (let r = 0; r < size; r++) for (let i = 0; i < s.n; i++) s.hands[i].push(deck.pop()!);
  s.stock = deck;
  s.books = s.names.map(() => []);
  s.known = s.names.map(() => []);
  s.says = s.names.map(() => undefined);
  s.lastAsk = null;
  s.phase = 'ask';
  s.turn = ctx.rng.int(s.n);
  s.result = '';
  s.deal++;
  fx(s, 'shuffle');
  for (let i = 0; i < s.n; i++) layBooks(s, i);
}

function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  if (s.phase !== 'ask' || s.turn !== seat) return null;
  const hand = s.hands[seat];
  const others = s.names.map((_, i) => i).filter((i) => i !== seat && s.hands[i].length);
  if (!others.length) return null;
  const ranks = [...new Set(hand.map((c) => c.r))];
  if (ctx.level !== 'easy') {
    // ask someone known to hold a rank we have
    for (const o of others) for (const r of s.known[o]) if (ranks.includes(r)) return { t: 'ask', target: o, rank: r };
  }
  // otherwise the rank we hold most of, from a random opponent
  const best = ranks.sort((a, b) => hand.filter((c) => c.r === b).length - hand.filter((c) => c.r === a).length)[0];
  return { t: 'ask', target: ctx.rng.pick(others), rank: ctx.level === 'easy' ? ctx.rng.pick(ranks) : best };
}

function view(s: S, viewer: Seat): View {
  const myTurn = s.phase === 'ask' && s.turn === viewer;
  const zones: Zone[] = s.names.map((_, i) => handZone(i, viewer, s.hands[i], { sel: myTurn && i === viewer, reveal: s.phase === 'over' }));
  zones.push(stackZone('stock', s.stock, { x: 0, y: -0.06 }, { deck: true, label: s.stock.length ? `${s.stock.length} in the pond` : 'Pond empty' }));
  s.books.forEach((bs, i) => {
    if (!bs.length) return;
    zones.push({ id: 'books' + i, at: { seat: i, slot: 'front' }, lay: 'row', gap: 0.28, scale: 0.55, label: `${bs.length} book${bs.length > 1 ? 's' : ''}`, cards: bs.map((b) => ({ id: b[0].id, f: `${['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][b[0].r - 1]}${b[0].s}` })) });
    // the other three cards of each book stay stacked underneath
  });
  const buttons: View['buttons'] = [];
  if (myTurn) for (let i = 0; i < s.n; i++) if (i !== viewer && s.hands[i].length) buttons.push({ label: `Ask ${s.names[i]}`, a: { t: 'ask', target: i }, needSel: [1, 1], kind: 'primary' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  const total = s.books.reduce((a, b) => a + b.length, 0);
  return {
    game: 'gofish',
    viewer,
    seats: s.names.map((name, i) => ({ name, cpu: s.cpu[i], score: `${s.books[i].length} book${s.books[i].length === 1 ? '' : 's'}`, sub: `${s.hands[i].length} cards`, say: s.says[i], active: s.phase === 'ask' && s.turn === i, win: s.phase === 'over' && s.books[i].length === Math.max(...s.books.map((b) => b.length)) })),
    zones,
    buttons,
    prompt: myTurn ? 'Tap a card to pick its rank, then ask a player' : s.phase === 'ask' ? `${s.names[s.turn]} is asking…` : undefined,
    status: `${total} of 13 books made · ${s.stock.length} cards in the pond`,
    banner: s.phase === 'over' ? { title: s.result, lines: s.names.map((n, i) => `${n}: ${s.books[i].length}`), tone: s.result.includes(s.names[viewer]) ? 'win' : 'info' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    fx: s.fx,
    over: s.phase === 'over',
  };
}

export const gofish: GameDef<S> = {
  meta: {
    id: 'gofish',
    name: 'Go Fish',
    family: 'Family',
    players: { min: 2, max: 6, def: 4 },
    blurb: 'Ask for the cards you need, remember who has what, and collect the most books.',
    hero: ['7S', '7H', '7D', '7C', '2H'],
    length: '10 min',
    rules: [
      ['Deal', 'With two or three players each gets seven cards; with four or more, five. The rest form the pond.'],
      ['Asking', 'On your turn, ask one player for a rank you already hold. If they have any, they hand them all over and you ask again.'],
      ['Go fish', 'If they have none, they say “Go fish!” and you draw from the pond. If you draw the rank you asked for, you go again; otherwise the turn passes.'],
      ['Books', 'When you collect all four of a rank, lay them down as a book. If your hand runs out, draw a card from the pond.'],
      ['Winning', 'When all thirteen books are made, the player with the most books wins.'],
    ],
  },
  create: (players, ctx) => {
    const s: S = { ...base(players), hands: [], stock: [], books: [], phase: 'ask', turn: 0, says: [], known: [], lastAsk: null, result: '' };
    setup(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'over' ? humans(s) : [s.turn]),
  act,
  cpu,
  view,
  over: (s) => s.phase === 'over',
};
