export type Point = { x: number; y: number };
export type RGB = { r: number; g: number; b: number };
export type Matrix = [number, number, number, number, number, number, number, number, number];
export type Base = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  stroke: string;
  fill: string | null;
  width: number;
  matrix: Matrix;
};
export type Shape = Base &
  (
    | { kind: 'line'; a: Point; b: Point }
    | { kind: 'rect'; x: number; y: number; w: number; h: number }
    | { kind: 'circle'; center: Point; r: number }
    | { kind: 'polygon' | 'bezier'; points: Point[] }
    | {
        kind: 'image';
        x: number;
        y: number;
        w: number;
        h: number;
        pixels: string;
        original: string;
      }
  );
export type DocumentModel = {
  version: 1;
  width: number;
  height: number;
  background: string;
  objects: Shape[];
  element?: StructuringElement;
};
export type StructuringElement = {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  cells: number[];
};
export const identity = (): Matrix => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const uid = () => crypto.randomUUID();
export const blank = (): DocumentModel => ({
  version: 1,
  width: 1920,
  height: 1080,
  background: '#ffffff',
  objects: [],
});
export const base = (kind: string): Base => ({
  id: uid(),
  name: kind,
  visible: true,
  locked: false,
  stroke: '#65d8ec',
  fill: null,
  width: 2,
  matrix: identity(),
});
