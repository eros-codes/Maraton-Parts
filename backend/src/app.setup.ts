import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { ServerResponse } from 'http';
import { createValidationPipe } from './common/validation/persian-validation';
import { resolveUploadRoot } from './common/storage/local-file-storage';
import {
  extraSecurityHeaders,
  httpsOnly,
} from './common/security/http-security';
import { CSRF_HEADER } from './common/security/csrf.guard';
import { SecurityEventsService } from './audit/security-events.service';

// Everything main.ts does to the app before it listens, apart from the API
// docs. Kept in one function so the security e2e suite boots the app with
// exactly the same middleware production runs.
export function configureApp(app: NestExpressApplication): void {
  const isProduction = process.env.NODE_ENV === 'production';

  // Express says "X-Powered-By: Express" by default; helmet removes it too,
  // but this keeps it off even for anything answered before helmet runs.
  app.disable('x-powered-by');

  const trustProxy = (process.env.TRUST_PROXY ?? '').trim();
  if (trustProxy && trustProxy !== 'false') {
    app.set(
      // Behind a reverse proxy the client IP arrives in a header; without this
      // every rate limit would count the proxy as one caller.
      'trust proxy',
      /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy,
    );
  }

  // First of all: in production nothing is answered over plain HTTP.
  const securityEvents = app.get(SecurityEventsService, { strict: false });
  app.use(
    httpsOnly(isProduction, (request) => {
      void securityEvents.record('security.insecure_request_rejected', {
        key: `ip:${request.ip ?? 'unknown'}`,
        ip: request.ip ?? null,
        path: request.path,
      });
    }),
  );

  app.use(
    helmet({
      // A year, for this host and its subdomains (admin.<shop host>).
      // Browsers only honour it over HTTPS, so it is harmless in development.
      strictTransportSecurity: {
        maxAge: 31_536_000,
        includeSubDomains: true,
      },
      // The API serves JSON, images and the tiny link-preview page - none of
      // which may be framed by anyone.
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(extraSecurityHeaders());
  app.use(cookieParser());

  app.useStaticAssets(resolveUploadRoot(process.env.UPLOAD_DIR), {
    prefix: '/uploads',
    // Never list a directory, never serve dotfiles (.env, .git) even if one
    // ended up in the upload folder.
    dotfiles: 'deny',
    index: false,
    // Uploaded files are data, never pages: the sandbox CSP stops anything
    // stored here from running script on this origin, and the explicit
    // cross-origin policy keeps product images usable from a frontend on
    // another domain.
    setHeaders: (res: ServerResponse) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });

  // Production refuses "*" at boot (see app.module.ts), so there only the
  // listed origins may call the API with cookies. Methods and headers are
  // limited to what the two apps actually send.
  const corsOrigin = process.env.CORS_ORIGIN ?? '*';
  app.enableCors({
    origin:
      corsOrigin === '*'
        ? true
        : corsOrigin.split(',').map((o) => o.trim().replace(/\/+$/, '')),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      CSRF_HEADER,
    ],
    maxAge: 600,
  });

  app.useGlobalPipes(createValidationPipe());
}
