import { hi, newDeck, type Card } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View } from '../core/types';
import { baseView, chooseCard, dealRound, followable, fx, log, trickWinner, trickZones, type TrickBase } from './tricks/common';

interface S extends TrickBase {
  phase: 'bid' | 'play' | 'collect' | 'roundEnd' | 'over';
  hand: number;
  bids: (number | null)[];
  broken: boolean;
  score: [number, number];
  bags: [number, number];
  target: number;
  result: string;
  lines: string[];
}

const team = (i: Seat) => i % 2;
const partner = (i: Seat) => (i + 2) % 4;

function startHand(s: S, ctx: Ctx) {
  s.hand++;
  s.dealer = (s.dealer + 1) % 4;
  s.hands = dealRound(newDeck(ctx.rng), 4, s.dealer, 13);
  s.won = [[], [], [], []];
  s.tricks = [0, 0, 0, 0];
  s.trick = [];
  s.bids = [null, null, null, null];
  s.broken = false;
  s.collecting = null;
  s.phase = 'bid';
  s.turn = (s.dealer + 1) % 4;
  s.deal++;
  fx(s, 'shuffle');
  log(s, `Hand ${s.hand}: ${s.names[s.turn]} bids first`);
}

function legal(s: S, seat: Seat): Card[] {
  const hand = s.hands[seat];
  if (!s.trick.length) {
    if (!s.broken) {
      const non = hand.filter((c) => c.s !== 'S');
      if (non.length) return non;
    }
    return hand;
  }
  return followable(hand, s.trick);
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'roundEnd') return a.t === 'next' ? void startHand(s, ctx) : 'Hold on';
  if (s.phase === 'over') {
    if (a.t !== 'rematch') return 'The game is over';
    s.score = [0, 0];
    s.bags = [0, 0];
    s.hand = 0;
    return void startHand(s, ctx);
  }
  if (seat !== s.turn) return "It isn't your turn";
  if (s.phase === 'bid') {
    const b = Number(a.bid);
    if (a.t !== 'bid' || !Number.isInteger(b) || b < 0 || b > 13) return 'Bid from 0 (nil) to 13';
    s.bids[seat] = b;
    log(s, `${s.names[seat]} bids ${b === 0 ? 'nil' : b}`);
    fx(s, 'check');
    if (s.bids.every((x) => x !== null)) {
      s.phase = 'play';
      s.leader = s.turn = (s.dealer + 1) % 4;
    } else s.turn = (seat + 1) % 4;
    return;
  }
  if (s.phase !== 'play') return 'Wait for the trick to be collected';
  const card = s.hands[seat].find((c) => c.id === a.card);
  if (a.t !== 'play' || !card) return 'Play a card from your hand';
  if (!legal(s, seat).includes(card)) return s.trick.length ? 'You must follow suit' : "Spades aren't broken yet";
  s.hands[seat] = s.hands[seat].filter((c) => c !== card);
  s.trick.push({ seat, card });
  if (card.s === 'S' && !s.broken) {
    s.broken = true;
    log(s, 'Spades are broken');
    fx(s, 'flip');
  }
  if (s.trick.length === 4) {
    s.collecting = trickWinner(s.trick, 'S').seat;
    s.phase = 'collect';
  } else s.turn = (seat + 1) % 4;
}

function step(s: S, ctx: Ctx) {
  if (s.phase === 'roundEnd') return startHand(s, ctx);
  if (s.phase !== 'collect') return;
  const w = s.collecting!;
  s.won[w].push(...s.trick.map((p) => p.card));
  s.tricks[w]++;
  s.lastTrick = s.trick;
  s.trick = [];
  s.collecting = null;
  log(s, `${s.names[w]} takes the trick`);
  fx(s, 'collect');
  if (s.hands.every((h) => !h.length)) return endHand(s);
  s.phase = 'play';
  s.leader = s.turn = w;
}

