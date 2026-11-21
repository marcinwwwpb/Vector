import type { RGB } from './types';
export type CMYK = { c: number; m: number; y: number; k: number };
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
export const rgbToCmyk = ({ r, g, b }: RGB): CMYK => {
  const R = clamp(r, 0, 255) / 255,
    G = clamp(g, 0, 255) / 255,
    B = clamp(b, 0, 255) / 255,
    k = 1 - Math.max(R, G, B);
  return k === 1
    ? { c: 0, m: 0, y: 0, k: 100 }
    : {
        c: ((1 - R - k) / (1 - k)) * 100,
        m: ((1 - G - k) / (1 - k)) * 100,
        y: ((1 - B - k) / (1 - k)) * 100,
        k: k * 100,
      };
};
export const cmykToRgb = ({ c, m, y, k }: CMYK): RGB => ({
  r: Math.round(255 * (1 - clamp(c, 0, 100) / 100) * (1 - clamp(k, 0, 100) / 100)),
  g: Math.round(255 * (1 - clamp(m, 0, 100) / 100) * (1 - clamp(k, 0, 100) / 100)),
  b: Math.round(255 * (1 - clamp(y, 0, 100) / 100) * (1 - clamp(k, 0, 100) / 100)),
});
export const rgbToHex = ({ r, g, b }: RGB) =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.round(clamp(v, 0, 255))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
export const hexToRgb = (hex: string): RGB => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});
