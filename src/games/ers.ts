/**
 * Egyptian Rat Screw: flip cards onto the pile in turn. A face card or ace
 * challenges the next player to answer with one of their own within 1–4
 * tries; fail and the challenger takes the pile. Anyone may slap a double
 * or a sandwich to take the pile. A wrong slap burns a card. Collect every
 * card to win. Real-time: the computer slaps with human-like reactions.
 */
import { code, type Card, newDeck } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View, Zone } from '../core/types';
import { base, fx, humans, log, rankWord, type Base } from './shared';

interface S extends Base {
  piles: Card[][];
  pile: Card[];
  burned: Card[];
  phase: 'flip' | 'award' | 'over';
  turn: Seat;
  challenger: Seat; // who played the face card (−1 = none)
  chances: number;
  awardTo: Seat;
  flips: number;
  maxFlips: number;
  says: (string | undefined)[];
  slapSeq: number;
  result: string;
}

const tries = (c: Card) => ({ 11: 1, 12: 2, 13: 3, 1: 4 } as Record<number, number>)[c.r] ?? 0;

/** Is the top of the pile slappable right now? */
export function slappable(pile: Card[]) {
  const n = pile.length;
  if (n >= 2 && pile[n - 1].r === pile[n - 2].r) return 'double';
  if (n >= 3 && pile[n - 1].r === pile[n - 3].r) return 'sandwich';
  return null;
}

function setup(s: S, ctx: Ctx) {
  const deck = newDeck(ctx.rng);
  s.piles = s.names.map(() => []);
  let i = 0;
  while (deck.length) s.piles[i++ % s.n].push(deck.pop()!);
  s.pile = [];
  s.burned = [];
  s.phase = 'flip';
  s.turn = ctx.rng.int(s.n);
  s.challenger = -1;
  s.chances = 0;
  s.awardTo = -1;
  s.flips = 0;
  s.says = s.names.map(() => undefined);
  s.slapSeq = 0;
  s.result = '';
  s.deal++;
  fx(s, 'shuffle');
}

const alive = (s: S, i: Seat) => s.piles[i].length > 0;
function nextAlive(s: S, from: Seat) {
  for (let k = 1; k <= s.n; k++) {
    const j = (from + k) % s.n;
    if (alive(s, j)) return j;
  }
  return from;
}

function take(s: S, who: Seat, why: string) {
  const won = [...s.pile, ...s.burned];
  s.piles[who].push(...won);
  log(s, `${s.names[who]} takes ${won.length} cards (${why})`);
  s.says = s.names.map(() => undefined);
  s.says[who] = why === 'slap' ? `Slap! +${won.length}` : `+${won.length}`;
  s.pile = [];
  s.burned = [];
  s.challenger = -1;
  s.chances = 0;
  s.turn = who;
  fx(s, 'collect');
  checkWin(s);
}

function checkWin(s: S) {
  const left = s.names.map((_, i) => i).filter((i) => alive(s, i));
  const tableEmpty = !s.pile.length && !s.burned.length;
  if (left.length === 1 && tableEmpty) {
    s.phase = 'over';
    s.result = `${s.names[left[0]]} has every card!`;
    fx(s, 'win');
    return true;
  }
  if (s.maxFlips && s.flips >= s.maxFlips && tableEmpty) {
    const most = Math.max(...s.piles.map((p) => p.length));
    const w = s.piles.findIndex((p) => p.length === most);
    s.phase = 'over';
    s.result = `${s.names[w]} wins on cards (${most})`;
    fx(s, 'win');
    return true;
  }
  return false;
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'over') return a.t === 'rematch' ? void setup(s, ctx) : 'The game is over';
  if (a.t === 'slap') {
    const kind = slappable(s.pile);
    if (kind) {
      s.slapSeq++;
      fx(s, 'allin');
      s.phase = 'flip';
      return take(s, seat, 'slap');
    }
    // a wrong slap burns a card
    if (!alive(s, seat)) return 'Nothing to slap';
    const c = s.piles[seat].shift()!;
    s.burned.push(c);
    s.says[seat] = 'Bad slap: burn one';
    log(s, `${s.names[seat]} slaps wrongly and burns a card`);
    fx(s, 'fold');
    if (!alive(s, seat) && s.turn === seat) s.turn = nextAlive(s, seat);
    return;
  }
  if (s.phase !== 'flip') return 'Hold on';
  if (a.t !== 'flip') return 'Flip or slap';
  if (seat !== s.turn) return "It isn't your turn to flip";
  if (!alive(s, seat)) return 'You have no cards';
  const c = s.piles[seat].shift()!;
  s.pile.push(c);
  s.flips++;
  s.says[seat] = undefined;
  fx(s, 'draw');
  if (tries(c)) {
    s.challenger = seat;
    s.chances = tries(c);
    s.turn = nextAlive(s, seat);
    s.says[seat] = `${rankWord(c.r)}! ${s.chances} ${s.chances > 1 ? 'tries' : 'try'}`;
    return;
  }
  if (s.challenger >= 0) {
    s.chances--;
    if (s.chances <= 0) {
      s.awardTo = s.challenger;
      s.phase = 'award';
      return;
    }
    if (!alive(s, seat)) s.turn = nextAlive(s, seat);
    return;
  }
  s.turn = nextAlive(s, seat);
}

function step(s: S) {
  if (s.phase !== 'award') return;
  s.phase = 'flip';
  take(s, s.awardTo, 'challenge');
}

