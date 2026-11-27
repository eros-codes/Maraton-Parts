import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AdminTwoFactor } from '../entities/admin-two-factor.entity';
import { User } from '../../users/entities/user.entity';
import userRoleEnum from '../../users/enums/userRoleEnum';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/error-codes';
import { isDemoMode } from '../../common/demo/demo-accounts';
import { SecurityEventsService } from '../../audit/security-events.service';
import { LoginLockoutService } from '../login-lockout.service';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp';
import { openSecret, sealSecret } from './secret-box';

// Second factor for admin accounts: a six-digit code from an authenticator
// app, asked for after the password.
//
// ADMIN_TWO_FACTOR decides who must have one:
//   required - every admin. One without it is walked through setup at the
//              next sign-in, before the panel opens. The default in
//              production (except on a public demo).
//   optional - only the admins who turned it on in the panel. The default
//              everywhere else, so development and the demo work as before.
//
// Sign-in becomes two calls. The password call answers with a short-lived
// challenge instead of tokens; the code call exchanges the challenge and a
// correct code for the session. Wrong codes count towards the same lock as
// wrong passwords (five, then locked), so having the password alone buys
// five guesses at a million codes.

export type TwoFactorStage = 'verify' | 'setup';

export interface TwoFactorChallenge {
  twoFactor: TwoFactorStage;
  challengeToken: string;
  // Only on setup: what the authenticator app needs.
  setup?: { secret: string; otpauthUrl: string };
}

interface ChallengePayload {
  sub: number;
  purpose: 'two-factor';
  stage: TwoFactorStage;
}

const CHALLENGE_MINUTES = 5;
const ISSUER = 'Maraton Parts';

