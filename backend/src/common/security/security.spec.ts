import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { CookieCsrfGuard } from './csrf.guard';
import { extraSecurityHeaders, httpsOnly } from './http-security';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { SecurityEventsService } from '../../audit/security-events.service';
import userRoleEnum from '../../users/enums/userRoleEnum';
import { ErrorCodes } from '../errors/error-codes';

const config = (corsOrigin: string) =>
  ({ get: () => corsOrigin }) as unknown as ConfigService;

const httpContext = (request: Partial<Request>) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  }) as unknown as ExecutionContext;

const events = () => {
  const record = jest.fn().mockResolvedValue(undefined);
  return { record, service: { record } as unknown as SecurityEventsService };
};

describe('CookieCsrfGuard (refresh and logout)', () => {
  const shop = 'https://shop.example.ir';
  const guard = (origins = `${shop},https://admin.shop.example.ir`) => {
    const e = events();
    return { e, guard: new CookieCsrfGuard(config(origins), e.service) };
  };

  it('lets the apps through: header present, own origin', async () => {
    const { guard: g } = guard();
    await expect(
      g.canActivate(
        httpContext({
          headers: { 'x-requested-with': 'XMLHttpRequest', origin: shop },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('refuses a request without the custom header (a plain form post)', async () => {
    const { guard: g, e } = guard();
    await expect(
      g.canActivate(httpContext({ headers: { origin: shop }, ip: '5.6.7.8' })),
    ).rejects.toMatchObject({ code: ErrorCodes.CSRF_REJECTED });
    expect(e.record).toHaveBeenCalledWith(
      'security.csrf_rejected',
      expect.objectContaining({ ip: '5.6.7.8' }),
    );
  });

  it('refuses another origin even with the header', async () => {
    const { guard: g } = guard();
    await expect(
      g.canActivate(
        httpContext({
          headers: {
            'x-requested-with': 'x',
            origin: 'https://evil.example.ir',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.CSRF_REJECTED });
  });

  it('refuses what the browser itself labels cross-site', async () => {
    const { guard: g } = guard('*');
    await expect(
      g.canActivate(
        httpContext({
          headers: { 'x-requested-with': 'x', 'sec-fetch-site': 'cross-site' },
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.CSRF_REJECTED });
  });
});

describe('httpsOnly', () => {
  const run = (enabled: boolean, request: Partial<Request>) => {
    const next = jest.fn();
    const json = jest.fn();
    const response = {
      status: jest.fn(() => ({ json })),
    } as unknown as Response;
    const rejected = jest.fn();
    httpsOnly(enabled, rejected)(request as Request, response, next);
    return { next, response, json, rejected };
  };

  it('does nothing outside production', () => {
    const { next } = run(false, {
      secure: false,
      headers: {},
      socket: { remoteAddress: '8.8.8.8' } as never,
    });
    expect(next).toHaveBeenCalled();
  });

  it('accepts HTTPS from a trusted proxy', () => {
    const { next } = run(true, {
      secure: true,
      headers: {},
      socket: { remoteAddress: '127.0.0.1' } as never,
    });
    expect(next).toHaveBeenCalled();
  });

  it('accepts nginx on the same machine saying the client used https', () => {
    const { next } = run(true, {
      secure: false,
      headers: { 'x-forwarded-proto': 'https' },
      socket: { remoteAddress: '127.0.0.1' } as never,
    });
    expect(next).toHaveBeenCalled();
  });

  it('accepts a health check made on the server itself', () => {
    const { next } = run(true, {
      secure: false,
      headers: {},
      socket: { remoteAddress: '::1' } as never,
    });
    expect(next).toHaveBeenCalled();
  });

  it('refuses plain HTTP through the proxy', () => {
    const { next, response, rejected } = run(true, {
      secure: false,
      headers: { 'x-forwarded-proto': 'http' },
      socket: { remoteAddress: '127.0.0.1' } as never,
    });
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(rejected).toHaveBeenCalled();
  });

  it('refuses anyone reaching the port directly from outside', () => {
    const { next, response } = run(true, {
      secure: false,
      // A client cannot talk its way in by sending the header itself.
      headers: { 'x-forwarded-proto': 'https' },
      socket: { remoteAddress: '203.0.113.9' } as never,
    });
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
  });
});

describe('extraSecurityHeaders', () => {
  const run = (request: Partial<Request>) => {
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (name: string, value: string) => (headers[name] = value),
    } as unknown as Response;
    extraSecurityHeaders()(request as Request, response, jest.fn());
    return headers;
  };

  it('keeps signed-in answers and the auth routes out of every cache', () => {
    expect(
      run({ path: '/orders', headers: { authorization: 'Bearer x' } })[
        'Cache-Control'
      ],
    ).toBe('no-store');
    expect(run({ path: '/auth/login', headers: {} })['Cache-Control']).toBe(
      'no-store',
    );
  });

  it('leaves public catalogue answers cacheable', () => {
    const headers = run({ path: '/products', headers: {} });
    expect(headers['Cache-Control']).toBeUndefined();
    expect(headers['Permissions-Policy']).toContain('camera=()');
  });
});

describe('RolesGuard', () => {
  const reflectorFor = (roles: userRoleEnum[] | undefined) =>
    ({ getAllAndOverride: () => roles }) as unknown as Reflector;

  it('lets an admin through', async () => {
    const e = events();
    const guard = new RolesGuard(
      reflectorFor([userRoleEnum.AdminUser]),
      e.service,
    );
    await expect(
      guard.canActivate(
        httpContext({
          user: { role: userRoleEnum.AdminUser, userId: 1 },
        } as never),
      ),
    ).resolves.toBe(true);
    expect(e.record).not.toHaveBeenCalled();
  });

  it('refuses a customer on a staff route and records it', async () => {
    const e = events();
    const guard = new RolesGuard(
      reflectorFor([userRoleEnum.AdminUser]),
      e.service,
    );
    await expect(
      guard.canActivate(
        httpContext({
          user: { role: userRoleEnum.NormalUser, userId: 42 },
          method: 'GET',
          originalUrl: '/reports/summary?x=1',
          ip: '9.9.9.9',
        } as never),
      ),
    ).resolves.toBe(false);
    expect(e.record).toHaveBeenCalledWith(
      'security.admin_access_denied',
      expect.objectContaining({ userId: 42, route: 'GET /reports/summary' }),
    );
  });
});
