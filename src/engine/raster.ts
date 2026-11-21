import type { Point, Shape } from './types';
import { sampleBezier, transform } from './geometry';
import { hexToRgb } from './colors';

export type Buffer = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  originX?: number;
  originY?: number;
};
export const buffer = (width: number, height: number, originX = 0, originY = 0): Buffer => ({
  width,
  height,
  originX,
  originY,
  data: new Uint8ClampedArray(width * height * 4),
});
export const pixel = (b: Buffer, x: number, y: number, color: string, width = 1) => {
  const originX = b.originX ?? 0,
    originY = b.originY ?? 0,
    c = hexToRgb(color),
    r = Math.max(0, Math.floor((width - 1) / 2));
  for (let yy = Math.round(y) - r; yy <= Math.round(y) + r; yy++)
    for (let xx = Math.round(x) - r; xx <= Math.round(x) + r; xx++) {
      const localX = xx - originX,
        localY = yy - originY;
      if (localX < 0 || localY < 0 || localX >= b.width || localY >= b.height) continue;
      const i = (localY * b.width + localX) * 4;
      b.data[i] = c.r;
      b.data[i + 1] = c.g;
      b.data[i + 2] = c.b;
      b.data[i + 3] = 255;
    }
};
export const line = (b: Buffer, a: Point, z: Point, color: string, width = 1) => {
  let x = Math.round(a.x),
    y = Math.round(a.y);
  const x2 = Math.round(z.x),
    y2 = Math.round(z.y),
    dx = Math.abs(x2 - x),
    dy = Math.abs(y2 - y),
    sx = x < x2 ? 1 : -1,
    sy = y < y2 ? 1 : -1;
  let e = dx - dy;
  for (;;) {
    pixel(b, x, y, color, width);
    if (x === x2 && y === y2) break;
    const e2 = 2 * e;
    if (e2 > -dy) {
      e -= dy;
      x += sx;
    }
    if (e2 < dx) {
      e += dx;
      y += sy;
    }
  }
};
export const circle = (b: Buffer, c: Point, radius: number, color: string, width = 1) => {
  let x = Math.max(0, Math.round(radius)),
    y = 0,
    d = 1 - x;
  while (y <= x) {
    for (const [dx, dy] of [
      [x, y],
      [y, x],
      [-y, x],
      [-x, y],
      [-x, -y],
      [-y, -x],
      [y, -x],
      [x, -y],
    ])
      pixel(b, c.x + dx, c.y + dy, color, width);
    y++;
    if (d <= 0) d += 2 * y + 1;
    else {
      x--;
      d += 2 * (y - x) + 1;
    }
  }
};
export const polygonFill = (b: Buffer, points: Point[], color: string) => {
  if (points.length < 3) return;
  const originX = b.originX ?? 0,
    originY = b.originY ?? 0,
    min = Math.max(originY, Math.ceil(Math.min(...points.map((p) => p.y)))),
    max = Math.min(originY + b.height - 1, Math.floor(Math.max(...points.map((p) => p.y))));
  for (let y = min; y <= max; y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        z = points[(i + 1) % points.length];
      if ((a.y <= y && z.y > y) || (z.y <= y && a.y > y))
        xs.push(a.x + ((y - a.y) * (z.x - a.x)) / (z.y - a.y));
    }
    xs.sort((a, z) => a - z);
    for (let i = 0; i + 1 < xs.length; i += 2)
      for (
        let x = Math.max(originX, Math.ceil(xs[i]));
        x <= Math.min(originX + b.width - 1, Math.floor(xs[i + 1]));
        x++
      )
        pixel(b, x, y, color);
  }
};
export const drawShape = (b: Buffer, s: Shape) => {
  if (!s.visible || s.kind === 'image') return;
  const p = (q: Point) => transform(s.matrix, q),
    edge = (a: Point, z: Point) => line(b, p(a), p(z), s.stroke, s.width);
  if (s.kind === 'line') edge(s.a, s.b);
  else if (s.kind === 'rect') {
    const pts = [
      { x: s.x, y: s.y },
      { x: s.x + s.w, y: s.y },
      { x: s.x + s.w, y: s.y + s.h },
      { x: s.x, y: s.y + s.h },
    ].map(p);
    if (s.fill) polygonFill(b, pts, s.fill);
    pts.forEach((v, i) => line(b, v, pts[(i + 1) % 4], s.stroke, s.width));
  } else if (s.kind === 'circle') {
    const m = s.matrix,
      uniform =
        Math.abs(m[0] * m[1] + m[3] * m[4]) < 1e-6 &&
        Math.abs(Math.hypot(m[0], m[3]) - Math.hypot(m[1], m[4])) < 1e-6;
    const center = p(s.center),
      r = s.r * Math.hypot(m[0], m[3]);
    if (uniform) {
      if (s.fill)
        for (
          let y = Math.max(b.originY ?? 0, Math.ceil(center.y - r));
          y <= Math.min((b.originY ?? 0) + b.height - 1, Math.floor(center.y + r));
          y++
        )
          for (
            let x = Math.max(b.originX ?? 0, Math.ceil(center.x - r));
            x <= Math.min((b.originX ?? 0) + b.width - 1, Math.floor(center.x + r));
            x++
          )
            if (Math.hypot(x - center.x, y - center.y) <= r) pixel(b, x, y, s.fill);
      circle(b, center, r, s.stroke, s.width);
    } else {
      const steps = Math.max(32, Math.min(1024, Math.ceil(2 * Math.PI * s.r)));
      const pts = Array.from({ length: steps }, (_, i) =>
        p({
          x: s.center.x + s.r * Math.cos((i * 2 * Math.PI) / steps),
          y: s.center.y + s.r * Math.sin((i * 2 * Math.PI) / steps),
        }),
      );
      if (s.fill) polygonFill(b, pts, s.fill);
      pts.forEach((v, i) => line(b, v, pts[(i + 1) % pts.length], s.stroke, s.width));
    }
  } else if (s.kind === 'polygon') {
    const pts = s.points.map(p);
    if (s.fill) polygonFill(b, pts, s.fill);
    pts.forEach((v, i) => line(b, v, pts[(i + 1) % pts.length], s.stroke, s.width));
  } else if (s.kind === 'bezier' && s.points.length > 1) {
    const scale = Math.max(
      Math.hypot(s.matrix[0], s.matrix[3]),
      Math.hypot(s.matrix[1], s.matrix[4]),
    );
    const samples = sampleBezier(s.points, 0.5 / Math.max(scale, 0.01)).map(p);
    samples.forEach((point, i) => {
      if (i > 0) line(b, samples[i - 1], point, s.stroke, s.width);
    });
  }
};
