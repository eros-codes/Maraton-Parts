import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';
import { SecurityEventsService } from '../../audit/security-events.service';

// The header both apps send on every API call. Its value does not matter:
// a page on another site cannot add a custom header to a request without a
// CORS preflight, and the preflight is refused for any origin not in
// CORS_ORIGIN. So its presence proves the request came from our own code.
export const CSRF_HEADER = 'x-requested-with';

export function allowedOrigins(config: ConfigService): string[] | null {
  const raw = (config.get<string>('CORS_ORIGIN') ?? '*').trim();
  if (raw === '*' || raw === '') return null;
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// Protects the routes that authenticate with the refresh-token COOKIE
// (refresh, logout). Every other route takes its access token from the
// Authorization header, which a browser never attaches on its own, so
// those cannot be forged from another site at all.
//
// The cookie is already SameSite=Lax, which stops other *sites* from
// sending it on a POST. This closes what Lax leaves open - another app on
// a sibling subdomain counts as the same site - and does not depend on
// the browser honouring SameSite:
//   1. the custom header must be present, and
//   2. if the browser says where the request came from (Origin, or
//      Sec-Fetch-Site), that must be one of our own origins.
@Injectable()
export class CookieCsrfGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const reason = this.rejection(request);
    if (!reason) return true;

    await this.securityEvents.record('security.csrf_rejected', {
      key: `ip:${request.ip ?? 'unknown'}`,
      ip: request.ip ?? null,
      path: request.originalUrl ?? request.url,
      origin: request.headers.origin ?? null,
      reason,
    });
    throw new AppError(
      ErrorCodes.CSRF_REJECTED,
      'This request did not come from the shop itself',
      HttpStatus.FORBIDDEN,
    );
  }

  private rejection(request: Request): string | null {
    const header = request.headers[CSRF_HEADER];
    if (typeof header !== 'string' || header.trim() === '') {
      return 'missing X-Requested-With header';
    }

    const origin = request.headers.origin;
    const allowed = allowedOrigins(this.config);
    if (origin && allowed && !allowed.includes(origin.replace(/\/+$/, ''))) {
      return 'origin not allowed';
    }
    // Sent by every current browser; "cross-site" means another site
    // entirely made this request.
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      return 'cross-site request';
    }
    return null;
  }
}
