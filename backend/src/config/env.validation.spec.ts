import { envValidationSchema } from './env.validation';

const SECRET_A = 'a1'.repeat(32);
const SECRET_B = 'b2'.repeat(32);

const base = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USERNAME: 'shop',
  DB_PASSWORD: '',
  DB_DATABASE: 'shop',
  JWT_SECRET_KEY: SECRET_A,
  OTP_HASH_SECRET: SECRET_B,
};

const production = {
  ...base,
  NODE_ENV: 'production',
  DB_PASSWORD: 'a-long-real-database-password',
  CORS_ORIGIN: 'https://shop.example.ir',
  BACKEND_URL: 'https://shop.example.ir/api',
  ZARINPAL_MERCHANT_ID: '12345678-1234-1234-1234-123456789012',
};

const check = (env: Record<string, string>) =>
  envValidationSchema.validate(env, { allowUnknown: true }).error?.message;

describe('environment validation', () => {
  it('accepts a sensible development setup', () => {
    expect(check(base)).toBeUndefined();
  });

  it('accepts a complete production setup', () => {
    expect(check(production)).toBeUndefined();
  });

  it('refuses short secrets everywhere', () => {
    expect(check({ ...base, JWT_SECRET_KEY: 'short' })).toMatch(
      /JWT_SECRET_KEY must be at least 32/,
    );
  });

  it('refuses the same value for both secrets', () => {
    expect(check({ ...base, OTP_HASH_SECRET: SECRET_A })).toMatch(
      /must be different from JWT_SECRET_KEY/,
    );
  });

  it('refuses the example secrets in production', () => {
    expect(
      check({
        ...production,
        JWT_SECRET_KEY: 'change-me-to-a-long-random-string-at-least-32-chars',
      }),
    ).toMatch(/still the example value/);
  });

  it('refuses a weak database password in production', () => {
    expect(check({ ...production, DB_PASSWORD: 'root' })).toMatch(
      /DB_PASSWORD must be at least 12/,
    );
  });

  it('refuses CORS "*" and plain-http callbacks in production', () => {
    expect(check({ ...production, CORS_ORIGIN: '*' })).toMatch(/CORS_ORIGIN/);
    expect(
      check({ ...production, BACKEND_URL: 'http://shop.example.ir/api' }),
    ).toMatch(/BACKEND_URL/);
  });

  it('refuses public API docs in production without credentials', () => {
    expect(check({ ...production, SWAGGER_ENABLED: 'true' })).toMatch(
      /SWAGGER_USER and SWAGGER_PASSWORD are required/,
    );
    expect(
      check({
        ...production,
        SWAGGER_ENABLED: 'true',
        SWAGGER_USER: 'docs',
        SWAGGER_PASSWORD: 'a-long-docs-password',
      }),
    ).toBeUndefined();
  });

  it('refuses the sandbox gateway in a real production shop', () => {
    expect(check({ ...production, ZARINPAL_MODE: 'sandbox' })).toMatch(
      /ZARINPAL_MODE/,
    );
  });
});
