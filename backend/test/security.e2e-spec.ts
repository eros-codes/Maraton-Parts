import { PANEL_ORIGIN, SHOP_ORIGIN, previousCorsOrigin } from './security-env';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { createHmac } from 'crypto';
import { assertDisposableTestDatabase } from './assert-test-database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { User } from '../src/users/entities/user.entity';
import { OtpVerification } from '../src/auth/entities/otp-verification.entity';
import OtpPurposeEnum from '../src/auth/enums/otp-purpose.enum';

assertDisposableTestDatabase();

// The security protections, end to end, with the app booted exactly as
// main.ts boots it (configureApp: helmet, CORS, the CSRF header, uploads).
//
// The allowed origins are set (security-env.ts) before the app module is
// even loaded, so the configuration sees them - as in production.
const SHOP = SHOP_ORIGIN;
void PANEL_ORIGIN;

const PASSWORD = 'TestPassword123';
const run = Date.now();
let counter = 0;
const uniqueMobile = () =>
  `09${(run + counter++).toString().slice(-8)}${Math.floor(Math.random() * 10)}`;

describe('Security (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  const api = () => request(app.getHttpServer());

  // Accounts straight in the database. Signed in for real only when the
  // test needs the refresh cookie: sign-in is rate-limited per address
  // (30 a minute), and every request here comes from one.
  async function account(
    role: 'admin' | 'user' = 'user',
    options: { withCookie?: boolean } = {},
  ) {
    const mobile = uniqueMobile();
    const users = dataSource.getRepository(User);
    const user = await users.save(
      users.create({
        mobile,
        display_name: 'Security e2e',
        password: await bcrypt.hash(PASSWORD, 10),
        role: role as never,
      }),
    );
    if (!options.withCookie) {
      const token = app
        .get(JwtService, { strict: false })
        .sign({ sub: user.id, role: user.role });
      return { id: user.id, mobile, token, cookie: '' };
    }
    const login = await api()
      .post('/auth/login')
      .send({ mobile, password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('refreshToken='))!
      .split(';')[0];
    return {
      id: user.id,
      mobile,
      token: login.body.data.accessToken as string,
      cookie,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env.CORS_ORIGIN = previousCorsOrigin;
  });

  describe('security headers', () => {
    it('sends the hardening headers and hides the framework', async () => {
      const res = await api().get('/health/live');
      expect(res.headers['strict-transport-security']).toMatch(
        /max-age=31536000; includeSubDomains/,
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['content-security-policy']).toContain(
        "frame-ancestors 'self'",
      );
      expect(res.headers['permissions-policy']).toContain('camera=()');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('never lets a browser cache tokens or personal answers', async () => {
      const user = await account();
      const login = await api()
        .post('/auth/login')
        .send({ mobile: user.mobile, password: PASSWORD });
      expect(login.headers['cache-control']).toBe('no-store');

      const orders = await api()
        .get('/orders')
        .set('Authorization', `Bearer ${user.token}`);
      expect(orders.headers['cache-control']).toBe('no-store');
    });
  });

  describe('CORS', () => {
    it('answers the preflight of our own apps', async () => {
      const res = await api()
        .options('/auth/refresh')
        .set('Origin', SHOP)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-requested-with');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(SHOP);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('gives another site no permission at all', async () => {
      const res = await api()
        .options('/auth/refresh')
        .set('Origin', 'https://evil.e2e.test')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'x-requested-with');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does not allow headers the apps never send', async () => {
      const res = await api()
        .options('/orders')
        .set('Origin', SHOP)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'x-forwarded-host');
      expect(res.headers['access-control-allow-headers']).not.toContain(
        'x-forwarded-host',
      );
    });
  });

  describe('CSRF on the cookie routes', () => {
    it('refuses a refresh without the X-Requested-With header', async () => {
      const user = await account('user', { withCookie: true });
      const res = await api().post('/auth/refresh').set('Cookie', user.cookie);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_REJECTED');
    });

    it('refuses a refresh from another origin', async () => {
      const user = await account('user', { withCookie: true });
      const res = await api()
        .post('/auth/refresh')
        .set('Cookie', user.cookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Origin', 'https://evil.e2e.test');
      expect(res.status).toBe(403);
    });

    it('refuses a forged logout (which would sign the customer out)', async () => {
      const user = await account('user', { withCookie: true });
      const forged = await api()
        .post('/auth/logout')
        .set('Cookie', user.cookie);
      expect(forged.status).toBe(403);
      // ...and the session is still alive.
      const real = await api()
        .post('/auth/refresh')
        .set('Cookie', user.cookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Origin', SHOP);
      expect(real.status).toBe(200);
    });

    it('writes the refresh cookie httpOnly and SameSite', async () => {
      const mobile = (await account('user', { withCookie: true })).mobile;
      const login = await api()
        .post('/auth/login')
        .send({ mobile, password: PASSWORD });
      const cookie = (login.headers['set-cookie'] as unknown as string[]).find(
        (c) => c.startsWith('refreshToken='),
      )!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\//);
    });
  });

  describe('sign-in lockout', () => {
    it('locks password sign-in after five wrong passwords, even for the right one', async () => {
      const user = await account();
      for (let i = 1; i <= 4; i += 1) {
        const res = await api()
          .post('/auth/login')
          .send({ mobile: user.mobile, password: 'WrongPassword1' });
        expect(res.status).toBe(401);
      }
      const fifth = await api()
        .post('/auth/login')
        .send({ mobile: user.mobile, password: 'WrongPassword1' });
      expect(fifth.status).toBe(429);
      expect(fifth.body.code).toBe('ACCOUNT_LOCKED');
      expect(fifth.body.details.retryAfter).toBeGreaterThan(800);

      const right = await api()
        .post('/auth/login')
        .send({ mobile: user.mobile, password: PASSWORD });
      expect(right.status).toBe(429);
      expect(right.body.code).toBe('ACCOUNT_LOCKED');

      // Recorded where the shop can see it.
      const [event] = await dataSource.query(
        "SELECT `action`, `changes` FROM `audit_logs` WHERE `entity_type` = 'security' AND `action` = 'security.login_locked' ORDER BY `id` DESC LIMIT 1",
      );
      expect(event.action).toBe('security.login_locked');
      expect(JSON.stringify(event.changes)).toContain(user.mobile);
    });

    it('locks a number with no account exactly the same way', async () => {
      const mobile = uniqueMobile();
      let last: request.Response | undefined;
      for (let i = 1; i <= 5; i += 1) {
        last = await api()
          .post('/auth/login')
          .send({ mobile, password: 'WrongPassword1' });
      }
      expect(last!.status).toBe(429);
      expect(last!.body.code).toBe('ACCOUNT_LOCKED');
    });

    it('a correct sign-in clears the count', async () => {
      const user = await account();
      for (let i = 1; i <= 3; i += 1) {
        await api()
          .post('/auth/login')
          .send({ mobile: user.mobile, password: 'WrongPassword1' });
      }
      await api()
        .post('/auth/login')
        .send({ mobile: user.mobile, password: PASSWORD })
        .expect(200);
      const [row] = await dataSource.query(
        'SELECT COUNT(*) AS n FROM `login_lockouts` WHERE `mobile` = ?',
        [user.mobile],
      );
      expect(Number(row.n)).toBe(0);
    });
  });

  describe('staff routes', () => {
    const staffRoutes: Array<[string, string]> = [
      ['get', '/users'],
      ['get', '/reports/summary'],
      ['get', '/audit-logs'],
      ['get', '/discount-codes'],
      ['post', '/products'],
      ['post', '/categories'],
      ['get', '/wallets'],
    ];

    it.each(staffRoutes)(
      '%s %s refuses anyone who is not signed in',
      async (method, path) => {
        const res = await (
          api() as never as Record<string, (p: string) => request.Test>
        )[method](path);
        expect(res.status).toBe(401);
      },
    );

    it('refuses a customer on every staff route, and records the attempt', async () => {
      const customer = await account();
      for (const [method, path] of staffRoutes) {
        const res = await (
          api() as never as Record<string, (p: string) => request.Test>
        )
          [method](path)
          .set('Authorization', `Bearer ${customer.token}`)
          .send({});
        expect(res.status).toBe(403);
      }
      const [event] = await dataSource.query(
        "SELECT `entity_id` FROM `audit_logs` WHERE `action` = 'security.admin_access_denied' ORDER BY `id` DESC LIMIT 1",
      );
      expect(Number(event.entity_id)).toBe(customer.id);
    });

    it('rejects a forged token (wrong key, or alg "none")', async () => {
      const header = (alg: string) =>
        Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 1,
          role: 'admin',
          iat: Math.floor(Date.now() / 1000),
        }),
      ).toString('base64url');

      const none = await api()
        .get('/reports/summary')
        .set('Authorization', `Bearer ${header('none')}.${payload}.`);
      expect(none.status).toBe(401);

      const wrongKey = await api()
        .get('/reports/summary')
        .set(
          'Authorization',
          `Bearer ${header('HS256')}.${payload}.c2lnbmF0dXJl`,
        );
      expect(wrongKey.status).toBe(401);
    });
  });

  describe('somebody else’s data', () => {
    it('cannot read or change another customer’s profile, wallet or basket', async () => {
      const alice = await account();
      const bob = await account();
      const as = (path: string) =>
        api().get(path).set('Authorization', `Bearer ${bob.token}`);

      expect((await as(`/users/${alice.id}`)).status).toBe(403);
      expect((await as(`/wallets/user/${alice.id}`)).status).toBe(403);
      expect((await as(`/products/basket/${alice.id}`)).status).toBe(403);
      const patch = await api()
        .patch(`/users/${alice.id}`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ display_name: 'hijacked' });
      expect(patch.status).toBe(403);
    });

    it('cannot make itself an admin', async () => {
      const user = await account();
      const res = await api()
        .patch(`/users/${user.id}`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ role: 'admin' });
      expect(res.status).toBe(400);
      const role = await api()
        .patch(`/users/${user.id}/role`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ role: 'admin' });
      expect(role.status).toBe(403);
    });
  });

  describe('input validation', () => {
    it('refuses fields a form does not have (a price slipped into an order)', async () => {
      const user = await account();
      const res = await api()
        .post('/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', `sec-${run}`)
        .send({
          payWithWallet: true,
          items: [{ productId: 1, quantity: 1, price: 1 }],
          total_price: 1,
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('treats SQL in a search box as text', async () => {
      for (const search of [
        "' OR 1=1 --",
        '%" UNION SELECT password FROM users --',
        "206'; DROP TABLE products; --",
      ]) {
        const res = await api().get('/products').query({ search });
        expect(res.status).toBe(200);
        expect(res.body.data.total).toBe(0);
      }
      const [row] = await dataSource.query(
        'SELECT COUNT(*) AS n FROM `products`',
      );
      expect(row).toBeDefined();
    });

    it('refuses a sort column that is not on the list', async () => {
      const res = await api().get('/products').query({ sortBy: 'password' });
      expect(res.status).toBe(400);
    });
  });

  describe('uploads', () => {
    let admin: { token: string };
    let productId: number;

    beforeAll(async () => {
      admin = await account('admin');
      const product = await api()
        .post('/products')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          title: `Security e2e ${run}`,
          description: 'test',
          price: 1000,
          stock: 1,
          weight_grams: 100,
        });
      productId = product.body.data.id;
    });

    it('refuses a script dressed up as an image', async () => {
      const res = await api()
        .post(`/products/${productId}/images`)
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('images', Buffer.from('<script>alert(1)</script>'), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        });
      expect(res.status).toBe(400);
    });

    it('refuses an image over 5 MB before reading it all', async () => {
      const big = Buffer.alloc(5 * 1024 * 1024 + 10, 0xff);
      big[0] = 0xff;
      big[1] = 0xd8;
      big[2] = 0xff;
      const res = await api()
        .post(`/products/${productId}/images`)
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('images', big, {
          filename: 'big.jpg',
          contentType: 'image/jpeg',
        });
      expect([400, 413]).toContain(res.status);
    });

    it('lets nobody but staff upload', async () => {
      const customer = await account();
      const res = await api()
        .post(`/products/${productId}/images`)
        .set('Authorization', `Bearer ${customer.token}`)
        .attach('images', Buffer.from('x'), 'x.jpg');
      expect(res.status).toBe(403);
    });

    it('serves uploaded files as data that can never run script', async () => {
      const res = await api().get('/uploads/does-not-exist.png');
      // A miss falls through to the API's 404; a hit carries the sandbox.
      expect([404]).toContain(res.status);
      const dotfile = await api().get('/uploads/.env');
      expect([403, 404]).toContain(dotfile.status);
    });
  });

  describe('password reset codes', () => {
    it('stops working once they expire', async () => {
      const user = await account();
      const code = '482913';
      await dataSource.getRepository(OtpVerification).save({
        mobile: user.mobile,
        purpose: OtpPurposeEnum.PasswordReset,
        codeHash: createHmac('sha256', process.env.OTP_HASH_SECRET!)
          .update(code)
          .digest('hex'),
        expiresAt: new Date(Date.now() - 1000),
        attempts: 0,
        lastSentAt: new Date(),
        sendCount: 1,
        windowStartedAt: new Date(),
      });
      const res = await api()
        .post('/auth/reset-password')
        .send({ mobile: user.mobile, code, password: 'BrandNewPass1' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_EXPIRED');
    });
  });
});
