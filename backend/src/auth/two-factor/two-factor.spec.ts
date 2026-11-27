import {
  base32Decode,
  base32Encode,
  currentStep,
  generateTotpSecret,
  otpauthUrl,
  totpAt,
  verifyTotp,
} from './totp';
import { openSecret, sealSecret } from './secret-box';

// RFC 6238, appendix B: the SHA-1 secret is the ASCII string
// "12345678901234567890"; at T = 59 s the 8-digit code is 94287082.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(totpAt(RFC_SECRET, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(totpAt(RFC_SECRET, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(totpAt(RFC_SECRET, Math.floor(2000000000 / 30), 8)).toBe('69279037');
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from('any bytes at all');
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('accepts the current code and one step either side, nothing further', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = currentStep(now);
    expect(verifyTotp(secret, totpAt(secret, step), { now })).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), { now })).toBe(
      step - 1,
    );
    expect(verifyTotp(secret, totpAt(secret, step + 1), { now })).toBe(
      step + 1,
    );
    expect(verifyTotp(secret, totpAt(secret, step - 3), { now })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { now })).toBeNull();
  });

  it('refuses a code once used (replay)', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = currentStep(now);
    const code = totpAt(secret, step);
    expect(verifyTotp(secret, code, { now, lastUsedStep: step })).toBeNull();
  });

  it('builds the URL authenticator apps read', () => {
    const url = otpauthUrl('ABC234', '09120000001', 'Maraton Parts');
    expect(url).toMatch(/^otpauth:\/\/totp\/Maraton%20Parts%3A09120000001\?/);
    expect(url).toContain('secret=ABC234');
    expect(url).toContain('issuer=Maraton+Parts');
  });
});

describe('secret box', () => {
  const master = 'x'.repeat(40);

  it('encrypts so the stored value does not contain the secret', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', master);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(openSecret(sealed, master)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('refuses another key and any tampering', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', master);
    expect(openSecret(sealed, 'y'.repeat(40))).toBeNull();
    const parts = sealed.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(openSecret(parts.join(':'), master)).toBeNull();
    expect(openSecret('garbage', master)).toBeNull();
  });
});
