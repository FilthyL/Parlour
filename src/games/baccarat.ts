/**
 * Punto Banco baccarat: bet on Player, Banker or Tie, then the cards are
 * dealt and drawn strictly by the tableau. Banker pays 0.95:1 (5 %
 * commission), Tie 8:1 (Player and Banker bets push on a tie).
 */
import { code, newDeck, type Card } from '../core/cards';
import type { Action, ChipStack, Ctx, FxEvent, GameDef, Level, Seat, View, Zone } from '../core/types';

type Side = 'player' | 'banker' | 'tie';
interface P {
  name: string;
  cpu: boolean;
  level: Level;
  bank: number;
  side: Side;
  bet: number;
  ready: boolean;
  say?: string;
}
type Phase = 'bet' | 'deal' | 'settle' | 'over';
interface S {
  players: P[];
  shoe: Card[];
  discard: Card[];
  ph: Card[];
  bh: Card[];
  queue: ('p' | 'b')[];
  shown: number;
  phase: Phase;
  round: number;
  maxRounds: number;
  history: ('P' | 'B' | 'T')[];
  result: string;
  deal: number;
  fx: FxEvent[];
  fxn: number;
  log: string[];
}

const pv = (c: Card) => (c.r >= 10 ? 0 : c.r);
export const bacTotal = (h: Card[]) => h.reduce((a, c) => a + pv(c), 0) % 10;
const fmt = (n: number) => n.toLocaleString('en-US');
const fx = (s: S, k: string) => {
  s.fx.push({ n: ++s.fxn, k });
  if (s.fx.length > 12) s.fx.shift();
};
const log = (s: S, m: string) => {
  s.log.push(m);
  if (s.log.length > 60) s.log.shift();
};

/** The banker's third-card rule, given the player's third card (or null if the player stood). */
export function bankerDraws(bankerTotal: number, playerThird: Card | null): boolean {
  if (playerThird === null) return bankerTotal <= 5;
  const t = pv(playerThird);
  switch (bankerTotal) {
    case 0: case 1: case 2: return true;
    case 3: return t !== 8;
    case 4: return t >= 2 && t <= 7;
    case 5: return t >= 4 && t <= 7;
    case 6: return t === 6 || t === 7;
    default: return false;
  }
}

function startRound(s: S, ctx: Ctx) {
  s.discard.push(...s.ph, ...s.bh);
  s.ph = [];
  s.bh = [];
  s.shown = 0;
  if (s.shoe.length < 16) {
    s.shoe = newDeck(ctx.rng, { decks: 8 });
    s.discard = [];
    s.deal++;
    fx(s, 'shuffle');
    log(s, 'A fresh eight-deck shoe');
  }
  s.round++;
  if (s.maxRounds && s.round > s.maxRounds) return void (s.phase = 'over');
  s.phase = 'bet';
  s.result = '';
  for (const p of s.players) {
    p.ready = false;
    p.say = undefined;
    if (p.bank < 5) {
      p.bet = 0;
      p.ready = true;
      continue;
    }
    if (p.cpu) {
      const r = ctx.rng.next();
      p.side = r < 0.47 ? 'banker' : r < 0.94 ? 'player' : 'tie';
      p.bet = Math.min(p.bank, p.side === 'tie' ? 10 : Math.round((10 + ctx.rng.next() * 90) / 5) * 5);
      p.ready = true;
    } else p.bet = Math.min(p.bet || 25, p.bank);
  }
  if (s.players.every((p) => p.ready)) begin(s);
}

function begin(s: S) {
  if (s.players.every((p) => !p.bet)) {
    s.players.forEach((p) => (p.bank = 1000));
  }
  for (const p of s.players) p.bank -= p.bet;
  // P B P B, then third cards by the tableau (decided as cards are revealed)
  s.ph = [s.shoe.pop()!, s.shoe.pop()!];
  s.bh = [s.shoe.pop()!, s.shoe.pop()!];
  // reorder ids so the visual deal alternates
  s.queue = ['p', 'b', 'p', 'b'];
  s.shown = 0;
  s.phase = 'deal';
  fx(s, 'chips');
}

/** Reveal the next card; decide third cards once the first four are up. */
function dealStep(s: S) {
  if (s.shown < 4) {
    s.shown++;
    fx(s, 'flip');
    if (s.shown < 4) return;
    const p = bacTotal(s.ph), b = bacTotal(s.bh);
    if (p >= 8 || b >= 8) return; // natural
    let pThird: Card | null = null;
    if (p <= 5) {
      pThird = s.shoe.pop()!;
      s.ph.push(pThird);
      s.queue.push('p');
    }
    if (bankerDraws(b, pThird)) {
      s.bh.push(s.shoe.pop()!);
      s.queue.push('b');
    }
    return;
  }
  if (s.shown < s.queue.length) {
    s.shown++;
    fx(s, 'flip');
    return;
  }
  settle(s);
}

