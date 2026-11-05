/**
 * President (a.k.a. Scum): play singles, pairs, triples or fours that beat
 * the last play; 2s are high. Finishing order sets ranks, and the next
 * round starts with the Scum handing their best cards to the President.
 */
import { code, newDeck, type Card } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View, Zone } from '../core/types';
import { base, fx, handZone, humans, log, rankWord, type Base } from './shared';

interface S extends Base {
  hands: Card[][];
  phase: 'exchange' | 'play' | 'clear' | 'roundEnd' | 'over';
  turn: Seat;
  pile: Card[]; // all cards played to the current trick
  last: { seat: Seat; cards: Card[] } | null;
  passed: boolean[];
  finished: Seat[];
  ranks: Seat[]; // last round's finishing order
  owed: { from: Seat; to: Seat; count: number; done: boolean }[];
  scores: number[];
  round: number;
  rounds: number;
  firstLead: boolean;
  says: (string | undefined)[];
  result: string;
  lines: string[];
  given: string[];
}

/** 3 is lowest, then 4…K, A, and 2 is highest. */
const power = (c: Card) => (c.r === 2 ? 15 : c.r === 1 ? 14 : c.r);
const title = (s: S, place: number) => {
  const n = s.n;
  if (place === 0) return 'President';
  if (place === n - 1) return 'Scum';
  if (n >= 4 && place === 1) return 'Vice President';
  if (n >= 4 && place === n - 2) return 'Vice Scum';
  return 'Citizen';
};

function startRound(s: S, ctx: Ctx) {
  s.round++;
  const deck = newDeck(ctx.rng);
  s.hands = s.names.map(() => []);
  let i = 0;
  while (deck.length) s.hands[i++ % s.n].push(deck.pop()!);
  s.pile = [];
  s.last = null;
  s.passed = s.names.map(() => false);
  s.finished = [];
  s.says = s.names.map(() => undefined);
  s.given = [];
  s.deal++;
  fx(s, 'shuffle');
  s.owed = [];
  if (s.ranks.length === s.n) {
    const pres = s.ranks[0], scum = s.ranks[s.n - 1];
    s.owed.push({ from: scum, to: pres, count: 2, done: false }, { from: pres, to: scum, count: 2, done: false });
    if (s.n >= 4) {
      const vp = s.ranks[1], vs = s.ranks[s.n - 2];
      s.owed.push({ from: vs, to: vp, count: 1, done: false }, { from: vp, to: vs, count: 1, done: false });
    }
    // the Scum and Vice Scum must hand over their best cards
    for (const o of s.owed) {
      if (o.from === scum || (s.n >= 4 && o.from === s.ranks[s.n - 2])) {
        const best = [...s.hands[o.from]].sort((a, b) => power(b) - power(a)).slice(0, o.count);
        give(s, o, best);
      }
    }
    s.phase = 'exchange';
    s.firstLead = false;
    s.turn = scum;
    if (s.owed.every((o) => o.done)) startPlay(s);
  } else {
    s.firstLead = true;
    s.turn = s.hands.findIndex((h) => h.some((c) => c.r === 3 && c.s === 'C'));
    s.phase = 'play';
  }
  log(s, `Round ${s.round}`);
}

function give(s: S, o: S['owed'][number], cards: Card[]) {
  s.hands[o.from] = s.hands[o.from].filter((c) => !cards.includes(c));
  s.hands[o.to].push(...cards);
  if (o.to === o.from) return;
  o.done = true;
  s.given.push(...cards.map((c) => c.id));
  log(s, `${s.names[o.from]} gives ${o.count} card${o.count > 1 ? 's' : ''} to ${s.names[o.to]}`);
}

function startPlay(s: S) {
  s.phase = 'play';
  s.turn = s.ranks[s.n - 1];
}

const active = (s: S, i: Seat) => s.hands[i].length > 0;

function nextPlayer(s: S, from: Seat): Seat {
  for (let k = 1; k <= s.n; k++) {
    const j = (from + k) % s.n;
    if (active(s, j) && !s.passed[j]) return j;
  }
  return -1;
}

