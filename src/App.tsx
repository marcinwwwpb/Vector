import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import {
  MousePointer2,
  Minus,
  Square,
  Circle,
  PenTool,
  Spline,
  Hand,
  ZoomIn,
  ZoomOut,
  Pipette,
  PanelRightClose,
  PanelRightOpen,
  Undo2,
  Redo2,
  Save,
  FolderOpen,
  Download,
  Copy,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  RotateCw,
  Scaling,
  Grid2X2,
  ArrowUp,
  ArrowDown,
  Crosshair,
} from 'lucide-react';
import type { DocumentModel, Point, Shape, StructuringElement, RGB, Matrix } from './engine/types';
import { base, blank } from './engine/types';
import { drawShape, buffer } from './engine/raster';
import { defaultElement, type Filter, type FilterOptions } from './engine/filters';
import { cmykToRgb, hexToRgb, rgbToCmyk, rgbToHex, type CMYK } from './engine/colors';
import {
  hit,
  inverse,
  multiply,
  rotation,
  scaling,
  translation,
  transform,
  vertices,
} from './engine/geometry';
import { download, parseProject } from './engine/project';
import AlgorithmPanel from './components/AlgorithmPanel';
import { demoProject } from './demo';
import { traceLine, type AlgorithmId } from './engine/teaching';
import { limitHistory } from './engine/history';

type Tool =
  | 'select'
  | 'line'
  | 'rect'
  | 'circle'
  | 'polygon'
  | 'bezier'
  | 'rotate'
  | 'scale'
  | 'pivot'
  | 'eyedropper'
  | 'pan';
type ImageShape = Extract<Shape, { kind: 'image' }>;
type Drag = {
  mode: 'draw' | 'move' | 'handle' | 'rotate' | 'scale' | 'pan';
  start: Point;
  original?: Shape;
  originals?: Shape[];
  index?: number;
  pivot?: Point;
  pan: { x: number; y: number };
};
const tools: { id: Tool; label: string; icon: typeof MousePointer2; key: string }[] = [
  { id: 'select', label: 'Zaznacz', icon: MousePointer2, key: 'V' },
  { id: 'line', label: 'Linia', icon: Minus, key: 'L' },
  { id: 'rect', label: 'Prostokąt', icon: Square, key: 'R' },
  { id: 'circle', label: 'Okrąg', icon: Circle, key: 'C' },
  { id: 'polygon', label: 'Wielokąt', icon: PenTool, key: 'P' },
  { id: 'bezier', label: 'Krzywa Béziera', icon: Spline, key: 'B' },
  { id: 'rotate', label: 'Obróć myszą', icon: RotateCw, key: '—' },
  { id: 'scale', label: 'Skaluj myszą', icon: Scaling, key: '—' },
  { id: 'pivot', label: 'Ustaw punkt odniesienia', icon: Crosshair, key: '—' },
  { id: 'eyedropper', label: 'Pobierz kolor z kanwy', icon: Pipette, key: 'I' },
  { id: 'pan', label: 'Przesuń widok', icon: Hand, key: 'H' },
];
const shapeLabel: Record<Shape['kind'], string> = {
  line: 'Linia',
  rect: 'Prostokąt',
  circle: 'Okrąg',
  polygon: 'Wielokąt',
  bezier: 'Krzywa Béziera',
  image: 'Obraz',
};
const clone = <T,>(x: T): T => structuredClone(x);
const snapshot = (d: DocumentModel): DocumentModel => ({
  ...d,
  objects: d.objects.map((s): Shape => {
    const matrix = [...s.matrix] as Matrix;
    if (s.kind === 'line') return { ...s, matrix, a: { ...s.a }, b: { ...s.b } };
    if (s.kind === 'circle') return { ...s, matrix, center: { ...s.center } };
    if (s.kind === 'polygon' || s.kind === 'bezier')
      return { ...s, matrix, points: s.points.map((p) => ({ ...p })) };
    return { ...s, matrix };
  }),
  element: d.element ? clone(d.element) : undefined,
});
const num = (v: string, fallback = 0) =>
  Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : fallback;
const suggestedPoint = (index: number): Point => ({
  x: 100 + index * 70,
  y: 100 + (index % 2) * 100,
});
const initialCoordinatePoints = (): Point[] =>
  Array.from({ length: 4 }, (_, index) => suggestedPoint(index));