function endHand(s: S) {
  s.lines = [];
  for (const t of [0, 1]) {
    const seats = [t, t + 2];
    let delta = 0;
    let bid = 0, took = 0, bags = 0;
    for (const i of seats) {
      if (s.bids[i] === 0) {
        delta += s.tricks[i] === 0 ? 100 : -100;
        bags += s.tricks[i];
        s.lines.push(`${s.names[i]} ${s.tricks[i] === 0 ? 'made nil +100' : 'broke nil −100'}`);
      } else {
        bid += s.bids[i]!;
        took += s.tricks[i];
      }
    }
    if (bid > 0) {
      if (took >= bid) {
        delta += bid * 10 + (took - bid);
        bags += took - bid;
      } else delta -= bid * 10;
    }
    s.bags[t] += bags;
    if (s.bags[t] >= 10) {
      s.bags[t] -= 10;
      delta -= 100;
      s.lines.push(`${teamName(s, t)} hit ten bags −100`);
    }
    s.score[t] += delta;
    s.lines.push(`${teamName(s, t)}: bid ${bid}, took ${took} → ${delta >= 0 ? '+' : ''}${delta} (${s.score[t]})`);
  }
  s.result = `Hand ${s.hand} scored`;
  const done = s.score.some((v) => v >= s.target) || s.score.some((v) => v <= -200);
  if (done && s.score[0] !== s.score[1]) {
    const w = s.score[0] > s.score[1] ? 0 : 1;
    s.result = `${teamName(s, w)} win ${s.score[w]} to ${s.score[1 - w]}`;
    s.phase = 'over';
    fx(s, 'win');
  } else s.phase = 'roundEnd';
}

const teamName = (s: S, t: number) => `${s.names[t]} & ${s.names[t + 2]}`;

// ---------------------------------------------------------------- CPU
function estimate(hand: Card[]): number {
  let t = 0;
  const bySuit = (x: string) => hand.filter((c) => c.s === x);
  for (const suit of ['H', 'D', 'C']) {
    const cs = bySuit(suit);
    if (cs.some((c) => hi(c) === 14)) t += cs.length <= 5 ? 1 : 0.6;
    if (cs.some((c) => hi(c) === 13) && cs.length >= 2 && cs.length <= 4) t += 0.7;
    if (cs.some((c) => hi(c) === 12) && cs.length >= 3 && cs.length <= 4) t += 0.25;
  }
  const sp = bySuit('S');
  for (const c of sp) {
    const v = hi(c);
    if (v === 14) t += 1;
    else if (v === 13) t += sp.length >= 2 ? 0.9 : 0.4;
    else if (v === 12) t += sp.length >= 3 ? 0.7 : 0.2;
  }
  t += Math.max(0, sp.length - 3) * 0.85;
  for (const suit of ['H', 'D', 'C']) if (bySuit(suit).length === 0 && sp.length >= 2) t += 0.6;
  return t;
}

function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  if (s.turn !== seat) return null;
  if (s.phase === 'bid') {
    const est = estimate(s.hands[seat]);
    if (est < 0.6 && !s.hands[seat].some((c) => c.s === 'S' && hi(c) >= 12) && s.bids[partner(seat)] !== 0 && ctx.level !== 'easy') return { t: 'bid', bid: 0 };
    let b = Math.round(est + (ctx.level === 'easy' ? ctx.rng.range(-1, 1) : 0));
    return { t: 'bid', bid: Math.max(1, Math.min(13, b)) };
  }
  if (s.phase !== 'play') return null;
  const ok = legal(s, seat);
  const t = team(seat);
  const need = [t, t + 2].reduce((a, i) => a + (s.bids[i] ?? 0), 0) - [t, t + 2].reduce((a, i) => a + s.tricks[i], 0);
  const nil = s.bids[seat] === 0;
  const wantWin = !nil && need > 0;
  return { t: 'play', card: chooseCard(ok, s.trick, { trump: 'S', wantWin, partner: s.bids[partner(seat)] === 0 ? undefined : partner(seat), seat, n: 4 }).id };
}

