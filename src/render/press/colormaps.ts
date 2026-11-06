/** Colormaps in the spirit of scientific / CFD visualisation. */
export type Stop = [number, number, number];
export type Colormap = Stop[];

const hex = (h: string): Stop => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const cm = (...h: string[]): Colormap => h.map(hex);

export const MAPS = {
  // dark ground → ice: black suits on the Vortex edition
  abyss: cm('#04060c', '#0a1730', '#0f2e5c', '#13508f', '#1b7fb8', '#36b4d6', '#7fe0ea', '#e6fbff'),
  // dark ground → ember: red suits on the Vortex edition
  ember: cm('#070405', '#2a070d', '#561020', '#8f1a2a', '#c8302c', '#ec6a2d', '#fbab4c', '#ffe7a8'),
  // classic CFD "turbo"-like rainbow
  turbo: cm('#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#24eca6', '#61fc6c', '#a4fc3b', '#d1e835', '#f3c63a', '#fe9b2d', '#f36315', '#d93806', '#b11901', '#7a0402'),
  // perceptual maps
  magma: cm('#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fec287', '#fcfdbf'),
  mako: cm('#0b0405', '#2b1c35', '#3e356b', '#3b5998', '#357ba3', '#38a0ab', '#4fc2ad', '#a5e0c0', '#def5e5'),
  // ultramarine dye, deep ink to the palest wash (the default back)
  dye: cm('#0b1242', '#111c5e', '#16267f', '#1c32a6', '#2240cf', '#2c4ce4'),
  // light editions
  frost: cm('#f6f2ea', '#e3ebec', '#c7dbe2', '#9fc2d2', '#6f9fbb', '#467ea2', '#2b5f86'),
  blush: cm('#f7f1e8', '#f6e0d6', '#efc2b2', '#e39a87', '#cf6d5e', '#b2453f', '#8b2730'),
} satisfies Record<string, Colormap>;

export type MapName = keyof typeof MAPS;

export function sample(map: Colormap, t: number, out: number[]) {
  const x = Math.min(0.99999, Math.max(0, t)) * (map.length - 1);
  const i = x | 0, f = x - i;
  const a = map[i], b = map[i + 1];
  out[0] = a[0] + (b[0] - a[0]) * f;
  out[1] = a[1] + (b[1] - a[1]) * f;
  out[2] = a[2] + (b[2] - a[2]) * f;
}

/** Bake a map into a 256-entry RGB lookup table for speed. */
export function lut(map: Colormap): Uint8ClampedArray {
  const t = new Uint8ClampedArray(256 * 3);
  const o = [0, 0, 0];
  for (let i = 0; i < 256; i++) {
    sample(map, i / 255, o);
    t[i * 3] = o[0];
    t[i * 3 + 1] = o[1];
    t[i * 3 + 2] = o[2];
  }
  return t;
}