function legalPlay(s: S, seat: Seat, cards: Card[]): string | null {
  if (!cards.length || cards.length > 4) return 'Play one to four cards of the same rank';
  if (!cards.every((c) => c.r === cards[0].r)) return 'All cards must be the same rank';
  if (s.firstLead && !cards.some((c) => c.r === 3 && c.s === 'C')) return 'The first play must include the 3 of clubs';
  if (s.last) {
    if (cards.length !== s.last.cards.length) return `Play ${s.last.cards.length === 1 ? 'a single' : s.last.cards.length === 2 ? 'a pair' : s.last.cards.length === 3 ? 'three of a kind' : 'four of a kind'}`;
    if (power(cards[0]) <= power(s.last.cards[0])) return `Beat the ${rankWord(s.last.cards[0].r, s.last.cards.length > 1)}`;
  }
  void seat;
  return null;
}

function afterPlay(s: S, seat: Seat) {
  if (!s.hands[seat].length && !s.finished.includes(seat)) {
    s.finished.push(seat);
    s.says[seat] = title(s, s.finished.length - 1);
    log(s, `${s.names[seat]} is out: ${title(s, s.finished.length - 1)}`);
    fx(s, 'win');
  }
  const left = s.names.map((_, i) => i).filter((i) => active(s, i));
  if (left.length <= 1) {
    if (left.length) s.finished.push(left[0]);
    return endRound(s);
  }
  const nx = nextPlayer(s, seat);
  // everyone else passed: the trick is won
  if (nx === -1 || (nx === s.last?.seat && s.names.every((_, i) => i === nx || !active(s, i) || s.passed[i]))) {
    s.phase = 'clear';
    return;
  }
  s.turn = nx;
}

function clearTrick(s: S) {
  const winner = s.last!.seat;
  s.pile = [];
  s.last = null;
  s.passed = s.names.map(() => false);
  s.says = s.says.map((v, i) => (s.finished.includes(i) ? v : undefined));
  s.phase = 'play';
  fx(s, 'collect');
  s.turn = active(s, winner) ? winner : nextPlayer(s, winner);
}

function endRound(s: S) {
  s.ranks = [...s.finished];
  s.lines = s.ranks.map((p, place) => {
    const pts = s.n - 1 - place;
    s.scores[p] += pts;
    return `${title(s, place)}: ${s.names[p]} +${pts}`;
  });
  s.result = `${s.names[s.ranks[0]]} is President`;
  if (s.round >= s.rounds) {
    const top = Math.max(...s.scores);
    s.result = `${s.names.filter((_, i) => s.scores[i] === top).join(' & ')} win${s.scores.filter((v) => v === top).length > 1 ? '' : 's'} with ${top} points`;
    s.phase = 'over';
  } else s.phase = 'roundEnd';
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'roundEnd') return a.t === 'next' ? void startRound(s, ctx) : 'Hold on';
  if (s.phase === 'over') {
    if (a.t !== 'rematch') return 'The game is over';
    s.scores = s.scores.map(() => 0);
    s.round = 0;
    s.ranks = [];
    return void startRound(s, ctx);
  }
  if (s.phase === 'exchange') {
    const o = s.owed.find((x) => x.from === seat && !x.done);
    if (!o) return 'Waiting for the exchange';
    const cards = ((a.cards as string[]) ?? []).map((id) => s.hands[seat].find((c) => c.id === id)).filter(Boolean) as Card[];
    if (a.t !== 'give' || cards.length !== o.count) return `Choose ${o.count} card${o.count > 1 ? 's' : ''} to give to ${s.names[o.to]}`;
    give(s, o, cards);
    if (s.owed.every((x) => x.done)) startPlay(s);
    return;
  }
  if (s.phase !== 'play') return 'Hold on';
  if (seat !== s.turn) return "It isn't your turn";
  if (a.t === 'pass') {
    if (!s.last) return 'You are leading: play something';
    s.passed[seat] = true;
    s.says[seat] = 'Pass';
    fx(s, 'check');
    return afterPlay(s, seat);
  }
  const cards = ((a.cards as string[]) ?? []).map((id) => s.hands[seat].find((c) => c.id === id)).filter(Boolean) as Card[];
  if (a.t !== 'play') return 'Play or pass';
  const err = legalPlay(s, seat, cards);
  if (err) return err;
  s.hands[seat] = s.hands[seat].filter((c) => !cards.includes(c));
  s.pile.push(...cards);
  s.last = { seat, cards };
  s.firstLead = false;
  s.says[seat] = `${cards.length > 1 ? `${['', '', 'Pair of', 'Three', 'Four'][cards.length]} ` : ''}${rankWord(cards[0].r, cards.length > 1)}`;
  log(s, `${s.names[seat]} plays ${cards.map(code).join(' ')}`);
  fx(s, cards.length > 2 ? 'allin' : 'chips');
  afterPlay(s, seat);
}