function settle(s: S) {
  const p = bacTotal(s.ph), b = bacTotal(s.bh);
  const w: 'P' | 'B' | 'T' = p > b ? 'P' : b > p ? 'B' : 'T';
  s.history.push(w);
  if (s.history.length > 24) s.history.shift();
  const natural = s.ph.length === 2 && s.bh.length === 2 && (p >= 8 || b >= 8);
  s.result = w === 'T' ? `Tie at ${p}` : `${w === 'P' ? 'Player' : 'Banker'} wins ${Math.max(p, b)} to ${Math.min(p, b)}${natural ? ' (natural)' : ''}`;
  for (const pl of s.players) {
    if (!pl.bet) continue;
    let pay = 0;
    if (w === 'T') pay = pl.side === 'tie' ? pl.bet * 9 : pl.bet;
    else if (w === 'P' && pl.side === 'player') pay = pl.bet * 2;
    else if (w === 'B' && pl.side === 'banker') pay = pl.bet + Math.floor(pl.bet * 0.95);
    pl.bank += pay;
    const net = pay - pl.bet;
    pl.say = net > 0 ? `Wins ${fmt(net)}` : net < 0 ? `Loses ${fmt(-net)}` : 'Push';
  }
  log(s, s.result);
  s.phase = 'settle';
  fx(s, 'pot');
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  const p = s.players[seat];
  if (s.phase === 'settle') return a.t === 'next' ? void startRound(s, ctx) : 'Hold on';
  if (s.phase === 'over') {
    if (a.t !== 'rematch') return 'The session is over';
    s.players.forEach((x) => (x.bank = 1000));
    s.round = 0;
    return void startRound(s, ctx);
  }
  if (s.phase !== 'bet') return 'The cards are out';
  if (p.ready) return 'Waiting for the others';
  switch (a.t) {
    case 'side':
      if (!['player', 'banker', 'tie'].includes(a.side as string)) return 'Pick Player, Banker or Tie';
      p.side = a.side as Side;
      return;
    case 'chip': {
      const v = Number(a.v);
      if (p.bet + v > p.bank) return 'Not enough chips';
      p.bet += v;
      fx(s, 'chips');
      return;
    }
    case 'clear':
      p.bet = 0;
      return;
    case 'rebuy':
      if (p.bank >= 5) return 'You still have chips';
      p.bank = 1000;
      return;
    case 'deal':
      if (p.bet < 5) return 'Minimum bet is 5';
      p.ready = true;
      break;
    case 'sitout':
      p.bet = 0;
      p.ready = true;
      break;
    default:
      return 'Place a bet';
  }
  if (s.players.every((x) => x.ready)) begin(s);
}

