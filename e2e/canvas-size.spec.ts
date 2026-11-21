import { test, expect } from '@playwright/test';
import { savedProject } from './fixtures';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
});

test('zmienia rozmiar białego obszaru roboczego bez skalowania obiektów', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Typ tworzonej figury' }).selectOption('rect');
  await page.getByRole('button', { name: 'Utwórz obiekt' }).click();
  const before = await savedProject(page);
  const matrix = before.objects[0].matrix;

  await page.getByRole('spinbutton', { name: 'Szerokość kanwy (px)' }).fill('2400');
  await page.getByRole('spinbutton', { name: 'Wysokość kanwy (px)' }).fill('1600');
  await page.getByRole('button', { name: 'Zastosuj rozmiar' }).click();

  const resized = await savedProject(page);
  expect([resized.width, resized.height]).toEqual([2400, 1600]);
  expect(resized.objects).toHaveLength(1);
  expect(resized.objects[0].matrix).toEqual(matrix);
});

test('zachowuje proporcje oraz obsługuje undo i redo rozmiaru kanwy', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Zachowaj proporcje' }).check();
  await page.getByRole('spinbutton', { name: 'Szerokość kanwy (px)' }).fill('960');
  await expect(page.getByRole('spinbutton', { name: 'Wysokość kanwy (px)' })).toHaveValue('540');
  await page.getByRole('button', { name: 'Zastosuj rozmiar' }).click();
  expect((await savedProject(page)).width).toBe(960);

  await page.getByRole('button', { name: 'Cofnij', exact: true }).click();
  expect((await savedProject(page)).width).toBe(1920);
  await page.getByRole('button', { name: 'Ponów', exact: true }).click();
  expect((await savedProject(page)).width).toBe(960);
});
