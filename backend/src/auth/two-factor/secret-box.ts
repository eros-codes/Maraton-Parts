import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'crypto';

// The authenticator secrets are encrypted in the database (AES-256-GCM), so
// a leaked backup or a read-only SQL hole does not hand out working second
// factors. The key is derived from OTP_HASH_SECRET, which lives only in the
// env file: changing that secret makes every stored second factor
// unreadable, and the admins set theirs up again at the next sign-in.

function keyFrom(masterSecret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(masterSecret),
      Buffer.from('maraton-parts'),
      Buffer.from('admin-two-factor-secret'),
      32,
    ),
  );
}

export function sealSecret(plain: string, masterSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(masterSecret), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

// null when the value was sealed with another key or was tampered with.
export function openSecret(
  sealed: string,
  masterSecret: string,
): string | null {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFrom(masterSecret),
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
