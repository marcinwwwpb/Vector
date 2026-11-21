import type { Matrix, Point, Shape } from './types';
export const multiply = (a: Matrix, b: Matrix): Matrix => {
  const o = Array(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o as Matrix;
};
export const translation = (x: number, y: number): Matrix => [1, 0, x, 0, 1, y, 0, 0, 1];
export const rotation = (deg: number, p: Point): Matrix => {
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return multiply(
    translation(p.x, p.y),
    multiply([c, -s, 0, s, c, 0, 0, 0, 1], translation(-p.x, -p.y)),
  );
};
export const scaling = (sx: number, sy: number, p: Point): Matrix =>
  multiply(translation(p.x, p.y), multiply([sx, 0, 0, 0, sy, 0, 0, 0, 1], translation(-p.x, -p.y)));
export const transform = (m: Matrix, p: Point): Point => ({
  x: m[0] * p.x + m[1] * p.y + m[2],
  y: m[3] * p.x + m[4] * p.y + m[5],
});
export const inverse = (m: Matrix): Matrix => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h,
    B = c * h - b * i,
    C = b * f - c * e,
    D = f * g - d * i,
    E = a * i - c * g,
    F = c * d - a * f,
    G = d * h - e * g,
    H = b * g - a * h,
    I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (Math.abs(det) < 1e-12) throw new Error('Macierz osobliwa');
  return [A, B, C, D, E, F, G, H, I].map((v) => v / det) as Matrix;
};
export const deCasteljau = (points: Point[], t: number): Point => {
  if (!points.length) throw new Error('Brak punktów');
  const p = points.map((q) => ({ ...q }));
  for (let n = p.length - 1; n > 0; n--)
    for (let i = 0; i < n; i++) {
      p[i].x = (1 - t) * p[i].x + t * p[i + 1].x;
      p[i].y = (1 - t) * p[i].y + t * p[i + 1].y;
    }
  return p[0];
};
export const distanceToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t =
      dx * dx + dy * dy === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
/** Subdivide until the control polygon is within tolerance of its endpoint chord. */
export function sampleBezier(points: Point[], tolerance = 0.5): Point[] {
  if (points.length < 2) return points.map((point) => ({ ...point }));
  const result: Point[] = [{ ...points[0] }];
  const visit = (control: Point[], depth: number) => {
    const last = control[control.length - 1];
    const flat = control
      .slice(1, -1)
      .every((point) => distanceToSegment(point, control[0], last) <= tolerance);
    if (flat || depth >= 12) {
      result.push({ ...last });
      return;
    }
    const levels: Point[][] = [control];
    while (levels.at(-1)!.length > 1) {
      const previous = levels.at(-1)!;
      levels.push(
        previous.slice(0, -1).map((point, i) => ({
          x: (point.x + previous[i + 1].x) / 2,
          y: (point.y + previous[i + 1].y) / 2,
        })),
      );
    }
    const left = levels.map((level) => level[0]);
    const right = levels.map((level) => level.at(-1)!).reverse();
    visit(left, depth + 1);
    visit(right, depth + 1);
  };
  visit(points, 0);
  return result;
}
export const pointInPolygon = (p: Point, pts: Point[]) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i],
      b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
};
export const hit = (s: Shape, p: Point, tolerance: number): boolean => {
  const t = tolerance + s.width / 2;
  const world = (q: Point) => transform(s.matrix, q);
  if (s.kind === 'line') return distanceToSegment(p, world(s.a), world(s.b)) <= t;
  let points: Point[];
  if (s.kind === 'circle') {
    const radius = s.r * Math.max(Math.hypot(s.matrix[0], s.matrix[3]), Math.hypot(s.matrix[1], s.matrix[4]));
    const steps = Math.max(32, Math.min(4096, Math.ceil(Math.PI * Math.sqrt(radius / Math.max(0.05, t / 4)))));
    points = Array.from({length: steps}, (_, i) => world({x:s.center.x+s.r*Math.cos(i*2*Math.PI/steps),y:s.center.y+s.r*Math.sin(i*2*Math.PI/steps)}));
  } else if (s.kind === 'bezier') {
    points = sampleBezier(s.points.map(world), Math.max(0.05, t / 4));
  } else points = vertices(s).map(world);
  if (points.length < 2) return false;
  const closed = s.kind !== 'bezier';
  if (closed && (s.kind !== 'circle' || s.fill) && pointInPolygon(p, points)) return true;
  return points.some((a, i) => (closed || i < points.length - 1) && distanceToSegment(p, a, points[(i + 1) % points.length]) <= t);
};
export const vertices = (s: Shape): Point[] => {
  if (s.kind === 'line') return [s.a, s.b];
  if (s.kind === 'rect' || s.kind === 'image')
    return [
      { x: s.x, y: s.y },
      { x: s.x + s.w, y: s.y },
      { x: s.x + s.w, y: s.y + s.h },
      { x: s.x, y: s.y + s.h },
    ];
  if (s.kind === 'circle')
    return [
      { x: s.center.x - s.r, y: s.center.y - s.r },
      { x: s.center.x + s.r, y: s.center.y + s.r },
    ];
  return s.points;
};
