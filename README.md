# VectorLab Studio

VectorLab Studio to edytor grafiki wektorowej i rastrowej napisany w React i TypeScript. Interfejs aplikacji jest po polsku.

## Uruchomienie

Wymagany jest Node.js oraz npm.

1. Otwórz terminal w katalogu projektu.
2. Zainstaluj zależności:

   ```bash
   npm ci
   ```

3. Uruchom aplikację:

   ```bash
   npm run dev
   ```

4. Otwórz adres wyświetlony przez Vite, zwykle `http://localhost:5173`.

## Funkcje

- Rysowanie linii, prostokątów, okręgów, wielokątów i krzywych Béziera dowolnego stopnia.
- Tworzenie i edycja figur za pomocą myszy oraz pól z współrzędnymi.
- Zaznaczanie wielu obiektów, wspólne przesuwanie, duplikowanie i usuwanie.
- Przesuwanie, obracanie i skalowanie figur z użyciem myszy lub wartości liczbowych. Transformacje wykorzystują współrzędne jednorodne.
- Cofanie i ponawianie zmian, siatka przyciągania, zapis projektu i eksport obrazu.
- Wczytywanie obrazów, podgląd filtrów oraz filtry: uśredniający, medianowy, Sobela, binaryzacja, dylatacja i erozja. Maskę do operacji morfologicznych można skonfigurować samodzielnie.
- Analiza udziału wybranego koloru na obrazie. Zdjęcie wczytane do analizy nie jest dodawane do tablicy; wynik pokazuje procent dopasowanych pikseli i ich położenie na podglądzie.
- Przykładowe obiekty i obrazy dostępne z menu aplikacji.

## Zapis i eksport

Projekt można zapisać do pliku `.vlab` i później ponownie otworzyć. Aplikacja tworzy również lokalną kopię projektu w przeglądarce. Obraz można wyeksportować do PNG lub JPEG.

## Testy i kompilacja

```bash
npm test
npm run test:e2e
npm run build
```

Testy end-to-end korzystają z Chrome wskazanego w `playwright.config.ts`. Jeśli Chrome jest zainstalowany w innym miejscu, dostosuj tam `executablePath`.

## Dokumenty projektu

- [Scenariusz prezentacji](./PREZENTACJA.md) zawiera instrukcje demonstracji funkcji aplikacji.
- [Wymagania projektu](./wymagania_projektu.md) opisują wymagania i sposób ich realizacji.

## Technologie

React, TypeScript, Vite, Canvas API, Web Workers, Vitest i Playwright. Operacje rastrowe i geometryczne zaimplementowano w kodzie projektu; aplikacja nie korzysta z biblioteki filtrów obrazu.
