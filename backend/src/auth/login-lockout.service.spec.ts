import { DataSource, Repository } from 'typeorm';
import {
  FAILED_LOGIN_WINDOW_MS,
  LoginLockoutService,
  MAX_FAILED_LOGINS,
  lockDurationMs,
} from './login-lockout.service';
import { LoginLockout } from './entities/login-lockout.entity';
import { SecurityEventsService } from '../audit/security-events.service';
import { ErrorCodes } from '../common/errors/error-codes';
import { User } from '../users/entities/user.entity';

// An in-memory stand-in for the login_lockouts table.
function setup() {
  const rows = new Map<string, LoginLockout>();
  const repo = {
    findOneBy: jest.fn(({ mobile }: { mobile: string }) =>
      Promise.resolve(rows.get(mobile) ?? null),
    ),
    findOne: jest.fn(({ where }: { where: { mobile: string } }) =>
      Promise.resolve(rows.get(where.mobile) ?? null),
    ),
    findOneOrFail: jest.fn(({ where }: { where: { mobile: string } }) =>
      Promise.resolve(rows.get(where.mobile)!),
    ),
    insert: jest.fn((row: LoginLockout) => {
      rows.set(row.mobile, { ...row, updated_at: new Date() });
      return Promise.resolve();
    }),
    update: jest.fn(
      ({ mobile }: { mobile: string }, patch: Partial<LoginLockout>) => {
        rows.set(mobile, { ...rows.get(mobile)!, ...patch });
        return Promise.resolve();
      },
    ),
    delete: jest.fn(({ mobile }: { mobile: string }) => {
      rows.delete(mobile);
      return Promise.resolve();
    }),
  };
  const dataSource = {
    transaction: (work: (manager: unknown) => Promise<unknown>) =>
      work({ getRepository: () => repo }),
  } as unknown as DataSource;
  const record = jest.fn().mockResolvedValue(undefined);
  const owners = new Map<string, { id: number; role: string }>();
  const users = {
    findOne: jest.fn(({ where }: { where: { mobile: string } }) =>
      Promise.resolve(owners.get(where.mobile) ?? null),
    ),
  };
  const service = new LoginLockoutService(
    repo as unknown as Repository<LoginLockout>,
    dataSource,
    { record } as unknown as SecurityEventsService,
    users as unknown as Repository<User>,
  );
  return { service, rows, record, owners };
}

const MOBILE = '09121112233';

describe('LoginLockoutService', () => {
  it(`locks the number on the ${MAX_FAILED_LOGINS}th wrong password`, async () => {
    const { service, record } = setup();
    for (let i = 1; i < MAX_FAILED_LOGINS; i += 1) {
      await service.recordFailure(MOBILE);
    }
    await expect(service.assertNotLocked(MOBILE)).resolves.toBeUndefined();

    await expect(
      service.recordFailure(MOBILE, '1.1.1.1'),
    ).rejects.toMatchObject({ code: ErrorCodes.ACCOUNT_LOCKED });
    await expect(service.assertNotLocked(MOBILE)).rejects.toMatchObject({
      code: ErrorCodes.ACCOUNT_LOCKED,
      status: 429,
    });
    expect(record).toHaveBeenCalledWith(
      'security.login_locked',
      expect.objectContaining({ key: MOBILE, ip: '1.1.1.1', lockNumber: 1 }),
      {},
    );
  });

  it('alerts the owner when the locked number is an admin', async () => {
    const { service, record, owners } = setup();
    owners.set(MOBILE, { id: 3, role: 'admin' });
    for (let i = 1; i < MAX_FAILED_LOGINS; i += 1) {
      await service.recordFailure(MOBILE);
    }
    await expect(service.recordFailure(MOBILE)).rejects.toBeDefined();
    expect(record).toHaveBeenCalledWith(
      'security.login_locked',
      expect.objectContaining({ userId: 3 }),
      { alert: 'admin_login_locked', subject: MOBILE },
    );
  });

  it('only logs (no alert) when it is a customer', async () => {
    const { service, record } = setup();
    for (let i = 1; i <= MAX_FAILED_LOGINS; i += 1) {
      await service.recordFailure(MOBILE).catch(() => undefined);
    }
    expect(record.mock.calls[0][2]).toEqual({});
  });

  it('forgets old failures once the window has passed', async () => {
    const { service, rows } = setup();
    for (let i = 1; i < MAX_FAILED_LOGINS; i += 1) {
      await service.recordFailure(MOBILE);
    }
    rows.get(MOBILE)!.window_started_at = new Date(
      Date.now() - FAILED_LOGIN_WINDOW_MS - 1000,
    );
    await expect(service.recordFailure(MOBILE)).resolves.toBeUndefined();
    expect(rows.get(MOBILE)!.failed_attempts).toBe(1);
  });

  it('lets the number in again when the lock runs out', async () => {
    const { service, rows } = setup();
    for (let i = 1; i < MAX_FAILED_LOGINS; i += 1) {
      await service.recordFailure(MOBILE);
    }
    await expect(service.recordFailure(MOBILE)).rejects.toBeDefined();
    rows.get(MOBILE)!.locked_until = new Date(Date.now() - 1000);
    await expect(service.assertNotLocked(MOBILE)).resolves.toBeUndefined();
  });

  it('makes every following lock longer, up to a day', () => {
    expect(lockDurationMs(1)).toBe(15 * 60 * 1000);
    expect(lockDurationMs(2)).toBe(30 * 60 * 1000);
    expect(lockDurationMs(3)).toBe(60 * 60 * 1000);
    expect(lockDurationMs(20)).toBe(24 * 60 * 60 * 1000);
  });

  it('clears everything after a correct sign-in', async () => {
    const { service, rows } = setup();
    await service.recordFailure(MOBILE);
    await service.clear(MOBILE);
    expect(rows.has(MOBILE)).toBe(false);
  });
});
