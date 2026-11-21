import type { Buffer } from './raster';
import type { StructuringElement } from './types';
import { clamp } from './colors';
export type Filter = 'average' | 'median' | 'sobel' | 'threshold' | 'dilation' | 'erosion';
export type FilterOptions = {
  size: number;
  threshold: number;
  invert: boolean;
  sobel: 'full' | 'gx' | 'gy';
  element: StructuringElement;
};
const sample = (b: Buffer, x: number, y: number, c: number) =>
  b.data[
    (Math.round(clamp(y, 0, b.height - 1)) * b.width + Math.round(clamp(x, 0, b.width - 1))) * 4 + c
  ];
export const applyFilter = (
  b: Buffer,
  kind: Filter,
  o: FilterOptions,
  onProgress?: (fraction: number) => void,
): Buffer => {
  const out = { width: b.width, height: b.height, data: new Uint8ClampedArray(b.data) };
  const size = Math.max(1, Math.min(15, Math.floor(o.size) | 1)),
    rad = Math.floor(size / 2),
    gray = (x: number, y: number) =>
      0.299 * sample(b, x, y, 0) + 0.587 * sample(b, x, y, 1) + 0.114 * sample(b, x, y, 2);
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1],
    gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const i = (y * b.width + x) * 4;
      if (kind === 'average' || kind === 'median') {
        for (let c = 0; c < 3; c++) {
          const values: number[] = [];
          for (let yy = -rad; yy <= rad; yy++)
            for (let xx = -rad; xx <= rad; xx++) values.push(sample(b, x + xx, y + yy, c));
          out.data[i + c] =
            kind === 'average'
              ? Math.round(values.reduce((a, z) => a + z, 0) / values.length)
              : values.sort((a, z) => a - z)[Math.floor(values.length / 2)];
        }
      } else if (kind === 'sobel') {
        let sx = 0,
          sy = 0;
        for (let yy = -1; yy <= 1; yy++)
          for (let xx = -1; xx <= 1; xx++) {
            const j = (yy + 1) * 3 + xx + 1,
              v = gray(x + xx, y + yy);
            sx += v * gx[j];
            sy += v * gy[j];
          }
        const v = Math.round(
          clamp(
            o.sobel === 'gx' ? Math.abs(sx) : o.sobel === 'gy' ? Math.abs(sy) : Math.hypot(sx, sy),
            0,
            255,
          ),
        );
        out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      } else if (kind === 'threshold') {
        const v = gray(x, y) >= o.threshold !== o.invert ? 255 : 0;
        out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      } else {
        const se = o.element;
        let found = kind === 'erosion';
        for (let sy = 0; sy < se.height; sy++)
          for (let sx = 0; sx < se.width; sx++) {
            if (!se.cells[sy * se.width + sx]) continue;
            const xx = kind === 'dilation' ? x - (sx - se.anchorX) : x + (sx - se.anchorX),
              yy = kind === 'dilation' ? y - (sy - se.anchorY) : y + (sy - se.anchorY);
            const on = xx >= 0 && yy >= 0 && xx < b.width && yy < b.height && gray(xx, yy) >= 128;
            if (kind === 'dilation' && on) found = true;
            if (kind === 'erosion' && !on) found = false;
          }
        const v = found ? 255 : 0;
        out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      }
    }
    if (onProgress && (y % 8 === 7 || y === b.height - 1)) onProgress((y + 1) / b.height);
  }
  return out;
};
export const defaultElement = (): StructuringElement => ({
  width: 3,
  height: 3,
  anchorX: 1,
  anchorY: 1,
  cells: Array(9).fill(1),
});