// ---------------------------------------------------------------- CPU
function groups(hand: Card[]) {
  const by = new Map<number, Card[]>();
  for (const c of hand) by.set(c.r, [...(by.get(c.r) ?? []), c]);
  return [...by.values()].sort((a, b) => power(a[0]) - power(b[0]));
}

function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  const hand = s.hands[seat];
  if (s.phase === 'exchange') {
    const o = s.owed.find((x) => x.from === seat && !x.done);
    if (!o) return null;
    // give away the lowest cards
    return { t: 'give', cards: [...hand].sort((a, b) => power(a) - power(b)).slice(0, o.count).map((c) => c.id) };
  }
  if (s.phase !== 'play' || s.turn !== seat) return null;
  const gs = groups(hand);
  if (!s.last) {
    if (s.firstLead) {
      const g = gs.find((x) => x.some((c) => c.r === 3 && c.s === 'C'))!;
      return { t: 'play', cards: g.map((c) => c.id) };
    }
    // lead the lowest group; keep 2s for the end
    const pick = gs.find((g) => power(g[0]) < 15) ?? gs[0];
    return { t: 'play', cards: pick.map((c) => c.id) };
  }
  const need = s.last.cards.length;
  const beat = gs.filter((g) => g.length >= need && power(g[0]) > power(s.last!.cards[0]));
  if (!beat.length) return { t: 'pass' };
  // prefer an exact-size group, cheapest first; hold 2s and aces unless the hand is short
  const exact = beat.filter((g) => g.length === need);
  let choice = (exact.length ? exact : beat)[0];
  if (power(choice[0]) >= 14 && hand.length > 4 && ctx.level !== 'easy' && ctx.rng.chance(0.6)) return { t: 'pass' };
  return { t: 'play', cards: choice.slice(0, need).map((c) => c.id) };
}

