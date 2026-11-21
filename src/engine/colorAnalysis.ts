import type { RGB } from './types';
import type { Buffer } from './raster';
import { clamp } from './colors';

export type ColorAnalysisOptions = {
  target: RGB;
  hueTolerance: number;
  minSaturation: number;
  minValue: number;
  rgbTolerance: number;
};

export type ColorAnalysisResult = {
  matchedPixels: number;
  visiblePixels: number;
  mask: Uint8ClampedArray;
  maskWidth: number;
  maskHeight: number;
};

const hueOf = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  const hue =
    max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
};

export function analyzeColor(
  image: Buffer,
  options: ColorAnalysisOptions,
  onProgress?: (fraction: number) => void,
): ColorAnalysisResult {
  const targetR = clamp(options.target.r, 0, 255) / 255;
  const targetG = clamp(options.target.g, 0, 255) / 255;
  const targetB = clamp(options.target.b, 0, 255) / 255;
  const targetMax = Math.max(targetR, targetG, targetB);
  const targetMin = Math.min(targetR, targetG, targetB);
  const targetSaturation = targetMax === 0 ? 0 : (targetMax - targetMin) / targetMax;
  const targetHue = hueOf(targetR, targetG, targetB);
  const tolerance = clamp(options.hueTolerance, 0, 180);
  const minSaturation = clamp(options.minSaturation, 0, 100) / 100;
  const minValue = clamp(options.minValue, 0, 100) / 100;
  const rgbTolerance = clamp(options.rgbTolerance, 0, 100);
  const previewScale = Math.min(1, 1200 / image.width, 1200 / image.height);
  const maskWidth = Math.max(1, Math.round(image.width * previewScale));
  const maskHeight = Math.max(1, Math.round(image.height * previewScale));
  const mask = new Uint8ClampedArray(maskWidth * maskHeight * 4);
  let matchedPixels = 0;
  let visiblePixels = 0;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      if (image.data[i + 3] === 0) continue;
      visiblePixels++;
      const r = image.data[i] / 255;
      const g = image.data[i + 1] / 255;
      const b = image.data[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const value = max;
      const hue = hueOf(r, g, b);
      const hueDifference = Math.min(Math.abs(hue - targetHue), 360 - Math.abs(hue - targetHue));
      const rgbDistance =
        (Math.hypot(r - targetR, g - targetG, b - targetB) / Math.sqrt(3)) * 100;
      const isNeutralTarget = targetSaturation < 0.04;
      const isMatch = isNeutralTarget
        ? rgbDistance <= rgbTolerance
        : hueDifference <= tolerance && saturation >= minSaturation && value * 100 >= minValue;
      if (isMatch) {
        matchedPixels++;
        const maskIndex =
          (Math.min(maskHeight - 1, Math.floor(y * previewScale)) * maskWidth +
            Math.min(maskWidth - 1, Math.floor(x * previewScale))) *
          4;
        mask[maskIndex] = 22;
        mask[maskIndex + 1] = 224;
        mask[maskIndex + 2] = 105;
        mask[maskIndex + 3] = 142;
      }
    }
    if (onProgress && (y % 16 === 15 || y === image.height - 1)) {
      onProgress((y + 1) / image.height);
    }
  }
  return { matchedPixels, visiblePixels, mask, maskWidth, maskHeight };
}
