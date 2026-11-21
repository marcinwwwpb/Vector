import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { screenPoint } from './fixtures';

test('okrąg z pól, promień z uchwytu i przesunięcie prostokąta', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByRole('button', { name: 'Okrąg', exact: true }).click();
  await page.locator('#new-x2').fill('50');
  await page.getByRole('button', { name: 'Utwórz obiekt' }).click();
  await expect(page.getByRole('spinbutton', { name: 'R', exact: true })).toHaveValue('50');
  const box = await page.locator('canvas.interaction').boundingBox();
  expect(box).not.toBeNull();
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByRole('button', { name: 'Zaznacz' }).click();
  await page.mouse.move(box!.x + 220, box!.y + 210);
  await page.mouse.down();
  await page.mouse.move(box!.x + 250, box!.y + 240, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('spinbutton', { name: 'R', exact: true })).not.toHaveValue('50');
  await page.getByRole('button', { name: 'Prostokąt' }).click();
  await page.mouse.move(box!.x + 310, box!.y + 170);
  await page.mouse.down();
  await page.mouse.move(box!.x + 410, box!.y + 260, { steps: 4 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Zaznacz' }).click();
  await page.mouse.move(box!.x + 360, box!.y + 210);
  await page.mouse.down();
  await page.mouse.move(box!.x + 390, box!.y + 250, { steps: 4 });
  await page.mouse.up();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Zapisz projekt' }).click();
  const firstDownload = await pending;
  const saved = JSON.parse(await readFile(await firstDownload.path(), 'utf8'));
  expect(saved.objects).toHaveLength(2);
  expect(saved.objects[1].matrix[2]).toBeCloseTo(30);
  expect(saved.objects[1].matrix[5]).toBeCloseTo(40);
});

test('RGB i CMYK synchronizują wartości w obie strony', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'kolor', exact: true }).click();
  const rgb = page.locator('.channel input[type="number"]');
  await rgb.nth(0).fill('0');
  await rgb.nth(1).fill('0');
  await rgb.nth(2).fill('0');
  await expect(page.getByText(/RGB 0, 0, 0 · CMYK 0, 0, 0, 100%/)).toBeVisible();
  await page.getByRole('button', { name: 'CMYK', exact: true }).click();
  const cmyk = page.locator('.channel input[type="number"]');
  await cmyk.nth(1).fill('100');
  await cmyk.nth(2).fill('100');
  await cmyk.nth(3).fill('0');
  await expect(page.getByText(/RGB 255, 0, 0/)).toBeVisible();
});

test('filtry, binaryzacja i własna maska morfologiczna', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scena pokazowa' }).first().click();
  await page.getByRole('button', { name: 'filtry', exact: true }).click();
  const operation = page.getByRole('combobox', { name: 'Operacja' });
  for (const name of ['average', 'median', 'sobel']) {
    await operation.selectOption(name);
    await page.getByRole('button', { name: 'Podgląd' }).click();
    await expect(page.getByText('Podgląd filtra gotowy')).toBeVisible();
    await page.getByRole('button', { name: 'Zastosuj' }).click();
  }
  await operation.selectOption('threshold');
  await expect(page.getByText('Podgląd filtra gotowy')).toBeVisible();
  await page.getByRole('button', { name: 'Zastosuj' }).click();
  for (const name of ['dilation', 'erosion']) {
    await operation.selectOption(name);
    await page.getByRole('spinbutton', { name: 'Szerokość' }).fill('2');
    await page.getByRole('spinbutton', { name: 'Wysokość' }).fill('3');
    await page.getByRole('button', { name: 'Wyczyść' }).click();
    await page.locator('.mask button').nth(0).click();
    await page.locator('.mask button').nth(3).click();
    await page.getByRole('button', { name: 'Podgląd' }).click();
    await expect(page.getByText('Podgląd filtra gotowy')).toBeVisible();
    await page.getByRole('button', { name: 'Zastosuj' }).click();
  }
  await page.getByRole('button', { name: 'Przywróć oryginał' }).click();
  await expect(page.getByText('Przywrócono oryginał')).toBeVisible();
});

