import { code, newDeck } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View } from '../core/types';
import { baseView, chooseCard, dealRound, followable, fx, log, SUIT_GLYPH, SUIT_WORD, trickWinner, trickZones, type TrickBase } from './tricks/common';

interface S extends TrickBase {
  phase: 'play' | 'collect' | 'roundEnd' | 'over';
  hand: number;
  trumpCardId: string;
  score: [number, number];
  target: number;
  result: string;
  lines: string[];
}

const team = (i: Seat) => i % 2;
const partner = (i: Seat) => (i + 2) % 4;
const teamName = (s: S, t: number) => `${s.names[t]} & ${s.names[t + 2]}`;

function startHand(s: S, ctx: Ctx) {
  s.hand++;
  s.dealer = (s.dealer + 1) % 4;
  s.hands = dealRound(newDeck(ctx.rng), 4, s.dealer, 13);
  // the dealer's last card is turned up for trump
  const last = s.hands[s.dealer][12];
  s.trump = last.s;
  s.trumpCardId = last.id;
  s.won = [[], [], [], []];
  s.tricks = [0, 0, 0, 0];
  s.trick = [];
  s.collecting = null;
  s.phase = 'play';
  s.leader = s.turn = (s.dealer + 1) % 4;
  s.deal++;
  fx(s, 'shuffle');
  log(s, `Hand ${s.hand}: trump is ${SUIT_WORD[s.trump]} (${code(last)})`);
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'roundEnd') return a.t === 'next' ? void startHand(s, ctx) : 'Hold on';
  if (s.phase === 'over') {
    if (a.t !== 'rematch') return 'The game is over';
    s.score = [0, 0];
    s.hand = 0;
    return void startHand(s, ctx);
  }
  if (s.phase !== 'play') return 'Wait for the trick to be collected';
  if (seat !== s.turn) return "It isn't your turn";
  const card = s.hands[seat].find((c) => c.id === a.card);
  if (a.t !== 'play' || !card) return 'Play a card from your hand';
  if (!followable(s.hands[seat], s.trick).includes(card)) return 'You must follow suit';
  s.hands[seat] = s.hands[seat].filter((c) => c !== card);
  s.trick.push({ seat, card });
  if (s.trick.length === 4) {
    s.collecting = trickWinner(s.trick, s.trump).seat;
    s.phase = 'collect';
  } else s.turn = (seat + 1) % 4;
}

function step(s: S, ctx: Ctx) {
  if (s.phase === 'roundEnd') return startHand(s, ctx);
  if (s.phase !== 'collect') return;
  const w = s.collecting!;
  s.won[w].push(...s.trick.map((p) => p.card));
  s.tricks[w]++;
  s.trick = [];
  s.collecting = null;
  fx(s, 'collect');
  if (s.hands.every((h) => !h.length)) {
    const t0 = s.tricks[0] + s.tricks[2], t1 = s.tricks[1] + s.tricks[3];
    const w2 = t0 > t1 ? 0 : 1;
    const odd = Math.max(t0, t1) - 6;
    s.score[w2] += odd;
    s.result = `${teamName(s, w2)} take ${Math.max(t0, t1)} tricks: +${odd}`;
    s.lines = [`${teamName(s, 0)} ${t0} tricks · ${teamName(s, 1)} ${t1} tricks`, `Score ${s.score[0]} – ${s.score[1]}`];
    log(s, s.result);
    if (s.score[w2] >= s.target) {
      s.phase = 'over';
      s.result = `${teamName(s, w2)} win ${s.score[w2]} to ${s.score[1 - w2]}`;
      fx(s, 'win');
    } else s.phase = 'roundEnd';
    return;
  }
  s.phase = 'play';
  s.leader = s.turn = w;
}

