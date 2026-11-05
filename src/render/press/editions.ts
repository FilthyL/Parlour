/**
 * Ink editions for the card press. Each edition replaces the four process
 * inks of the source art, so court-card robes, crowns and pips are all
 * reprinted in the edition's palette.
 */
export type RGB = [number, number, number];

export interface Edition {
  id: string;
  name: string;
  blurb: string;
  paper: RGB; // card stock
  black: RGB; // key plate
  red: RGB; // red suits and robes
  blue: RGB; // court-card blues
  gold: RGB; // gold plate (also drives the foil mask)
  back: RGB; // back field ink
  backLine: RGB; // back accent ink (frames, rosette heart)
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export const EDITIONS: Edition[] = [
  {
    id: 'heritage',
    name: 'Heritage',
    blurb: 'Lacquer red and Prussian blue on ivory stock.',
    paper: hex('#f7f2e6'),
    black: hex('#18161b'),
    red: hex('#c01f2b'),
    blue: hex('#1f4a86'),
    gold: hex('#d7a93c'),
    back: hex('#9e1b28'),
    backLine: hex('#d7a93c'),
  },
  {
    id: 'noir',
    name: 'Noir',
    blurb: 'Oxblood and slate, gilded courts, a black back.',
    paper: hex('#f1ebdf'),
    black: hex('#111014'),
    red: hex('#8f1d2c'),
    blue: hex('#343b4c'),
    gold: hex('#c9a45c'),
    back: hex('#17161c'),
    backLine: hex('#c9a45c'),
  },
  {
    id: 'riviera',
    name: 'Riviera',
    blurb: 'Navy key, coral suits, teal robes.',
    paper: hex('#f9f5eb'),
    black: hex('#142a4c'),
    red: hex('#de4b37'),
    blue: hex('#14807c'),
    gold: hex('#e6b24a'),
    back: hex('#173a6b'),
    backLine: hex('#e6b24a'),
  },
  {
    id: 'jade',
    name: 'Jade',
    blurb: 'Cinnabar and jade with a forest back.',
    paper: hex('#f5f1e4'),
    black: hex('#14201c'),
    red: hex('#b8262c'),
    blue: hex('#0f6a56'),
    gold: hex('#cfa758'),
    back: hex('#1b5a45'),
    backLine: hex('#cfa758'),
  },
];

export const editionById = (id: string): Edition => EDITIONS.find((e) => e.id === id) ?? EDITIONS[0];