test('zapis, odczyt, walidacja projektu i eksport PNG/JPEG', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scena pokazowa' }).first().click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Zapisz projekt' }).click();
  const firstDownload = await pending;
  const saved = await readFile(await firstDownload.path());
  await page.getByRole('button', { name: 'Plik' }).click();
  await page.getByRole('button', { name: 'Nowy projekt' }).click();
  await expect(page.getByText('OBIEKTY 0')).toBeVisible();
  await page
    .locator('input[accept^=".vlab"]')
    .setInputFiles({ name: 'scena.vlab', mimeType: 'application/json', buffer: saved });
  await expect(page.getByText('OBIEKTY 6')).toBeVisible();
  await page.locator('input[accept^=".vlab"]').setInputFiles({
    name: 'blad.vlab',
    mimeType: 'application/json',
    buffer: Buffer.from('{bad'),
  });
  await expect(page.getByText('OBIEKTY 6')).toBeVisible();
  for (const [label, extension] of [
    ['Eksport PNG', '.png'],
    ['Eksport JPEG', '.jpg'],
  ]) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Plik' }).click();
    await page.getByRole('button', { name: label }).click();
    expect((await download).suggestedFilename()).toContain(extension);
  }
});

test('krzywa z kliknięć, przesunięcie punktu i zamknięcie wielokąta', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByRole('button', { name: 'Krzywa Béziera' }).click();
  await page.getByRole('spinbutton', { name: 'Stopień' }).fill('2');
  for (const [x, y] of [
    [170, 160],
    [220, 240],
    [270, 160],
  ]) {
    const point = await screenPoint(page, x, y);
    await page.mouse.click(point.x, point.y);
  }
  await expect(page.getByText('OBIEKTY 1')).toBeVisible();
  await page.getByRole('button', { name: 'Zaznacz' }).click();
  const control = await screenPoint(page, 220, 240);
  await page.mouse.move(control.x, control.y);
  await page.mouse.down();
  const movedControl = await screenPoint(page, 220, 280);
  await page.mouse.move(movedControl.x, movedControl.y, { steps: 4 });
  await page.mouse.up();
  const pointRows = page.locator('.point-fields > div');
  await expect(pointRows.nth(1).locator('input').nth(1)).toHaveValue('280');
  await page.getByRole('button', { name: 'Wielokąt' }).click();
  for (const [x, y] of [
    [340, 160],
    [440, 160],
    [410, 230],
    [350, 230],
  ]) {
    const point = await screenPoint(page, x, y);
    await page.mouse.click(point.x, point.y);
  }
  await page.keyboard.press('Enter');
  await expect(page.getByText('OBIEKTY 2')).toBeVisible();
});

test('maska jest zapisywana i wczytywana z kotwicą', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scena pokazowa' }).first().click();
  await page.getByRole('button', { name: 'filtry', exact: true }).click();
  await page.getByRole('combobox', { name: 'Operacja' }).selectOption('dilation');
  await page.getByRole('spinbutton', { name: 'Szerokość' }).fill('2');
  await page.getByRole('spinbutton', { name: 'Kotwica X' }).fill('0');
  await page.getByRole('button', { name: 'Wyczyść' }).click();
  await page.getByRole('button', { name: 'Podgląd' }).click();
  await expect(page.getByText('Maska musi mieć co najmniej jedną aktywną komórkę')).toBeVisible();
  await page.locator('.mask button').nth(0).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Zapisz maskę' }).click();
  const downloaded = await pending;
  const mask = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
  expect(mask.width).toBe(2);
  expect(mask.anchorX).toBe(0);
  expect(mask.cells.filter((value: number) => value === 1)).toHaveLength(1);
  await page.getByRole('button', { name: 'Pełna' }).click();
  await page.locator('input[accept="application/json,.json"]').setInputFiles({
    name: 'maska.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(mask)),
  });
  await expect(page.locator('.mask button.on')).toHaveCount(1);
});