function view(s: S, viewer: Seat): View {
  const myTurn = s.phase === 'play' && s.turn === viewer;
  const owe = s.phase === 'exchange' ? s.owed.find((x) => x.from === viewer && !x.done) : undefined;
  const sortP = (h: Card[]) => [...h].sort((a, b) => power(a) - power(b) || a.s.localeCompare(b.s));
  const zones: Zone[] = s.names.map((_, i) => {
    const z = handZone(i, viewer, i === viewer ? sortP(s.hands[i]) : s.hands[i], { sel: (myTurn || !!owe) && i === viewer, sort: false, reveal: s.phase === 'roundEnd' || s.phase === 'over', hi: (c) => s.given.includes(c.id) && i === viewer });
    return z;
  });
  zones.push({ id: 'pile', at: { x: 0, y: -0.06 }, lay: 'trick', deck: true, cards: s.pile.slice(-8).map((c, k) => ({ id: c.id, f: code(c), rot: ((k * 29) % 21) - 10, from: s.last?.seat })) });
  const buttons: View['buttons'] = [];
  let prompt: string | undefined;
  if (owe) {
    buttons.push({ label: `Give ${owe.count} to ${s.names[owe.to]}`, a: { t: 'give' }, needSel: [owe.count, owe.count], kind: 'primary' });
    prompt = `You're ${title(s, s.ranks.indexOf(viewer))}: choose ${owe.count} card${owe.count > 1 ? 's' : ''} to give back`;
  } else if (myTurn) {
    if (s.last) buttons.push({ label: 'Pass', a: { t: 'pass' }, kind: 'ghost', key: 'p' });
    buttons.push({ label: 'Play selected', a: { t: 'play' }, needSel: [1, 4], kind: 'primary', key: 'enter' });
    prompt = s.firstLead ? 'Lead with the 3 of clubs (alone or with other 3s)' : s.last ? `Beat ${s.says[s.last.seat] ?? ''} with the same number of cards, or pass` : 'Your lead: any single, pair, triple or four';
  } else if (s.phase === 'play') prompt = `${s.names[s.turn]} to play`;
  else if (s.phase === 'exchange') prompt = 'Cards are changing hands…';
  if (s.phase === 'roundEnd' && !s.cpu[viewer]) buttons.push({ label: 'Next round', a: { t: 'next' }, kind: 'primary', key: 'n' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return {
    game: 'president',
    viewer,
    seats: s.names.map((name, i) => {
      const place = s.ranks.indexOf(i);
      return { name, cpu: s.cpu[i], score: `${s.scores[i]} pts`, sub: s.finished.includes(i) ? title(s, s.finished.indexOf(i)) : place >= 0 ? `Last: ${title(s, place)}` : `${s.hands[i].length} cards`, say: s.says[i], active: myTurnOf(s, i), out: s.finished.includes(i) && s.phase === 'play', win: s.phase === 'over' && s.scores[i] === Math.max(...s.scores) };
    }),
    zones,
    buttons,
    prompt,
    status: `Round ${s.round} of ${s.rounds} · 2s are high`,
    banner: s.phase === 'roundEnd' || s.phase === 'over' ? { title: s.result, lines: s.lines, tone: s.phase === 'over' && s.scores[viewer] === Math.max(...s.scores) ? 'win' : 'info' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    fx: s.fx,
    over: s.phase === 'over',
  };
}
const myTurnOf = (s: S, i: Seat) => (s.phase === 'play' && s.turn === i) || (s.phase === 'exchange' && s.owed.some((o) => o.from === i && !o.done));

export const president: GameDef<S> = {
  meta: {
    id: 'president',
    name: 'President',
    family: 'Shedding',
    players: { min: 4, max: 7, def: 5 },
    blurb: 'Climb from Scum to President by shedding singles, pairs and triples. Twos are high.',
    hero: ['2S', '2H', 'AD', 'AC', '3C'],
    length: '20–30 min',
    options: [{ id: 'rounds', label: 'Rounds', type: 'select', default: 5, choices: [{ value: 3, label: '3 rounds' }, { value: 5, label: '5 rounds' }, { value: 8, label: '8 rounds' }] }],
    rules: [
      ['Order', 'Cards rank from 3 (lowest) up through K, A, and 2 (highest). Suits do not matter.'],
      ['Play', 'The leader plays a single, a pair, three or four of a kind. Each player in turn must play the same number of cards of a higher rank, or pass. Once you pass, you are out of that trick.'],
      ['Winning a trick', 'When everyone else has passed, the last player to play clears the cards and leads again.'],
      ['Ranks', 'The first player out is President, then Vice President, and so on down to the last player, the Scum. In the first round the holder of the 3 of clubs leads it.'],
      ['Exchange', 'Next round, the Scum gives their two best cards to the President, who gives back any two. The Vice Scum and Vice President swap one. The Scum leads.'],
      ['Scoring', 'Each round you score one point for every player who finished after you. Highest total after the last round wins.'],
    ],
  },
  create: (players, ctx, options) => {
    const s: S = { ...base(players), hands: [], phase: 'play', turn: 0, pile: [], last: null, passed: [], finished: [], ranks: [], owed: [], scores: players.map(() => 0), round: 0, rounds: Number(options.rounds ?? 5), firstLead: true, says: [], result: '', lines: [], given: [] };
    startRound(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'play' ? [s.turn] : s.phase === 'exchange' ? s.owed.filter((o) => !o.done).map((o) => o.from) : s.phase === 'roundEnd' || s.phase === 'over' ? humans(s) : []),
  act,
  auto: (s) => (s.phase === 'clear' ? 1000 : s.phase === 'roundEnd' && s.cpu.every(Boolean) ? 10 : null),
  step: (s, ctx) => (s.phase === 'clear' ? clearTrick(s) : startRound(s, ctx)),
  cpu,
  view,
  over: (s) => s.phase === 'over',
};
