import { test, expect } from '@playwright/test';
import { camera, exportPixels, imageData, openProject, project, rectangle, savedProject, screenPoint } from './fixtures';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
});

test('obszar roboczy i wybór narzędzi są dostępne z klawiatury', async ({ page }) => {
  const canvas = page.getByLabel(/^Obszar roboczy/);
  await expect(canvas).toBeVisible();
  await canvas.focus();
  await canvas.press('r');
  await expect(page.getByRole('button', { name: 'Prostokąt', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('status')).toHaveAttribute('aria-live', 'polite');
});

test('nowy dokument 1920×1080 jest dopasowany i pusty', async ({ page }) => {
  const doc = await savedProject(page);
  expect([doc.width, doc.height, doc.objects.length]).toEqual([1920, 1080, 0]);
  await expect(page.getByText('OBIEKTY 0')).toBeVisible();
  const topLeft = await screenPoint(page, 0, 0);
  const bottomRight = await screenPoint(page, doc.width, doc.height);
  const host = await page.locator('canvas.interaction').boundingBox();
  expect(host).not.toBeNull();
  expect(topLeft.x).toBeGreaterThanOrEqual(host!.x);
  expect(topLeft.y).toBeGreaterThanOrEqual(host!.y);
  expect(bottomRight.x).toBeLessThanOrEqual(host!.x + host!.width + 1);
  expect(bottomRight.y).toBeLessThanOrEqual(host!.y + host!.height + 1);
});

test('pointerup zachowuje ostatni punkt i jeden krok undo/redo', async ({ page }) => {
  await openProject(page, project([rectangle()]));
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByRole('button', { name: 'Zaznacz', exact: true }).click();
  const start = await screenPoint(page, 150, 150);
  const end = await screenPoint(page, 235, 195);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Same-task events deliberately finish before the next animation frame.
  await page.locator('canvas.interaction').evaluate((canvas, { start, end }) => {
    const fire = (type: string, p: { x: number; y: number }, buttons: number) =>
      canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1,
        pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: p.x, clientY: p.y }));
    fire('pointermove', { x: start.x + 10, y: start.y + 10 }, 1);
    fire('pointerup', end, 0);
  }, { start, end });
  await page.mouse.up();
  const moved = await savedProject(page);
  expect(moved.objects[0].matrix).toEqual([1, 0, 85, 0, 1, 45, 0, 0, 1]);
  await page.getByRole('button', { name: 'Cofnij', exact: true }).click();
  expect((await savedProject(page)).objects).toEqual([rectangle()]);
  await page.getByRole('button', { name: 'Ponów', exact: true }).click();
  expect((await savedProject(page)).objects).toEqual(moved.objects);
});

for (const cancellation of ['Escape', 'pointercancel'] as const) {
  test(`${cancellation} cofa podgląd przesunięcia bez nowego kroku historii`, async ({ page }) => {
    await openProject(page, project([rectangle()]));
    await page.getByRole('button', { name: '100%', exact: true }).click();
    const start = await screenPoint(page, 150, 150);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, start.y + 50, { steps: 3 });
    if (cancellation === 'Escape') await page.keyboard.press('Escape');
    else await page.locator('canvas.interaction').dispatchEvent('pointercancel', {
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
    });
    await page.mouse.up();
    expect((await savedProject(page)).objects).toEqual([rectangle()]);
    await page.getByRole('button', { name: 'Cofnij', exact: true }).click();
    expect((await savedProject(page)).objects).toEqual([]);
    await page.getByRole('button', { name: 'Ponów', exact: true }).click();
    expect((await savedProject(page)).objects).toEqual([rectangle()]);
  });
}

test('Escape anuluje rysowanie nowej figury', async ({ page }) => {
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await page.getByRole('button', { name: 'Prostokąt', exact: true }).click();
  const start = await screenPoint(page, 100, 100);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 100, start.y + 80);
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect((await savedProject(page)).objects).toEqual([]);
});

test('zoom zachowuje punkt pod kursorem oraz geometrię dokumentu', async ({ page }) => {
  const fixture = project([rectangle()]);
  await openProject(page, fixture);
  const anchor = await screenPoint(page, 160, 150);
  const before = await camera(page);
  await page.mouse.move(anchor.x, anchor.y); await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(before.zoom);
  let after = await screenPoint(page, 160, 150);
  expect(after.x).toBeCloseTo(anchor.x, 0); expect(after.y).toBeCloseTo(anchor.y, 0);
  await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(before.zoom, 8);
  after = await screenPoint(page, 160, 150);
  expect(after.x).toBeCloseTo(anchor.x, 0); expect(after.y).toBeCloseTo(anchor.y, 0);
  const saved = await savedProject(page);
  expect([saved.width, saved.height, saved.objects]).toEqual([1920, 1080, fixture.objects]);
});

test('przeciąganie obiektu zachowuje kolejność nakładających się warstw', async ({ page }) => {
  await openProject(page, project([rectangle('bottom', '#ff0000'), {
    ...rectangle('top', '#0000ff'), x: 130, y: 120, w: 120, h: 80,
  }], 640, 480));
  await page.getByRole('button', { name: '100%', exact: true }).click();
  const start = await screenPoint(page, 110, 150);
  const end = await screenPoint(page, 170, 150);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  const result = await exportPixels(page, 'PNG', [[110, 150], [180, 150]]);
  expect(result.pixels).toEqual([[255, 255, 255, 255], [0, 0, 255, 255]]);
});

for (const format of ['PNG', 'JPEG'] as const) {
  test(`${format}: obrazy i figury zachowują kolejność warstw, eksport ignoruje zoom`, async ({ page }) => {
    const pixels = await imageData(page);
    const image = { ...rectangle('image'), kind: 'image' as const, x: 140, y: 120,
      w: 120, h: 100, pixels, original: pixels };
    await openProject(page, project([rectangle(), image], 640, 480));
    const assertExport = async (overlap: number[]) => {
      const result = await exportPixels(page, format, [[110, 110], [170, 150], [250, 210], [400, 300]]);
      expect([result.width, result.height]).toEqual([640, 480]);
      const expected = [[255, 0, 0, 255], overlap, [0, 0, 255, 255], [255, 255, 255, 255]];
      result.pixels.forEach((pixel, i) => pixel.forEach((value, channel) =>
        expect(Math.abs(value - expected[i][channel])).toBeLessThanOrEqual(format === 'JPEG' ? 8 : 0)));
    };
    await assertExport([0, 0, 255, 255]);
    await page.locator('.object-row').filter({ has: page.locator('.object-name', { hasText: 'image' }) })
      .getByRole('button', { name: 'Niżej', exact: true }).click();
    const anchor = await screenPoint(page, 160, 150);
    await page.mouse.move(anchor.x, anchor.y); await page.mouse.wheel(0, 300);
    await assertExport([255, 0, 0, 255]);
    await page.getByRole('button', { name: 'Cofnij', exact: true }).click();
    await assertExport([0, 0, 255, 255]);
  });
}
