import { applyFilter, type Filter, type FilterOptions } from '../engine/filters';
type Request = {
  width: number;
  height: number;
  data: ArrayBuffer;
  kind: Filter;
  options: FilterOptions;
};
self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const { width, height, data, kind, options } = event.data;
    const result = applyFilter(
      { width, height, data: new Uint8ClampedArray(data) },
      kind,
      options,
      (fraction) => self.postMessage({ progress: fraction }),
    );
    self.postMessage({ width, height, data: result.data.buffer }, [result.data.buffer]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Błąd filtra' });
  }
};