const REACT = { easy: [850, 1500], normal: [520, 1000], hard: [300, 620] };

function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  if (s.phase === 'over') return null;
  const level = ctx.level ?? 'normal';
  if (slappable(s.pile)) {
    const [lo, hi2] = REACT[level];
    return { t: 'slap', delay: lo + ctx.rng.int(hi2 - lo) };
  }
  if (s.phase === 'flip' && s.turn === seat && alive(s, seat)) {
    // an occasional mistaken slap on easy
    if (level === 'easy' && s.pile.length > 1 && ctx.rng.chance(0.02)) return { t: 'slap', delay: 400 };
    return { t: 'flip', delay: 250 + ctx.rng.int(350) };
  }
  return null;
}

function view(s: S, viewer: Seat): View {
  const zones: Zone[] = s.names.map((_, i) => ({
    id: 'pile' + i,
    at: { seat: i, slot: 'hand' },
    lay: 'stack',
    deck: i === 0,
    label: `${s.piles[i].length}`,
    act: i === viewer && s.phase === 'flip' && s.turn === viewer ? { t: 'flip' } : undefined,
    cards: s.piles[i].slice(0, 5).map((c) => ({ id: c.id })),
  }));
  zones.push({
    id: 'center',
    at: { x: 0, y: -0.06 },
    lay: 'trick',
    act: s.phase !== 'over' ? { t: 'slap' } : undefined,
    label: s.pile.length ? `${s.pile.length} in the pile` : undefined,
    cards: [...s.burned.slice(-2).map((c) => ({ id: c.id, rot: 90 })), ...s.pile.slice(-7).map((c, k) => ({ id: c.id, f: code(c), rot: ((k * 41 + c.r * 7) % 31) - 15, hi: !!slappable(s.pile) && k >= s.pile.slice(-7).length - 1 }))],
  });
  const buttons: View['buttons'] = [];
  if (s.phase !== 'over' && !s.cpu[viewer]) {
    buttons.push({ label: 'Slap!', a: { t: 'slap' }, kind: 'danger', key: ' ' });
    if (s.phase === 'flip' && s.turn === viewer && alive(s, viewer)) buttons.push({ label: 'Flip', a: { t: 'flip' }, kind: 'primary', key: 'f' });
  }
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  const ch = s.challenger >= 0 ? `${s.names[s.turn]} has ${s.chances} ${s.chances === 1 ? 'try' : 'tries'} to answer` : undefined;
  return {
    game: 'ers',
    viewer,
    seats: s.names.map((name, i) => ({ name, cpu: s.cpu[i], score: `${s.piles[i].length} cards`, say: s.says[i], active: s.phase === 'flip' && s.turn === i, out: !alive(s, i) && s.phase !== 'over', win: s.phase === 'over' && s.result.startsWith(name) })),
    zones,
    buttons,
    prompt: s.phase === 'over' ? undefined : slappable(s.pile) ? 'SLAP IT!' : s.turn === viewer ? `Flip (F)${ch ? ` · ${ch}` : ''} · slap with Space` : ch ?? `${s.names[s.turn]} flips…`,
    status: `Doubles and sandwiches can be slapped · J 1, Q 2, K 3, A 4 tries`,
    banner: s.phase === 'over' ? { title: s.result, tone: s.result.startsWith(s.names[viewer]) ? 'win' : 'info' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    fx: s.fx,
    over: s.phase === 'over',
  };
}

export const ers: GameDef<S> = {
  meta: {
    id: 'ers',
    name: 'Egyptian Rat Screw',
    family: 'Duel',
    players: { min: 2, max: 6, def: 3 },
    realtime: true,
    cpuThink: 90,
    blurb: 'Flip fast, slap faster: doubles and sandwiches take the pile.',
    hero: ['JS', 'JH', 'QD', 'KC', 'AS'],
    length: '10–20 min',
    rules: [
      ['Deal', 'All the cards are dealt face down into piles. Nobody looks at their cards.'],
      ['Flipping', 'In turn, each player flips the top card of their pile onto the centre.'],
      ['Challenges', 'When a jack, queen, king or ace is played, the next player has 1, 2, 3 or 4 tries to play another face card or ace. If they do, the challenge passes on. If they don’t, the player who started it takes the whole pile.'],
      ['Slapping', 'Anyone may slap the pile when the top two cards match (a <em>double</em>) or the top and third card match (a <em>sandwich</em>). The first to slap takes the pile. Slap wrongly and you burn a card to the bottom of the pile.'],
      ['Winning', 'Players without cards are out, but may still slap their way back in. Collect every card to win. Press Space to slap and F to flip.'],
    ],
  },
  create: (players, ctx, options) => {
    const s: S = { ...base(players), piles: [], pile: [], burned: [], phase: 'flip', turn: 0, challenger: -1, chances: 0, awardTo: -1, flips: 0, maxFlips: Number(options.maxFlips ?? 1500), says: [], slapSeq: 0, result: '' };
    setup(s, ctx);
    return s;
  },
  // anyone may slap at any time, so every player is always "able to act"
  toAct: (s) => (s.phase === 'over' ? humans(s) : s.names.map((_, i) => i)),
  act,
  auto: (s) => (s.phase === 'award' ? 950 : null),
  step,
  cpu,
  view,
  over: (s) => s.phase === 'over',
};
