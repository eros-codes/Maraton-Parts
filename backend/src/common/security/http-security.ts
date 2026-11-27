import type { NextFunction, Request, Response } from 'express';

// Transport-level protections, applied in main.ts (see app.setup.ts).

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopback(address: string | undefined): boolean {
  return !!address && LOOPBACK.has(address);
}

// Production answers only over HTTPS.
//
// The API itself never terminates TLS - nginx does, and passes the scheme
// on in X-Forwarded-Proto. So a request counts as secure when:
//   - Express already says so (TRUST_PROXY set, header from a trusted proxy), or
//   - it came straight from this machine with X-Forwarded-Proto: https
//     (nginx on the same host, even if TRUST_PROXY was left out), or
//   - it came straight from this machine with no proxy header at all: a
//     health check or script on the server itself (deploy.sh does this),
//     which never crossed the network.
// Anything else - plain HTTP through nginx before certbot ran, or someone
// reaching port 3000 from outside - is refused with 403. No redirect: the
// address to redirect to would have to come from the Host header, which
// the client controls. nginx (certbot) does the http -> https redirect.
export function httpsOnly(
  enabled: boolean,
  onRejected?: (request: Request) => void,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!enabled || request.secure) return next();

    const peer = request.socket?.remoteAddress;
    const forwardedRaw = request.headers['x-forwarded-proto'];
    const forwarded = (
      Array.isArray(forwardedRaw) ? forwardedRaw[0] : (forwardedRaw ?? '')
    )
      .split(',')[0]
      .trim()
      .toLowerCase();

    if (isLoopback(peer) && (forwarded === 'https' || forwarded === '')) {
      return next();
    }

    onRejected?.(request);
    response.status(403).json({
      statusCode: 403,
      code: 'HTTPS_REQUIRED',
      data: null,
      message: 'This API only answers over HTTPS',
    });
  };
}

// Headers helmet does not set, on every API response.
export function extraSecurityHeaders() {
  return (request: Request, response: Response, next: NextFunction) => {
    // The API never needs any of these browser features.
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    );
    // Anything personal - every signed-in request, and the auth routes that
    // hand out tokens - must never be kept by a browser or a shared cache.
    const path = request.path ?? '';
    if (request.headers.authorization || path.startsWith('/auth')) {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Pragma', 'no-cache');
    }
    next();
  };
}
