import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LoginLockout } from './entities/login-lockout.entity';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/errors/error-codes';
import { isDuplicateEntryError } from '../common/database/mysql-errors';
import { SecurityEventsService } from '../audit/security-events.service';
import { User } from '../users/entities/user.entity';
import userRoleEnum from '../users/enums/userRoleEnum';

// Five wrong passwords for one number within fifteen minutes lock password
// sign-in for that number. The first lock lasts 15 minutes and every lock
// after it doubles, up to a day, until a correct sign-in (or a password
// reset by SMS code) clears the record. The per-number rate limit on the
// route stops bursts; this stops the slow, patient kind that the rate
// limit's window lets through, and survives a restart.
export const MAX_FAILED_LOGINS = 5;
export const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;

export function lockDurationMs(lockCount: number): number {
  return Math.min(BASE_LOCK_MS * 2 ** Math.max(0, lockCount - 1), MAX_LOCK_MS);
}

@Injectable()
export class LoginLockoutService {
  constructor(
    @InjectRepository(LoginLockout)
    private readonly lockouts: Repository<LoginLockout>,
    private readonly dataSource: DataSource,
    private readonly securityEvents: SecurityEventsService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  // Throws while the number is locked. Called before the password is even
  // looked at, so a correct guess during a lock tells the guesser nothing.
  async assertNotLocked(mobile: string): Promise<void> {
    const row = await this.lockouts.findOneBy({ mobile });
    if (row?.locked_until && row.locked_until.getTime() > Date.now()) {
      throw this.lockedError(row.locked_until);
    }
  }

  async recordFailure(mobile: string, ip?: string | null): Promise<void> {
    const lockedUntil = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(LoginLockout);
      const now = new Date();
      let row = await repo.findOne({
        where: { mobile },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) {
        try {
          await repo.insert({
            mobile,
            failed_attempts: 1,
            window_started_at: now,
            locked_until: null,
            lock_count: 0,
          });
          return null;
        } catch (error) {
          // Two failures for a new number at once: the other one created
          // the row; count this one against it.
          if (!isDuplicateEntryError(error)) throw error;
          row = await repo.findOneOrFail({
            where: { mobile },
            lock: { mode: 'pessimistic_write' },
          });
        }
      }

      const windowExpired =
        now.getTime() - row.window_started_at.getTime() >
        FAILED_LOGIN_WINDOW_MS;
      const attempts = windowExpired ? 1 : row.failed_attempts + 1;

      if (attempts >= MAX_FAILED_LOGINS) {
        const lockCount = row.lock_count + 1;
        const until = new Date(now.getTime() + lockDurationMs(lockCount));
        await repo.update(
          { mobile },
          {
            failed_attempts: 0,
            window_started_at: now,
            locked_until: until,
            lock_count: lockCount,
          },
        );
        return { until, lockCount };
      }

      await repo.update(
        { mobile },
        {
          failed_attempts: attempts,
          window_started_at: windowExpired ? now : row.window_started_at,
        },
      );
      return null;
    });

    if (lockedUntil) {
      // Someone guessing at a customer's password is logged; at an admin's,
      // the owner hears about it straight away.
      const owner = await this.users.findOne({
        where: { mobile },
        select: { id: true, role: true },
      });
      const isAdmin = owner?.role === userRoleEnum.AdminUser;
      await this.securityEvents.record(
        'security.login_locked',
        {
          key: mobile,
          userId: owner?.id ?? null,
          ip: ip ?? null,
          lockedUntil: lockedUntil.until.toISOString(),
          lockNumber: lockedUntil.lockCount,
        },
        isAdmin ? { alert: 'admin_login_locked', subject: mobile } : {},
      );
      throw this.lockedError(lockedUntil.until);
    }
  }

  async clear(mobile: string): Promise<void> {
    await this.lockouts.delete({ mobile });
  }

  private lockedError(until: Date): AppError {
    const retryAfter = Math.max(
      1,
      Math.ceil((until.getTime() - Date.now()) / 1000),
    );
    return new AppError(
      ErrorCodes.ACCOUNT_LOCKED,
      `Too many wrong passwords for this number - sign-in is locked for ${Math.ceil(retryAfter / 60)} minute(s). Resetting the password by SMS unlocks it.`,
      HttpStatus.TOO_MANY_REQUESTS,
      { retryAfter },
    );
  }
}
