import { test, expect } from '@playwright/test';
import { imageData, importImage, openProject, project, savedProject } from './fixtures';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
});

test('rysowanie, edycja, kolor i historia', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('VectorLab', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByRole('button', { name: 'Linia' }).click();
  const box = await page.locator('canvas.interaction').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 170, box!.y + 160);
  await page.mouse.down();
  await page.mouse.move(box!.x + 300, box!.y + 210, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('OBIEKTY 1')).toBeVisible();
  await expect(page.getByText('LINIA', { exact: true })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'X₁' }).fill('150');
  await expect(page.getByRole('spinbutton', { name: 'X₁' })).toHaveValue('150');
  await page.getByRole('button', { name: /kolor/i }).click();
  await page.getByRole('button', { name: 'CMYK', exact: true }).click();
  await expect(page.getByText(/CMYK/).first()).toBeVisible();
  await page.getByRole('button', { name: /właściwości/i }).click();
  await page.getByRole('button', { name: 'Cofnij' }).click();
  await expect(page.getByRole('spinbutton', { name: 'X₁' })).not.toHaveValue('150');
});

test('obraz, filtr i zapis projektu', async ({ page }) => {
  await page.goto('/');
  const url = await imageData(page, '#808080');
  await importImage(page, url);
  await expect(page.getByText('OBIEKTY 1')).toBeVisible();
  await page.getByRole('combobox', { name: 'Operacja' }).selectOption('threshold');
  await expect(page.getByText('Podgląd filtra gotowy')).toBeVisible();
  await page.getByRole('button', { name: 'Zastosuj' }).click();
  await expect(page.getByText('Zastosowano filtr')).toBeVisible();
  const saved = await savedProject(page);
  expect(saved.objects).toHaveLength(1);
  const image = saved.objects[0];
  expect(image.kind).toBe('image');
  if (image.kind !== 'image') throw new Error('Import nie utworzył obrazu');
  expect(image.original).toBe(url);
  expect(image.pixels).not.toBe(url);
  await page.reload();
  await expect(page.getByText('OBIEKTY 1')).toBeVisible();
  expect((await savedProject(page)).objects).toEqual(saved.objects);
});

test('wielokąt, krzywa i przekształcenia z pól', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Wielokąt' }).click();
  await page.getByRole('button', { name: 'Wklej listę' }).click();
  await page.getByRole('textbox', { name: /Punkty X,Y/ }).fill('20,20\n120,20\n120,100\n20,100');
  await page.getByRole('button', { name: 'Utwórz obiekt' }).click();
  await expect(page.getByText('OBIEKTY 1')).toBeVisible();
  await page.locator('#tx').fill('30');
  await expect(page.getByRole('button', { name: 'Zastosuj przekształcenie' })).toBeEnabled();
  await page.getByRole('button', { name: 'Zastosuj przekształcenie' }).click();
  await page.getByRole('combobox', { name: 'Rodzaj przekształcenia' }).selectOption('rotate');
  await page.locator('#tx').fill('45');
  await page.getByRole('button', { name: 'Zastosuj przekształcenie' }).click();
  await page.getByRole('combobox', { name: 'Rodzaj przekształcenia' }).selectOption('scale');
  await page.locator('#tx').fill('2');
  await page.locator('#ty').fill('2');
  await page.getByRole('button', { name: 'Zastosuj przekształcenie' }).click();
  await page.getByRole('button', { name: 'Krzywa Béziera' }).click();
  await page.getByRole('spinbutton', { name: 'Stopień' }).fill('2');
  await page.getByRole('textbox', { name: /Punkty X,Y/ }).fill('10,10\n60,130\n110,10');
  await page.getByRole('button', { name: 'Utwórz obiekt' }).click();
  await expect(page.getByText('OBIEKTY 2')).toBeVisible();
});

test('obrót i skalowanie przeciągnięciem', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByRole('button', { name: 'Prostokąt' }).click();
  await page.getByRole('button', { name: 'Utwórz obiekt' }).click();
  const initial = await savedProject(page);
  const box = await page.locator('canvas.interaction').boundingBox();
  expect(box).not.toBeNull();
  await page.getByRole('button', { name: 'Obróć myszą' }).click();
  await page.mouse.move(box!.x + 250, box!.y + 200);
  await page.mouse.down();
  await page.mouse.move(box!.x + 350, box!.y + 290, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('Zmieniono obiekt').first()).toBeVisible();
  const rotated = await savedProject(page);
  expect(rotated.objects[0].matrix).not.toEqual(initial.objects[0].matrix);
  await page.getByRole('button', { name: 'Skaluj myszą' }).click();
  await page.mouse.move(box!.x + 250, box!.y + 200);
  await page.mouse.down();
  await page.mouse.move(box!.x + 310, box!.y + 240, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('OBIEKTY 1')).toBeVisible();
  const scaled = await savedProject(page);
  expect(scaled.objects[0].matrix).not.toEqual(rotated.objects[0].matrix);
  await page.getByRole('button', { name: 'Cofnij', exact: true }).click();
  expect((await savedProject(page)).objects).toEqual(rotated.objects);
  await page.getByRole('button', { name: 'Ponów', exact: true }).click();
  expect((await savedProject(page)).objects).toEqual(scaled.objects);
});

test('własny projekt: kroki algorytmu i import obrazu do filtra', async ({ page }) => {
  await page.goto('/');
  await openProject(page, project([{
    id: 'line-fixture', name: 'Linia testowa', kind: 'line', visible: true, locked: false,
    stroke: '#000000', fill: null, width: 1, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    a: { x: 50, y: 50 }, b: { x: 180, y: 110 },
  }]));
  await page.locator('.object-name').filter({ hasText: 'Linia testowa' }).click();
  await page.getByRole('button', { name: 'algorytm', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Wybierz algorytm' })).toHaveValue('bresenham');
  await expect(page.locator('#line-step')).toBeVisible();
  await page.locator('#line-step').fill('10');
  await expect(page.getByText(/Piksel \(/)).toBeVisible();
  await importImage(page, await imageData(page));
  await page.getByRole('button', { name: 'filtry', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Operacja' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Operacja' }).selectOption('sobel');
  await page.getByRole('button', { name: 'Podgląd' }).click();
  await expect(page.getByText('Podgląd filtra gotowy')).toBeVisible();
  expect((await savedProject(page)).objects.map((shape) => shape.kind)).toEqual(['line', 'image']);
});
