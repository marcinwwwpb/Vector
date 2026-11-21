import type { Point } from './types';

export type AlgorithmId =
  | 'bresenham'
  | 'circle'
  | 'scanline'
  | 'bezier'
  | 'matrix'
  | 'colors'
  | 'average'
  | 'median'
  | 'sobel'
  | 'threshold'
  | 'dilation'
  | 'erosion';

export type AlgorithmCard = {
  name: string;
  summary: string;
  formula: string;
  pseudocode: string;
  complexity: string;
};

export const algorithms: Record<AlgorithmId, AlgorithmCard> = {
  bresenham: {
    name: 'Linia — Bresenham',
    summary:
      'Decyzja o następnym pikselu opiera się wyłącznie na całkowitoliczbowym błędzie. Ta wersja obsługuje wszystkie oktanty.',
    formula: 'dx = |x₂−x₁|, dy = |y₂−y₁|, e = dx−dy',
    pseudocode:
      'rysuj(x, y)\nif x=x₂ and y=y₂: stop\ne₂ = 2e\nif e₂ > −dy: e -= dy; x += sx\nif e₂ < dx: e += dx; y += sy',
    complexity: 'O(max(dx, dy)) czasu, O(1) pamięci',
  },
  circle: {
    name: 'Okrąg — punkt środkowy',
    summary: 'Wyznaczamy piksele jednej ósemki okręgu i kopiujemy je przez osiem symetrii.',
    formula: 'd₀ = 1 − r;  (±x, ±y), (±y, ±x)',
    pseudocode:
      'x = r; y = 0; d = 1−r\nwhile y ≤ x:\n  rysuj 8 punktów symetrycznych\n  y += 1\n  jeśli d > 0: x -= 1\n  zaktualizuj d',
    complexity: 'O(r) czasu, O(1) pamięci',
  },
  scanline: {
    name: 'Wielokąt — Scanline',
    summary:
      'Każdy wiersz obrazu przecina krawędzie wielokąta. Pary przecięć wyznaczają odcinki wypełnienia.',
    formula: 'x = x₁ + (y−y₁)(x₂−x₁)/(y₂−y₁)',
    pseudocode:
      'for y w zakresie figury:\n  policz przecięcia z krawędziami\n  posortuj przecięcia\n  wypełnij pary zgodnie z regułą parzystości',
    complexity: 'O(H · E log E + A) czasu',
  },
  bezier: {
    name: 'Krzywa Béziera — de Casteljau',
    summary:
      'Interpolujemy sąsiednie punkty kontrolne, aż zostanie jeden punkt krzywej. Stopień to liczba punktów minus jeden.',
    formula: 'Pᵢʲ(t) = (1−t)Pᵢʲ⁻¹(t) + tPᵢ₊₁ʲ⁻¹(t)',
    pseudocode:
      'q = kopia punktów\nfor poziom od n do 1:\n  for i od 0 do poziom−1:\n    q[i] = (1−t)q[i] + t·q[i+1]\nwynik = q[0]',
    complexity: 'O(n²) na próbkę; O(n) pamięci',
  },
  matrix: {
    name: 'Macierze 3×3 — transformacje',
    summary:
      'Współrzędne zmiennoprzecinkowe są przekształcane macierzami jednorodnymi. Zaokrąglenie następuje dopiero przy rasteryzacji.',
    formula: 'p′ = M · p;  M = T · R · S',
    pseudocode:
      'M = macierz jednostkowa\nM = mnożenie(T, M)\nM = mnożenie(R, M)\np′ = transformuj(M, p)',
    complexity: 'O(1) na punkt; O(n) dla n punktów',
  },
  colors: {
    name: 'Konwersja RGB ↔ CMYK',
    summary:
      'Prosta konwersja matematyczna bez profili ICC. Czerń wymaga osobnego przypadku, aby uniknąć dzielenia przez zero.',
    formula: 'K=1−max(r,g,b); C=(1−r−K)/(1−K); R=255(1−C)(1−K)',
    pseudocode:
      'normalizuj RGB do 0..1\nwyznacz K\njeśli K=1: C=M=Y=0\nw przeciwnym razie policz C,M,Y',
    complexity: 'O(1) czasu i pamięci',
  },
  average: {
    name: 'Filtr uśredniający',
    summary:
      'Każdy kanał RGB zastępujemy średnią sąsiedztwa. Kanał alfa pozostaje bez zmian; brzegi są powielane.',
    formula: 'I′(x,y) = (1/k²) Σ I(x+i,y+j)',
    pseudocode: 'dla każdego piksela i kanału RGB:\n  zsumuj k×k sąsiadów\n  podziel przez k²',
    complexity: 'O(W·H·k²) czasu',
  },
  median: {
    name: 'Filtr medianowy',
    summary: 'Wartości kanału z sąsiedztwa są sortowane, a środkowa wartość zastępuje piksel.',
    formula: 'I′(x,y) = mediana(Nₖ(x,y))',
    pseudocode:
      'dla każdego piksela i kanału RGB:\n  pobierz k×k wartości\n  posortuj\n  wybierz element środkowy',
    complexity: 'O(W·H·k² log k) czasu',
  },
  sobel: {
    name: 'Wykrywanie krawędzi — Sobel',
    summary: 'Najpierw powstaje obraz szary. Dwie maski 3×3 liczą gradient poziomy i pionowy.',
    formula: 'Gray=.299R+.587G+.114B; G=√(Gx²+Gy²)',
    pseudocode:
      'konwertuj RGB na Gray\npolicz konwolucje Gx i Gy\nwybierz |Gx|, |Gy| lub √(Gx²+Gy²)\nogranicz wynik do 0..255',
    complexity: 'O(W·H) czasu',
  },
  threshold: {
    name: 'Binaryzacja',
    summary: 'Próg dzieli piksele na tło (0) i obiekt (255). Wynik można odwrócić.',
    formula: 'I′(x,y) = Gray(x,y) ≥ T ? 255 : 0',
    pseudocode:
      'dla każdego piksela:\n  policz Gray\n  porównaj z progiem T\n  opcjonalnie odwróć 0 i 255',
    complexity: 'O(W·H) czasu',
  },
  dilation: {
    name: 'Dylatacja',
    summary:
      'Aktywne pozycje maski rozszerzają biały obiekt. Wzór odwraca przesunięcie maski, co ma znaczenie przy maskach niesymetrycznych.',
    formula: 'D(x,y) = max B(x−(sx−ax), y−(sy−ay)) dla aktywnych S',
    pseudocode:
      'dla piksela wynikowego:\n  sprawdź aktywne pozycje maski\n  jeśli którykolwiek piksel źródła = 255 → 255\n  poza obrazem przyjmij 0',
    complexity: 'O(W·H·|S|) czasu',
  },
  erosion: {
    name: 'Erozja',
    summary:
      'Biały piksel pozostaje biały tylko wtedy, gdy wszystkie aktywne pozycje maski pokrywają się z obiektem.',
    formula: 'E(x,y) = min B(x+(sx−ax), y+(sy−ay)) dla aktywnych S',
    pseudocode:
      'dla piksela wynikowego:\n  sprawdź aktywne pozycje maski\n  jeśli każdy piksel źródła = 255 → 255\n  poza obrazem przyjmij 0',
    complexity: 'O(W·H·|S|) czasu',
  },
};

export type LineStep = { x: number; y: number; error: number };
export function traceLine(a: Point, b: Point): LineStep[] {
  let x = Math.round(a.x),
    y = Math.round(a.y);
  const x2 = Math.round(b.x),
    y2 = Math.round(b.y);
  const dx = Math.abs(x2 - x),
    dy = Math.abs(y2 - y);
  const sx = x < x2 ? 1 : -1,
    sy = y < y2 ? 1 : -1;
  let error = dx - dy;
  const steps: LineStep[] = [];
  while (steps.length < 4096) {
    steps.push({ x, y, error });
    if (x === x2 && y === y2) break;
    const doubled = 2 * error;
    if (doubled > -dy) {
      error -= dy;
      x += sx;
    }
    if (doubled < dx) {
      error += dx;
      y += sy;
    }
  }
  return steps;
}
