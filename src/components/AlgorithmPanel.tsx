import type { Shape, StructuringElement } from '../engine/types';
import type { FilterOptions } from '../engine/filters';
import { algorithms, type AlgorithmId, type LineStep } from '../engine/teaching';

type Props = {
  selected: Shape | null;
  algorithm: AlgorithmId;
  onAlgorithmChange: (id: AlgorithmId) => void;
  steps: LineStep[];
  stepIndex: number;
  onStepChange: (index: number) => void;
  filterTime: number;
  filterProgress: number;
  element: StructuringElement;
  filterOptions: FilterOptions;
  showControls: boolean;
  onShowControls: (value: boolean) => void;
  showPixels: boolean;
  onShowPixels: (value: boolean) => void;
};

export default function AlgorithmPanel(props: Props) {
  const card = algorithms[props.algorithm];
  const step = props.steps[props.stepIndex];
  const inputDescription = (() => {
    const object = props.selected;
    if (!object) return 'Wybierz obiekt, aby zobaczyć jego parametry.';
    if (object.kind === 'line')
      return `A=(${object.a.x.toFixed(1)}, ${object.a.y.toFixed(1)}), B=(${object.b.x.toFixed(1)}, ${object.b.y.toFixed(1)})`;
    if (object.kind === 'circle')
      return `Środek=(${object.center.x.toFixed(1)}, ${object.center.y.toFixed(1)}), r=${object.r.toFixed(1)}`;
    if (object.kind === 'rect' || object.kind === 'image')
      return `X=${object.x.toFixed(1)}, Y=${object.y.toFixed(1)}, W=${object.w.toFixed(1)}, H=${object.h.toFixed(1)}`;
    return object.points
      .map((point, index) => `P${index + 1}=(${point.x.toFixed(1)}, ${point.y.toFixed(1)})`)
      .join('; ');
  })();
  return (
    <section className="algorithm-card">
      <h3>ALGORYTM I DIAGNOSTYKA</h3>
      <label className="field">
        <span>Temat</span>
        <select
          aria-label="Wybierz algorytm"
          value={props.algorithm}
          onChange={(event) => props.onAlgorithmChange(event.target.value as AlgorithmId)}
        >
          {Object.entries(algorithms).map(([id, info]) => (
            <option key={id} value={id}>
              {info.name}
            </option>
          ))}
        </select>
      </label>
      <h4>{card.name}</h4>
      <p>{card.summary}</p>
      <div className="formula-box">
        <b>Wzór</b>
        <code>{card.formula}</code>
      </div>
      <div className="formula-box">
        <b>Pseudokod</b>
        <pre>{card.pseudocode}</pre>
      </div>
      <p className="muted">Złożoność: {card.complexity}</p>
      <div className="diagnostic-block">
        <strong>Parametry wejściowe</strong>
        <span>{inputDescription}</span>
      </div>
      {props.selected && (
        <div className="diagnostic-block">
          <strong>Wybrany obiekt: {props.selected.name}</strong>
          <span>
            Typ: {props.selected.kind} · grubość: {props.selected.width} px
          </span>
          {props.selected.kind === 'bezier' && (
            <span>
              Stopień: {props.selected.points.length - 1}; punkty: {props.selected.points.length}
            </span>
          )}
          <span>Macierz transformacji:</span>
          <pre>
            {[0, 1, 2]
              .map((row) =>
                props
                  .selected!.matrix.slice(row * 3, row * 3 + 3)
                  .map((value) => value.toFixed(2).padStart(7))
                  .join(' '),
              )
              .join('\n')}
          </pre>
        </div>
      )}
      {props.algorithm === 'average' && (
        <div className="diagnostic-block">
          <strong>
            Maska konwolucji {props.filterOptions.size}×{props.filterOptions.size}
          </strong>
          <span>Każda waga = 1/{props.filterOptions.size ** 2}</span>
          <pre>
            {Array.from({ length: props.filterOptions.size }, () =>
              Array(props.filterOptions.size).fill('1').join(' '),
            ).join('\n')}
          </pre>
        </div>
      )}
      {props.algorithm === 'median' && (
        <p className="muted">
          Okno medianowe: {props.filterOptions.size}×{props.filterOptions.size}. Wynik to środkowa
          wartość posortowanego sąsiedztwa.
        </p>
      )}
      {props.algorithm === 'sobel' && (
        <div className="diagnostic-block">
          <strong>Maski Sobela</strong>
          <span>
            Widok:{' '}
            {props.filterOptions.sobel === 'full'
              ? 'pełny gradient'
              : props.filterOptions.sobel.toUpperCase()}
          </span>
          <pre>
            {
              'Gx:  -1  0  1\n     -2  0  2\n     -1  0  1\nGy:  -1 -2 -1\n      0  0  0\n      1  2  1'
            }
          </pre>
        </div>
      )}
      {props.algorithm === 'threshold' && (
        <p className="muted">
          Próg: {props.filterOptions.threshold} / 255 · odwrócenie:{' '}
          {props.filterOptions.invert ? 'tak' : 'nie'}
        </p>
      )}
      {(props.algorithm === 'dilation' || props.algorithm === 'erosion') && (
        <div className="diagnostic-block">
          <strong>
            Element strukturyzujący: {props.element.width}×{props.element.height}
          </strong>
          <span>
            Kotwica: ({props.element.anchorX}, {props.element.anchorY})
          </span>
          <pre>
            {Array.from({ length: props.element.height }, (_, y) =>
              props.element.cells
                .slice(y * props.element.width, (y + 1) * props.element.width)
                .join(' '),
            ).join('\n')}
          </pre>
        </div>
      )}
      {props.algorithm === 'bresenham' &&
        props.selected?.kind === 'line' &&
        props.steps.length > 0 && (
          <div className="trace">
            <label htmlFor="line-step">
              Krok {props.stepIndex + 1} / {props.steps.length}
            </label>
            <input
              id="line-step"
              type="range"
              min="0"
              max={props.steps.length - 1}
              value={props.stepIndex}
              onChange={(event) => props.onStepChange(Number(event.target.value))}
            />
            <p>
              Piksel ({step.x}, {step.y}) · błąd e = {step.error}
            </p>
          </div>
        )}
      <p className="muted">
        Ostatni filtr: {props.filterTime} ms · postęp: {props.filterProgress}%
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={props.showControls}
          onChange={(event) => props.onShowControls(event.target.checked)}
        />{' '}
        Pokaż punkty kontrolne
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={props.showPixels}
          onChange={(event) => props.onShowPixels(event.target.checked)}
        />{' '}
        Pokaż piksele przy ≥800%
      </label>
    </section>
  );
}
