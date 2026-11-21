import { expect, type Page, type Download } from '@playwright/test';
import type { DocumentModel, Shape } from '../src/engine/types';

export const rectangle = (id = 'rectangle', fill = '#ff0000'): Shape => ({
  id, name: id, kind: 'rect', visible: true, locked: false,
  stroke: fill, fill, width: 1, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  x: 100, y: 100, w: 120, h: 100,
});

export const project = (objects: Shape[] = [], width = 1920, height = 1080): DocumentModel => ({
  version: 1, width, height, background: '#ffffff', objects,
});

export async function openProject(page: Page, doc: DocumentModel) {
  await page.locator('input[accept^=".vlab"]').setInputFiles({
    name: 'fixture.vlab', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(page.getByText('Wczytano projekt', { exact: true })).toBeVisible();
}

export async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Brak strumienia pobranego pliku');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function savedProject(page: Page): Promise<DocumentModel> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Zapisz projekt', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('projekt.vlab');
  return JSON.parse((await downloadBytes(download)).toString('utf8'));
}

export async function camera(page: Page) {
  const canvas = page.locator('canvas.interaction');
  await expect(canvas).toHaveAttribute('data-camera', /.+/);
  return canvas.evaluate((element) => {
    const value = JSON.parse(element.getAttribute('data-camera')!) as {
      x: number; y: number; zoom: number;
    };
    if (![value.x, value.y, value.zoom].every(Number.isFinite) || value.zoom <= 0)
      throw new Error('Nieprawidłowe data-camera');
    const bounds = element.getBoundingClientRect();
    return { ...value, left: bounds.left, top: bounds.top };
  });
}

// Camera coordinates are document-local; the editor reserves a 70×60 px ruler margin.
export async function screenPoint(page: Page, x: number, y: number) {
  const view = await camera(page);
  return {
    x: view.left + 70 + view.x + x * view.zoom,
    y: view.top + 60 + view.y + y * view.zoom,
  };
}

export async function imageData(page: Page, color = '#0000ff') {
  return page.evaluate((color) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d')!;
    context.fillStyle = color;
    context.fillRect(0, 0, 16, 16);
    return canvas.toDataURL('image/png');
  }, color);
}

export async function importImage(page: Page, data: string) {
  await page.locator('input[accept^="image/png"]').setInputFiles({
    name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(data.split(',')[1], 'base64'),
  });
}

export async function exportPixels(page: Page, format: 'PNG' | 'JPEG', points: number[][]) {
  await page.getByRole('button', { name: 'Plik', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: `Eksport ${format}`, exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(format === 'PNG' ? 'grafika.png' : 'grafika.jpg');
  const data = (await downloadBytes(download)).toString('base64');
  return page.evaluate(async ({ data, format, points }) => {
    const image = new Image();
    image.src = `data:image/${format === 'PNG' ? 'png' : 'jpeg'};base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return { width: image.width, height: image.height,
      pixels: points.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data)) };
  }, { data, format, points });
}
