// The catalogue in the panel: creating a product, its pictures, and
// editing its stock without undoing a sale made meanwhile.
import { readFileSync } from 'node:fs';
import { expect, pngOf, test } from '../../support/fixtures.js';
import { api, items, tokensFor } from '../../support/api.js';

// The API's own 2-second H.264 test clip.
const CLIP = new URL('../../../backend/test/fixtures/clip-2s.mp4', import.meta.url);

test('a new product: Persian digits, saved price and stock, then on to its pictures', async ({ page }) => {
  const { admin } = tokensFor();
  const title = `کالای آزمایشی ${Date.now()}`;
  await page.goto('/products');
  await page.getByRole('button', { name: 'کالای جدید' }).first().click();
  const modal = page.locator('.modal');
  await modal.locator('input.input').first().fill(title);
  await modal.locator('textarea').first().fill('ساخته‌شده در تست');
  const price = modal.locator('.field', { hasText: 'قیمت (تومان)' }).locator('input');
  await price.fill('۱۲۳۰۰۰');
  await expect(price).toHaveValue('123000');
  await modal.locator('.field', { hasText: 'موجودی' }).locator('input').first().fill('۳');
  await page.locator('.modal-foot').getByRole('button', { name: 'ذخیره' }).click();

  await expect(modal.getByText('آپلود تصویر')).toBeVisible();
  const created = items(
    (await api('GET', `/products?includeDrafts=true&search=${encodeURIComponent(title)}`, { token: admin })).data,
  )[0];
  try {
    expect(Number(created.price)).toBe(123000);
    expect(Number(created.stock)).toBe(3);
  } finally {
    await api('DELETE', `/products/${created.id}`, { token: admin });
  }
});

test('a new product takes its pictures and video before it is first saved', async ({ page, browser }) => {
  const { admin } = tokensFor();
  const title = `کالای با رسانه ${Date.now()}`;
  await page.goto('/products');
  await page.getByRole('button', { name: 'کالای جدید' }).first().click();
  const modal = page.locator('.modal');
  await modal.locator('input.input').first().fill(title);
  await modal.locator('textarea').first().fill('با تصویر و ویدیو ساخته شد');
  await modal.locator('.field', { hasText: 'قیمت (تومان)' }).locator('input').fill('50000');

  await modal.getByRole('button', { name: 'تصاویر و ویدیو' }).click();
  await modal.locator('input[type=file][accept="image/*"]').setInputFiles([
    { name: 'red.png', mimeType: 'image/png', buffer: await pngOf(browser, '#e63946') },
    { name: 'teal.png', mimeType: 'image/png', buffer: await pngOf(browser, '#2a9d8f') },
  ]);
  await expect(modal.locator('.card img')).toHaveCount(2);
  // The second one picked becomes the cover before anything is uploaded.
  await modal.getByRole('button', { name: 'تصویر اصلی شود' }).click();
  await modal.locator('input[type=file][accept^="video/"]').setInputFiles({
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    buffer: readFileSync(CLIP),
  });
  await expect(modal.locator('video')).toHaveCount(1);

  await page.locator('.modal-foot').getByRole('button', { name: 'ذخیره' }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });

  const created = items(
    (await api('GET', `/products?includeDrafts=true&search=${encodeURIComponent(title)}`, { token: admin })).data,
  )[0];
  try {
    const product = (await api('GET', `/products/${created.id}?includeDrafts=true`, { token: admin })).data;
    expect(product.images).toHaveLength(2);
    expect(product.video_url).toBeTruthy();
    expect(product.video_duration_ms).toBeGreaterThan(1000);
  } finally {
    await api('DELETE', `/products/${created.id}`, { token: admin });
  }
});

test('any picture can be made the cover; the rest keep their order', async ({ page, browser }) => {
  const { admin } = tokensFor();
  const product = items((await api('GET', '/products?limit=1', { token: admin })).data)[0];
  const form = new FormData();
  for (const [i, colour] of ['#e63946', '#2a9d8f'].entries()) {
    form.append('images', new Blob([await pngOf(browser, colour)], { type: 'image/png' }), `e2e-${i}.png`);
  }
  expect((await api('POST', `/products/${product.id}/images`, { token: admin, form })).status).toBe(201);
  const uploaded = (await api('GET', `/products/${product.id}`, { token: admin })).data.images;
  const before = uploaded.map((i) => i.id);

  // Stored as WebP, at the widths it has (a 120px picture is never enlarged).
  for (const image of uploaded.slice(-2)) {
    expect(image.url).toMatch(/\.webp$/);
    expect(image.sizes).toEqual([{ width: 120, url: image.url }]);
  }

  await page.goto(`/products?edit=${product.id}`);
  await page.locator('.modal').getByRole('button', { name: 'تصاویر' }).click();
  await expect(page.locator('.modal .badge', { hasText: 'تصویر اصلی' })).toHaveCount(1);
  await page.locator('.modal').getByRole('button', { name: 'تصویر اصلی شود' }).last().click();

  const expected = [before.at(-1), ...before.slice(0, -1)];
  await expect
    .poll(async () => (await api('GET', `/products/${product.id}`, { token: admin })).data.images.map((i) => i.id))
    .toEqual(expected);
});

test('saving a product leaves alone stock that was sold while the editor was open', async ({ page }) => {
  const { admin } = tokensFor();
  const created = (
    await api('POST', '/products', {
      token: admin,
      body: { title: `کالای موجودی ${Date.now()}`, description: 'تست', price: 1000, stock: 9 },
    })
  ).data;
  try {
    await page.goto(`/products?edit=${created.id}`);
    const modal = page.locator('.modal');
    await expect(modal.locator('.field', { hasText: 'موجودی' }).locator('input')).toHaveValue('9');

    // A sale happens elsewhere while the editor is open.
    await api('PATCH', `/products/${created.id}`, { token: admin, body: { stock: 7 } });

    // Only the description changes here: the stock field is untouched.
    await modal.locator('textarea').first().fill('توضیح تازه');
    await page.locator('.modal-foot').getByRole('button', { name: 'ذخیره' }).click();
    await expect
      .poll(async () => (await api('GET', `/products/${created.id}`, { token: admin })).data.description)
      .toBe('توضیح تازه');
    expect((await api('GET', `/products/${created.id}`, { token: admin })).data.stock).toBe(7);
  } finally {
    await api('DELETE', `/products/${created.id}`, { token: admin });
  }
});
