import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { PhoneThrottle } from '../common/throttler/phone-throttle';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from './decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password.dto';
import {
  REFRESH_TOKEN_COOKIE,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
} from './utils/refresh-token-cookie';
import { ApiTags } from '@nestjs/swagger';
import { CookieCsrfGuard } from '../common/security/csrf.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import userRoleEnum from '../users/enums/userRoleEnum';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { TwoFactorService } from './two-factor/two-factor.service';
import {
  DisableTwoFactorDto,
  TwoFactorCodeDto,
  TwoFactorSetupDto,
  TwoFactorLoginDto,
} from './dto/two-factor.dto';

const MINUTE = 60_000;

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  // Per number: the real limit. Per IP: only a ceiling on one address
  // sending codes to a list of numbers - generous, because a whole
  // carrier can sit behind one address.
  @PhoneThrottle(
    { limit: 5, ttl: 10 * MINUTE },
    { limit: 30, ttl: 10 * MINUTE },
  )
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    const result = await this.authService.register(registerDto);
    return {
      data: result,
      message: 'Verification code sent',
    };
  }

  @PhoneThrottle(
    { limit: 10, ttl: 10 * MINUTE },
    { limit: 60, ttl: 10 * MINUTE },
  )
  @Post('verify-otp')
  async verifyOtp(
    @Body() verifyOtpDto: VerifyOtpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { user, accessToken, refreshToken } =
      await this.authService.verifyOtp(verifyOtpDto);
    setRefreshTokenCookie(response, refreshToken, this.configService);
    return {
      data: { user, accessToken },
      message: 'Account verified and created successfully',
    };
  }

  @PhoneThrottle({ limit: 10, ttl: 10 * MINUTE }, { limit: 30, ttl: MINUTE })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(loginDto, request.ip);
    // An admin with two-step sign-in: no session yet, only the challenge
    // to answer at POST /auth/2fa/login.
    if ('challengeToken' in result) {
      return {
        data: result,
        message:
          result.twoFactor === 'setup'
            ? 'Set up the authenticator app to finish signing in'
            : 'Enter the code from the authenticator app',
      };
    }
    setRefreshTokenCookie(response, result.refreshToken, this.configService);
    return {
      data: { accessToken: result.accessToken },
      message: 'User logged in successfully',
    };
  }

  // Step two of an admin's sign-in. Wrong codes count towards the same
  // five-strike lock as wrong passwords.
  @Throttle({ default: { limit: 30, ttl: MINUTE } })
  @HttpCode(HttpStatus.OK)
  @Post('2fa/login')
  async twoFactorLogin(
    @Body() dto: TwoFactorLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.twoFactor.completeChallenge(
      dto.challengeToken,
      dto.code,
      request.ip,
    );
    const { accessToken, refreshToken } = await this.authService.signIn(user);
    setRefreshTokenCookie(response, refreshToken, this.configService);
    return { data: { accessToken }, message: 'User logged in successfully' };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(userRoleEnum.AdminUser)
  @Get('2fa')
  async twoFactorStatus(@CurrentUser() currentUser: CurrentUserPayload) {
    return {
      data: await this.twoFactor.status(currentUser.userId),
      message: 'Two-step sign-in status',
    };
  }

  // Turning it on (or moving it to a new phone): a new secret to scan,
  // confirmed by the first code from it.
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(userRoleEnum.AdminUser)
  @Post('2fa/setup')
  async twoFactorSetup(
    @Body() dto: TwoFactorSetupDto,
    @Req() request: Request,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    const setup = await this.twoFactor.beginSetupFromPanel(
      { id: currentUser.userId, mobile: currentUser.mobile },
      dto.code,
      request.ip,
    );
    return { data: setup, message: 'Scan the code with the authenticator app' };
  }

  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(userRoleEnum.AdminUser)
  @HttpCode(HttpStatus.OK)
  @Post('2fa/enable')
  async twoFactorEnable(
    @Body() dto: TwoFactorCodeDto,
    @Req() request: Request,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    await this.twoFactor.enable(
      { id: currentUser.userId, mobile: currentUser.mobile },
      dto.code,
      request.ip,
    );
    return { message: 'Two-step sign-in is on' };
  }

  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(userRoleEnum.AdminUser)
  @HttpCode(HttpStatus.OK)
  @Post('2fa/disable')
  async twoFactorDisable(
    @Body() dto: DisableTwoFactorDto,
    @Req() request: Request,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    await this.twoFactor.disable(
      currentUser.userId,
      dto.password,
      dto.code,
      request.ip,
    );
    return { message: 'Two-step sign-in is off' };
  }

  // For an admin who lost their phone - done by another admin.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(userRoleEnum.AdminUser)
  @Delete('2fa/users/:id')
  async twoFactorReset(
    @Param('id', ParseIdPipe) id: number,
    @Req() request: Request,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    await this.twoFactor.reset(id, currentUser.userId, request.ip);
    return { message: 'Two-step sign-in was reset for this account' };
  }

  // Authenticated by the cookie alone, so it needs the CSRF check (see
  // CookieCsrfGuard).
  @UseGuards(CookieCsrfGuard)
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = (
      request.cookies as Record<string, string> | undefined
    )?.[REFRESH_TOKEN_COOKIE];
    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token cookie found');
    }
    const tokens = await this.authService.refresh(refreshToken);
    setRefreshTokenCookie(response, tokens.refreshToken, this.configService);
    return {
      data: { accessToken: tokens.accessToken },
      message: 'Token refreshed successfully',
    };
  }

  // "I forgot my password": a code goes to the number. The answer is the
  // same whether or not an account exists, so this cannot be used to
  // find out which numbers are registered.
  @PhoneThrottle(
    { limit: 5, ttl: 10 * MINUTE },
    { limit: 30, ttl: 10 * MINUTE },
  )
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const result = await this.authService.forgotPassword(dto.mobile);
    return {
      data: result,
      message: 'If an account exists for this number, a code has been sent',
    };
  }

  @PhoneThrottle(
    { limit: 10, ttl: 10 * MINUTE },
    { limit: 60, ttl: 10 * MINUTE },
  )
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return { message: 'Password changed - please sign in again' };
  }

  // Changing it while signed in: the current password is required, and
  // every session is signed out afterwards. Throttled because a stolen
  // access token could otherwise be used to guess the current password.
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @UseGuards(JwtAuthGuard)
  @Patch('password')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() currentUser: CurrentUserPayload,
  ) {
    await this.authService.changePassword(
      currentUser.userId,
      dto.currentPassword,
      dto.newPassword,
    );
    return { message: 'Password changed - please sign in again' };
  }

  @UseGuards(CookieCsrfGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = (
      request.cookies as Record<string, string> | undefined
    )?.[REFRESH_TOKEN_COOKIE];
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    clearRefreshTokenCookie(response);
    return { message: 'Logged out successfully' };
  }
}
