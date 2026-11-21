import { describe, it, expect } from 'vitest';
import { buffer, line, circle, drawShape } from './raster';
import { rgbToCmyk, cmykToRgb } from './colors';
import {
  deCasteljau,
  inverse,
  multiply,
  rotation,
  scaling,
  transform,
  translation,
  hit,
  sampleBezier,
} from './geometry';
import { applyFilter, defaultElement } from './filters';
import { parseProject } from './project';
import { limitHistory } from './history';
import { base, blank } from './types';

describe('raster', () => {
  it('draws all octants and a single point', () => {
    for (const [x, y] of [
      [7, 2],
      [2, 7],
      [-2, 7],
      [-7, 2],
      [-7, -2],
      [-2, -7],
      [2, -7],
      [7, -2],
      [0, 0],
    ]) {
      const b = buffer(21, 21);
      line(b, { x: 10, y: 10 }, { x: 10 + x, y: 10 + y }, '#ff0000');
      expect(b.data[(10 * 21 + 10) * 4]).toBe(255);
      expect(b.data[((10 + y) * 21 + 10 + x) * 4]).toBe(255);
    }
  });
  it('circle has eight-way symmetry', () => {
    const b = buffer(21, 21);
    circle(b, { x: 10, y: 10 }, 5, '#ffffff');
    for (const [x, y] of [
      [5, 0],
      [0, 5],
      [-5, 0],
      [0, -5],
    ])
      expect(b.data[((10 + y) * 21 + 10 + x) * 4]).toBe(255);
  });
  it('rectangle edges are rasterized', () => {
    const b = buffer(20, 20);
    drawShape(b, { ...base('r'), kind: 'rect', x: 2, y: 3, w: 8, h: 5 });
    expect(b.data[(3 * 20 + 2) * 4 + 3]).toBe(255);
    expect(b.data[(8 * 20 + 10) * 4 + 3]).toBe(255);
  });
  it('cropped buffers produce the same pixels as the matching full-canvas region', () => {
    const shapes = [
      { ...base('line'), kind: 'line' as const, a: { x: -2, y: 9 }, b: { x: 24, y: 20 } },
      { ...base('rect'), kind: 'rect' as const, x: 3, y: 5, w: 18, h: 12, fill: '#123456' },
      {
        ...base('circle'),
        kind: 'circle' as const,
        center: { x: 14, y: 12 },
        r: 8,
        fill: '#123456',
      },
      {
        ...base('polygon'),
        kind: 'polygon' as const,
        points: [
          { x: 2, y: 2 },
          { x: 22, y: 6 },
          { x: 17, y: 24 },
          { x: 7, y: 18 },
        ],
        fill: '#123456',
      },
      {
        ...base('bezier'),
        kind: 'bezier' as const,
        points: [
          { x: 1, y: 20 },
          { x: 12, y: 0 },
          { x: 23, y: 21 },
        ],
      },
    ];
    for (const shape of shapes) {
      const full = buffer(26, 26);
      const cropped = buffer(12, 14, 6, 4);
      drawShape(full, shape);
      drawShape(cropped, shape);
      for (let y = 0; y < cropped.height; y++)
        for (let x = 0; x < cropped.width; x++) {
          const fullOffset = ((y + 4) * full.width + x + 6) * 4;
          const croppedOffset = (y * cropped.width + x) * 4;
          expect(Array.from(cropped.data.slice(croppedOffset, croppedOffset + 4))).toEqual(
            Array.from(full.data.slice(fullOffset, fullOffset + 4)),
          );
        }
    }
  });
});
describe('color', () => {
  it('handles black and white', () => {
    expect(rgbToCmyk({ r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 100 });
    expect(cmykToRgb({ c: 0, m: 0, y: 0, k: 0 })).toEqual({ r: 255, g: 255, b: 255 });
  });
  it('round trips RGB', () => {
    const c = { r: 62, g: 147, b: 213 };
    const out = cmykToRgb(rgbToCmyk(c));
    expect(out).toEqual(c);
  });
});
describe('geometry', () => {
  it('evaluates Bezier endpoints and midpoint', () => {
    const p = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 0 },
    ];
    expect(deCasteljau(p, 0)).toEqual(p[0]);
    expect(deCasteljau(p, 1)).toEqual(p[2]);
    expect(deCasteljau(p, 0.5)).toEqual({ x: 10, y: 10 });
  });
  it('subdivides curved Bézier segments adaptively', () => {
    const straight = sampleBezier([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    const curved = sampleBezier([
      { x: 0, y: 0 },
      { x: 50, y: 100 },
      { x: 100, y: 0 },
    ]);
    expect(straight).toHaveLength(2);
    expect(curved.length).toBeGreaterThan(2);
    expect(curved[0]).toEqual({ x: 0, y: 0 });
    expect(curved.at(-1)).toEqual({ x: 100, y: 0 });
  });
  it('composes and inverts transforms', () => {
    const m = multiply(translation(4, 3), rotation(90, { x: 0, y: 0 }));
    const p = { x: 2, y: 1 };
    const q = transform(m, p);
    expect(transform(inverse(m), q).x).toBeCloseTo(p.x);
    expect(transform(scaling(-2, 3, { x: 1, y: 1 }), { x: 2, y: 2 })).toEqual({ x: -1, y: 4 });
  });
  it('hit tests a line', () => {
    expect(
      hit({ ...base('l'), kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, { x: 5, y: 1 }, 2),
    ).toBe(true);
  });
  it('keeps hit tolerance in world space after nonuniform scaling', () => {
    const lineShape = {
      ...base('l'),
      kind: 'line' as const,
      a: { x: 0, y: 0 },
      b: { x: 100, y: 0 },
      matrix: scaling(2, 10, { x: 0, y: 0 }),
    };
    expect(hit(lineShape, { x: 50, y: 3 }, 3)).toBe(true);
    expect(hit(lineShape, { x: 50, y: 12 }, 3)).toBe(false);
    const small = { ...lineShape, matrix: scaling(0.1, 0.1, { x: 0, y: 0 }) };
    expect(hit(small, { x: 5, y: 3 }, 3)).toBe(true);
  });
  it('hit tests the rendered Bezier curve', () => {
    const curve = {
      ...base('b'),
      kind: 'bezier' as const,
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 100 },
        { x: 100, y: 0 },
      ],
    };
    expect(hit(curve, { x: 50, y: 50 }, 2)).toBe(true);
    expect(hit(curve, { x: 50, y: 80 }, 2)).toBe(false);
  });
});
describe('filters', () => {
  const opts = {
    size: 3,
    threshold: 128,
    invert: false,
    sobel: 'full' as const,
    element: defaultElement(),
  };
  it('averages and finds median without changing source', () => {
    const b = buffer(3, 3);
    b.data.fill(0);
    b.data[(1 * 3 + 1) * 4] = 255;
    const original = new Uint8ClampedArray(b.data);
    expect(applyFilter(b, 'average', opts).data[(1 * 3 + 1) * 4]).toBe(28);
    expect(applyFilter(b, 'median', opts).data[(1 * 3 + 1) * 4]).toBe(0);
    expect(b.data).toEqual(original);
  });
  it('thresholds and handles asymmetric morphology', () => {
    const b = buffer(3, 1);
    b.data[4] = b.data[5] = b.data[6] = 255;
    const se = { width: 2, height: 1, anchorX: 0, anchorY: 0, cells: [1, 1] };
    const d = applyFilter(b, 'dilation', { ...opts, element: se });
    expect([d.data[0], d.data[4], d.data[8]]).toEqual([0, 255, 255]);
    const e = applyFilter(b, 'erosion', { ...opts, element: se });
    expect([e.data[0], e.data[4], e.data[8]]).toEqual([0, 0, 0]);
    expect(applyFilter(b, 'threshold', opts).data[4]).toBe(255);
  });
  it('detects edges', () => {
    const b = buffer(3, 3);
    for (let y = 0; y < 3; y++)
      for (let x = 1; x < 3; x++) for (let c = 0; c < 3; c++) b.data[(y * 3 + x) * 4 + c] = 255;
    expect(applyFilter(b, 'sobel', opts).data[(1 * 3 + 1) * 4]).toBe(255);
  });
  it('reports monotonically increasing progress through the final row', () => {
    const b = buffer(5, 17);
    const progress: number[] = [];
    applyFilter(b, 'threshold', opts, (fraction) => progress.push(fraction));
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((fraction, index) => index === 0 || fraction > progress[index - 1])).toBe(
      true,
    );
  });
});
describe('project', () => {
  it('validates version and objects', () => {
    expect(parseProject(JSON.stringify(blank())).version).toBe(1);
    expect(() => parseProject('{')).toThrow();
    expect(() => parseProject(JSON.stringify({ ...blank(), version: 2 }))).toThrow();
  });
});
describe('history memory budget', () => {
  it('keeps newest states and counts unchanged image strings once', () => {
    const documentWith = (name: string) => ({
      ...blank(),
      objects: [
        {
          ...base(name),
          kind: 'image' as const,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          pixels: name.repeat(10),
          original: name.repeat(10),
        },
      ],
    });
    const a = documentWith('a'),
      b = documentWith('b'),
      c = documentWith('c');
    expect(limitHistory([a, b, c], 50, 40)).toEqual([b, c]);
    expect(limitHistory([a, a, a], 50, 20)).toHaveLength(3);
  });
});
