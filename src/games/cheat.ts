/**
 * Cheat (I Doubt It): play cards face down claiming the rank in sequence.
 * Anyone may call "Cheat!" and the loser of the challenge takes the pile.
 */
import { code, newDeck, type Card } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View, Zone } from '../core/types';
import { base, fx, handZone, humans, log, rankWord, type Base } from './shared';

interface S extends Base {
  hands: Card[][];
  pile: Card[];
  lastPlay: { seat: Seat; cards: Card[]; rank: number } | null;
  rank: number; // rank to claim next (1 = ace … 13 = king)
  phase: 'play' | 'challenge' | 'reveal' | 'over';
  turn: Seat;
  responses: (null | 'pass' | 'call')[];
  caller: Seat;
  truthful: boolean;
  says: (string | undefined)[];
  winner: Seat;
  result: string;
}

const claim = (n: number, r: number) => `${['', 'One', 'Two', 'Three', 'Four'][n]} ${rankWord(r, n > 1)}`;

function setup(s: S, ctx: Ctx) {
  const deck = newDeck(ctx.rng);
  s.hands = s.names.map(() => []);
  let i = 0;
  while (deck.length) s.hands[i++ % s.n].push(deck.pop()!);
  s.pile = [];
  s.lastPlay = null;
  s.rank = 1;
  s.phase = 'play';
  s.turn = ctx.rng.int(s.n);
  s.responses = s.names.map(() => null);
  s.caller = -1;
  s.says = s.names.map(() => undefined);
  s.winner = -1;
  s.result = '';
  s.deal++;
  fx(s, 'shuffle');
}

function nextTurn(s: S, from: Seat) {
  s.turn = (from + 1) % s.n;
  s.rank = (s.rank % 13) + 1;
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'over') return a.t === 'rematch' ? void setup(s, ctx) : 'The game is over';
  if (s.phase === 'challenge') {
    if (seat === s.lastPlay!.seat || s.responses[seat] !== null) return 'Waiting for the others';
    if (a.t === 'call') {
      s.responses[seat] = 'call';
      s.caller = seat;
      s.says[seat] = 'Cheat!';
      s.truthful = s.lastPlay!.cards.every((c) => c.r === s.lastPlay!.rank);
      s.phase = 'reveal';
      fx(s, 'allin');
      return;
    }
    if (a.t !== 'pass') return 'Call cheat or let it pass';
    s.responses[seat] = 'pass';
    if (s.responses.every((r, i) => i === s.lastPlay!.seat || r !== null)) closeChallenge(s);
    return;
  }
  if (s.phase !== 'play') return 'Hold on';
  if (seat !== s.turn) return "It isn't your turn";
  const cards = ((a.cards as string[]) ?? []).map((id) => s.hands[seat].find((c) => c.id === id)).filter(Boolean) as Card[];
  if (a.t !== 'play' || cards.length < 1 || cards.length > 4) return 'Play one to four cards face down';
  s.hands[seat] = s.hands[seat].filter((c) => !cards.includes(c));
  s.pile.push(...cards);
  s.lastPlay = { seat, cards, rank: s.rank };
  s.says = s.names.map(() => undefined);
  s.says[seat] = claim(cards.length, s.rank);
  log(s, `${s.names[seat]}: “${claim(cards.length, s.rank)}”`);
  fx(s, 'fold');
  s.phase = 'challenge';
  s.responses = s.names.map((_, i) => (i === seat ? 'pass' : null));
}

/** Nobody called: play moves on (or the last card wins). */
function closeChallenge(s: S) {
  const p = s.lastPlay!.seat;
  if (!s.hands[p].length) {
    s.winner = p;
    s.phase = 'over';
    s.result = `${s.names[p]} is out of cards and wins!`;
    fx(s, 'win');
    return;
  }
  s.phase = 'play';
  nextTurn(s, p);
}

function resolveReveal(s: S) {
  const p = s.lastPlay!.seat;
  const loser = s.truthful ? s.caller : p;
  s.hands[loser].push(...s.pile);
  log(s, s.truthful ? `${s.names[p]} told the truth: ${s.names[s.caller]} takes ${s.pile.length} cards` : `Caught! ${s.names[p]} takes ${s.pile.length} cards`);
  s.says[loser] = `Takes ${s.pile.length}`;
  s.pile = [];
  fx(s, 'collect');
  if (s.truthful && !s.hands[p].length) {
    s.winner = p;
    s.phase = 'over';
    s.result = `${s.names[p]} played their last cards honestly and wins!`;
    fx(s, 'win');
    return;
  }
  s.phase = 'play';
  s.lastPlay = null;
  nextTurn(s, p);
}

function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  const hand = s.hands[seat];
  if (s.phase === 'challenge') {
    if (s.responses[seat] !== null) return null;
    const lp = s.lastPlay!;
    const mine = hand.filter((c) => c.r === lp.rank).length;
    let p = 0.08 + (lp.cards.length - 1) * 0.12;
    if (mine + lp.cards.length > 4) p = 1; // impossible claim
    if (!s.hands[lp.seat].length) p += 0.65; // they'd win
    if (s.pile.length > 10) p -= 0.05;
    if (ctx.level === 'easy') p *= 0.6;
    if (ctx.level === 'hard' && mine >= 2) p += 0.15;
    return { t: ctx.rng.chance(Math.min(1, Math.max(0, p))) ? 'call' : 'pass', delay: 300 + ctx.rng.int(900) };
  }
  if (s.phase !== 'play' || s.turn !== seat) return null;
  const real = hand.filter((c) => c.r === s.rank);
  if (real.length) {
    const extra = ctx.level !== 'easy' && hand.length > real.length && real.length < 4 && ctx.rng.chance(0.2) ? [farCard(hand.filter((c) => c.r !== s.rank), s.rank)] : [];
    return { t: 'play', cards: [...real, ...extra].slice(0, 4).map((c) => c.id) };
  }
  // bluff with the card least useful soon (furthest ahead in the cycle)
  const n = hand.length > 6 && ctx.rng.chance(0.3) ? 2 : 1;
  const picks = [...hand].sort((a, b) => dist(b.r, s.rank) - dist(a.r, s.rank)).slice(0, n);
  return { t: 'play', cards: picks.map((c) => c.id) };
}
const dist = (r: number, cur: number) => (r - cur + 13) % 13;
const farCard = (cards: Card[], cur: number) => [...cards].sort((a, b) => dist(b.r, cur) - dist(a.r, cur))[0];

