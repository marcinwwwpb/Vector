import type { DocumentModel, Shape } from './types';
const finite = (...values: number[]) =>
  values.every((v) => typeof v === 'number' && Number.isFinite(v));
const point = (p: { x: number; y: number } | undefined) => !!p && finite(p.x, p.y);
const color = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
export const parseProject = (text: string): DocumentModel => {
  if (text.length > 100_000_000) throw new Error('Plik projektu jest zbyt duży');
  const p: unknown = JSON.parse(text);
  if (!p || typeof p !== 'object') throw new Error('Nieprawidłowy projekt');
  const d = p as Record<string, unknown>;
  if (
    d.version !== 1 ||
    !Number.isInteger(d.width) ||
    !Number.isInteger(d.height) ||
    Number(d.width) < 1 ||
    Number(d.height) < 1 ||
    Number(d.width) > 8192 ||
    Number(d.height) > 8192 ||
    !color(d.background) ||
    !Array.isArray(d.objects) ||
    d.objects.length > 10000
  )
    throw new Error('Nieobsługiwany lub uszkodzony projekt');
  if (d.element) {
    const e = d.element as Record<string, unknown>;
    if (
      !Number.isInteger(e.width) ||
      !Number.isInteger(e.height) ||
      Number(e.width) < 1 ||
      Number(e.height) < 1 ||
      Number(e.width) > 31 ||
      Number(e.height) > 31 ||
      !Number.isInteger(e.anchorX) ||
      !Number.isInteger(e.anchorY) ||
      Number(e.anchorX) < 0 ||
      Number(e.anchorY) < 0 ||
      Number(e.anchorX) >= Number(e.width) ||
      Number(e.anchorY) >= Number(e.height) ||
      !Array.isArray(e.cells) ||
      e.cells.length !== Number(e.width) * Number(e.height) ||
      !e.cells.every((v) => v === 0 || v === 1)
    )
      throw new Error('Uszkodzona maska');
  }
  const ids = new Set<string>();
  for (const s of d.objects as Shape[]) {
    if (
      !s ||
      !['line', 'rect', 'circle', 'polygon', 'bezier', 'image'].includes(s.kind) ||
      typeof s.id !== 'string' ||
      ids.has(s.id) ||
      typeof s.name !== 'string' ||
      typeof s.visible !== 'boolean' ||
      typeof s.locked !== 'boolean' ||
      !color(s.stroke) ||
      !(s.fill === null || color(s.fill)) ||
      !finite(s.width) ||
      s.width < 0 ||
      s.width > 100 ||
      !Array.isArray(s.matrix) ||
      s.matrix.length !== 9 ||
      !s.matrix.every(Number.isFinite)
    )
      throw new Error('Uszkodzony obiekt');
    ids.add(s.id);
    if (s.kind === 'line' && (!point(s.a) || !point(s.b))) throw new Error('Uszkodzona linia');
    if ((s.kind === 'rect' || s.kind === 'image') && !finite(s.x, s.y, s.w, s.h))
      throw new Error('Uszkodzony prostokąt lub obraz');
    if (s.kind === 'circle' && (!point(s.center) || !finite(s.r) || s.r < 0))
      throw new Error('Uszkodzony okrąg');
    if (
      (s.kind === 'polygon' || s.kind === 'bezier') &&
      (!Array.isArray(s.points) ||
        s.points.length < (s.kind === 'polygon' ? 3 : 2) ||
        s.points.length > 1024 ||
        !s.points.every(point))
    )
      throw new Error('Uszkodzone punkty');
    if (
      s.kind === 'image' &&
      (!s.pixels.startsWith('data:image/png;base64,') ||
        !s.original.startsWith('data:image/png;base64,'))
    )
      throw new Error('Uszkodzone piksele obrazu');
  }
  return d as DocumentModel;
};
export const download = (name: string, content: Blob) => {
  const url = URL.createObjectURL(content),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
