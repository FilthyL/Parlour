/**
 * Deck editions.
 *
 * - `flow` editions are this site's own design: every face is a solved flow
 *   field around its pips (see flow.ts / composer.ts).
 * - `classic` editions reprint the public-domain traditional art with custom
 *   inks (see printer.ts).
 */
import type { MapName } from './colormaps';

export type RGB = [number, number, number];

interface Base {
  id: string;
  name: string;
  blurb: string;
}

export interface ClassicEdition extends Base {
  kind: 'classic';
  paper: RGB;
  black: RGB;
  red: RGB;
  blue: RGB;
  gold: RGB;
  back: RGB;
  backLine: RGB;
}

export interface FlowEdition extends Base {
  kind: 'flow';
  stock: RGB; // face: white card stock
  inkBlack: [string, string]; // pip/index ink (top → bottom gradient)
  inkRed: [string, string];
  /** contour hairlines: one tint per suit colour, or a colormap by flow speed */
  lineMode: 'tint' | 'map';
  lineBlack: RGB;
  lineRed: RGB;
  lineMap: MapName;
  lineAlpha: number;
  /** the single soft contour band hugging each pip */
  bandBlack: RGB;
  bandRed: RGB;
  bandAlpha: number;
  foil: string[]; // metallic gradient stops (frames, ace rings, court outlines)
  foilKind: 'gold' | 'silver' | 'holo';
  // back: full-colour flow field
  backMap: MapName;
  backStock: RGB;
  backS0: number;
  backGamma: number;
}

export type Edition = ClassicEdition | FlowEdition;

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export const EDITIONS: Edition[] = [
  {
    id: 'vortex',
    kind: 'flow',
    name: 'Vortex',
    blurb: 'White stock, prussian and crimson contour lines, an ultramarine back.',
    stock: hex('#fdfcf8'),
    inkBlack: ['#1a1b22', '#0d0e12'],
    inkRed: ['#d0243a', '#a8101f'],
    lineMode: 'tint',
    lineBlack: hex('#2c4d80'),
    lineRed: hex('#c81e32'),
    lineMap: 'abyss',
    lineAlpha: 0.5,
    bandBlack: hex('#dfe8f4'),
    bandRed: hex('#fbe1e1'),
    bandAlpha: 0.75,
    foil: ['#14227a', '#4a63f0', '#1d36c4', '#9db0f7', '#14227a'],
    foilKind: 'silver',
    backMap: 'dye',
    backStock: hex('#f4f5f1'),
    backS0: 1.9,
    backGamma: 1.35,
  },
  {
    id: 'spectra',
    kind: 'flow',
    name: 'Spectra',
    blurb: 'Rainbow CFD hairlines on white, a full-spectrum back.',
    stock: hex('#fdfdfc'),
    inkBlack: ['#16171d', '#0a0b0e'],
    inkRed: ['#e0263c', '#b30f25'],
    lineMode: 'map',
    lineBlack: hex('#2c4d80'),
    lineRed: hex('#c81e32'),
    lineMap: 'turbo',
    lineAlpha: 0.5,
    bandBlack: hex('#e6eefb'),
    bandRed: hex('#fde6e3'),
    bandAlpha: 0.7,
    foil: ['#6f7684', '#e8edf5', '#9aa3b2', '#ffffff', '#7d8696'],
    foilKind: 'silver',
    backMap: 'turbo',
    backStock: hex('#05060a'),
    backS0: 1.9,
    backGamma: 1.2,
  },
  {
    id: 'magma',
    kind: 'flow',
    name: 'Magma',
    blurb: 'Ember-to-violet hairlines on white, a deep-sea back.',
    stock: hex('#fefcf9'),
    inkBlack: ['#1b1622', '#0d0a12'],
    inkRed: ['#d92b43', '#ae1230'],
    lineMode: 'map',
    lineBlack: hex('#3b2a6b'),
    lineRed: hex('#c81e32'),
    lineMap: 'magma',
    lineAlpha: 0.48,
    bandBlack: hex('#ece6f6'),
    bandRed: hex('#fde3df'),
    bandAlpha: 0.7,
    foil: ['#8a6bff', '#5ef2ff', '#ffd36e', '#ff7ad9', '#8a6bff'],
    foilKind: 'holo',
    backMap: 'mako',
    backStock: hex('#050406'),
    backS0: 1.9,
    backGamma: 1.3,
  },
  {
    id: 'laminar',
    kind: 'flow',
    name: 'Laminar',
    blurb: 'Graphite wind-tunnel lines on ivory, a midnight back.',
    stock: hex('#f8f4ea'),
    inkBlack: ['#1d1e24', '#0e0f13'],
    inkRed: ['#c62a38', '#9c1424'],
    lineMode: 'tint',
    lineBlack: hex('#4a4a4f'),
    lineRed: hex('#8f4a44'),
    lineMap: 'abyss',
    lineAlpha: 0.48,
    bandBlack: hex('#ebe6da'),
    bandRed: hex('#f1e0d8'),
    bandAlpha: 0.75,
    foil: ['#8c6a2c', '#e6c97f', '#b38b3c', '#fbe9b8', '#94702f'],
    foilKind: 'gold',
    backMap: 'abyss',
    backStock: hex('#0b1220'),
    backS0: 1.9,
    backGamma: 1.3,
  },
  {
    id: 'heritage',
    kind: 'classic',
    name: 'Heritage',
    blurb: 'The traditional courts, re-inked on ivory stock.',
    paper: hex('#f7f2e6'),
    black: hex('#18161b'),
    red: hex('#c01f2b'),
    blue: hex('#1f4a86'),
    gold: hex('#d7a93c'),
    back: hex('#9e1b28'),
    backLine: hex('#d7a93c'),
  },
];

export const editionById = (id: string): Edition => EDITIONS.find((e) => e.id === id) ?? EDITIONS[0];