test('pola Béziera zmieniają się ze stopniem, a tabela wielokąta dodaje wierzchołki', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Krzywa Béziera' }).click();
  await page.getByRole('spinbutton', { name: 'Stopień' }).fill('4');
  await expect(page.locator('.point-create-row')).toHaveCount(5);
  await page.getByRole('spinbutton', { name: 'Punkt 5 X' }).fill('430');
  await page.getByRole('button', { name: 'Utwórz obiekt' }).click();
  await expect(page.getByText(/5 punktów/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Wielokąt' }).click();
  await page.getByRole('button', { name: '+ Wierzchołek' }).click();
  await expect(page.locator('.point-create-row')).toHaveCount(5);
  await page.getByRole('button', { name: 'Utwórz obiekt' }).click();
  await expect(page.getByText('OBIEKTY 2')).toBeVisible();
});

test('pipeta pobiera kolor widocznego piksela z kanwy', async ({ page }) => {
  await page.goto('/');
  const artboard = await page.locator('canvas.artboard').boundingBox();
  expect(artboard).not.toBeNull();
  await page.getByRole('button', { name: 'Pobierz kolor z kanwy' }).click();
  await page.mouse.click(artboard!.x + 12, artboard!.y + 12);
  await expect(page.getByRole('textbox', { name: 'HEX' })).toHaveValue('#FFFFFF');
  await expect(page.getByText('Pobrano kolor #FFFFFF')).toBeVisible();
});

test('uchwyty obrotu i skalowania zmieniają macierz figury', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Prostokąt' }).click();
  await page.getByRole('button', { name: 'Utwórz obiekt' }).click();
  await page.getByRole('button', { name: 'Zaznacz' }).click();
  const artboard = await page.locator('canvas.artboard').boundingBox();
  expect(artboard).not.toBeNull();
  const zoom = artboard!.width / 1920;
  const rotateX = artboard!.x + 220 * zoom,
    rotateY = artboard!.y + 100 * zoom - 28;
  await page.mouse.move(rotateX, rotateY);
  await page.mouse.down();
  await page.mouse.move(rotateX + 35, rotateY + 22, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('Zmieniono obiekt').first()).toBeVisible();
  await page.getByRole('button', { name: 'Cofnij' }).click();
  const scaleX = artboard!.x + 340 * zoom + 20,
    scaleY = artboard!.y + 280 * zoom + 20;
  await page.mouse.move(scaleX, scaleY);
  await page.mouse.down();
  await page.mouse.move(scaleX + 30, scaleY + 25, { steps: 5 });
  await page.mouse.up();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Zapisz projekt' }).click();
  const saved = JSON.parse(await readFile(await (await pending).path(), 'utf8'));
  expect(saved.objects[0].matrix[0]).not.toBe(1);
});

test('ostrzeżenie chroni niezapisany projekt, a panel można schować', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Prostokąt' }).click();
  await page.getByRole('button', { name: 'Utwórz obiekt' }).click();
  await page.getByRole('button', { name: 'Ukryj panel boczny' }).click();
  await expect(page.getByRole('combobox', { name: 'Typ tworzonej figury' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pokaż panel boczny' }).click();
  await expect(page.getByRole('combobox', { name: 'Typ tworzonej figury' })).toBeVisible();
  await page.getByRole('button', { name: 'Plik' }).click();
  await page.getByRole('button', { name: 'Nowy projekt' }).click();
  await expect(page.getByRole('dialog', { name: 'Niezapisane zmiany' })).toBeVisible();
  await page.getByRole('button', { name: 'Wróć do projektu' }).click();
  await expect(page.getByText('OBIEKTY 1')).toBeVisible();
  await page.getByRole('button', { name: 'Plik' }).click();
  await page.getByRole('button', { name: 'Nowy projekt' }).click();
  await page.getByRole('button', { name: 'Zastąp bez zapisu' }).click();
  await expect(page.getByText('OBIEKTY 0')).toBeVisible();
});
