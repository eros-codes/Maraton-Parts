import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CleanupService } from './cleanup.service';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { OtpVerification } from '../auth/entities/otp-verification.entity';
import { RateLimit } from '../common/throttler/rate-limit.entity';
import { LoginLockout } from '../auth/entities/login-lockout.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RefreshToken,
      OtpVerification,
      RateLimit,
      LoginLockout,
    ]),
  ],
  providers: [CleanupService],
})
export class CleanupModule {}
