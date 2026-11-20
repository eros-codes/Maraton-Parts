import { INestApplication } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { assertDisposableTestDatabase } from './assert-test-database';
import { bootApp, createAccount } from './shop-helpers';
import userRoleEnum from '../src/users/enums/userRoleEnum';
import { resolveUploadRoot } from '../src/common/storage/local-file-storage';

assertDisposableTestDatabase();

// Real MP4 files, made with ffmpeg (a few KB each): two seconds of H.264,
// 31 seconds of H.264, and one second of HEVC.
const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name));
const storedPath = (url: string) =>
  join(
    resolveUploadRoot(process.env.UPLOAD_DIR),
    decodeURIComponent(url.split('/uploads/')[1]),
  );

describe('Product video (e2e)', () => {
  let app: INestApplication;
  let admin: { token: string };
  let customer: { token: string };
  let productId: number;

  const api = () => request(app.getHttpServer() as App);
  const upload = (name: string, token = admin.token) =>
    api()
      .post(`/products/${productId}/video`)
      .set('Authorization', `Bearer ${token}`)
      .attach('video', fixture(name), name);

  beforeAll(async () => {
    app = await bootApp();
    admin = await createAccount(app, userRoleEnum.AdminUser);
    customer = await createAccount(app, userRoleEnum.NormalUser);
    const product = await api()
      .post('/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        title: `E2E video ${Date.now()}`,
        description: 'video fixture',
        price: 100_000,
        stock: 3,
      });
    productId = product.body.data.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  let firstUrl: string;
  const urlOf = (res: request.Response) =>
    (res.body as { data: { video_url: string } }).data.video_url;

  it('takes a short H.264 video and shows it on the product', async () => {
    const res = await upload('clip-2s.mp4');

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      video_url: expect.stringMatching(/\/uploads\/products\/videos\/.+\.mp4$/),
      video_duration_ms: 2000,
    });
    // The storage key stays on the server.
    expect(res.body.data).not.toHaveProperty('video_filename');
    firstUrl = urlOf(res);
    expect(existsSync(storedPath(firstUrl))).toBe(true);

    const page = await api().get(`/products/${productId}`);
    expect(page.body.data.video_url).toBe(firstUrl);
  });

  it('refuses a video longer than 30 seconds, saying how long it is', async () => {
    const res = await upload('clip-31s.mp4');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VIDEO_TOO_LONG');
    expect(res.body.details).toEqual({ seconds: 31, max: 30 });
  });

  it('refuses HEVC, which most browsers on a computer cannot play', async () => {
    const res = await upload('clip-hevc.mp4');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VIDEO_CODEC_UNSUPPORTED');
  });

  it('refuses something that is not a video, whatever its name says', async () => {
    const res = await api()
      .post(`/products/${productId}/video`)
      .set('Authorization', `Bearer ${admin.token}`)
      .attach('video', Buffer.from('not really a video at all'), 'fake.mp4');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VIDEO_INVALID');
  });

  it('is for staff only', async () => {
    const res = await upload('clip-2s.mp4', customer.token);

    expect(res.status).toBe(403);
  });

  // A refused upload must not have touched the video already there.
  it('still has the first video after the refusals', async () => {
    const page = await api().get(`/products/${productId}`);
    expect(page.body.data.video_url).toBe(firstUrl);
    expect(existsSync(storedPath(firstUrl))).toBe(true);
  });

  it('replaces the video, and the old file is deleted', async () => {
    const res = await upload('clip-2s.mp4');

    expect(res.status).toBe(201);
    expect(res.body.data.video_url).not.toBe(firstUrl);
    expect(existsSync(storedPath(urlOf(res)))).toBe(true);
    expect(existsSync(storedPath(firstUrl))).toBe(false);
    firstUrl = urlOf(res);
  });

  it('removes the video and its file', async () => {
    const res = await api()
      .delete(`/products/${productId}/video`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.video_url).toBeNull();
    expect(existsSync(storedPath(firstUrl))).toBe(false);

    const again = await api()
      .delete(`/products/${productId}/video`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(again.status).toBe(404);
  });
});