const imageData = (s: Shape) => (s.kind === 'image' ? s.pixels : '');
type ImageCacheEntry = { source: string; image: HTMLImageElement; bytes: number };
type ObjectBitmap = {
  shape: Shape;
  source: string;
  documentWidth: number;
  documentHeight: number;
  width: number;
  height: number;
  x: number;
  y: number;
  canvas: HTMLCanvasElement;
  bytes: number;
};
type RenderSnapshot = { doc: DocumentModel; preview: string | null; selected: string | null };
type AnalysisResult = {
  imageId: string;
  key: string;
  matchedPixels: number;
  visiblePixels: number;
  percentage: number;
  durationMs: number;
  maskUrl: string;
};
const bitmapCacheLimit = 128 * 1024 * 1024;
const imageCacheLimit = 24;
const imageCacheByteLimit = 128 * 1024 * 1024;
const objectBounds = (shape: Shape, width: number, height: number) => {
  const points = vertices(shape).map((point) => transform(shape.matrix, point));
  if (!points.length) return null;
  const padding = Math.ceil(shape.width / 2) + 2;
  const x = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x)) - padding));
  const y = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y)) - padding));
  const right = Math.min(
    width,
    Math.ceil(Math.max(...points.map((point) => point.x)) + padding + 1),
  );
  const bottom = Math.min(
    height,
    Math.ceil(Math.max(...points.map((point) => point.y)) + padding + 1),
  );
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
};
const transformationHandles = (shape: Shape, zoom: number) => {
  const positions = vertices(shape).map((point) => transform(shape.matrix, point));
  const minX = Math.min(...positions.map((point) => point.x));
  const maxX = Math.max(...positions.map((point) => point.x));
  const minY = Math.min(...positions.map((point) => point.y));
  const maxY = Math.max(...positions.map((point) => point.y));
  return {
    rotate: { x: (minX + maxX) / 2, y: minY - 28 / zoom },
    scale: { x: maxX + 20 / zoom, y: maxY + 20 / zoom },
    top: { x: (minX + maxX) / 2, y: minY },
  };
};
const makeShape = (
  tool: Tool,
  a: Point,
  b: Point,
  stroke: string,
  fill: string | null,
  width: number,
): Shape | null => {
  const common = { ...base(shapeLabel[tool as 'line' | 'rect' | 'circle']), stroke, fill, width };
  if (tool === 'line') return { ...common, kind: 'line', a, b };
  if (tool === 'rect')
    return { ...common, kind: 'rect', x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  if (tool === 'circle')
    return { ...common, kind: 'circle', center: a, r: Math.hypot(b.x - a.x, b.y - a.y) };
  return null;
};

type LayerRowProps = {
  shape: Shape;
  active: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onReorder: (id: string, direction: number) => void;
  onModify: (id: string, update: (shape: Shape) => Shape) => void;
};
const LayerRow = memo(function LayerRow({
  shape,
  active,
  onSelect,
  onReorder,
  onModify,
}: LayerRowProps) {
  const glyph =
    shape.kind === 'line'
      ? '╱'
      : shape.kind === 'rect'
        ? '▭'
        : shape.kind === 'circle'
          ? '○'
          : shape.kind === 'image'
            ? '▧'
            : shape.kind === 'bezier'
              ? '⌁'
              : '⬡';
  return (
    <div className={`object-row ${active ? 'active' : ''}`}>
      <button className="object-name" onClick={(event) => onSelect(shape.id, event.shiftKey)}>
        <span className="object-type">{glyph}</span>
        {shape.name}
      </button>
      <button title="Wyżej" onClick={() => onReorder(shape.id, 1)}>
        <ArrowUp size={13} />
      </button>
      <button title="Niżej" onClick={() => onReorder(shape.id, -1)}>
        <ArrowDown size={13} />
      </button>
      <button
        title="Widoczność"
        onClick={() => onModify(shape.id, (item) => ({ ...item, visible: !item.visible }))}
      >
        {shape.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      <button
        title="Blokada"
        onClick={() => onModify(shape.id, (item) => ({ ...item, locked: !item.locked }))}
      >
        {shape.locked ? <Lock size={14} /> : <Unlock size={14} />}
      </button>
    </div>
  );
});

export default function App() {
  const [doc, setDoc] = useState<DocumentModel>(blank),
    [selected, setSelected] = useState<string | null>(null),
    [selectedIds, setSelectedIds] = useState<string[]>([]),
    [tool, setTool] = useState<Tool>('select');
  const [history, setHistory] = useState<DocumentModel[]>([]),
    [future, setFuture] = useState<DocumentModel[]>([]),
    [draft, setDraft] = useState<Shape | null>(null),
    [points, setPoints] = useState<Point[]>([]);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 }),
    [canvasSize, setCanvasSize] = useState({ width: 1920, height: 1080 }),
    [keepCanvasAspect, setKeepCanvasAspect] = useState(false),
    [cursor, setCursor] = useState<Point>({ x: 0, y: 0 }),
    [pivot, setPivot] = useState<Point>({ x: 0, y: 0 }),
    [transformKind, setTransformKind] = useState<'move' | 'rotate' | 'scale'>('move'),
    [transformValues, setTransformValues] = useState({ x: 0, y: 0 }),
    [grid, setGrid] = useState(false),
    [snap, setSnap] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [stroke, setStroke] = useState('#65d8ec'),
    [fill, setFill] = useState<string | null>(null),
    [weight, setWeight] = useState(2),
    [colorTarget, setColorTarget] = useState<'stroke' | 'fill'>('stroke'),
    [colorMode, setColorMode] = useState<'RGB' | 'CMYK'>('RGB'),
    [cmykSource, setCmykSource] = useState<CMYK | null>(null),
    [hexDraft, setHexDraft] = useState('#65D8EC'),
    [recent, setRecent] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>('average'),
    [filterOpts, setFilterOpts] = useState<FilterOptions>({
      size: 3,
      threshold: 128,
      invert: false,
      sobel: 'full',
      element: defaultElement(),
    }),
    [preview, setPreview] = useState<string | null>(null),
    [filterTime, setFilterTime] = useState(0),
    [filterProgress, setFilterProgress] = useState(0),
    [busy, setBusy] = useState(false),
    [compare, setCompare] = useState(50);
  const [analysisTarget, setAnalysisTarget] = useState('#2f9e44');
  const [analysisImage, setAnalysisImage] = useState<ImageShape | null>(null);
  const [analysisPreviewOpen, setAnalysisPreviewOpen] = useState(false);
  const [analysisHueTolerance, setAnalysisHueTolerance] = useState(28);
  const [analysisMinSaturation, setAnalysisMinSaturation] = useState(22);
  const [analysisMinValue, setAnalysisMinValue] = useState(12);
  const [analysisRgbTolerance, setAnalysisRgbTolerance] = useState(18);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [status, setStatus] = useState('Gotowe'),
    [pendingReplacement, setPendingReplacement] = useState<(() => void) | null>(null),
    [ready, setReady] = useState(false),
    [bezierDegree, setBezierDegree] = useState(3),
    [pointText, setPointText] = useState('100,100\n200,100\n200,200\n100,200'),
    [coordinateMode, setCoordinateMode] = useState<'fields' | 'paste'>('fields'),
    [coordinatePoints, setCoordinatePoints] = useState<Point[]>(initialCoordinatePoints),
    [showControls, setShowControls] = useState(true),
    [showPixels, setShowPixels] = useState(false),
    [algorithmId, setAlgorithmId] = useState<AlgorithmId>('bresenham'),
    [traceIndex, setTraceIndex] = useState(0),
    [menu, setMenu] = useState<string | null>(null),
    [panel, setPanel] = useState<'właściwości' | 'kolor' | 'filtry' | 'algorytm' | 'analiza'>('właściwości');
  const canvas = useRef<HTMLCanvasElement>(null),
    overlay = useRef<HTMLCanvasElement>(null),
    wrap = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    maskInput = useRef<HTMLInputElement>(null),
    imageImportPanel = useRef<'filtry' | 'analiza'>('filtry'),
    drag = useRef<Drag | null>(null),
    workerRef = useRef<Worker | null>(null),
    analysisWorkerRef = useRef<Worker | null>(null),
    analysisGeneration = useRef(0),
    filterGeneration = useRef(0),
    spaceHeld = useRef(false),
    projectOpened = useRef(false),
    dirty = useRef(false),
    docRef = useRef(doc),
    selectionRef = useRef(selected),
    imageCache = useRef(new Map<string, ImageCacheEntry>()),
    imageCacheBytes = useRef(0),
    objectBitmapCache = useRef(new Map<string, ObjectBitmap>()),
    objectBitmapBytes = useRef(0),
    bitmapDocumentSize = useRef(''),
    previousRender = useRef<RenderSnapshot | null>(null),
    database = useRef<IDBDatabase | null>(null),
    databaseOpening = useRef<Promise<IDBDatabase> | null>(null),
    renderReady = useRef(Promise.resolve());
  docRef.current = doc;
  selectionRef.current = selected;
  const shape = doc.objects.find((s) => s.id === selected) ?? null;
  const selectOnly = (id: string | null) => {
    setSelected(id);
    setSelectedIds(id ? [id] : []);
  };
  useEffect(() => {
    if (tool === 'polygon' || tool === 'bezier') setCoordinatePoints(initialCoordinatePoints());
  }, [tool]);
  const openDatabase = useCallback((): Promise<IDBDatabase> => {
    if (database.current) return Promise.resolve(database.current);
    if (databaseOpening.current) return databaseOpening.current;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('vectorlab', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('projects'))
          request.result.createObjectStore('projects');
      };
      request.onerror = () => reject(request.error ?? new Error('Nie można otworzyć IndexedDB'));
      request.onblocked = () => reject(new Error('Otwarcie IndexedDB zostało zablokowane'));
      request.onsuccess = () => {
        const db = request.result;
        database.current = db;
        db.onversionchange = () => {
          db.close();
          if (database.current === db) database.current = null;
          databaseOpening.current = null;
        };
        resolve(db);
      };
    });
    databaseOpening.current = opening;
    void opening.catch(() => {
      if (databaseOpening.current === opening) databaseOpening.current = null;
    });
    return opening;
  }, []);
  useEffect(() => {
    const closeDatabase = () => {
      database.current?.close();
      database.current = null;
      databaseOpening.current = null;
    };
    window.addEventListener('pagehide', closeDatabase);
    return () => window.removeEventListener('pagehide', closeDatabase);
  }, []);
  useEffect(() => setCanvasSize({ width: doc.width, height: doc.height }), [doc.width, doc.height]);
  const transformPreview = useMemo((): Shape | null => {
    if (!shape || shape.locked) return null;
    const { x, y } = transformValues;
    if (transformKind === 'move' && x === 0 && y === 0) return null;
    if (transformKind === 'rotate' && x === 0) return null;
    if (transformKind === 'scale' && (x === 0 || y === 0 || (x === 1 && y === 1))) return null;
    const matrix =
      transformKind === 'move'
        ? translation(x, y)
        : transformKind === 'rotate'
          ? rotation(x, pivot)
          : scaling(x, y, pivot);
    return { ...shape, matrix: multiply(matrix, shape.matrix) };
  }, [shape, transformKind, transformValues, pivot]);
  const lineSteps = useMemo(
    () =>
      shape?.kind === 'line'
        ? traceLine(transform(shape.matrix, shape.a), transform(shape.matrix, shape.b))
        : [],
    [shape],
  );
  useEffect(() => {
    if (!shape) return;
    const mapping: Record<Shape['kind'], AlgorithmId> = {
      line: 'bresenham',
      rect: 'bresenham',
      circle: 'circle',
      polygon: 'scanline',
      bezier: 'bezier',
      image: 'sobel',
    };
    setAlgorithmId(mapping[shape.kind]);
    setTraceIndex(0);
    setTransformKind('move');
    setTransformValues({ x: 0, y: 0 });
  }, [selected]);
  useEffect(() => {
    const s = docRef.current.objects.find((o) => o.id === selected);
    if (s) {
      setStroke(s.stroke);
      setFill(s.fill);
      setWeight(s.width);
      const pts = vertices(s).map((q) => transform(s.matrix, q));
      if (pts.length)
        setPivot({
          x: pts.reduce((n, q) => n + q.x, 0) / pts.length,
          y: pts.reduce((n, q) => n + q.y, 0) / pts.length,
        });
    }
  }, [selected, shape?.stroke, shape?.fill, shape?.width]);
  useEffect(() => {
    setCmykSource(null);
  }, [colorTarget, selected]);
  const commit = useCallback((next: DocumentModel, message = 'Zmieniono projekt') => {
    const previous = snapshot(docRef.current);
    setHistory((h) => limitHistory([...h, previous]));
    setFuture([]);
    setDoc(next);
    docRef.current = next;
    dirty.current = true;
    setStatus(message);
  }, []);
  const replaceProject = (action: () => void) => {
    if (dirty.current) setPendingReplacement(() => action);
    else action();
  };
  const modify = useCallback(
    (id: string, fn: (s: Shape) => Shape, message = 'Zmieniono obiekt') => {
      const next = snapshot(docRef.current);
      next.objects = next.objects.map((s) => (s.id === id ? fn(s) : s));
      commit(next, message);
    },
    [commit],
  );
  const undo = useCallback(() => {
    if (!history.length) return;
    const current = snapshot(docRef.current);
    setFuture((f) => [current, ...f]);
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setDoc(last);
    docRef.current = last;
    dirty.current = true;
    setStatus('Cofnięto');
  }, [history]);
  const redo = useCallback(() => {
    if (!future.length) return;
    const current = snapshot(docRef.current);
    setHistory((h) => limitHistory([...h, current]));
    const next = future[0];
    setFuture((f) => f.slice(1));
    setDoc(next);
    docRef.current = next;
    dirty.current = true;
    setStatus('Ponowiono');
  }, [future]);
  const save = useCallback(() => {
    const content = JSON.stringify({ ...docRef.current, element: filterOpts.element });
    void openDatabase()
      .then(
        (db) =>
          new Promise<void>((resolve, reject) => {
            const tx = db.transaction('projects', 'readwrite');
            tx.objectStore('projects').put(content, 'autosave');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('Błąd zapisu kopii'));
            tx.onabort = () => reject(tx.error ?? new Error('Zapis kopii został przerwany'));
          }),
      )
      .then(() => {
        download('projekt.vlab', new Blob([content], { type: 'application/json' }));
        dirty.current = false;
        setStatus('Zapisano projekt');
      })
      .catch(() => {
        download('projekt.vlab', new Blob([content], { type: 'application/json' }));
        dirty.current = false;
        setStatus('Zapisano plik, ale kopia lokalna nie powiodła się');
      });
  }, [filterOpts.element, openDatabase]);
  const open = (file: File) => {
    file.text().then((text) => {
      try {
        const p = parseProject(text);
        replaceProject(() => {
          projectOpened.current = true;
          commit(p, 'Wczytano projekt');
          dirty.current = false;
          if (p.element) setFilterOpts((o) => ({ ...o, element: p.element! }));
          selectOnly(null);
        });
      } catch (e) {
        setStatus(e instanceof Error ? e.message : 'Błąd wczytywania');
      }
    });
  };
  const exportImage = (type: 'png' | 'jpeg') => {
    const c = canvas.current;
    if (!c) return;
    void renderReady.current.then(() => {
      c.toBlob(
        (blob) => {
          if (blob) download(`grafika.${type === 'png' ? 'png' : 'jpg'}`, blob);
        },
        `image/${type}`,
        0.92,
      );
    });
  };
  const resizeCanvas = () => {
    const width = Math.round(canvasSize.width),
      height = Math.round(canvasSize.height);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192 ||
      width * height > 16_000_000
    ) {
      setStatus('Kanwa: podaj dodatnie wymiary do 8192 px i 16 mln pikseli');
      return;
    }
    commit({ ...docRef.current, width, height }, 'Zmieniono wymiary kanwy');
    requestAnimationFrame(fitView);
  };
  const fitView = () => {
    const host = wrap.current;
    if (!host) return;
    const availableWidth = Math.max(100, host.clientWidth - 100);
    const availableHeight = Math.max(100, host.clientHeight - 90);
    const zoom = Math.min(
      4,
      availableWidth / docRef.current.width,
      availableHeight / docRef.current.height,
    );
    setView({
      zoom,
      x: Math.max(-70, (host.clientWidth - docRef.current.width * zoom) / 2 - 70),
      y: Math.max(-60, (host.clientHeight - docRef.current.height * zoom) / 2 - 60),
    });
  };
  useEffect(() => {
    fitView();
  }, [doc.width, doc.height]);
  const selectedImage: ImageShape | null = shape?.kind === 'image' ? shape : null;
  const analysisSource = analysisImage ?? selectedImage;
  const dataUrlToBuffer = async (src: string) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return {
      width: c.width,
      height: c.height,
      data: ctx.getImageData(0, 0, c.width, c.height).data,
    };
  };
  const bufferToDataUrl = (b: { width: number; height: number; data: Uint8ClampedArray }) => {
    const c = document.createElement('canvas');
    c.width = b.width;
    c.height = b.height;
    c.getContext('2d')!.putImageData(new ImageData(b.data, b.width, b.height), 0, 0);
    return c.toDataURL('image/png');
  };
  const openImagePicker = (destination: 'filtry' | 'analiza') => {
    imageImportPanel.current = destination;
    imageInput.current?.click();
  };
  const analysisTargetRgb = hexToRgb(analysisTarget);
  const analysisTargetNeutral =
    Math.max(analysisTargetRgb.r, analysisTargetRgb.g, analysisTargetRgb.b) -
      Math.min(analysisTargetRgb.r, analysisTargetRgb.g, analysisTargetRgb.b) <
    10;
  const analysisKey = `${analysisTarget}|${analysisHueTolerance}|${analysisMinSaturation}|${analysisMinValue}|${analysisRgbTolerance}`;
  const currentAnalysis =
    analysisResult && analysisResult.imageId === analysisSource?.id && analysisResult.key === analysisKey
      ? analysisResult
      : null;
  useEffect(() => {
    analysisGeneration.current++;
    analysisWorkerRef.current?.terminate();
    analysisWorkerRef.current = null;
    setAnalysisBusy(false);
    setAnalysisProgress(0);
    setAnalysisResult(null);
  }, [analysisSource?.id, analysisSource?.pixels]);
  const runColorAnalysis = async () => {
    if (!analysisSource) {
      setStatus('Wczytaj i zaznacz obraz, aby uruchomić analizę');
      return;
    }
    const imageId = analysisSource.id;
    const source = analysisSource.pixels;
    const key = analysisKey;
    const generation = ++analysisGeneration.current;
    analysisWorkerRef.current?.terminate();
    setAnalysisResult(null);
    setAnalysisBusy(true);
    setAnalysisProgress(0);
    setStatus('Analizowanie obrazu…');
    const startedAt = performance.now();
    try {
      const image = await dataUrlToBuffer(source);
      if (generation !== analysisGeneration.current) return;
      const worker = new Worker(new URL('./workers/analysis.worker.ts', import.meta.url), {
        type: 'module',
      });
      analysisWorkerRef.current = worker;
      worker.onmessage = (
        event: MessageEvent<{
          progress?: number;
          error?: string;
          matchedPixels?: number;
          visiblePixels?: number;
          mask?: ArrayBuffer;
          maskWidth?: number;
          maskHeight?: number;
        }>,
      ) => {
        if (generation !== analysisGeneration.current) return;
        if (typeof event.data.progress === 'number') {
          setAnalysisProgress(Math.round(event.data.progress * 100));
          return;
        }
        if (event.data.error) {
          setStatus(event.data.error);
          setAnalysisBusy(false);
          worker.terminate();
          analysisWorkerRef.current = null;
          return;
        }
        if (
          !event.data.mask ||
          event.data.matchedPixels === undefined ||
          event.data.visiblePixels === undefined ||
          !event.data.maskWidth ||
          !event.data.maskHeight
        ) return;
        const maskUrl = bufferToDataUrl({
          width: event.data.maskWidth,
          height: event.data.maskHeight,
          data: new Uint8ClampedArray(event.data.mask),
        });
        const matchedPixels = event.data.matchedPixels;
        const visiblePixels = event.data.visiblePixels;
        const percentage = visiblePixels ? (matchedPixels / visiblePixels) * 100 : 0;
        setAnalysisResult({
          imageId,
          key,
          matchedPixels,
          visiblePixels,
          percentage,
          durationMs: performance.now() - startedAt,
          maskUrl,
        });
        setAnalysisProgress(100);
        setAnalysisBusy(false);
        setStatus(`Analiza zakończona: ${percentage.toFixed(2)}% obrazu`);
        worker.terminate();
        analysisWorkerRef.current = null;
      };
      worker.onerror = () => {
        if (generation !== analysisGeneration.current) return;
        setStatus('Błąd podczas analizy obrazu');
        setAnalysisBusy(false);
        worker.terminate();
        analysisWorkerRef.current = null;
      };
      worker.postMessage(
        {
          width: image.width,
          height: image.height,
          data: image.data.buffer,
          options: {
            target: hexToRgb(analysisTarget),
            hueTolerance: analysisHueTolerance,
            minSaturation: analysisMinSaturation,
            minValue: analysisMinValue,
            rgbTolerance: analysisRgbTolerance,
          },
        },
        [image.data.buffer],
      );
    } catch (error) {
      if (generation !== analysisGeneration.current) return;
      setStatus(error instanceof Error ? error.message : 'Błąd podczas analizy obrazu');
      setAnalysisBusy(false);
    }
  };
  const cancelColorAnalysis = () => {
    analysisGeneration.current++;
    analysisWorkerRef.current?.terminate();
    analysisWorkerRef.current = null;
    setAnalysisBusy(false);
    setAnalysisProgress(0);
    setStatus('Anulowano analizę obrazu');
  };
  const importImage = async (file: File) => {
    if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) {
      setStatus('Nieobsługiwany format obrazu');
      return;
    }
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode();
      // Keep imports within the same limits as the editable canvas while preserving
      // the complete image and its aspect ratio. Very large photos are downsampled.
      const maxDimension = 8192;
      const maxPixels = 16_000_000;
      const importScale = Math.min(
        1,
        maxDimension / img.width,
        maxDimension / img.height,
        Math.sqrt(maxPixels / (img.width * img.height)),
      );
      const imageWidth = Math.max(1, Math.round(img.width * importScale));
      const imageHeight = Math.max(1, Math.round(img.height * importScale));
      const off = document.createElement('canvas');
      off.width = imageWidth;
      off.height = imageHeight;
      off.getContext('2d')!.drawImage(img, 0, 0, imageWidth, imageHeight);
      const pixels = off.toDataURL('image/png');
      URL.revokeObjectURL(url);
      const current = docRef.current;
      const hasObjects = current.objects.length > 0;
      const canvasWidth = hasObjects ? current.width : imageWidth;
      const canvasHeight = hasObjects ? current.height : imageHeight;
      const displayScale = Math.min(1, canvasWidth / imageWidth, canvasHeight / imageHeight);
      const displayWidth = imageWidth * displayScale;
      const displayHeight = imageHeight * displayScale;
      const s: ImageShape = {
        ...base('Obraz'),
        kind: 'image',
        x: (canvasWidth - displayWidth) / 2,
        y: (canvasHeight - displayHeight) / 2,
        w: displayWidth,
        h: displayHeight,
        pixels,
        original: pixels,
      };
      if (imageImportPanel.current === 'analiza') {
        setAnalysisImage({ ...s, x: 0, y: 0, w: imageWidth, h: imageHeight });
        setAnalysisResult(null);
        setAnalysisPreviewOpen(false);
        setPanel('analiza');
        setStatus('Wczytano obraz do analizy');
        return;
      }
      commit(
        { ...current, width: canvasWidth, height: canvasHeight, objects: [...current.objects, s] },
        'Wczytano obraz',
      );
      selectOnly(s.id);
      requestAnimationFrame(fitView);
      setPanel(imageImportPanel.current);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Błąd obrazu');
    }
  };
  const addSampleImages = () => {
    const samples: { name: string; paint: (ctx: CanvasRenderingContext2D) => void }[] = [
      {
        name: 'Przykład — krajobraz',
        paint: (ctx) => {
          const sky = ctx.createLinearGradient(0, 0, 0, 220);
          sky.addColorStop(0, '#9bd8f4');
          sky.addColorStop(1, '#f8e9b5');
          ctx.fillStyle = sky;
          ctx.fillRect(0, 0, 320, 220);
          ctx.fillStyle = '#ffd45c';
          ctx.beginPath();
          ctx.arc(250, 54, 27, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#688e9a';
          ctx.beginPath();
          ctx.moveTo(0, 158); ctx.lineTo(72, 68); ctx.lineTo(148, 158); ctx.lineTo(220, 86); ctx.lineTo(320, 170); ctx.lineTo(320, 220); ctx.lineTo(0, 220); ctx.fill();
          ctx.fillStyle = '#47764f';
          ctx.fillRect(0, 166, 320, 54);
          for (const x of [45, 95, 270]) {
            ctx.fillStyle = '#684b37'; ctx.fillRect(x - 5, 150, 10, 38);
            ctx.fillStyle = '#2e7048'; ctx.beginPath(); ctx.arc(x, 145, 19, 0, Math.PI * 2); ctx.fill();
          }
        },
      },
      {
        name: 'Przykład — figury i kolory',
        paint: (ctx) => {
          ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, 320, 220);
          ctx.fillStyle = '#ed6a5a'; ctx.fillRect(28, 28, 112, 82);
          ctx.fillStyle = '#3178a8'; ctx.beginPath(); ctx.arc(220, 75, 48, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#f3bd45'; ctx.beginPath(); ctx.moveTo(45, 190); ctx.lineTo(118, 116); ctx.lineTo(176, 190); ctx.fill();
          ctx.fillStyle = '#56a879'; ctx.fillRect(202, 145, 82, 42);
          ctx.strokeStyle = '#252c32'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(24, 205); ctx.lineTo(295, 205); ctx.stroke();
        },
      },
      {
        name: 'Przykład — maska czarno-biała',
        paint: (ctx) => {
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 320, 220);
          ctx.fillStyle = '#111'; ctx.fillRect(34, 30, 76, 76);
          ctx.beginPath(); ctx.arc(194, 70, 43, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(62, 145, 204, 28);
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(194, 70, 15, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(138, 150, 45, 18);
        },
      },
    ];
    const objects: Shape[] = samples.map((sample, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 220;
      sample.paint(canvas.getContext('2d')!);
      const pixels = canvas.toDataURL('image/png');
      return {
        ...base(sample.name),
        kind: 'image',
        x: 24 + index * 350,
        y: 70,
        w: canvas.width,
        h: canvas.height,
        pixels,
        original: pixels,
      };
    });
    commit({ ...docRef.current, objects: [...docRef.current.objects, ...objects] }, 'Dodano przykładowe obrazy');
    selectOnly(objects[0].id);
    setPanel('filtry');
  };
  const addSampleObjects = () => {
    const example = demoProject();
    const additions = example.objects.map(clone);
    const image = additions.find((item) => item.kind === 'image');
    commit(
      { ...docRef.current, objects: [...docRef.current.objects, ...additions] },
      'Dodano przykładowe obiekty',
    );
    selectOnly(image?.id ?? additions[0]?.id ?? null);
    setPanel(image ? 'filtry' : 'algorytm');
  };
  const runFilter = async () => {
    if (!selectedImage) return;
    if ((filter === 'dilation' || filter === 'erosion') && !filterOpts.element.cells.some(Boolean)) {
      setStatus('Maska musi mieć co najmniej jedną aktywną komórkę');
      return;
    }
    const generation = ++filterGeneration.current;
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(true);
    setFilterProgress(0);
    setStatus('Przetwarzanie...');
    const start = performance.now();
    try {
      const b = await dataUrlToBuffer(selectedImage.pixels);
      if (generation !== filterGeneration.current) return;
      const worker = new Worker(new URL('./workers/filter.worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;
      worker.onmessage = (
        event: MessageEvent<{
          width?: number;
          height?: number;
          data?: ArrayBuffer;
          progress?: number;
          error?: string;
        }>,
      ) => {
        if (generation !== filterGeneration.current) return;
        if (typeof event.data.progress === 'number') {
          setFilterProgress(Math.round(event.data.progress * 100));
          return;
        }
        if (event.data.error) setStatus(event.data.error);
        else if (event.data.data && event.data.width && event.data.height) {
          setPreview(
            bufferToDataUrl({
              width: event.data.width,
              height: event.data.height,
              data: new Uint8ClampedArray(event.data.data),
            }),
          );
          setFilterTime(Math.round(performance.now() - start));
          setFilterProgress(100);
          setStatus('Podgląd filtra gotowy');
        }
        worker.terminate();
        workerRef.current = null;
        setBusy(false);
      };
      worker.onerror = () => {
        if (generation !== filterGeneration.current) return;
        setStatus('Błąd procesu filtracji');
        worker.terminate();
        workerRef.current = null;
        setBusy(false);
      };
      worker.postMessage(
        {
          width: b.width,
          height: b.height,
          data: b.data.buffer,
          kind: filter,
          options: filterOpts,
        },
        [b.data.buffer],
      );
    } catch (e) {
      if (generation === filterGeneration.current) {
        setStatus(e instanceof Error ? e.message : 'Błąd filtra');
        setBusy(false);
      }
    }
  };
  const cancelFilter = () => {
    filterGeneration.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(false);
    setFilterProgress(0);
    setPreview(null);
    setStatus('Anulowano filtr');
  };
  useEffect(() => {
    if (filter !== 'threshold' || !selectedImage) return;
    const id = setTimeout(() => {
      void runFilter();
    }, 180);
    return () => clearTimeout(id);
  }, [filter, filterOpts.threshold, filterOpts.invert, selectedImage?.id]);
  const acceptFilter = () => {
    if (!selectedImage || !preview) return;
    modify(
      selectedImage.id,
      (s) => (s.kind === 'image' ? { ...s, pixels: preview } : s),
      'Zastosowano filtr',
    );
    setPreview(null);
  };
  const restoreImage = () => {
    if (!selectedImage) return;
    modify(
      selectedImage.id,
      (s) => (s.kind === 'image' ? { ...s, pixels: s.original } : s),
      'Przywrócono oryginał',
    );
    setPreview(null);
  };
  const activeColor = colorTarget === 'stroke' ? stroke : (fill ?? '#ffffff');
  const rgb = hexToRgb(activeColor),
    cmyk = cmykSource ?? rgbToCmyk(rgb);
  useEffect(() => {
    setHexDraft(activeColor.toUpperCase());
  }, [activeColor]);
  const colorChange = (hex: string, preserveCmyk = false) => {
    if (!preserveCmyk) setCmykSource(null);
    if (colorTarget === 'stroke') setStroke(hex);
    else setFill(hex);
    setRecent((r) => [hex, ...r.filter((x) => x !== hex)].slice(0, 12));
    if (shape) modify(shape.id, (s) => ({ ...s, [colorTarget]: hex }), 'Zmieniono kolor');
  };
  const toCanvas = (e: React.PointerEvent | React.WheelEvent): Point => {
    const rect =
      canvas.current?.getBoundingClientRect() ?? overlay.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / view.zoom,
      y: (e.clientY - rect.top) / view.zoom,
    };
  };
  const snapped = (p: Point): Point =>
    snap ? { x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 } : p;
  const handleAt = (s: Shape, p: Point) =>
    vertices(s).findIndex(
      (v) =>
        Math.hypot(transform(s.matrix, v).x - p.x, transform(s.matrix, v).y - p.y) < 8 / view.zoom,
    );
  const pointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    overlay.current?.setPointerCapture(e.pointerId);
    const p = snapped(toCanvas(e));
    setCursor(p);
    if (tool === 'pan' || e.button === 1 || spaceHeld.current) {
      drag.current = {
        mode: 'pan',
        start: { x: e.clientX, y: e.clientY },
        pan: { x: view.x, y: view.y },
      };
      return;
    }
    if (tool === 'pivot') {
      setPivot(p);
      setStatus(`Punkt odniesienia: ${Math.round(p.x)}, ${Math.round(p.y)}`);
      return;
    }
    if (tool === 'eyedropper') {
      const x = Math.floor(p.x),
        y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= docRef.current.width || y >= docRef.current.height) {
        setStatus('Kliknij wewnątrz kanwy, aby pobrać kolor');
        return;
      }
      const rgba = canvas.current?.getContext('2d')?.getImageData(x, y, 1, 1).data;
      if (rgba) {
        const color = rgbToHex({ r: rgba[0], g: rgba[1], b: rgba[2] });
        colorChange(color);
        setPanel('kolor');
        setStatus(`Pobrano kolor ${color.toUpperCase()}`);
      }
      return;
    }
    if (tool === 'select' || tool === 'rotate' || tool === 'scale') {
      const current = docRef.current.objects.find((s) => s.id === selectionRef.current);
      if (tool === 'select' && current && !current.locked) {
        const handles = transformationHandles(current, view.zoom);
        for (const [mode, point] of [
          ['rotate', handles.rotate],
          ['scale', handles.scale],
        ] as const) {
          if (Math.hypot(p.x - point.x, p.y - point.y) < 10 / view.zoom) {
            drag.current = { mode, start: p, original: clone(current), pivot, pan: { x: 0, y: 0 } };
            setStatus(
              mode === 'rotate' ? 'Przeciągnij uchwyt obrotu' : 'Przeciągnij uchwyt skalowania',
            );
            return;
          }
        }
        const index = handleAt(current, p);
        if (index >= 0) {
          drag.current = {
            mode: 'handle',
            start: p,
            original: clone(current),
            index,
            pan: { x: 0, y: 0 },
          };
          return;
        }
      }
      const target = [...docRef.current.objects]
        .reverse()
        .find((s) => s.visible && !s.locked && hit(s, p, 6 / view.zoom));
      let nextSelection = selectedIds;
      if (e.shiftKey && target) {
        nextSelection = selectedIds.includes(target.id)
          ? selectedIds.filter((id) => id !== target.id)
          : [...selectedIds, target.id];
        setSelectedIds(nextSelection);
        setSelected(nextSelection.at(-1) ?? null);
        setStatus(`Zaznaczono ${nextSelection.length} obiektów`);
      } else if (!e.shiftKey) {
        nextSelection = target ? [target.id] : [];
        setSelectedIds(nextSelection);
        setSelected(target?.id ?? null);
      }
      if (e.shiftKey && target && selectedIds.includes(target.id)) return;
      if (target) {
        const pts = vertices(target).map((q) => transform(target.matrix, q));
        const center = {
          x: pts.reduce((n, q) => n + q.x, 0) / pts.length,
          y: pts.reduce((n, q) => n + q.y, 0) / pts.length,
        };
        if (target.id !== selectionRef.current) setPivot(center);
        const group = tool === 'select'
          ? docRef.current.objects.filter((item) => nextSelection.includes(item.id) && !item.locked)
          : [target];
        drag.current = {
          mode: tool === 'rotate' ? 'rotate' : tool === 'scale' ? 'scale' : 'move',
          start: p,
          original: clone(target),
          originals: group.length > 1 ? group.map(clone) : undefined,
          pivot: target.id === selectionRef.current ? pivot : center,
          pan: { x: 0, y: 0 },
        };
      }
      return;
    }
    if (tool === 'polygon' || tool === 'bezier') {
      const next = [...points, p];
      if (
        tool === 'polygon' &&
        points.length >= 3 &&
        Math.hypot(points[0].x - p.x, points[0].y - p.y) < 10 / view.zoom
      ) {
        finishPoints();
        return;
      }
      setPoints(next);
      if (tool === 'bezier' && next.length >= bezierDegree + 1) {
        const s: Shape = {
          ...base('Krzywa'),
          kind: 'bezier',
          points: next,
          stroke,
          fill: null,
          width: weight,
        };
        commit({ ...docRef.current, objects: [...docRef.current.objects, s] }, 'Utworzono krzywą');
        selectOnly(s.id);
        setPoints([]);
      }
      return;
    }
    drag.current = { mode: 'draw', start: p, pan: { x: 0, y: 0 } };
    setDraft(makeShape(tool, p, p, stroke, fill, weight));
  };
  const pointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const p = snapped(toCanvas(e));
    setCursor(p);
    if (!d) return;
    if (d.mode === 'pan') {
      setView((v) => ({
        ...v,
        x: d.pan.x + e.clientX - d.start.x,
        y: d.pan.y + e.clientY - d.start.y,
      }));
      return;
    }
    if (d.mode === 'draw') {
      setDraft(makeShape(tool, d.start, p, stroke, fill, weight));
      return;
    }
    if (!d.original) return;
    const next: DocumentModel = {
      ...docRef.current,
      objects: docRef.current.objects.slice(),
    };
    next.objects = next.objects.map((s) => {
      const groupOriginal = d.originals?.find((original) => original.id === s.id);
      if (d.mode === 'move' && groupOriginal) {
        let dx = p.x - d.start.x, dy = p.y - d.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        return { ...groupOriginal, matrix: multiply(translation(dx, dy), groupOriginal.matrix) } as Shape;
      }
      if (s.id !== d.original!.id) return s;
      if (d.mode === 'move') {
        let dx = p.x - d.start.x,
          dy = p.y - d.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (d.pivot) setPivot({ x: d.pivot.x + dx, y: d.pivot.y + dy });
        return {
          ...d.original!,
          matrix: multiply(translation(dx, dy), d.original!.matrix),
        } as Shape;
      }
      if (d.mode === 'rotate') {
        const pivot = d.pivot!,
          a = Math.atan2(d.start.y - pivot.y, d.start.x - pivot.x),
          b = Math.atan2(p.y - pivot.y, p.x - pivot.x);
        let deg = ((b - a) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        setStatus(`Obrót: ${deg.toFixed(1)}°`);
        return {
          ...d.original!,
          matrix: multiply(rotation(deg, pivot), d.original!.matrix),
        } as Shape;
      }
      if (d.mode === 'scale') {
        const pivot = d.pivot!,
          sx = Math.abs(d.start.x - pivot.x) < 1 ? 1 : (p.x - pivot.x) / (d.start.x - pivot.x),
          sy = Math.abs(d.start.y - pivot.y) < 1 ? 1 : (p.y - pivot.y) / (d.start.y - pivot.y),
          uniform = e.shiftKey ? (Math.abs(sx) > Math.abs(sy) ? sx : sy) : 0;
        const x = uniform || sx,
          y = uniform || sy;
        if (Math.abs(x) < 0.001 || Math.abs(y) < 0.001) return s;
        setStatus(`Skala: ${x.toFixed(2)} × ${y.toFixed(2)}`);
        return {
          ...d.original!,
          matrix: multiply(scaling(x, y, pivot), d.original!.matrix),
        } as Shape;
      }
      const original = d.original!;
      let local: Point;
      try {
        local = transform(inverse(original.matrix), p);
      } catch {
        return s;
      }
      if (original.kind === 'line') {
        const q = { ...original };
        if (d.index === 0) q.a = local;
        else q.b = local;
        return q;
      }
      if (original.kind === 'rect' || original.kind === 'image') {
        const q = { ...original };
        const pts = vertices(original);
        const opposite = pts[(d.index! + 2) % 4];
        q.x = Math.min(local.x, opposite.x);
        q.y = Math.min(local.y, opposite.y);
        q.w = Math.abs(local.x - opposite.x);
        q.h = Math.abs(local.y - opposite.y);
        return q;
      }
      if (original.kind === 'circle')
        return {
          ...original,
          r: Math.hypot(local.x - original.center.x, local.y - original.center.y),
        };
      if (original.kind === 'polygon' || original.kind === 'bezier') {
        const pts = original.points.map((x) => ({ ...x }));
        pts[d.index!] = local;
        return { ...original, points: pts };
      }
      return s;
    });
    setDoc(next);
    docRef.current = next;
  };
  const pointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    overlay.current?.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.mode === 'draw') {
      const s = makeShape(tool, d.start, snapped(toCanvas(e)), stroke, fill, weight);
      setDraft(null);
      if (s) {
        commit({ ...docRef.current, objects: [...docRef.current.objects, s] }, 'Utworzono obiekt');
        selectOnly(s.id);
      }
    } else if (d.mode === 'move' && d.original) {
      const end = snapped(toCanvas(e));
      let dx = end.x - d.start.x;
      let dy = end.y - d.start.y;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const next = {
        ...docRef.current,
        objects: docRef.current.objects.map((s) =>
          (d.originals ?? [d.original!]).some((original) => original.id === s.id)
            ? (() => {
                const original = (d.originals ?? [d.original!]).find((item) => item.id === s.id)!;
                return { ...original, matrix: multiply(translation(dx, dy), original.matrix) };
              })()
            : s,
        ),
      };
      setDoc(next);
      docRef.current = next;
    }
    if (
      (d.mode === 'move' || d.mode === 'handle' || d.mode === 'rotate' || d.mode === 'scale') &&
      d.original
    ) {
      const originals = d.originals ?? [d.original];
      const changed = originals.some((original) =>
        JSON.stringify(docRef.current.objects.find((s) => s.id === original.id)) !== JSON.stringify(original),
      );
      if (changed) {
        const previous = {
          ...docRef.current,
          objects: docRef.current.objects.map((item) => originals.find((original) => original.id === item.id) ?? item),
        };
        setHistory((h) =>
          limitHistory([...h, previous]),
        );
        setFuture([]);
        dirty.current = true;
        setStatus('Zmieniono obiekt');
      }
    }
  };
  const cancelPointer = () => {
    const d = drag.current;
    if (d?.original) {
      const originals = d.originals ?? [d.original];
      const next = {
        ...docRef.current,
        objects: docRef.current.objects.map((s) => originals.find((original) => original.id === s.id) ?? s),
      };
      setDoc(next);
      docRef.current = next;
    }
    drag.current = null;
    setDraft(null);
  };
  const finishPoints = () => {
    if (points.length < 3) return;
    const s: Shape = { ...base('Wielokąt'), kind: 'polygon', points, stroke, fill, width: weight };
    commit({ ...docRef.current, objects: [...docRef.current.objects, s] }, 'Utworzono wielokąt');
    selectOnly(s.id);
    setPoints([]);
  };
  const wheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = overlay.current!.getBoundingClientRect(),
      cx = e.clientX - rect.left - 70,
      cy = e.clientY - rect.top - 60,
      z = Math.max(0.1, Math.min(16, view.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    setView((v) => ({
      zoom: z,
      x: cx - ((cx - v.x) * z) / v.zoom,
      y: cy - ((cy - v.y) * z) / v.zoom,
    }));
  };
  const duplicate = () => {
    if (!shape) return;
    const s = clone(shape);
    s.id = crypto.randomUUID();
    s.name += ' kopia';
    s.matrix = multiply(translation(20, 20), s.matrix);
    commit({ ...docRef.current, objects: [...docRef.current.objects, s] }, 'Zduplikowano');
    selectOnly(s.id);
  };
  const remove = () => {
    if (!selectedIds.length) return;
    commit(
      { ...docRef.current, objects: docRef.current.objects.filter((s) => !selectedIds.includes(s.id)) },
      'Usunięto zaznaczone obiekty',
    );
    selectOnly(null);
  };
  const clearObjects = () => {
    if (!docRef.current.objects.length) return;
    commit({ ...docRef.current, objects: [] }, 'Wyczyszczono wszystkie obiekty');
    selectOnly(null);
  };
  const reorder = useCallback(
    (id: string, direction: number) => {
      const next = snapshot(docRef.current),
        i = next.objects.findIndex((s) => s.id === id),
        j = i + direction;
      if (i < 0 || j < 0 || j >= next.objects.length) return;
      [next.objects[i], next.objects[j]] = [next.objects[j], next.objects[i]];
      commit(next, 'Zmieniono kolejność warstw');
    },
    [commit],
  );
  const setField = (field: string, value: number) => {
    if (!shape || !Number.isFinite(value)) return;
    modify(shape.id, (s) => {
      const q = clone(s) as Shape;
      if (q.kind === 'line') {
        if (field === 'x1') q.a.x = value;
        if (field === 'y1') q.a.y = value;
        if (field === 'x2') q.b.x = value;
        if (field === 'y2') q.b.y = value;
      } else if (q.kind === 'rect' || q.kind === 'image') {
        if (field === 'x') q.x = value;
        if (field === 'y') q.y = value;
        if (field === 'w') q.w = value;
        if (field === 'h') q.h = value;
      } else if (q.kind === 'circle') {
        if (field === 'x') q.center.x = value;
        if (field === 'y') q.center.y = value;
        if (field === 'r') q.r = Math.max(0, value);
      } else if (q.kind === 'polygon' || q.kind === 'bezier') {
        const [axis, index] = field.split(':');
        if (q.points[Number(index)]) q.points[Number(index)][axis as 'x' | 'y'] = value;
      }
      return q;
    });
  };
  const addByFields = () => {
    let s: Shape | null = null;
    if (tool === 'polygon' || tool === 'bezier') {
      const pts =
        coordinateMode === 'fields'
          ? Array.from(
              { length: tool === 'bezier' ? bezierDegree + 1 : coordinatePoints.length },
              (_, i) => coordinatePoints[i] ?? suggestedPoint(i),
            )
          : pointText
              .trim()
              .split(/\n|;/)
              .map((row) =>
                row
                  .trim()
                  .split(/[\s,]+/)
                  .map(Number),
              )
              .map(([x, y]) => ({ x, y }));
      if (
        pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) ||
        pts.length < (tool === 'polygon' ? 3 : 2) ||
        (tool === 'bezier' && pts.length !== bezierDegree + 1) ||
        (tool === 'polygon' && new Set(pts.map((p) => `${p.x},${p.y}`)).size < 3)
      ) {
        setStatus(
          tool === 'bezier'
            ? `Krzywa stopnia ${bezierDegree} wymaga ${bezierDegree + 1} punktów`
            : 'Wielokąt wymaga co najmniej 3 różnych punktów',
        );
        return;
      }
      s = {
        ...base(shapeLabel[tool]),
        kind: tool,
        points: pts,
        stroke,
        fill: tool === 'polygon' ? fill : null,
        width: weight,
      };
    } else {
      const a = {
          x: num((document.getElementById('new-x') as HTMLInputElement).value),
          y: num((document.getElementById('new-y') as HTMLInputElement).value),
        },
        b = {
          x: num((document.getElementById('new-x2') as HTMLInputElement).value, 100),
          y: num((document.getElementById('new-y2') as HTMLInputElement | null)?.value ?? '0', 100),
        };
      if (tool === 'rect')
        s = makeShape(tool, a, { x: a.x + b.x, y: a.y + b.y }, stroke, fill, weight);
      else if (tool === 'circle')
        s = {
          ...base('Okrąg'),
          kind: 'circle',
          center: a,
          r: Math.max(0, b.x),
          stroke,
          fill,
          width: weight,
        };
      else s = makeShape(tool, a, b, stroke, fill, weight);
    }
    if (s) {
      commit({ ...docRef.current, objects: [...docRef.current.objects, s] }, 'Utworzono obiekt');
      selectOnly(s.id);
    }
  };
  const transformSelected = () => {
    if (!shape) return;
    const { x, y } = transformValues;
    if (transformKind === 'scale' && (x === 0 || y === 0)) {
      setStatus('Skala nie może wynosić zero');
      return;
    }
    if (!transformPreview) {
      setStatus('Wpisz wartość przekształcenia');
      return;
    }
    modify(shape.id, () => transformPreview, 'Przekształcono obiekt');
    setTransformValues(transformKind === 'scale' ? { x: 1, y: 1 } : { x: 0, y: 0 });
  };
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    let cancelled = false;
    const render = async () => {
      const decoded = new Map<string, HTMLImageElement>();
      const documentSize = `${doc.width}x${doc.height}`;
      if (bitmapDocumentSize.current !== documentSize) {
        objectBitmapCache.current.clear();
        objectBitmapBytes.current = 0;
        bitmapDocumentSize.current = documentSize;
      }
      for (const s of doc.objects)
        if (s.kind === 'image' && s.visible) {
          const source = preview && s.id === selected ? preview : imageData(s);
          let cachedImage = imageCache.current.get(s.id);
          if (!cachedImage || cachedImage.source !== source) {
            const img = new Image();
            img.src = source;
            await img.decode();
            const previous = imageCache.current.get(s.id);
            if (previous) imageCacheBytes.current -= previous.bytes;
            imageCache.current.delete(s.id);
            const bytes = img.naturalWidth * img.naturalHeight * 4;
            cachedImage = { source, image: img, bytes };
            if (bytes <= imageCacheByteLimit) {
              imageCache.current.set(s.id, cachedImage);
              imageCacheBytes.current += bytes;
            }
          } else {
            imageCache.current.delete(s.id);
            imageCache.current.set(s.id, cachedImage);
          }
          decoded.set(s.id, cachedImage.image);
        }
      while (
        imageCache.current.size > imageCacheLimit ||
        imageCacheBytes.current > imageCacheByteLimit
      ) {
        const oldestId = imageCache.current.keys().next().value;
        if (!oldestId) break;
        imageCacheBytes.current -= imageCache.current.get(oldestId)!.bytes;
        imageCache.current.delete(oldestId);
      }
      if (cancelled) return;
      if (c.width !== doc.width) c.width = doc.width;
      if (c.height !== doc.height) c.height = doc.height;
      const ctx = c.getContext('2d')!;
      const getBitmap = (s: Shape) => {
        const source =
          s.kind === 'image' ? (preview && s.id === selected ? preview : s.pixels) : '';
        let bitmap = objectBitmapCache.current.get(s.id);
        if (
          bitmap?.shape === s &&
          bitmap.source === source &&
          bitmap.documentWidth === doc.width &&
          bitmap.documentHeight === doc.height
        ) {
          objectBitmapCache.current.delete(s.id);
          objectBitmapCache.current.set(s.id, bitmap);
        } else {
          const bounds = objectBounds(s, doc.width, doc.height);
          if (!bounds) return null;
          const layer = document.createElement('canvas');
          layer.width = bounds.width;
          layer.height = bounds.height;
          if (s.kind === 'image') {
            const img = decoded.get(s.id);
            if (!img) return null;
            const layerCtx = layer.getContext('2d')!;
            const m = s.matrix;
            layerCtx.translate(-bounds.x, -bounds.y);
            layerCtx.transform(m[0], m[3], m[1], m[4], m[2], m[5]);
            layerCtx.drawImage(img, s.x, s.y, s.w, s.h);
          } else {
            const pixels = buffer(bounds.width, bounds.height, bounds.x, bounds.y);
            drawShape(pixels, s);
            layer
              .getContext('2d')!
              .putImageData(new ImageData(pixels.data, bounds.width, bounds.height), 0, 0);
          }
          const bytes = bounds.width * bounds.height * 4;
          if (bytes <= bitmapCacheLimit) {
            if (bitmap) objectBitmapBytes.current -= bitmap.bytes;
            bitmap = {
              shape: s,
              source,
              documentWidth: doc.width,
              documentHeight: doc.height,
              ...bounds,
              canvas: layer,
              bytes,
            };
            objectBitmapCache.current.delete(s.id);
            objectBitmapCache.current.set(s.id, bitmap);
            objectBitmapBytes.current += bytes;
            while (
              objectBitmapBytes.current > bitmapCacheLimit ||
              objectBitmapCache.current.size > 2048
            ) {
              const oldestId = objectBitmapCache.current.keys().next().value;
              if (!oldestId) break;
              const oldest = objectBitmapCache.current.get(oldestId)!;
              objectBitmapBytes.current -= oldest.bytes;
              objectBitmapCache.current.delete(oldestId);
            }
          } else {
            if (bitmap) objectBitmapBytes.current -= bitmap.bytes;
            objectBitmapCache.current.delete(s.id);
            bitmap = {
              shape: s,
              source,
              documentWidth: doc.width,
              documentHeight: doc.height,
              ...bounds,
              canvas: layer,
              bytes,
            };
          }
        }
        return bitmap;
      };
      const prior = previousRender.current;
      let changedIndex = -1;
      let canPatch = !!(
        prior &&
        prior.preview === preview &&
        prior.selected === selected &&
        prior.doc.width === doc.width &&
        prior.doc.height === doc.height &&
        prior.doc.background === doc.background &&
        prior.doc.objects.length === doc.objects.length
      );
      if (canPatch && prior) {
        for (let i = 0; i < doc.objects.length; i++) {
          if (prior.doc.objects[i] === doc.objects[i]) continue;
          if (prior.doc.objects[i].id !== doc.objects[i].id || changedIndex !== -1) {
            canPatch = false;
            break;
          }
          changedIndex = i;
        }
        if (changedIndex === -1) canPatch = false;
      }
      let dirty: { x: number; y: number; width: number; height: number } | null = null;
      if (canPatch && prior && changedIndex >= 0) {
        const previousBounds = objectBounds(prior.doc.objects[changedIndex], doc.width, doc.height);
        const nextBounds = objectBounds(doc.objects[changedIndex], doc.width, doc.height);
        const left = Math.min(previousBounds?.x ?? doc.width, nextBounds?.x ?? doc.width);
        const top = Math.min(previousBounds?.y ?? doc.height, nextBounds?.y ?? doc.height);
        const right = Math.max(
          previousBounds ? previousBounds.x + previousBounds.width : 0,
          nextBounds ? nextBounds.x + nextBounds.width : 0,
        );
        const bottom = Math.max(
          previousBounds ? previousBounds.y + previousBounds.height : 0,
          nextBounds ? nextBounds.y + nextBounds.height : 0,
        );
        if (right > left && bottom > top)
          dirty = { x: left, y: top, width: right - left, height: bottom - top };
      }
      if (dirty) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(dirty.x, dirty.y, dirty.width, dirty.height);
        ctx.clip();
        ctx.fillStyle = doc.background;
        ctx.fillRect(dirty.x, dirty.y, dirty.width, dirty.height);
        for (const s of doc.objects) {
          if (!s.visible) continue;
          const bounds = objectBounds(s, doc.width, doc.height);
          if (
            !bounds ||
            bounds.x >= dirty.x + dirty.width ||
            bounds.y >= dirty.y + dirty.height ||
            bounds.x + bounds.width <= dirty.x ||
            bounds.y + bounds.height <= dirty.y
          )
            continue;
          const bitmap = getBitmap(s);
          if (bitmap) ctx.drawImage(bitmap.canvas, bitmap.x, bitmap.y);
        }
        ctx.restore();
      } else if (canPatch) {
        // A changed object that stayed fully outside the document does not alter visible pixels.
      } else {
        ctx.fillStyle = doc.background;
        ctx.fillRect(0, 0, doc.width, doc.height);
        for (const s of doc.objects) {
          if (!s.visible) continue;
          const bitmap = getBitmap(s);
          if (bitmap) ctx.drawImage(bitmap.canvas, bitmap.x, bitmap.y);
        }
      }
      previousRender.current = { doc, preview, selected };
    };
    const frame = requestAnimationFrame(() => {
      const currentRender = render().catch(() => {
        if (!cancelled) {
          previousRender.current = null;
          setStatus('Nie udało się narysować obrazu');
        }
      });
      renderReady.current = currentRender;
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [doc, preview, selected]);
  useEffect(() => {
    const el = overlay.current,
      container = wrap.current;
    if (!el || !container) return;
    const resize = () => {
      el.width = container.clientWidth * devicePixelRatio;
      el.height = container.clientHeight * devicePixelRatio;
      el.style.width = container.clientWidth + 'px';
      el.style.height = container.clientHeight + 'px';
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = overlay.current;
    if (!el) return;
    const ctx = el.getContext('2d')!,
      dpr = devicePixelRatio;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, el.width / dpr, el.height / dpr);
    ctx.translate(70 + view.x, 60 + view.y);
    ctx.scale(view.zoom, view.zoom);
    if (grid) {
      ctx.strokeStyle = 'rgba(100,130,150,.16)';
      ctx.lineWidth = 1 / view.zoom;
      for (let x = 0; x < doc.width; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, doc.height);
        ctx.stroke();
      }
      for (let y = 0; y < doc.height; y += 10) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(doc.width, y);
        ctx.stroke();
      }
    }
    if (showPixels && view.zoom >= 8) {
      ctx.strokeStyle = 'rgba(26,45,55,.32)';
      ctx.lineWidth = 1 / view.zoom;
      const left = Math.max(0, Math.floor((-70 - view.x) / view.zoom)),
        top = Math.max(0, Math.floor((-60 - view.y) / view.zoom)),
        right = Math.min(doc.width, Math.ceil((el.clientWidth - 70 - view.x) / view.zoom)),
        bottom = Math.min(doc.height, Math.ceil((el.clientHeight - 60 - view.y) / view.zoom));
      for (let x = left; x <= right; x++) {
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
      for (let y = top; y <= bottom; y++) {
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
      }
    }
    const drawOutline = (s: Shape, color: string) => {
      const pts = vertices(s).map((p) => transform(s.matrix, p));
      if (!pts.length) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 / view.zoom;
      ctx.setLineDash([5 / view.zoom, 4 / view.zoom]);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (s.kind === 'polygon' || s.kind === 'rect') ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      if (showControls)
        pts.forEach((p, i) => {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = color;
          ctx.fillRect(p.x - 4 / view.zoom, p.y - 4 / view.zoom, 8 / view.zoom, 8 / view.zoom);
          ctx.strokeRect(p.x - 4 / view.zoom, p.y - 4 / view.zoom, 8 / view.zoom, 8 / view.zoom);
          if (s.kind === 'bezier' || s.kind === 'polygon') {
            ctx.fillStyle = color;
            ctx.font = `${11 / view.zoom}px sans-serif`;
            ctx.fillText(String(i + 1), p.x + 7 / view.zoom, p.y - 7 / view.zoom);
          }
        });
    };
    for (const selectedShape of doc.objects.filter((item) => selectedIds.includes(item.id) && item.id !== selected)) {
      drawOutline(selectedShape, '#ffcc68');
    }
    if (shape) {
      drawOutline(shape, '#ffcc68');
      if (showControls && !shape.locked) {
        const handles = transformationHandles(shape, view.zoom);
        ctx.strokeStyle = '#ffcc68';
        ctx.lineWidth = 1 / view.zoom;
        ctx.beginPath();
        ctx.moveTo(handles.top.x, handles.top.y);
        ctx.lineTo(handles.rotate.x, handles.rotate.y);
        ctx.stroke();
        ctx.fillStyle = '#20313d';
        ctx.beginPath();
        ctx.arc(handles.rotate.x, handles.rotate.y, 6 / view.zoom, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#68e0ab';
        ctx.fillRect(
          handles.scale.x - 6 / view.zoom,
          handles.scale.y - 6 / view.zoom,
          12 / view.zoom,
          12 / view.zoom,
        );
        ctx.strokeRect(
          handles.scale.x - 6 / view.zoom,
          handles.scale.y - 6 / view.zoom,
          12 / view.zoom,
          12 / view.zoom,
        );
      }
      ctx.strokeStyle = '#ffcc68';
      ctx.lineWidth = 1 / view.zoom;
      ctx.beginPath();
      ctx.moveTo(pivot.x - 8 / view.zoom, pivot.y);
      ctx.lineTo(pivot.x + 8 / view.zoom, pivot.y);
      ctx.moveTo(pivot.x, pivot.y - 8 / view.zoom);
      ctx.lineTo(pivot.x, pivot.y + 8 / view.zoom);
      ctx.stroke();
    }
    if (transformPreview && panel === 'właściwości') drawOutline(transformPreview, '#68e0ab');
    if (panel === 'algorytm' && algorithmId === 'bresenham' && lineSteps.length) {
      const current = lineSteps[Math.min(traceIndex, lineSteps.length - 1)];
      ctx.fillStyle = '#eb5875';
      ctx.fillRect(
        current.x - 3 / view.zoom,
        current.y - 3 / view.zoom,
        6 / view.zoom,
        6 / view.zoom,
      );
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 / view.zoom;
      ctx.strokeRect(
        current.x - 4 / view.zoom,
        current.y - 4 / view.zoom,
        8 / view.zoom,
        8 / view.zoom,
      );
    }
    if (draft) drawOutline(draft, '#65d8ec');
    if (points.length) {
      ctx.strokeStyle = '#65d8ec';
      ctx.lineWidth = 1 / view.zoom;
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.lineTo(cursor.x, cursor.y);
      ctx.stroke();
      points.forEach((p) => {
        ctx.fillStyle = '#65d8ec';
        ctx.fillRect(p.x - 3 / view.zoom, p.y - 3 / view.zoom, 6 / view.zoom, 6 / view.zoom);
      });
    }
  }, [
    doc,
    view,
    grid,
    shape,
    selectedIds,
    draft,
    points,
    cursor,
    showControls,
    showPixels,
    pivot,
    panel,
    algorithmId,
    lineSteps,
    traceIndex,
    transformPreview,
  ]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editable =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;
      if (pendingReplacement) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setPendingReplacement(null);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        fileInput.current?.click();
        return;
      }
      if (editable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const ids = docRef.current.objects.filter((item) => item.visible && !item.locked).map((item) => item.id);
        setSelectedIds(ids);
        setSelected(ids.at(-1) ?? null);
        setStatus(`Zaznaczono ${ids.length} obiektów`);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate();
        return;
      }
      if (e.key === 'Delete') {
        remove();
        return;
      }
      if (e.key === 'Escape') {
        setDraft(null);
        setPoints([]);
        setPreview(null);
        cancelPointer();
        return;
      }
      if (e.key === 'Enter') {
        if (tool === 'polygon') finishPoints();
        return;
      }
      const map: Record<string, Tool> = {
        v: 'select',
        l: 'line',
        r: 'rect',
        c: 'circle',
        p: 'polygon',
        b: 'bezier',
        h: 'pan',
        i: 'eyedropper',
      };
      if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !(
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement
        )
      ) {
        e.preventDefault();
        spaceHeld.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void openDatabase()
      .then((db) => {
        if (cancelled) return;
        const tx = db.transaction('projects', 'readonly');
        const get = tx.objectStore('projects').get('autosave');
        get.onsuccess = () => {
          if (cancelled) return;
          if (get.result)
            try {
              const p = parseProject(get.result);
              if (!projectOpened.current && docRef.current.objects.length === 0) {
                setDoc(p);
                docRef.current = p;
                if (p.element) setFilterOpts((o) => ({ ...o, element: p.element! }));
                setStatus('Odzyskano projekt');
              }
            } catch {
              setStatus('Kopia automatyczna jest uszkodzona');
            }
          setReady(true);
        };
        get.onerror = () => setReady(true);
        tx.onerror = () => setReady(true);
      })
      .catch(() => setReady(true));
    return () => {
      cancelled = true;
    };
  }, [openDatabase]);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const id = setTimeout(() => {
      void openDatabase()
        .then((db) => {
          if (cancelled) return;
          const tx = db.transaction('projects', 'readwrite');
          tx.objectStore('projects').put(
            JSON.stringify({ ...doc, element: filterOpts.element }),
            'autosave',
          );
          tx.onerror = () => {
            if (!cancelled) setStatus('Nie udało się zapisać kopii automatycznej');
          };
          tx.onabort = () => {
            if (!cancelled) setStatus('Nie udało się zapisać kopii automatycznej');
          };
        })
        .catch(() => {
          if (!cancelled) setStatus('Nie udało się zapisać kopii automatycznej');
        });
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [doc, filterOpts.element, openDatabase, ready]);
  const field = (label: string, key: string, value: number) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
        onChange={(e) => setField(key, num(e.target.value, value))}
      />
    </label>
  );
  const colorChannel = (label: string, value: number, max: number, change: (v: number) => void) => (
    <label className="channel" key={label}>
      <span>{label}</span>
      <input
        type="range"
        min="0"
        max={max}
        value={Math.round(value)}
        onChange={(e) => change(Number(e.target.value))}
      />
      <input
        type="number"
        min="0"
        max={max}
        value={Math.round(value)}
        onChange={(e) => change(Math.max(0, Math.min(max, num(e.target.value))))}
      />
    </label>
  );
  const setRgb = (key: keyof RGB, v: number) => colorChange(rgbToHex({ ...rgb, [key]: v }));
  const setCmyk = (key: 'c' | 'm' | 'y' | 'k', v: number) => {
    const next = { ...cmyk, [key]: v };
    setCmykSource(next);
    colorChange(rgbToHex(cmykToRgb(next)), true);
  };
  const updateElement = (fn: (e: StructuringElement) => StructuringElement) =>
    setFilterOpts((o) => ({ ...o, element: fn(clone(o.element)) }));
  const loadMask = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as StructuringElement;
      if (
        !Number.isInteger(raw.width) ||
        !Number.isInteger(raw.height) ||
        raw.width < 1 ||
        raw.height < 1 ||
        raw.width > 31 ||
        raw.height > 31 ||
        !Number.isInteger(raw.anchorX) ||
        !Number.isInteger(raw.anchorY) ||
        raw.anchorX < 0 ||
        raw.anchorY < 0 ||
        raw.anchorX >= raw.width ||
        raw.anchorY >= raw.height ||
        !Array.isArray(raw.cells) ||
        raw.cells.length !== raw.width * raw.height ||
        !raw.cells.every((v) => v === 0 || v === 1)
      )
        throw new Error('Nieprawidłowa maska');
      setFilterOpts((o) => ({ ...o, element: raw }));
      setStatus('Wczytano maskę');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Błąd maski');
    }
  };
  const se = filterOpts.element;
  const makePreset = (kind: string) =>
    updateElement((e) => {
      const cells = Array(e.width * e.height)
        .fill(0)
        .map((_, i) => {
          const x = i % e.width,
            y = Math.floor(i / e.width),
            dx = x - e.anchorX,
            dy = y - e.anchorY;
          if (kind === 'kwadrat' || kind === 'prostokąt') return 1;
          if (kind === 'krzyż') return dx === 0 || dy === 0 ? 1 : 0;
          if (kind === 'romb')
            return Math.abs(dx) / Math.max(1, e.anchorX) + Math.abs(dy) / Math.max(1, e.anchorY) <=
              1
              ? 1
              : 0;
          if (kind === 'dysk')
            return (dx / Math.max(1, e.anchorX)) ** 2 + (dy / Math.max(1, e.anchorY)) ** 2 <= 1
              ? 1
              : 0;
          if (kind === 'pozioma') return dy === 0 ? 1 : 0;
          if (kind === 'pionowa') return dx === 0 ? 1 : 0;
          return dx === dy ? 1 : 0;
        });
      return { ...e, cells };
    });
  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) importImage(f);
      }}
    >
      <header className="top">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div>
            <b>VectorLab</b>
            <small>STUDIO</small>
          </div>
        </div>
        <nav>
          {['Plik', 'Edycja', 'Widok', 'Obiekt', 'Przekształcenia', 'Obraz', 'Filtry', 'Pomoc'].map(
            (item) => (
              <button
                key={item}
                className={menu === item ? 'active' : ''}
                onClick={() => setMenu(menu === item ? null : item)}
              >
                {item}
              </button>
            ),
          )}
        </nav>
        <div className="quick">
          <button title="Cofnij" onClick={undo} disabled={!history.length}>
            <Undo2 size={17} />
          </button>
          <button title="Ponów" onClick={redo} disabled={!future.length}>
            <Redo2 size={17} />
          </button>
          <span className="divider" />
          <button title="Otwórz projekt" onClick={() => fileInput.current?.click()}>
            <FolderOpen size={17} />
          </button>
          <button title="Zapisz projekt" onClick={save}>
            <Save size={17} />
          </button>
          <button className="accent" onClick={() => exportImage('png')}>
            <Download size={15} /> Eksport
          </button>
        </div>
      </header>
      {menu && (
        <div className="menu">
          <b>{menu}</b>
          {(menu === 'Plik'
            ? [
                [
                  'Nowy projekt',
                  () => {
                    replaceProject(() => {
                      commit(blank(), 'Nowy projekt');
                      dirty.current = false;
                      selectOnly(null);
                    });
                  },
                ],
                ['Otwórz projekt', () => fileInput.current?.click()],
                ['Zapisz .vlab', save],
                ['Eksport PNG', () => exportImage('png')],
                ['Eksport JPEG', () => exportImage('jpeg')],
              ]
            : menu === 'Edycja'
              ? [
                  ['Cofnij', undo],
                  ['Ponów', redo],
                  ['Duplikuj', duplicate],
                  ['Usuń', remove],
                ]
              : menu === 'Widok'
                ? [
                    ['Siatka', () => setGrid((v) => !v)],
                    ['Przyciągaj do siatki', () => setSnap((v) => !v)],
                    ['Dopasuj widok', fitView],
                  ]
                : menu === 'Obiekt'
                  ? [
                      ['Dodaj przykładowe obiekty', addSampleObjects],
                      ['Duplikuj', duplicate],
                      ['Usuń', remove],
                      ['Wypełnienie', () => setPanel('kolor')],
                    ]
                  : menu === 'Przekształcenia'
                    ? [
                        ['Przesuń', () => setPanel('właściwości')],
                        ['Obróć', () => setPanel('właściwości')],
                        ['Skaluj', () => setPanel('właściwości')],
                      ]
                    : menu === 'Obraz'
                      ? [
                          ['Wczytaj obraz', () => openImagePicker('filtry')],
                          ['Dodaj przykładowe obrazy', addSampleImages],
                          ['Analiza udziału koloru', () => setPanel('analiza')],
                          ['Przywróć oryginał', restoreImage],
                        ]
                      : menu === 'Filtry'
                        ? [
                            ['Otwórz filtry', () => setPanel('filtry')],
                            ['Zastosuj podgląd', acceptFilter],
                          ]
                        : [
                            ['O algorytmach', () => setPanel('algorytm')],
                            [
                              'Skróty klawiaturowe',
                              () => setStatus('V L R C B P H · Ctrl+Z/Y/S/O/D · Enter/Esc'),
                            ],
                          ]
          ).map((entry) => {
            const [label, fn] = entry as [string, () => void];
            return (
              <button
                key={label}
                onClick={() => {
                  fn();
                  setMenu(null);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      <div className="workspace">
        <aside className="toolbar">
          {tools.map((t) => (
            <button
              key={t.id}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              className={tool === t.id ? 'selected' : ''}
              onClick={() => {
                setTool(t.id);
                setPoints([]);
                setDraft(null);
              }}
            >
              <t.icon size={20} />
            </button>
          ))}
          <span className="spacer" />
          <button
            title="Powiększ"
            onClick={() => setView((v) => ({ ...v, zoom: Math.min(16, v.zoom * 1.25) }))}
          >
            <ZoomIn size={19} />
          </button>
          <button
            title="Pomniejsz"
            onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.1, v.zoom / 1.25) }))}
          >
            <ZoomOut size={19} />
          </button>
          <button
            title="Siatka"
            className={grid ? 'selected' : ''}
            onClick={() => setGrid((v) => !v)}
          >
            <Grid2X2 size={19} />
          </button>
        </aside>
        <main className="center">
          <div className="canvas-header">
            <span className="doc-badge">PROJEKT</span>
            <b>Bez nazwy</b>
            <span>
              {doc.width} × {doc.height} px
            </span>
            <span className="canvas-actions">
              <button onClick={clearObjects} disabled={!doc.objects.length} title="Usuń wszystkie obiekty z kanwy. Cofnij przywróci je.">
                <Trash2 size={15} /> Wyczyść obiekty
              </button>
              <button onClick={() => setSnap((v) => !v)} className={snap ? 'on' : ''} title="Przy włączonej opcji ruch i rysowanie wyrównują współrzędne do wielokrotności 10 pikseli.">
                Przyciąganie 10 px {snap ? 'WŁ.' : 'WYŁ.'}
              </button>
              <button onClick={() => setSidebarOpen(value => !value)} aria-label={sidebarOpen ? 'Ukryj panel boczny' : 'Pokaż panel boczny'} title={sidebarOpen ? 'Ukryj panel boczny' : 'Pokaż panel boczny'}>
                {sidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </button>
            </span>
          </div>
          <div className="canvas-wrap" ref={wrap}>
            <div className="ruler horizontal">
              {Array.from({ length: Math.ceil(doc.width / 100) + 1 }, (_, i) => (
                <span key={i} style={{ left: 70 + view.x + i * 100 * view.zoom }}>
                  {i * 100}
                </span>
              ))}
            </div>
            <div className="ruler vertical">
              {Array.from({ length: Math.ceil(doc.height / 100) + 1 }, (_, i) => (
                <span key={i} style={{ top: 60 + view.y + i * 100 * view.zoom }}>
                  {i * 100}
                </span>
              ))}
            </div>
            <canvas
              className="artboard"
              ref={canvas}
              style={{
                width: doc.width,
                height: doc.height,
                transform: `translate(${view.x}px,${view.y}px) scale(${view.zoom})`,
              }}
            />
            <canvas
              className="interaction"
              ref={overlay}
              aria-label="Obszar roboczy. Wybierz narzędzia paskiem lub skrótami klawiaturowymi; figury można tworzyć i edytować z panelu Właściwości."
              tabIndex={0}
              data-camera={JSON.stringify(view)}
              data-document-origin={JSON.stringify({
                x: 70 + view.x,
                y: 60 + view.y,
                zoom: view.zoom,
              })}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={cancelPointer}
              onWheel={wheel}
              onDoubleClick={() => {
                if (tool === 'polygon') finishPoints();
              }}
            />
          </div>
          <div className="canvas-footer">
            <span>Przeciągnij, aby rysować · Kółko myszy: zoom</span>
            <div>
              <button
                onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.1, v.zoom / 1.25) }))}
              >
                −
              </button>
              <button
                aria-label="100%"
                title="Ustaw zoom 100%"
                onClick={() => setView({ zoom: 1, x: 0, y: 0 })}
              >
                100%
              </button>
              <button onClick={() => setView((v) => ({ ...v, zoom: Math.min(16, v.zoom * 1.25) }))}>
                +
              </button>
            </div>
          </div>
        </main>
        <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
          <div className="tabs">
            {(['właściwości', 'kolor', 'filtry', 'analiza', 'algorytm'] as const).map((t) => (
              <button key={t} className={panel === t ? 'active' : ''} onClick={() => setPanel(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="panel-scroll">
            {panel === 'właściwości' && (
              <>
                <section>
                  <h3>WŁAŚCIWOŚCI OBIEKTU</h3>
                  {shape ? (
                    <>
                      <label className="field">
                        <span>Nazwa</span>
                        <input
                          value={shape.name}
                          onChange={(e) =>
                            modify(shape.id, (s) => ({ ...s, name: e.target.value }))
                          }
                        />
                      </label>
                      <div className="kind">{shapeLabel[shape.kind].toUpperCase()}</div>
                      {shape.kind === 'line' && (
                        <div className="field-grid">
                          {field('X₁', 'x1', shape.a.x)}
                          {field('Y₁', 'y1', shape.a.y)}
                          {field('X₂', 'x2', shape.b.x)}
                          {field('Y₂', 'y2', shape.b.y)}
                        </div>
                      )}
                      {(shape.kind === 'rect' || shape.kind === 'image') && (
                        <div className="field-grid">
                          {field('X', 'x', shape.x)}
                          {field('Y', 'y', shape.y)}
                          {field('W', 'w', shape.w)}
                          {field('H', 'h', shape.h)}
                        </div>
                      )}
                      {shape.kind === 'circle' && (
                        <div className="field-grid">
                          {field('X', 'x', shape.center.x)}
                          {field('Y', 'y', shape.center.y)}
                          {field('R', 'r', shape.r)}
                        </div>
                      )}
                      {(shape.kind === 'polygon' || shape.kind === 'bezier') && (
                        <>
                          <p>
                            {shape.points.length} punktów · stopień{' '}
                            {shape.kind === 'bezier' ? shape.points.length - 1 : '—'}
                          </p>
                          <div className="point-fields">
                            {shape.points.map((p, i) => (
                              <div key={i}>
                                <span>{i + 1}</span>
                                {field('X', `x:${i}`, p.x)}
                                {field('Y', `y:${i}`, p.y)}
                              </div>
                            ))}
                          </div>
                          <button
                            onClick={() =>
                              modify(shape.id, (s) =>
                                s.kind === 'polygon' || s.kind === 'bezier'
                                  ? { ...s, points: [...s.points, { x: 100, y: 100 }] }
                                  : s,
                              )
                            }
                          >
                            + Dodaj punkt
                          </button>
                          <button
                            onClick={() =>
                              modify(shape.id, (s) =>
                                (s.kind === 'polygon' || s.kind === 'bezier') && s.points.length > 2
                                  ? { ...s, points: s.points.slice(0, -1) }
                                  : s,
                              )
                            }
                          >
                            − Usuń punkt
                          </button>
                        </>
                      )}
                      {shape.kind !== 'image' && (
                        <>
                          <label className="field">
                            <span>Grubość</span>
                            <input
                              type="number"
                              min="1"
                              max="100"
                              value={shape.width}
                              onChange={(e) =>
                                modify(shape.id, (s) => ({
                                  ...s,
                                  width: Math.max(1, num(e.target.value, 1)),
                                }))
                              }
                            />
                          </label>
                          <div className="swatches">
                            <button
                              onClick={() => {
                                setColorTarget('stroke');
                                setPanel('kolor');
                              }}
                            >
                              <i style={{ background: shape.stroke }} />
                              Obrys
                            </button>
                            <button
                              onClick={() => {
                                setColorTarget('fill');
                                setPanel('kolor');
                              }}
                            >
                              <i style={{ background: shape.fill ?? 'transparent' }} />
                              Wypełnienie
                            </button>
                          </div>
                        </>
                      )}
                      <div className="action-row">
                        <button onClick={duplicate}>
                          <Copy size={15} /> Duplikuj
                        </button>
                        <button onClick={remove}>
                          <Trash2 size={15} /> Usuń
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="muted">Wybierz obiekt, aby edytować jego parametry.</p>
                  )}
                </section>
                <section>
                  <h3>UTWÓRZ Z PARAMETRÓW</h3>
                  <label className="field">
                    <span>Figura</span>
                    <select
                      aria-label="Typ tworzonej figury"
                      value={
                        ['line', 'rect', 'circle', 'polygon', 'bezier'].includes(tool) ? tool : ''
                      }
                      onChange={(e) => setTool(e.target.value as Tool)}
                    >
                      <option value="" disabled>
                        Wybierz figurę
                      </option>
                      <option value="line">Linia</option>
                      <option value="rect">Prostokąt</option>
                      <option value="circle">Okrąg</option>
                      <option value="polygon">Wielokąt</option>
                      <option value="bezier">Krzywa Béziera</option>
                    </select>
                  </label>
                  {tool !== 'polygon' && tool !== 'bezier' && (
                    <div className="field-grid">
                      <label className="field">
                        <span>X / CX</span>
                        <input id="new-x" type="number" defaultValue="100" />
                      </label>
                      <label className="field">
                        <span>Y / CY</span>
                        <input id="new-y" type="number" defaultValue="100" />
                      </label>
                      <label className="field">
                        <span>
                          {tool === 'rect' ? 'Szerokość' : tool === 'circle' ? 'Promień' : 'X₂'}
                        </span>
                        <input id="new-x2" type="number" defaultValue="240" />
                      </label>
                      {tool !== 'circle' && (
                        <label className="field">
                          <span>{tool === 'rect' ? 'Wysokość' : 'Y₂'}</span>
                          <input id="new-y2" type="number" defaultValue="180" />
                        </label>
                      )}
                    </div>
                  )}
                  {tool === 'bezier' && (
                    <label className="field">
                      <span>Stopień</span>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={bezierDegree}
                        onChange={(e) =>
                          setBezierDegree(Math.max(1, Math.min(20, num(e.target.value, 3))))
                        }
                      />
                    </label>
                  )}
                  {(tool === 'polygon' || tool === 'bezier') && (
                    <>
                      <div className="segmented" aria-label="Sposób wpisywania punktów">
                        <button
                          className={coordinateMode === 'fields' ? 'active' : ''}
                          onClick={() => setCoordinateMode('fields')}
                        >
                          Pola punktów
                        </button>
                        <button
                          className={coordinateMode === 'paste' ? 'active' : ''}
                          onClick={() => setCoordinateMode('paste')}
                        >
                          Wklej listę
                        </button>
                      </div>
                      {coordinateMode === 'fields' ? (
                        <>
                          <p className="muted">
                            {tool === 'bezier'
                              ? `Stopień ${bezierDegree} · liczba punktów kontrolnych: ${bezierDegree + 1}`
                              : 'Wierzchołki wielokąta w kolejności obrysu'}
                          </p>
                          <div className="point-create-fields">
                            {Array.from(
                              {
                                length:
                                  tool === 'bezier' ? bezierDegree + 1 : coordinatePoints.length,
                              },
                              (_, i) => {
                                const point = coordinatePoints[i] ?? suggestedPoint(i);
                                return (
                                  <div className="point-create-row" key={i}>
                                    <span>P{i + 1}</span>
                                    <label>
                                      X{' '}
                                      <input
                                        aria-label={`Punkt ${i + 1} X`}
                                        type="number"
                                        value={point.x}
                                        onChange={(e) =>
                                          setCoordinatePoints((previous) => {
                                            const next = Array.from(
                                              { length: Math.max(previous.length, i + 1) },
                                              (_, index) =>
                                                previous[index] ?? suggestedPoint(index),
                                            );
                                            next[i] = { ...next[i], x: num(e.target.value) };
                                            return next;
                                          })
                                        }
                                      />
                                    </label>
                                    <label>
                                      Y{' '}
                                      <input
                                        aria-label={`Punkt ${i + 1} Y`}
                                        type="number"
                                        value={point.y}
                                        onChange={(e) =>
                                          setCoordinatePoints((previous) => {
                                            const next = Array.from(
                                              { length: Math.max(previous.length, i + 1) },
                                              (_, index) =>
                                                previous[index] ?? suggestedPoint(index),
                                            );
                                            next[i] = { ...next[i], y: num(e.target.value) };
                                            return next;
                                          })
                                        }
                                      />
                                    </label>
                                  </div>
                                );
                              },
                            )}
                          </div>
                          {tool === 'polygon' && (
                            <div className="action-row">
                              <button
                                onClick={() =>
                                  setCoordinatePoints((points) => [
                                    ...points,
                                    suggestedPoint(points.length),
                                  ])
                                }
                              >
                                + Wierzchołek
                              </button>
                              <button
                                disabled={coordinatePoints.length <= 3}
                                onClick={() => setCoordinatePoints((points) => points.slice(0, -1))}
                              >
                                − Wierzchołek
                              </button>
                            </div>
                          )}
                        </>
                      ) : (
                        <label className="field points-input">
                          <span>Punkty X,Y (po jednym wierszu)</span>
                          <textarea
                            value={pointText}
                            onChange={(e) => setPointText(e.target.value)}
                          />
                        </label>
                      )}
                    </>
                  )}
                  <label className="field">
                    <span>Grubość</span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={weight}
                      onChange={(e) => setWeight(Math.max(1, num(e.target.value, 1)))}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={!['line', 'rect', 'circle', 'polygon', 'bezier'].includes(tool)}
                    onClick={addByFields}
                  >
                    Utwórz obiekt
                  </button>
                  {tool === 'polygon' && (
                    <button onClick={finishPoints}>Zamknij wielokąt ({points.length})</button>
                  )}
                </section>
                <section>
                  <h3>PRZEKSZTAŁCENIA</h3>
                  <label className="field">
                    <span>Operacja</span>
                    <select
                      aria-label="Rodzaj przekształcenia"
                      value={transformKind}
                      onChange={(e) => {
                        const kind = e.target.value as 'move' | 'rotate' | 'scale';
                        setTransformKind(kind);
                        setTransformValues(kind === 'scale' ? { x: 1, y: 1 } : { x: 0, y: 0 });
                      }}
                    >
                      <option value="move">Przesunięcie</option>
                      <option value="rotate">Obrót</option>
                      <option value="scale">Skalowanie</option>
                    </select>
                  </label>
                  <div className="field-grid">
                    <label className="field">
                      <span>
                        {transformKind === 'move'
                          ? 'ΔX (px)'
                          : transformKind === 'rotate'
                            ? 'Kąt (°)'
                            : 'Skala X'}
                      </span>
                      <input
                        id="tx"
                        type="number"
                        step="any"
                        value={transformValues.x}
                        onChange={(e) =>
                          setTransformValues((v) => ({ ...v, x: num(e.target.value) }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>
                        {transformKind === 'move'
                          ? 'ΔY (px)'
                          : transformKind === 'rotate'
                            ? '—'
                            : 'Skala Y'}
                      </span>
                      <input
                        id="ty"
                        type="number"
                        step="any"
                        value={transformValues.y}
                        disabled={transformKind === 'rotate'}
                        onChange={(e) =>
                          setTransformValues((v) => ({ ...v, y: num(e.target.value) }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Oś X</span>
                      <input
                        id="px"
                        type="number"
                        value={Number(pivot.x.toFixed(2))}
                        onChange={(e) => setPivot((q) => ({ ...q, x: num(e.target.value) }))}
                      />
                    </label>
                    <label className="field">
                      <span>Oś Y</span>
                      <input
                        id="py"
                        type="number"
                        value={Number(pivot.y.toFixed(2))}
                        onChange={(e) => setPivot((q) => ({ ...q, y: num(e.target.value) }))}
                      />
                    </label>
                  </div>
                  <p className="muted">
                    Zielony obrys pokazuje wynik przed zatwierdzeniem. Punkt odniesienia ustawisz
                    polami lub narzędziem po lewej.
                  </p>
                  {transformKind === 'scale' &&
                    (transformValues.x === 0 || transformValues.y === 0) && (
                      <p className="validation-error">Współczynnik skali nie może być zerem.</p>
                    )}
                  <div className="action-row">
                    <button
                      className="primary"
                      disabled={!shape || !transformPreview}
                      onClick={transformSelected}
                    >
                      Zastosuj przekształcenie
                    </button>
                    <button
                      onClick={() =>
                        setTransformValues(
                          transformKind === 'scale' ? { x: 1, y: 1 } : { x: 0, y: 0 },
                        )
                      }
                    >
                      Wyczyść podgląd
                    </button>
                  </div>
                </section>
                <section>
                  <h3>KANWA</h3>
                  <div className="field-grid">
                    <label className="field">
                      <span>Szerokość (px)</span>
                      <input
                        aria-label="Szerokość kanwy (px)"
                        type="number"
                        min="1"
                        max="8192"
                        value={canvasSize.width}
                        onChange={(e) => {
                          const width = num(e.target.value);
                          setCanvasSize((v) => ({
                            width,
                            height:
                              keepCanvasAspect && v.width > 0
                                ? Math.round((width * v.height) / v.width)
                                : v.height,
                          }));
                        }}
                      />
                    </label>
                    <label className="field">
                      <span>Wysokość (px)</span>
                      <input
                        aria-label="Wysokość kanwy (px)"
                        type="number"
                        min="1"
                        max="8192"
                        value={canvasSize.height}
                        onChange={(e) => {
                          const height = num(e.target.value);
                          setCanvasSize((v) => ({
                            width:
                              keepCanvasAspect && v.height > 0
                                ? Math.round((height * v.width) / v.height)
                                : v.width,
                            height,
                          }));
                        }}
                      />
                    </label>
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={keepCanvasAspect}
                      onChange={(e) => setKeepCanvasAspect(e.target.checked)}
                    />{' '}
                    Zachowaj proporcje
                  </label>
                  <div className="action-row">
                    <button className="primary" onClick={resizeCanvas}>
                      Zastosuj rozmiar
                    </button>
                    <button onClick={fitView}>Dopasuj widok</button>
                  </div>
                  <label className="field canvas-background">
                    <span>Tło</span>
                    <input
                      type="color"
                      value={doc.background}
                      onChange={(e) =>
                        commit(
                          { ...docRef.current, background: e.target.value },
                          'Zmieniono tło kanwy',
                        )
                      }
                    />
                  </label>
                </section>
              </>
            )}
            {panel === 'kolor' && (
              <>
                <section>
                  <h3>KOLOR</h3>
                  <div className="color-preview" style={{ background: activeColor }} />
                  <div className="segmented">
                    <button
                      className={colorTarget === 'stroke' ? 'active' : ''}
                      onClick={() => setColorTarget('stroke')}
                    >
                      Obrys
                    </button>
                    <button
                      className={colorTarget === 'fill' ? 'active' : ''}
                      onClick={() => setColorTarget('fill')}
                    >
                      Wypełnienie
                    </button>
                  </div>
                  <div className="segmented">
                    <button
                      className={colorMode === 'RGB' ? 'active' : ''}
                      onClick={() => setColorMode('RGB')}
                    >
                      RGB
                    </button>
                    <button
                      className={colorMode === 'CMYK' ? 'active' : ''}
                      onClick={() => setColorMode('CMYK')}
                    >
                      CMYK
                    </button>
                  </div>
                  <input
                    className="color-input"
                    type="color"
                    value={activeColor}
                    onChange={(e) => colorChange(e.target.value)}
                  />
                  <label className="field">
                    <span>HEX</span>
                    <input
                      value={hexDraft}
                      onChange={(e) => {
                        setHexDraft(e.target.value);
                        if (/^#[0-9a-f]{6}$/i.test(e.target.value)) colorChange(e.target.value);
                      }}
                      onBlur={() => {
                        if (!/^#[0-9a-f]{6}$/i.test(hexDraft))
                          setHexDraft(activeColor.toUpperCase());
                      }}
                    />
                  </label>
                  {colorMode === 'RGB' ? (
                    <>
                      {colorChannel('R', rgb.r, 255, (v) => setRgb('r', v))}
                      {colorChannel('G', rgb.g, 255, (v) => setRgb('g', v))}
                      {colorChannel('B', rgb.b, 255, (v) => setRgb('b', v))}
                    </>
                  ) : (
                    <>
                      {colorChannel('C', cmyk.c, 100, (v) => setCmyk('c', v))}
                      {colorChannel('M', cmyk.m, 100, (v) => setCmyk('m', v))}
                      {colorChannel('Y', cmyk.y, 100, (v) => setCmyk('y', v))}
                      {colorChannel('K', cmyk.k, 100, (v) => setCmyk('k', v))}
                    </>
                  )}
                  <p className="muted">
                    RGB {rgb.r}, {rgb.g}, {rgb.b} · CMYK {Math.round(cmyk.c)}, {Math.round(cmyk.m)},{' '}
                    {Math.round(cmyk.y)}, {Math.round(cmyk.k)}%
                  </p>
                  <button
                    onClick={() => {
                      setFill(null);
                      if (shape) modify(shape.id, (s) => ({ ...s, fill: null }));
                    }}
                  >
                    Bez wypełnienia
                  </button>
                </section>
                <section>
                  <h3>OSTATNIE KOLORY</h3>
                  <div className="recent">
                    {recent.map((c) => (
                      <button
                        key={c}
                        title={c}
                        style={{ background: c }}
                        onClick={() => colorChange(c)}
                      />
                    ))}
                  </div>
                </section>
              </>
            )}
            {panel === 'filtry' && (
              <>
                <section>
                  <h3>FILTRY OBRAZU</h3>
                  {selectedImage ? (
                    <>
                      <p className="muted">
                        {selectedImage.w} × {selectedImage.h} px
                      </p>
                      <label className="field">
                        <span>Operacja</span>
                        <select
                          value={filter}
                          onChange={(e) => {
                            setFilter(e.target.value as Filter);
                            setAlgorithmId(e.target.value as AlgorithmId);
                            setPreview(null);
                          }}
                        >
                          <option value="average">Uśrednianie</option>
                          <option value="median">Mediana</option>
                          <option value="sobel">Sobel</option>
                          <option value="threshold">Binaryzacja</option>
                          <option value="dilation">Dylatacja</option>
                          <option value="erosion">Erozja</option>
                        </select>
                      </label>
                      {(filter === 'average' || filter === 'median') && (
                        <label className="field">
                          <span>Maska</span>
                          <input
                            type="number"
                            min="1"
                            max="15"
                            step="2"
                            value={filterOpts.size}
                            onChange={(e) =>
                              setFilterOpts((o) => ({
                                ...o,
                                size: Math.max(1, Math.min(15, num(e.target.value, 3) | 1)),
                              }))
                            }
                          />
                        </label>
                      )}
                      {filter === 'sobel' && (
                        <label className="field">
                          <span>Wynik</span>
                          <select
                            value={filterOpts.sobel}
                            onChange={(e) =>
                              setFilterOpts((o) => ({
                                ...o,
                                sobel: e.target.value as FilterOptions['sobel'],
                              }))
                            }
                          >
                            <option value="full">Gradient</option>
                            <option value="gx">Gx</option>
                            <option value="gy">Gy</option>
                          </select>
                        </label>
                      )}
                      {filter === 'threshold' && (
                        <>
                          <label className="field">
                            <span>Próg {filterOpts.threshold}</span>
                            <input
                              type="range"
                              min="0"
                              max="255"
                              value={filterOpts.threshold}
                              onChange={(e) =>
                                setFilterOpts((o) => ({ ...o, threshold: Number(e.target.value) }))
                              }
                            />
                          </label>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={filterOpts.invert}
                              onChange={(e) =>
                                setFilterOpts((o) => ({ ...o, invert: e.target.checked }))
                              }
                            />{' '}
                            Odwróć
                          </label>
                        </>
                      )}
                      <div className="action-row">
                        <button className="primary" disabled={busy} onClick={runFilter}>
                          {busy ? 'Przetwarzanie…' : 'Podgląd'}
                        </button>
                        <button disabled={!preview} onClick={acceptFilter}>
                          Zastosuj
                        </button>
                        <button disabled={!preview && !busy} onClick={cancelFilter}>
                          Anuluj
                        </button>
                      </div>
                      {busy && (
                        <div className="filter-progress" role="status">
                          <div>Przetworzono {filterProgress}% obrazu</div>
                          <progress aria-label="Postęp filtra" max="100" value={filterProgress} />
                        </div>
                      )}
                      {preview && (
                        <>
                          <label className="field">
                            <span>Porównanie {compare}%</span>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={compare}
                              onChange={(e) => setCompare(Number(e.target.value))}
                            />
                          </label>
                          <div className="compare">
                            <img src={selectedImage.pixels} />
                            <img
                              src={preview}
                              style={{ clipPath: `inset(0 ${100 - compare}% 0 0)` }}
                            />
                          </div>
                        </>
                      )}
                      <button onClick={restoreImage}>Przywróć oryginał</button>
                      <p className="muted">Czas: {filterTime} ms</p>
                    </>
                  ) : (
                    <p className="muted">Wczytaj i wybierz obraz, aby użyć filtrów.</p>
                  )}
                </section>
                {(filter === 'dilation' || filter === 'erosion') && (
                  <section>
                    <h3>ELEMENT STRUKTURYZUJĄCY</h3>
                    <div className="field-grid">
                      <label className="field">
                        <span>Szerokość</span>
                        <input
                          type="number"
                          min="1"
                          max="31"
                          value={se.width}
                          onChange={(e) =>
                            updateElement((a) => {
                              const w = Math.max(1, Math.min(31, num(e.target.value, 3)));
                              return {
                                ...a,
                                width: w,
                                anchorX: Math.min(a.anchorX, w - 1),
                                cells: Array.from({ length: w * a.height }, (_, i) =>
                                  i % w < a.width
                                    ? (a.cells[Math.floor(i / w) * a.width + (i % w)] ?? 0)
                                    : 0,
                                ),
                              };
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Wysokość</span>
                        <input
                          type="number"
                          min="1"
                          max="31"
                          value={se.height}
                          onChange={(e) =>
                            updateElement((a) => {
                              const h = Math.max(1, Math.min(31, num(e.target.value, 3)));
                              return {
                                ...a,
                                height: h,
                                anchorY: Math.min(a.anchorY, h - 1),
                                cells: Array.from(
                                  { length: a.width * h },
                                  (_, i) => a.cells[i] ?? 0,
                                ),
                              };
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Kotwica X</span>
                        <input
                          type="number"
                          min="0"
                          max={se.width - 1}
                          value={se.anchorX}
                          onChange={(e) =>
                            updateElement((a) => ({
                              ...a,
                              anchorX: Math.max(0, Math.min(a.width - 1, num(e.target.value))),
                            }))
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Kotwica Y</span>
                        <input
                          type="number"
                          min="0"
                          max={se.height - 1}
                          value={se.anchorY}
                          onChange={(e) =>
                            updateElement((a) => ({
                              ...a,
                              anchorY: Math.max(0, Math.min(a.height - 1, num(e.target.value))),
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div
                      className="mask"
                      style={{ gridTemplateColumns: `repeat(${se.width}, minmax(0,1fr))` }}
                    >
                      {se.cells.map((v, i) => (
                        <button
                          key={i}
                          className={`${v ? 'on' : ''} ${i === se.anchorY * se.width + se.anchorX ? 'anchor' : ''}`}
                          title={`${i % se.width}, ${Math.floor(i / se.width)}`}
                          onClick={() =>
                            updateElement((a) => {
                              a.cells[i] = 1 - a.cells[i];
                              return a;
                            })
                          }
                        >
                          {v ? '1' : '0'}
                        </button>
                      ))}
                    </div>
                    <div className="presets">
                      {[
                        'kwadrat',
                        'prostokąt',
                        'krzyż',
                        'romb',
                        'dysk',
                        'pozioma',
                        'pionowa',
                        'ukośna',
                      ].map((p) => (
                        <button key={p} onClick={() => makePreset(p)}>
                          {p}
                        </button>
                      ))}
                    </div>
                    <div className="action-row">
                      <button
                        onClick={() =>
                          updateElement((a) => ({ ...a, cells: a.cells.map(() => 1) }))
                        }
                      >
                        Pełna
                      </button>
                      <button
                        onClick={() =>
                          updateElement((a) => ({ ...a, cells: a.cells.map(() => 0) }))
                        }
                      >
                        Wyczyść
                      </button>
                      <button
                        onClick={() =>
                          updateElement((a) => ({ ...a, cells: a.cells.map((v) => 1 - v) }))
                        }
                      >
                        Odwróć
                      </button>
                    </div>
                    <button
                      onClick={() =>
                        download(
                          'maska.json',
                          new Blob([JSON.stringify(se)], { type: 'application/json' }),
                        )
                      }
                    >
                      Zapisz maskę
                    </button>
                    <button onClick={() => maskInput.current?.click()}>Wczytaj maskę</button>
                  </section>
                )}
              </>
            )}
            {panel === 'analiza' && (
              <section className="color-analysis">
                <h3>ANALIZA UDZIAŁU KOLORU</h3>
                {analysisSource ? (
                  <p className="muted">
                    Analizowany obraz: {analysisSource.name} · {analysisSource.w} × {analysisSource.h} px
                  </p>
                ) : <p className="muted">Wczytaj zdjęcie bez dodawania go do tablicy.</p>}
                <div className="action-row">
                  <button className="primary" onClick={() => openImagePicker('analiza')}>
                    {analysisSource ? 'Wczytaj inne zdjęcie' : 'Wczytaj obraz do analizy'}
                  </button>
                  {analysisImage && <button onClick={() => { setAnalysisImage(null); setAnalysisResult(null); setAnalysisPreviewOpen(false); }}>Usuń zdjęcie</button>}
                </div>
                <label className="field">
                  <span>Kolor analizowanego obszaru</span>
                  <input
                    aria-label="Kolor analizowanego obszaru"
                    type="color"
                    value={analysisTarget}
                    onChange={(event) => setAnalysisTarget(event.target.value)}
                  />
                </label>
                {analysisTargetNeutral ? (
                  <label className="field">
                    <span>Tolerancja różnicy RGB: {analysisRgbTolerance}%</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={analysisRgbTolerance}
                      onChange={(event) => setAnalysisRgbTolerance(Number(event.target.value))}
                    />
                  </label>
                ) : (
                  <>
                    <label className="field">
                      <span>Zakres odcienia: ±{analysisHueTolerance}°</span>
                      <input
                        type="range"
                        min="1"
                        max="90"
                        value={analysisHueTolerance}
                        onChange={(event) => setAnalysisHueTolerance(Number(event.target.value))}
                      />
                    </label>
                    <label className="field">
                      <span>Minimalne nasycenie: {analysisMinSaturation}%</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={analysisMinSaturation}
                        onChange={(event) => setAnalysisMinSaturation(Number(event.target.value))}
                      />
                    </label>
                    <label className="field">
                      <span>Minimalna jasność: {analysisMinValue}%</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={analysisMinValue}
                        onChange={(event) => setAnalysisMinValue(Number(event.target.value))}
                      />
                    </label>
                  </>
                )}
                <p className="muted">
                  Dla kolorów nasyconych piksel musi mieścić się w zakresie odcienia oraz przekroczyć progi nasycenia i jasności. Dla szarości używana jest odległość RGB. Przezroczyste piksele są pomijane. To analiza barwy, więc inne obiekty o podobnym kolorze również zostaną policzone.
                </p>
                <div className="action-row">
                  <button className="primary" disabled={!analysisSource || analysisBusy} onClick={runColorAnalysis}>
                    {analysisBusy ? 'Analizowanie…' : 'Analizuj obraz'}
                  </button>
                  <button disabled={!analysisBusy} onClick={cancelColorAnalysis}>Anuluj</button>
                </div>
                {analysisBusy && (
                  <div className="filter-progress" role="status">
                    <div>Przeanalizowano {analysisProgress}% obrazu</div>
                    <progress aria-label="Postęp analizy koloru" max="100" value={analysisProgress} />
                  </div>
                )}
                {currentAnalysis && analysisSource && (
                  <>
                    <div className="analysis-result" aria-live="polite">
                      <strong>{currentAnalysis.percentage.toFixed(2)}%</strong>
                      <span>obszaru obrazu pasuje do wybranego koloru</span>
                      <small>
                        {currentAnalysis.matchedPixels.toLocaleString('pl-PL')} z{' '}
                        {currentAnalysis.visiblePixels.toLocaleString('pl-PL')} widocznych pikseli ·{' '}
                        {currentAnalysis.durationMs.toFixed(1)} ms
                      </small>
                    </div>
                    <button className="analysis-preview" onClick={() => setAnalysisPreviewOpen(true)} aria-label="Powiększ podgląd analizy">
                      <img src={analysisSource.pixels} alt="Podgląd analizowanego zdjęcia" />
                      <img className="analysis-mask" src={currentAnalysis.maskUrl} alt="Zaznaczone piksele pasujące do koloru" />
                      <span>Kliknij, aby powiększyć podgląd</span>
                    </button>
                    {analysisPreviewOpen && (
                      <div className="analysis-modal" role="dialog" aria-modal="true" aria-label="Podgląd analizy obrazu" onClick={() => setAnalysisPreviewOpen(false)}>
                        <button className="analysis-modal-close" onClick={() => setAnalysisPreviewOpen(false)}>Zamknij ×</button>
                        <div className="analysis-modal-image" onClick={(event) => event.stopPropagation()}>
                          <img src={analysisSource.pixels} alt="Analizowane zdjęcie" />
                          <img className="analysis-mask" src={currentAnalysis.maskUrl} alt="Zielone piksele oznaczają znaleziony kolor" />
                        </div>
                        <p>Zielona nakładka pokazuje piksele pasujące do koloru. Wynik: {currentAnalysis.percentage.toFixed(2)}%.</p>
                      </div>
                    )}
                  </>
                )}
                {analysisResult && !currentAnalysis && !analysisBusy && (
                  <p className="muted">Zmieniono obraz lub parametry. Uruchom analizę ponownie, aby odświeżyć wynik.</p>
                )}
              </section>
            )}
            {panel === 'algorytm' && (
              <AlgorithmPanel
                selected={shape}
                algorithm={algorithmId}
                onAlgorithmChange={setAlgorithmId}
                steps={lineSteps}
                stepIndex={Math.min(traceIndex, Math.max(0, lineSteps.length - 1))}
                onStepChange={setTraceIndex}
                filterTime={filterTime}
                filterProgress={filterProgress}
                element={se}
                filterOptions={filterOpts}
                showControls={showControls}
                onShowControls={setShowControls}
                showPixels={showPixels}
                onShowPixels={setShowPixels}
              />
            )}
            <section className="objects">
              <h3>
                OBIEKTY <span>{doc.objects.length}</span>
              </h3>
              <p className="muted">Shift+klik dodaje lub usuwa z zaznaczenia. Ctrl+A zaznacza wszystkie widoczne.</p>
              <button title="Usuń zaznaczone obiekty" disabled={!selectedIds.length} onClick={remove}>
                <Trash2 size={14} /> Usuń zaznaczone
              </button>
              {[...doc.objects].reverse().map((s) => (
                <LayerRow
                  key={s.id}
                  shape={s}
                  active={selectedIds.includes(s.id)}
                  onSelect={(id, additive) => {
                    if (!additive) {
                      selectOnly(id);
                      return;
                    }
                    const next = selectedIds.includes(id)
                      ? selectedIds.filter((item) => item !== id)
                      : [...selectedIds, id];
                    setSelectedIds(next);
                    setSelected(next.at(-1) ?? null);
                    setStatus(`Zaznaczono ${next.length} obiektów`);
                  }}
                  onReorder={reorder}
                  onModify={modify}
                />
              ))}
            </section>
          </div>
        </aside>
      </div>
      <footer className="status" role="status" aria-live="polite" aria-atomic="true">
        <span className="status-dot" />
        <span>{status}</span>
        <span className="status-right">
          X: {Math.round(cursor.x)} · Y: {Math.round(cursor.y)} <i /> {doc.width} × {doc.height}{' '}
          <i /> {Math.round(view.zoom * 100)}% <i /> {tools.find((t) => t.id === tool)?.label} <i />{' '}
          {doc.objects.length} obiektów
        </span>
      </footer>
      {pendingReplacement && (
        <div className="modal-backdrop">
          <div className="replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replace-title">
            <h2 id="replace-title">Niezapisane zmiany</h2>
            <p>Bieżący projekt zawiera niezapisane zmiany. Zapisz go jako plik .vlab, jeśli chcesz do niego wrócić.</p>
            <div className="action-row">
              <button autoFocus onClick={() => setPendingReplacement(null)}>Wróć do projektu</button>
              <button className="primary" onClick={() => { const action = pendingReplacement; setPendingReplacement(null); action(); }}>Zastąp bez zapisu</button>
            </div>
          </div>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".vlab,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) open(f);
          e.target.value = '';
        }}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importImage(f);
          e.target.value = '';
        }}
      />
      <input
        ref={maskInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadMask(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
