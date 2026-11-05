/**
 * Contracts shared by every game, the renderer and the network layer.
 *
 * A game is pure logic over a JSON state. The renderer and the network only
 * ever see a `View`: what one seat is allowed to see. Hidden cards carry no
 * face, so hidden information never leaves the host.
 */
import type { Rng } from './rng';

export type Seat = number;
export type Level = 'easy' | 'normal' | 'hard';
export type Action = { t: string; [k: string]: unknown };

export interface PlayerSlot {
  name: string;
  kind: 'human' | 'cpu' | 'remote';
  level?: Level;
}

export type Family = 'Casino' | 'Poker' | 'Trick-taking' | 'Rummy' | 'Shedding' | 'Family' | 'Classic' | 'Duel';

export interface OptionDef {
  id: string;
  label: string;
  type: 'select' | 'toggle' | 'number';
  choices?: { value: string | number; label: string }[];
  default: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface GameMeta {
  id: string;
  name: string;
  family: Family;
  players: { min: number; max: number; def: number };
  blurb: string;
  /** rules as small HTML fragments: [heading, html][] */
  rules: [string, string][];
  /** card codes for the lobby tile's fanned hand */
  hero: string[];
  realtime?: boolean;
  teams?: boolean;
  options?: OptionDef[];
  /** typical length of one game, shown in the lobby */
  length?: string;
}

export interface Ctx {
  rng: Rng;
  level?: Level;
}

export interface GameDef<S = any> {
  meta: GameMeta;
  create(players: PlayerSlot[], ctx: Ctx, options: Record<string, unknown>): S;
  /** seats that may act right now */
  toAct(s: S): Seat[];
  /** apply an action; return an error string if it is illegal */
  act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void;
  /** ms until `step` should run, or null if nothing is pending */
  auto?(s: S): number | null;
  step?(s: S, ctx: Ctx): void;
  cpu(s: S, seat: Seat, ctx: Ctx): Action | null;
  view(s: S, viewer: Seat): View;
  over(s: S): boolean;
}

// ---------------------------------------------------------------- views

export interface CardView {
  id: string;
  /** face code like "AS" or "10H"; absent = face down */
  f?: string;
  /** selectable for a multi-select action */
  sel?: boolean;
  /** clicking plays this action */
  act?: Action;
  hi?: boolean;
  dim?: boolean;
  /** lifted out of the hand (e.g. selected for a draw) */
  up?: boolean;
  /** seat that played it (trick layout pushes it toward that seat) */
  from?: Seat;
  rot?: number;
}

export type Slot = 'hand' | 'front' | 'bet' | 'side' | 'meld';
export type Anchor = { seat: Seat; slot: Slot; i?: number; n?: number } | { x: number; y: number };

export interface Zone {
  id: string;
  cards: CardView[];
  at: Anchor;
  lay: 'fan' | 'row' | 'stack' | 'trick' | 'grid' | 'column';
  /** total cards in a stack (only the top few are sprites) */
  count?: number;
  label?: string;
  scale?: number;
  gap?: number;
  cols?: number;
  /** clicking the zone (e.g. draw from stock) */
  act?: Action;
  needSel?: [number, number];
  /** placeholder outlines for empty slots (e.g. the board) */
  slots?: number;
  /** spawn point for cards that appear from nowhere */
  deck?: boolean;
}

export interface ChipStack {
  id: string;
  at: Anchor;
  amount: number;
  label?: string;
}

export interface SeatView {
  name: string;
  cpu: boolean;
  sub?: string;
  score?: string;
  chips?: number;
  badges?: string[];
  active?: boolean;
  out?: boolean;
  team?: number;
  /** a short speech bubble ("Check", "Raise to 120") */
  say?: string;
  win?: boolean;
}

export interface Button {
  label: string;
  a: Action;
  kind?: 'primary' | 'danger' | 'ghost';
  needSel?: [number, number];
  key?: string;
}

export interface BetControl {
  t: string; // action type to send with {amount}
  min: number;
  max: number;
  step: number;
  presets: { label: string; amount: number }[];
  verb: string; // "Raise to" / "Bet"
}

export interface Banner {
  title: string;
  lines?: string[];
  tone?: 'win' | 'lose' | 'info';
}

export interface FxEvent {
  n: number; // sequence number
  k: string; // 'chips' | 'win' | 'allin' | 'flip' | 'knock' | 'slap' | 'shuffle' ...
}

export interface View {
  game: string;
  viewer: Seat;
  seats: SeatView[];
  zones: Zone[];
  chips?: ChipStack[];
  buttons: Button[];
  bet?: BetControl;
  prompt?: string;
  status?: string;
  banner?: Banner;
  scores?: { head: string[]; rows: (string | number)[][] };
  log?: string[];
  /** increments on every fresh deal: the renderer runs the dealer's cardistry */
  deal: number;
  dealer?: Seat;
  turn?: Seat;
  fx?: FxEvent[];
  over?: boolean;
}