@Injectable()
export class TwoFactorService {
  constructor(
    @InjectRepository(AdminTwoFactor)
    private readonly records: Repository<AdminTwoFactor>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly lockouts: LoginLockoutService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  get required(): boolean {
    const mode = (this.config.get<string>('ADMIN_TWO_FACTOR') ?? '').trim();
    if (mode === 'required') return true;
    if (mode === 'optional') return false;
    return this.config.get('NODE_ENV') === 'production' && !isDemoMode();
  }

  async status(
    userId: number,
  ): Promise<{ enabled: boolean; required: boolean }> {
    const record = await this.records.findOneBy({ user_id: userId });
    return { enabled: !!record?.enabled_at, required: this.required };
  }

  // Called by sign-in once the password checked out. null = no second step
  // (not an admin, or an admin without it while it is optional).
  async challengeFor(user: User): Promise<TwoFactorChallenge | null> {
    if (user.role !== userRoleEnum.AdminUser) return null;
    const record = await this.records.findOneBy({ user_id: user.id });
    const enabled = !!record?.enabled_at;
    const secret = enabled && record?.secret ? this.open(record.secret) : null;

    if (secret)
      return {
        twoFactor: 'verify',
        challengeToken: this.sign(user.id, 'verify'),
      };
    // Off, and allowed to be: no second step.
    if (!enabled && !this.required) return null;

    // Required but not set up - or on, but its secret no longer opens
    // because OTP_HASH_SECRET changed: set it up now, before the panel
    // opens. Never a silent fall back to password only.
    const setup = await this.beginSetup(user);
    return {
      twoFactor: 'setup',
      challengeToken: this.sign(user.id, 'setup'),
      setup,
    };
  }

  // The second call of sign-in. Returns the user to issue a session for.
  async completeChallenge(
    challengeToken: string,
    code: string,
    ip?: string | null,
  ): Promise<User> {
    const payload = this.readChallenge(challengeToken);
    const user = await this.users.findOne({
      where: { id: payload.sub },
      select: { id: true, mobile: true, role: true, display_name: true },
    });
    if (!user || user.role !== userRoleEnum.AdminUser)
      throw this.challengeExpired();

    await this.lockouts.assertNotLocked(user.mobile);
    const ok =
      payload.stage === 'setup'
        ? await this.confirmPending(user, code, ip)
        : await this.checkCode(user.id, code);
    if (!ok) {
      await this.lockouts.recordFailure(user.mobile, ip);
      throw this.wrongCode();
    }
    await this.lockouts.clear(user.mobile);
    return user;
  }

  // From the panel's security page, for an admin turning it on while it is
  // optional (or replacing the app it is on).
  async beginSetup(
    user: Pick<User, 'id' | 'mobile'>,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    if (isDemoMode()) {
      throw new AppError(
        ErrorCodes.DEMO_ACCOUNT_LOCKED,
        'Two-step sign-in cannot be turned on in the public demo - it would lock every visitor out of the shared admin account',
        HttpStatus.FORBIDDEN,
      );
    }
    const secret = generateTotpSecret();
    await this.records.upsert(
      { user_id: user.id, pending_secret: this.seal(secret) },
      ['user_id'],
    );
    return { secret, otpauthUrl: otpauthUrl(secret, user.mobile, ISSUER) };
  }

  // The panel's "set up / move to a new phone". Moving it needs a code from
  // the current app, so a stolen access token cannot quietly put the
  // second factor on someone else's phone.
  async beginSetupFromPanel(
    user: Pick<User, 'id' | 'mobile'>,
    currentCode: string | undefined,
    ip?: string | null,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const record = await this.records.findOneBy({ user_id: user.id });
    if (record?.enabled_at) {
      await this.lockouts.assertNotLocked(user.mobile);
      if (!currentCode || !(await this.checkCode(user.id, currentCode))) {
        await this.lockouts.recordFailure(user.mobile, ip);
        throw this.wrongCode();
      }
    }
    return this.beginSetup(user);
  }

  // The first code from the app proves it was set up right; only then is
  // the new secret the one sign-in asks for.
  async confirmPending(
    user: Pick<User, 'id' | 'mobile'>,
    code: string,
    ip?: string | null,
  ): Promise<boolean> {
    const record = await this.records.findOneBy({ user_id: user.id });
    const secret = record?.pending_secret
      ? this.open(record.pending_secret)
      : null;
    if (!record || !secret) {
      throw AppError.badRequest(
        ErrorCodes.TWO_FACTOR_NOT_STARTED,
        'Start the setup first - no authenticator secret is waiting to be confirmed',
      );
    }
    const step = verifyTotp(secret, code);
    if (step === null) return false;
    await this.records.update(
      { user_id: user.id },
      {
        secret: record.pending_secret,
        pending_secret: null,
        enabled_at: new Date(),
        last_used_step: step,
      },
    );
    await this.securityEvents.record(
      'security.two_factor_enabled',
      { key: `user:${user.id}`, userId: user.id, ip: ip ?? null },
      { alert: 'two_factor_enabled', subject: user.mobile },
    );
    return true;
  }

  // From the security page: the first code after beginSetup. A wrong one
  // counts towards the sign-in lock like any other.
  async enable(
    user: Pick<User, 'id' | 'mobile'>,
    code: string,
    ip?: string | null,
  ): Promise<void> {
    await this.lockouts.assertNotLocked(user.mobile);
    if (!(await this.confirmPending(user, code, ip))) {
      await this.lockouts.recordFailure(user.mobile, ip);
      throw this.wrongCode();
    }
  }

  // Signed in already, from the security page: needs the password and a
  // current code, so a stolen access token alone cannot switch it off.
  async disable(
    userId: number,
    password: string,
    code: string,
    ip?: string | null,
  ): Promise<void> {
    if (this.required) {
      throw new AppError(
        ErrorCodes.TWO_FACTOR_REQUIRED,
        'Two-step sign-in is required for every admin on this shop and cannot be turned off',
        HttpStatus.FORBIDDEN,
      );
    }
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, mobile: true, password: true },
    });
    if (!user) throw this.challengeExpired();
    await this.lockouts.assertNotLocked(user.mobile);
    const passwordOk = await bcrypt.compare(password, user.password);
    const codeOk = passwordOk && (await this.checkCode(userId, code));
    if (!codeOk) {
      await this.lockouts.recordFailure(user.mobile, ip);
      throw passwordOk
        ? this.wrongCode()
        : AppError.unauthorized(
            ErrorCodes.CURRENT_PASSWORD_INCORRECT,
            'The current password is incorrect',
          );
    }
    await this.records.delete({ user_id: userId });
    await this.securityEvents.record(
      'security.two_factor_disabled',
      { key: `user:${userId}`, userId, ip: ip ?? null },
      { alert: 'two_factor_disabled', subject: user.mobile },
    );
  }

  // Another admin, for someone who lost their phone. They set it up again
  // at their next sign-in (when required) or from the panel.
  async reset(
    targetId: number,
    actorId: number,
    ip?: string | null,
  ): Promise<void> {
    if (targetId === actorId) {
      throw new AppError(
        ErrorCodes.CANNOT_CHANGE_OWN_ROLE,
        'Ask another admin to reset your own two-step sign-in',
        HttpStatus.FORBIDDEN,
      );
    }
    const target = await this.users.findOne({
      where: { id: targetId },
      select: { id: true, mobile: true },
    });
    if (!target) throw this.challengeExpired();
    await this.records.delete({ user_id: targetId });
    await this.securityEvents.record(
      'security.two_factor_reset',
      {
        key: `user:${targetId}`,
        userId: targetId,
        ip: ip ?? null,
        by: actorId,
      },
      { alert: 'two_factor_reset', subject: target.mobile },
    );
  }

  private async checkCode(userId: number, code: string): Promise<boolean> {
    const record = await this.records.findOneBy({ user_id: userId });
    const secret =
      record?.enabled_at && record.secret ? this.open(record.secret) : null;
    if (!record || !secret) return false;
    const step = verifyTotp(secret, code, {
      lastUsedStep: record.last_used_step,
    });
    if (step === null) return false;
    // Conditional, so two requests with the same code cannot both pass.
    const result = await this.records
      .createQueryBuilder()
      .update(AdminTwoFactor)
      .set({ last_used_step: step })
      .where(
        'user_id = :userId AND (last_used_step IS NULL OR last_used_step < :step)',
        {
          userId,
          step,
        },
      )
      .execute();
    return !!result.affected;
  }

  // Signed with a key of its own, so a challenge can never pass for an
  // access token (and the JWT strategy refuses the purpose as well).
  private challengeSecret(): string {
    return `${this.config.getOrThrow<string>('JWT_SECRET_KEY')}:two-factor-challenge`;
  }

  private sign(userId: number, stage: TwoFactorStage): string {
    const payload: ChallengePayload = {
      sub: userId,
      purpose: 'two-factor',
      stage,
    };
    return this.jwt.sign(payload, {
      secret: this.challengeSecret(),
      expiresIn: `${CHALLENGE_MINUTES}m`,
      algorithm: 'HS256',
    });
  }

  private readChallenge(token: string): ChallengePayload {
    try {
      const payload = this.jwt.verify<ChallengePayload>(token, {
        secret: this.challengeSecret(),
        algorithms: ['HS256'],
      });
      if (payload.purpose !== 'two-factor') throw new Error('wrong purpose');
      return payload;
    } catch {
      throw this.challengeExpired();
    }
  }

  private masterSecret(): string {
    return this.config.getOrThrow<string>('OTP_HASH_SECRET');
  }

  private seal(secret: string): string {
    return sealSecret(secret, this.masterSecret());
  }

  private open(sealed: string): string | null {
    return openSecret(sealed, this.masterSecret());
  }

  private wrongCode(): AppError {
    return AppError.unauthorized(
      ErrorCodes.TWO_FACTOR_INCORRECT,
      'The code from the authenticator app is not correct',
    );
  }

  private challengeExpired(): AppError {
    return AppError.unauthorized(
      ErrorCodes.TWO_FACTOR_CHALLENGE_EXPIRED,
      'This sign-in took too long - enter your password again',
    );
  }
}