function view(s: S, viewer: Seat): View {
  const myTurn = s.phase === 'play' && s.turn === viewer;
  const zones: Zone[] = s.names.map((_, i) => handZone(i, viewer, s.hands[i], { sel: myTurn && i === viewer, reveal: s.phase === 'over', hi: (c) => myTurn && c.r === s.rank }));
  const reveal = s.phase === 'reveal';
  const lastIds = new Set(s.lastPlay?.cards.map((c) => c.id));
  zones.push({
    id: 'pile',
    at: { x: 0, y: -0.06 },
    lay: 'trick',
    deck: true,
    label: s.pile.length ? `${s.pile.length} in the pile` : undefined,
    cards: s.pile.slice(-10).map((c, k) => ({ id: c.id, f: reveal && lastIds.has(c.id) ? code(c) : undefined, rot: ((k * 37) % 25) - 12, from: lastIds.has(c.id) ? s.lastPlay!.seat : undefined, hi: reveal && lastIds.has(c.id) && !s.truthful })),
  });
  const buttons: View['buttons'] = [];
  let prompt: string | undefined;
  if (myTurn) {
    buttons.push({ label: `Play as ${rankWord(s.rank, true)}`, a: { t: 'play' }, needSel: [1, 4], kind: 'primary', key: 'enter' });
    prompt = `Claim ${rankWord(s.rank, true)}: pick 1–4 cards (honest or not)`;
  } else if (s.phase === 'challenge' && s.responses[viewer] === null && !s.cpu[viewer]) {
    buttons.push({ label: 'Let it pass', a: { t: 'pass' }, kind: 'ghost', key: 'p' });
    buttons.push({ label: 'Cheat!', a: { t: 'call' }, kind: 'primary', key: 'c' });
    prompt = `${s.names[s.lastPlay!.seat]} claims ${claim(s.lastPlay!.cards.length, s.lastPlay!.rank).toLowerCase()}. Believe them?`;
  } else if (s.phase === 'challenge') prompt = 'Anyone calling cheat?';
  else if (s.phase === 'play') prompt = `${s.names[s.turn]} must claim ${rankWord(s.rank, true)}`;
  else if (reveal) prompt = s.truthful ? 'It was the truth!' : 'Caught cheating!';
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return {
    game: 'cheat',
    viewer,
    seats: s.names.map((name, i) => ({ name, cpu: s.cpu[i], sub: `${s.hands[i].length} cards`, say: s.says[i], active: (s.phase === 'play' && s.turn === i) || (s.phase === 'challenge' && s.responses[i] === null), win: s.phase === 'over' && i === s.winner })),
    zones,
    buttons,
    prompt,
    status: `Next claim: ${rankWord(s.rank, true)} · ${s.pile.length} card${s.pile.length === 1 ? '' : 's'} in the pile`,
    banner: s.phase === 'over' ? { title: s.result, tone: s.winner === viewer ? 'win' : 'info' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    fx: s.fx,
    over: s.phase === 'over',
  };
}

export const cheat: GameDef<S> = {
  meta: {
    id: 'cheat',
    name: 'Cheat',
    family: 'Shedding',
    players: { min: 3, max: 8, def: 5 },
    blurb: 'Claim the next rank, face down. Tell the truth, or bluff with a straight face.',
    hero: ['AS', 'AH', 'AD', 'KC', '9S'],
    length: '10–20 min',
    rules: [
      ['Deal', 'All the cards are dealt out. Players take turns clockwise.'],
      ['Claims', 'The first player puts one to four cards face down and says they are aces. The next must claim twos, then threes, up to kings, then aces again. Your cards may or may not be what you claim.'],
      ['Cheat!', 'After any play, anyone may call “Cheat!”. The cards are turned up: if the claim was false, the player who made it takes the whole pile; if it was true, the caller takes it.'],
      ['Winning', 'The first player to get rid of all their cards wins, as long as their last play survives a challenge.'],
    ],
  },
  create: (players, ctx) => {
    const s: S = { ...base(players), hands: [], pile: [], lastPlay: null, rank: 1, phase: 'play', turn: 0, responses: [], caller: -1, truthful: false, says: [], winner: -1, result: '' };
    setup(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'play' ? [s.turn] : s.phase === 'challenge' ? s.responses.map((r, i) => (r === null ? i : -1)).filter((i) => i >= 0) : s.phase === 'over' ? humans(s) : []),
  act,
  // humans get a few seconds to call before play moves on
  auto: (s) => (s.phase === 'challenge' ? 4200 : s.phase === 'reveal' ? 1900 : null),
  step: (s) => (s.phase === 'challenge' ? closeChallenge(s) : s.phase === 'reveal' ? resolveReveal(s) : undefined),
  cpu,
  view,
  over: (s) => s.phase === 'over',
};