function view(s: S, viewer: Seat): View {
  const myTurn = s.turn === viewer && (s.phase === 'play' || s.phase === 'bid');
  const zones = trickZones(s, viewer, { playable: myTurn && s.phase === 'play' ? legal(s, viewer) : undefined });
  const buttons: View['buttons'] = [];
  let prompt: string | undefined;
  if (s.phase === 'bid' && myTurn) {
    const sug = Math.max(1, Math.round(estimate(s.hands[viewer])));
    for (let b = 0; b <= 13; b++) buttons.push({ label: b === 0 ? 'Nil' : String(b), a: { t: 'bid', bid: b }, kind: b === sug ? 'primary' : undefined });
    const pb = s.bids[partner(viewer)];
    prompt = `How many tricks will you take?${pb !== null ? ` Partner bid ${pb === 0 ? 'nil' : pb}.` : ''}`;
  } else if (s.phase === 'bid') prompt = `${s.names[s.turn]} is bidding…`;
  else if (myTurn) prompt = s.trick.length ? 'Follow suit if you can; spades trump' : s.broken ? 'Your lead' : 'Your lead (spades not broken yet)';
  else if (s.phase === 'play') prompt = `${s.names[s.turn]} to play`;
  if (s.phase === 'roundEnd' && !s.cpu[viewer]) buttons.push({ label: 'Next hand', a: { t: 'next' }, kind: 'primary', key: 'n' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return baseView(s, viewer, 'spades', {
    seats: s.names.map((name, i) => ({
      name,
      cpu: s.cpu[i],
      team: team(i),
      score: `${s.score[team(i)]} · ${s.bags[team(i)]} bags`,
      sub: s.bids[i] === null ? undefined : `Bid ${s.bids[i] === 0 ? 'nil' : s.bids[i]} · won ${s.tricks[i]}`,
      active: s.turn === i && (s.phase === 'bid' || s.phase === 'play'),
      win: s.phase === 'over' && s.score[team(i)] > s.score[1 - team(i)],
    })),
    zones,
    buttons,
    prompt,
    status: `Hand ${s.hand} · ${teamName(s, 0)} ${s.score[0]} – ${s.score[1]} ${teamName(s, 1)} · to ${s.target}`,
    banner: s.phase === 'roundEnd' || s.phase === 'over' ? { title: s.result, lines: s.lines, tone: s.phase === 'over' && s.score[team(viewer)] > s.score[1 - team(viewer)] ? 'win' : 'info' } : undefined,
    turn: s.turn,
    over: s.phase === 'over',
  });
}

export const spades: GameDef<S> = {
  meta: {
    id: 'spades',
    name: 'Spades',
    family: 'Trick-taking',
    players: { min: 4, max: 4, def: 4 },
    teams: true,
    blurb: 'Bid your tricks with a partner. Spades are always trump, and bags will bite.',
    hero: ['AS', 'KS', 'QS', 'JS', '2S'],
    length: '30–45 min',
    options: [{ id: 'target', label: 'Game ends at', type: 'select', default: 500, choices: [{ value: 250, label: '250 points' }, { value: 500, label: '500 points' }] }],
    rules: [
      ['Teams', 'You partner the player opposite you. Partners combine their tricks and score together.'],
      ['Bidding', 'Starting left of the dealer, each player bids how many tricks they expect to win. A bid of <em>nil</em> means you aim to take no tricks at all.'],
      ['Play', 'The player left of the dealer leads. Follow suit if you can; otherwise play anything, including a spade, which trumps. Spades cannot be led until one has been played (unless you hold only spades).'],
      ['Scoring', 'Make your team bid and score 10 per trick bid, plus 1 per extra trick (a <em>bag</em>). Miss it and lose 10 per trick bid. Every 10 bags costs 100. Nil scores +100 if made, −100 if broken.'],
      ['Winning', 'The first team to 500 wins. A team that sinks to −200 loses.'],
    ],
  },
  create: (players, ctx, options) => {
    const s: S = {
      n: 4, names: players.map((p) => p.name), cpu: players.map((p) => p.kind === 'cpu'), hands: [], trick: [], lastTrick: [], leader: 0, turn: 0,
      won: [], tricks: [], trump: 'S', dealer: ctx.rng.int(4), deal: 0, fx: [], fxn: 0, log: [], collecting: null,
      phase: 'bid', hand: 0, bids: [], broken: false, score: [0, 0], bags: [0, 0], target: Number(options.target ?? 500), result: '', lines: [],
    };
    startHand(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'bid' || s.phase === 'play' ? [s.turn] : s.phase === 'roundEnd' || s.phase === 'over' ? [0, 1, 2, 3].filter((i) => !s.cpu[i]) : []),
  act,
  auto: (s) => (s.phase === 'collect' ? 1100 : s.phase === 'roundEnd' && s.cpu.every(Boolean) ? 10 : null),
  step,
  cpu,
  view,
  over: (s) => s.phase === 'over',
};