function view(s: S, viewer: Seat): View {
  const show = (h: Card[], who: 'p' | 'b') => {
    // a card is face up once its turn in the deal queue has come
    let seen = 0;
    return h.map((c, i) => {
      let order = -1;
      for (let q = 0, k = 0; q < s.queue.length; q++) if (s.queue[q] === who) { if (k === i) { order = q; break; } k++; }
      seen = order >= 0 && order < s.shown ? 1 : 0;
      return { id: c.id, f: seen ? code(c) : undefined, rot: i === 2 ? 90 : 0 };
    });
  };
  const revealed = (h: Card[], who: 'p' | 'b') => show(h, who).filter((c) => c.f).map((_, i) => h[i]);
  const zones: Zone[] = [
    { id: 'shoe', at: { x: 0.52, y: -0.5, p: [0.42, -0.62] }, lay: 'stack', deck: true, scale: 0.75, count: s.shoe.length, cards: s.shoe.slice(-6).map((c) => ({ id: c.id, rot: -8 })) },
    { id: 'discard', at: { x: -0.52, y: -0.5, p: [-0.42, -0.62] }, lay: 'stack', scale: 0.75, cards: s.discard.slice(-6).map((c) => ({ id: c.id, rot: 8 })) },
    { id: 'player', at: { x: -0.24, y: -0.14, p: [-0.3, -0.12] }, lay: 'row', gap: 0.6, label: s.ph.length ? `Player ${bacTotal(revealed(s.ph, 'p'))}` : 'Player', cards: show(s.ph, 'p') },
    { id: 'banker', at: { x: 0.24, y: -0.14, p: [0.3, -0.12] }, lay: 'row', gap: 0.6, label: s.bh.length ? `Banker ${bacTotal(revealed(s.bh, 'b'))}` : 'Banker', cards: show(s.bh, 'b') },
  ];
  const chips: ChipStack[] = s.players.flatMap((p, i) => (p.bet > 0 ? [{ id: `bet${i}`, at: { seat: i, slot: 'bet' as const }, amount: p.bet, label: `${p.side[0].toUpperCase() + p.side.slice(1)} ${fmt(p.bet)}` }] : []));
  const me = s.players[viewer];
  const buttons: View['buttons'] = [];
  let prompt: string | undefined;
  if (s.phase === 'bet' && !me.cpu && !me.ready) {
    if (me.bank < 5) buttons.push({ label: 'Rebuy 1,000', a: { t: 'rebuy' }, kind: 'primary' });
    else {
      for (const side of ['player', 'banker', 'tie'] as Side[]) buttons.push({ label: side === 'player' ? 'Player 1:1' : side === 'banker' ? 'Banker 0.95:1' : 'Tie 8:1', a: { t: 'side', side }, kind: me.side === side ? 'primary' : 'ghost' });
      for (const v of [5, 25, 100]) buttons.push({ label: `+${v}`, a: { t: 'chip', v }, kind: 'ghost' });
      buttons.push({ label: 'Clear', a: { t: 'clear' }, kind: 'ghost' });
      buttons.push({ label: `Deal ${fmt(me.bet)} on ${me.side}`, a: { t: 'deal' }, kind: 'primary', key: 'd' });
    }
    prompt = 'Choose a side and a stake';
  } else if (s.phase === 'bet') prompt = 'Waiting for bets…';
  else if (s.phase === 'settle' && !me.cpu) buttons.push({ label: 'Next coup', a: { t: 'next' }, kind: 'primary', key: 'n' });
  else if (s.phase === 'over' && !me.cpu) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  const road = s.history.slice(-14).join(' ');
  return {
    game: 'baccarat',
    viewer,
    seats: s.players.map((p, i) => ({ name: p.name, cpu: p.cpu, chips: p.bank, say: p.say, active: s.phase === 'bet' && !p.ready, win: s.phase === 'settle' && !!p.say?.startsWith('Wins'), sub: s.phase !== 'bet' && p.bet ? `On ${p.side}` : undefined, out: !p.bet && s.phase !== 'bet' && i !== viewer })),
    zones,
    chips,
    buttons,
    prompt,
    status: `Coup ${s.round} · eight decks${road ? ` · road ${road}` : ''}`,
    banner: s.phase === 'settle' ? { title: s.result, lines: [me.say ? `You: ${me.say.toLowerCase()}` : ''].filter(Boolean), tone: me.say?.startsWith('Wins') ? 'win' : 'info' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    fx: s.fx,
    over: s.phase === 'over',
  };
}

export const baccarat: GameDef<S> = {
  meta: {
    id: 'baccarat',
    name: 'Baccarat',
    family: 'Casino',
    players: { min: 1, max: 7, def: 4 },
    blurb: 'Punto Banco from an eight-deck shoe: back the Player, the Banker or a Tie.',
    hero: ['9H', '8S', 'KD', 'QC', '9D'],
    length: 'Play as long as you like',
    rules: [
      ['Goal', 'Bet on which hand, Player or Banker, will total closer to 9, or on a tie. You are not playing the hands yourself: the cards are drawn by fixed rules.'],
      ['Counting', 'Aces count 1, 2–9 their value, tens and court cards 0. Only the last digit of the total counts, so 7 + 8 = 5.'],
      ['Naturals', 'Two cards each are dealt. If either hand totals 8 or 9 (a <em>natural</em>), both stand.'],
      ['Third cards', 'The Player draws on 0–5 and stands on 6–7. If the Player stood, the Banker draws on 0–5. Otherwise the Banker draws by the standard tableau, depending on its total and the Player’s third card.'],
      ['Payouts', 'Player pays 1 to 1. Banker pays 1 to 1 less 5% commission. Tie pays 8 to 1, and Player and Banker bets push on a tie.'],
    ],
  },
  create: (players, ctx, options) => {
    const s: S = {
      players: players.map((p) => ({ name: p.name, cpu: p.kind === 'cpu', level: p.level ?? 'normal', bank: 1000, side: 'banker', bet: 25, ready: false })),
      shoe: [], discard: [], ph: [], bh: [], queue: [], shown: 0, phase: 'bet', round: 0, maxRounds: Number(options.rounds ?? 0), history: [], result: '', deal: 0, fx: [], fxn: 0, log: [],
    };
    startRound(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'bet' ? s.players.map((p, i) => (!p.ready ? i : -1)).filter((i) => i >= 0) : s.phase === 'settle' || s.phase === 'over' ? s.players.map((p, i) => (p.cpu ? -1 : i)).filter((i) => i >= 0) : []),
  act,
  auto: (s) => (s.phase === 'deal' ? 750 : s.phase === 'settle' ? (s.players.every((p) => p.cpu) ? 10 : 4500) : null),
  step: (s, ctx) => (s.phase === 'deal' ? dealStep(s) : s.phase === 'settle' ? startRound(s, ctx) : undefined),
  cpu: (s, seat) => (s.phase === 'bet' && !s.players[seat].ready ? { t: 'deal' } : null),
  view,
  over: (s) => s.phase === 'over',
};
