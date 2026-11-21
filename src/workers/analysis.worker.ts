import { analyzeColor, type ColorAnalysisOptions } from '../engine/colorAnalysis';

type Request = {
  width: number;
  height: number;
  data: ArrayBuffer;
  options: ColorAnalysisOptions;
};

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const { width, height, data, options } = event.data;
    const result = analyzeColor(
      { width, height, data: new Uint8ClampedArray(data) },
      options,
      (progress) => self.postMessage({ progress }),
    );
    const message = {
      matchedPixels: result.matchedPixels,
      visiblePixels: result.visiblePixels,
      mask: result.mask.buffer,
      maskWidth: result.maskWidth,
      maskHeight: result.maskHeight,
    };
    self.postMessage(message, [result.mask.buffer]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Błąd analizy obrazu' });
  }
};
