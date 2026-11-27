import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Time-based one-time codes (RFC 6238), as Google Authenticator,
// Microsoft Authenticator, Authy and every other authenticator app make
// them: HMAC-SHA1 of a 30-second step counter, six digits.

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
// One step either side: a phone clock a little off, or a code typed in the
// last seconds of its window, still works.
const DRIFT_STEPS = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('Not a base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 160 random bits, the size RFC 4226 recommends.
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(
  secret: string,
  step: number,
  digits = TOTP_DIGITS,
): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

// The step the code belongs to, or null when it matches none. A step at or
// before `lastUsedStep` is refused: a code works once, so one read over
// someone's shoulder (or out of a log) cannot be used again.
export function verifyTotp(
  secret: string,
  code: string,
  options: { now?: number; lastUsedStep?: number | null } = {},
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = currentStep(options.now);
  const given = Buffer.from(code);
  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    const step = now + drift;
    if (options.lastUsedStep != null && step <= options.lastUsedStep) continue;
    const expected = Buffer.from(totpAt(secret, step));
    if (timingSafeEqual(given, expected)) return step;
  }
  return null;
}

// What the authenticator app reads from the QR code.
export function otpauthUrl(
  secret: string,
  account: string,
  issuer: string,
): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
