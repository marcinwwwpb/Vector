import { base, blank, type DocumentModel, type Shape } from './engine/types';

/** A generated, local example with high contrast details for Sobel and morphology. */
export function demoProject(): DocumentModel {
  const width = 160;
  const height = 160;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const cross =
        (x > 64 && x < 96 && y > 22 && y < 138) || (y > 64 && y < 96 && x > 22 && x < 138);
      const dot = (x * 17 + y * 29) % 97 < 2;
      const value = cross || dot ? 25 : 245;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
      pixels[i + 3] = 255;
    }
  }
  const imageCanvas = document.createElement('canvas');
  imageCanvas.width = width;
  imageCanvas.height = height;
  imageCanvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
  const png = imageCanvas.toDataURL('image/png');
  const objects: Shape[] = [
    {
      ...base('Linia Bresenhama'),
      kind: 'line',
      a: { x: 80, y: 105 },
      b: { x: 285, y: 168 },
      stroke: '#e45a7a',
      width: 3,
    },
    {
      ...base('Prostokąt'),
      kind: 'rect',
      x: 90,
      y: 225,
      w: 185,
      h: 130,
      stroke: '#426fae',
      fill: '#dbeaff',
      width: 2,
    },
    {
      ...base('Okrąg'),
      kind: 'circle',
      center: { x: 415, y: 285 },
      r: 78,
      stroke: '#da8929',
      fill: '#ffefd2',
      width: 2,
    },
    {
      ...base('Wielokąt wklęsły'),
      kind: 'polygon',
      points: [
        { x: 315, y: 420 },
        { x: 520, y: 420 },
        { x: 480, y: 520 },
        { x: 420, y: 465 },
        { x: 350, y: 520 },
      ],
      stroke: '#6b63b5',
      fill: '#e5e0ff',
      width: 2,
    },
    {
      ...base('Krzywa Béziera'),
      kind: 'bezier',
      points: [
        { x: 75, y: 500 },
        { x: 125, y: 365 },
        { x: 210, y: 555 },
        { x: 270, y: 425 },
      ],
      stroke: '#169a89',
      fill: null,
      width: 3,
    },
    {
      ...base('Obraz do filtrów'),
      kind: 'image',
      x: 615,
      y: 145,
      w: 240,
      h: 240,
      pixels: png,
      original: png,
    },
  ];
  return { ...blank(), objects };
}
