import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { assertDisposableTestDatabase } from './assert-test-database';
import { bootApp, PASSWORD } from './shop-helpers';
import { User } from '../src/users/entities/user.entity';
import userRoleEnum from '../src/users/enums/userRoleEnum';
import { currentStep, totpAt } from '../src/auth/two-factor/totp';

assertDisposableTestDatabase();

// Two-step sign-in for admins, end to end: setup, the challenge at sign-in,
// wrong and replayed codes, the lock, turning it off, and another admin
// resetting it. The suite runs with two-step sign-in "optional" (as
// development does); one test switches it to "required".
describe('Admin two-step sign-in (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const api = () => request(app.getHttpServer());
  const run = Date.now();
  let counter = 0;

  async function admin(role = userRoleEnum.AdminUser) {
    const mobile = `09${(run + counter++).toString().slice(-8)}${Math.floor(Math.random() * 10)}`;
    const users = dataSource.getRepository(User);
    const user = await users.save(
      users.create({
        mobile,
        display_name: '2FA e2e',
        password: await bcrypt.hash(PASSWORD, 10),
        role,
      }),
    );
    return { id: user.id, mobile };
  }

  const login = (mobile: string) =>
    api().post('/auth/login').send({ mobile, password: PASSWORD });

  // Signs in (no second step yet), scans, confirms. Returns the secret and
  // the step of the code that confirmed it (used, so it no longer works).
  async function withTwoFactor() {
    const account = await admin();
    const first = await login(account.mobile);
    expect(first.status).toBe(200);
    const token = first.body.data.accessToken as string;

    const setup = await api()
      .post('/auth/2fa/setup')
      .set('Authorization', `Bearer ${token}`);
    expect(setup.status).toBe(201);
    const secret = setup.body.data.secret as string;
    expect(setup.body.data.otpauthUrl).toContain(`secret=${secret}`);

    const step = currentStep();
    const enable = await api()
      .post('/auth/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: totpAt(secret, step) });
    expect(enable.status).toBe(200);
    return { ...account, secret, usedStep: step, token };
  }

  beforeAll(async () => {
    app = await bootApp();
    dataSource = app.get(DataSource);
  }, 60_000);

  afterAll(async () => {
    delete process.env.ADMIN_TWO_FACTOR;
    await app?.close();
  });

  it('asks for the code after the password, and only then opens a session', async () => {
    const account = await withTwoFactor();

    const first = await login(account.mobile);
    expect(first.status).toBe(200);
    expect(first.body.data.twoFactor).toBe('verify');
    expect(first.body.data.accessToken).toBeUndefined();
    expect(first.headers['set-cookie']).toBeUndefined();
    const challenge = first.body.data.challengeToken as string;

    // The challenge is not a way in by itself.
    const sneaky = await api()
      .get('/reports/summary')
      .set('Authorization', `Bearer ${challenge}`);
    expect(sneaky.status).toBe(401);

    const wrong = await api()
      .post('/auth/2fa/login')
      .send({ challengeToken: challenge, code: '000000' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('TWO_FACTOR_INCORRECT');

    const code = totpAt(account.secret, account.usedStep + 1);
    const right = await api()
      .post('/auth/2fa/login')
      .send({ challengeToken: challenge, code });
    expect(right.status).toBe(200);
    expect(right.body.data.accessToken).toBeTruthy();
    expect(
      (right.headers['set-cookie'] as unknown as string[]).some((c) =>
        c.startsWith('refreshToken='),
      ),
    ).toBe(true);
    const panel = await api()
      .get('/reports/summary')
      .set('Authorization', `Bearer ${right.body.data.accessToken}`);
    expect(panel.status).toBe(200);

    // The same code a second time (someone who watched it typed) fails.
    const replay = await api()
      .post('/auth/2fa/login')
      .send({ challengeToken: challenge, code });
    expect(replay.status).toBe(401);
  });

  it('refuses the code of a challenge signed by anyone but the server', async () => {
    const account = await withTwoFactor();
    const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({
        sub: account.id,
        purpose: 'two-factor',
        stage: 'verify',
      }),
    ).toString('base64url');
    const res = await api()
      .post('/auth/2fa/login')
      .send({
        challengeToken: `${header}.${payload}.c2lnbmF0dXJlc2lnbmF0dXJl`,
        code: totpAt(account.secret, account.usedStep + 1),
      });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TWO_FACTOR_CHALLENGE_EXPIRED');
  });

  it('locks the account after five wrong codes, even with the right password', async () => {
    const account = await withTwoFactor();
    const challenge = (await login(account.mobile)).body.data.challengeToken;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push(
        (
          await api()
            .post('/auth/2fa/login')
            .send({ challengeToken: challenge, code: '123456' })
        ).status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    const again = await login(account.mobile);
    expect(again.status).toBe(429);
    expect(again.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('turns off only with the password and a current code', async () => {
    const account = await withTwoFactor();
    const noCode = await api()
      .post('/auth/2fa/disable')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ password: PASSWORD, code: '000000' });
    expect(noCode.status).toBe(401);

    const ok = await api()
      .post('/auth/2fa/disable')
      .set('Authorization', `Bearer ${account.token}`)
      .send({
        password: PASSWORD,
        code: totpAt(account.secret, account.usedStep + 1),
      });
    expect(ok.status).toBe(200);
    expect((await login(account.mobile)).body.data.accessToken).toBeTruthy();
  });

  it('another admin can reset it for someone who lost their phone, but not their own', async () => {
    const locked = await withTwoFactor();
    const helper = await withTwoFactor();

    const own = await api()
      .delete(`/auth/2fa/users/${helper.id}`)
      .set('Authorization', `Bearer ${helper.token}`);
    expect(own.status).toBe(403);

    const reset = await api()
      .delete(`/auth/2fa/users/${locked.id}`)
      .set('Authorization', `Bearer ${helper.token}`);
    expect(reset.status).toBe(200);
    expect((await login(locked.mobile)).body.data.accessToken).toBeTruthy();

    const [event] = await dataSource.query(
      "SELECT `entity_id` FROM `audit_logs` WHERE `action` = 'security.two_factor_reset' ORDER BY `id` DESC LIMIT 1",
    );
    expect(Number(event.entity_id)).toBe(locked.id);
  });

  it('is for staff only', async () => {
    const customer = await admin(userRoleEnum.NormalUser);
    const token = (await login(customer.mobile)).body.data.accessToken;
    expect(token).toBeTruthy();
    const res = await api()
      .post('/auth/2fa/setup')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('when required, an admin without it is walked through setup before any session', async () => {
    process.env.ADMIN_TWO_FACTOR = 'required';
    try {
      const account = await admin();
      const first = await login(account.mobile);
      expect(first.status).toBe(200);
      expect(first.body.data.twoFactor).toBe('setup');
      expect(first.body.data.accessToken).toBeUndefined();
      const { secret } = first.body.data.setup as { secret: string };

      const done = await api()
        .post('/auth/2fa/login')
        .send({
          challengeToken: first.body.data.challengeToken,
          code: totpAt(secret, currentStep()),
        });
      expect(done.status).toBe(200);
      expect(done.body.data.accessToken).toBeTruthy();

      // From now on it asks for the code, and cannot be switched off.
      expect((await login(account.mobile)).body.data.twoFactor).toBe('verify');
      const off = await api()
        .post('/auth/2fa/disable')
        .set('Authorization', `Bearer ${done.body.data.accessToken}`)
        .send({ password: PASSWORD, code: totpAt(secret, currentStep() + 1) });
      expect(off.status).toBe(403);
      expect(off.body.code).toBe('TWO_FACTOR_REQUIRED');
    } finally {
      delete process.env.ADMIN_TWO_FACTOR;
    }
  });
});