function view(s: S, viewer: Seat): View {
  const myTurn = s.phase === 'play' && s.turn === viewer;
  const zones = trickZones(s, viewer, { playable: myTurn ? followable(s.hands[viewer], s.trick) : undefined });
  // the turned-up trump card stays face up in the dealer's hand until played
  const dz = zones.find((z) => z.id === 'h' + s.dealer);
  const tc = dz?.cards.find((c) => c.id === s.trumpCardId);
  const tcard = s.hands[s.dealer].find((c) => c.id === s.trumpCardId);
  if (tc && tcard) tc.f = code(tcard);
  const buttons: View['buttons'] = [];
  if (s.phase === 'roundEnd' && !s.cpu[viewer]) buttons.push({ label: 'Next hand', a: { t: 'next' }, kind: 'primary', key: 'n' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  const t0 = s.tricks[0] + s.tricks[2], t1 = s.tricks[1] + s.tricks[3];
  return baseView(s, viewer, 'whist', {
    seats: s.names.map((name, i) => ({
      name,
      cpu: s.cpu[i],
      team: team(i),
      score: `${s.score[team(i)]} pts`,
      sub: `${team(i) === 0 ? t0 : t1} team tricks`,
      badges: i === s.dealer ? ['D'] : [],
      active: myTurn ? i === viewer : s.phase === 'play' && s.turn === i,
      win: s.phase === 'over' && s.score[team(i)] >= s.target,
    })),
    zones,
    buttons,
    prompt: myTurn ? (s.trick.length ? 'Follow suit if you can' : 'Your lead') : s.phase === 'play' ? `${s.names[s.turn]} to play` : undefined,
    status: `Hand ${s.hand} · trump ${s.trump ? SUIT_GLYPH[s.trump] + ' ' + SUIT_WORD[s.trump] : ''} · ${teamName(s, 0)} ${s.score[0]} – ${s.score[1]} · to ${s.target}`,
    banner: s.phase === 'roundEnd' || s.phase === 'over' ? { title: s.result, lines: s.lines, tone: s.phase === 'over' && s.score[team(viewer)] >= s.target ? 'win' : 'info' } : undefined,
    over: s.phase === 'over',
  });
}

export const whist: GameDef<S> = {
  meta: {
    id: 'whist',
    name: 'Whist',
    family: 'Trick-taking',
    players: { min: 4, max: 4, def: 4 },
    teams: true,
    blurb: 'The grandfather of bridge: trump turned up, partners, and every trick over six.',
    hero: ['AC', 'KC', 'QC', 'JC', '10C'],
    length: '20–30 min',
    options: [{ id: 'target', label: 'Game ends at', type: 'select', default: 7, choices: [{ value: 5, label: '5 points' }, { value: 7, label: '7 points' }] }],
    rules: [
      ['Teams and deal', 'You partner the player opposite. All 52 cards are dealt. The dealer’s last card is shown to everyone: its suit is trump.'],
      ['Play', 'The player left of the dealer leads. Follow suit if you can; otherwise you may trump or discard. The highest trump, or the highest card of the suit led, wins.'],
      ['Scoring', 'The team that takes more than six tricks scores one point for each trick over six (the <em>odd tricks</em>). The first team to 7 points wins.'],
    ],
  },
  create: (players, ctx, options) => {
    const s: S = {
      n: 4, names: players.map((p) => p.name), cpu: players.map((p) => p.kind === 'cpu'), hands: [], trick: [], lastTrick: [], leader: 0, turn: 0,
      won: [], tricks: [], trump: null, dealer: ctx.rng.int(4), deal: 0, fx: [], fxn: 0, log: [], collecting: null,
      phase: 'play', hand: 0, trumpCardId: '', score: [0, 0], target: Number(options.target ?? 7), result: '', lines: [],
    };
    startHand(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'play' ? [s.turn] : s.phase === 'roundEnd' || s.phase === 'over' ? [0, 1, 2, 3].filter((i) => !s.cpu[i]) : []),
  act,
  auto: (s) => (s.phase === 'collect' ? 1050 : s.phase === 'roundEnd' && s.cpu.every(Boolean) ? 10 : null),
  step,
  cpu: (s, seat) => (s.phase === 'play' && s.turn === seat ? { t: 'play', card: chooseCard(followable(s.hands[seat], s.trick), s.trick, { trump: s.trump, wantWin: true, partner: partner(seat), seat, n: 4 }).id } : null),
  view,
  over: (s) => s.phase === 'over',
};
