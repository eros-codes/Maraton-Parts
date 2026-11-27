import * as Joi from 'joi';

// Every environment variable the API reads, checked at boot: a missing or
// unsafe value stops the process with a message saying what to fix,
// instead of a shop that runs with a hole in it.

// The example values shipped in .env.example and deploy/env. Long enough
// to pass a length check, so they are refused by name: a shop running on
// a secret printed in its own repository has no secret at all.
const PLACEHOLDER_SECRETS = [
  'change-me-to-a-long-random-string-at-least-32-chars',
  'change-me-to-a-different-long-random-string-32-chars',
  'CHANGE_ME',
  'change-me',
  'changeme',
  'secret',
  'password',
];

const PLACEHOLDER_PATTERN = new RegExp(
  `^(?:${PLACEHOLDER_SECRETS.map((v) => v.replace(/[-]/g, '\\-')).join('|')})$|change[-_]?me`,
  'i',
);

// At least 32 characters everywhere; in production the example values
// are refused as well (a local copy of .env.example still boots).
const secret = (name: string) => {
  const base = Joi.string().min(32).required();
  const messages = {
    'string.min': `${name} must be at least 32 random characters`,
    'string.pattern.invert.base': `${name} is still the example value - generate a random one (openssl rand -hex 32)`,
  };
  return Joi.when('NODE_ENV', {
    is: 'production',
    then: base
      .pattern(PLACEHOLDER_PATTERN, { invert: true })
      .messages(messages),
    otherwise: base.messages(messages),
  });
};
export const envValidationSchema = Joi.object({
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().required(),
  DB_USERNAME: Joi.string().required(),
  // A real password in production: the shop's whole database sits
  // behind it.
  DB_PASSWORD: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .min(12)
      .invalid(...PLACEHOLDER_SECRETS)
      .required()
      .messages({
        'string.min':
          'DB_PASSWORD must be at least 12 characters in production',
        'any.invalid':
          'DB_PASSWORD is still the example value - set a real one',
      }),
    otherwise: Joi.string().allow('').required(),
  }),
  DB_DATABASE: Joi.string().required(),
  DB_POOL_SIZE: Joi.number().default(10),
  JWT_SECRET_KEY: secret('JWT_SECRET_KEY'),
  JWT_EXPIRATION: Joi.string().default('15m'),
  REFRESH_TOKEN_EXPIRATION_DAYS: Joi.number().default(30),
  OTP_EXPIRATION_MINUTES: Joi.number().default(5),
  OTP_HASH_SECRET: secret('OTP_HASH_SECRET')
    .invalid(Joi.ref('JWT_SECRET_KEY'))
    .messages({
      'any.invalid':
        'OTP_HASH_SECRET must be different from JWT_SECRET_KEY - generate a second random string',
    }),
  PORT: Joi.number().default(3000),
  // Who needs the authenticator-app code at sign-in: "required" (every
  // admin) or "optional" (admins who turned it on). Empty: required in
  // production, optional elsewhere and on a public demo.
  ADMIN_TWO_FACTOR: Joi.string().valid('required', 'optional', '').optional(),
  // Instant alerts about admin-account events (see SecurityAlertsService).
  SECURITY_ALERT_MOBILES: Joi.string()
    .pattern(/^\s*09\d{9}\s*(,\s*09\d{9}\s*)*$/)
    .allow('')
    .optional()
    .messages({
      'string.pattern.base':
        'SECURITY_ALERT_MOBILES must be mobile numbers like 09123456789, separated by commas',
    }),
  SMSIR_SECURITY_ALERT_TEMPLATE_ID: Joi.string().allow('').optional(),
  ALERT_BOT_TOKEN: Joi.string().allow('').optional(),
  ALERT_BOT_CHAT_ID: Joi.string().allow('').optional(),
  ALERT_BOT_API: Joi.string()
    .uri({ scheme: ['https'] })
    .allow('')
    .optional(),
  // Interface to listen on. Empty: 127.0.0.1 in production (nginx on the
  // same machine is the only caller), every interface elsewhere.
  HOST: Joi.string().allow('').optional(),
  CORS_ORIGIN: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().invalid('*').required().messages({
      'any.invalid':
        'CORS_ORIGIN must not be "*" in production - set it to your real frontend domain(s)',
      'any.required':
        'CORS_ORIGIN must be set to your real frontend domain(s) in production',
    }),
    otherwise: Joi.string().default('*'),
  }),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  SENTRY_DSN: Joi.string().optional().allow(''),
  SMSIR_API_KEY: Joi.string().optional().allow(''),
  SMSIR_OTP_TEMPLATE_ID: Joi.string().optional().allow(''),
  SMSIR_ACCOUNT_EXISTS_TEMPLATE_ID: Joi.string().optional().allow(''),
  ZARINPAL_MERCHANT_ID: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(36).required().messages({
      'any.required':
        'ZARINPAL_MERCHANT_ID is required in production (the 36-character merchant id from your ZarinPal panel)',
      'string.min':
        'ZARINPAL_MERCHANT_ID does not look like a real merchant id',
      'string.empty':
        'ZARINPAL_MERCHANT_ID is required in production (the 36-character merchant id from your ZarinPal panel)',
    }),
    otherwise: Joi.string().allow('').default(''),
  }),
  // A public portfolio demo runs as a real production build (secure
  // cookies, migrations, no schema sync, no Swagger) but has no
  // merchant account and must never take real money. DEMO_MODE is the
  // one explicit switch for that: it allows the sandbox gateway and the
  // demo seed, and nothing else. A real shop leaves it unset.
  DEMO_MODE: Joi.boolean().default(false),
  ZARINPAL_MODE: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.when('DEMO_MODE', {
      is: Joi.valid(true, 'true'),
      then: Joi.string().valid('sandbox', 'production').default('sandbox'),
      otherwise: Joi.string()
        .valid('production')
        .default('production')
        .messages({
          'any.only':
            'ZARINPAL_MODE must be "production" when NODE_ENV=production - sandbox payments never collect real money (set DEMO_MODE=true only for a public demo)',
        }),
    }),
    otherwise: Joi.string().valid('sandbox', 'production').default('sandbox'),
  }),
  BACKEND_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .uri({ scheme: ['https'] })
      .pattern(/^https:\/\/(?!localhost|127\.0\.0\.1)/)
      .required()
      .messages({
        'string.pattern.base':
          'BACKEND_URL must be the public HTTPS address of this API in production - payment callbacks are built from it',
        'string.uri.scheme':
          'BACKEND_URL must be an https:// URL in production',
      }),
    otherwise: Joi.string().default('http://localhost:3000'),
  }),
  FRONTEND_URL: Joi.string().optional().allow(''),
  UPLOAD_DIR: Joi.string().default('uploads'),
  ZARINPAL_TIMEOUT_MS: Joi.number().integer().min(1000).default(10000),
  PAYMENT_WINDOW_MINUTES: Joi.number().integer().min(1).default(15),
  ZARINPAL_API_BASE: Joi.string().optional().allow(''),
  ZARINPAL_GATEWAY_BASE: Joi.string().optional().allow(''),
  TAX_RATE_PERCENT: Joi.number().min(0).max(100).default(10),
  RETURN_WINDOW_DAYS: Joi.number().integer().min(0).max(365).default(7),
  COD_MAX_AMOUNT: Joi.number().integer().min(0).default(20000000),
  // The shop's own details, shown on the storefront's contact and
  // legal pages (GET /shop/info). All optional: an empty one is
  // simply left off the page.
  SHOP_LEGAL_NAME: Joi.string().allow('').optional(),
  SHOP_PHONE: Joi.string().allow('').optional(),
  SHOP_EMAIL: Joi.string().email().allow('').optional(),
  SHOP_ADDRESS: Joi.string().allow('').optional(),
  SHOP_SUPPORT_HOURS: Joi.string().allow('').optional(),
  // Linked from every page, so only https addresses are accepted.
  SHOP_INSTAGRAM_URL: Joi.string()
    .uri({ scheme: ['https'] })
    .allow('')
    .optional(),
  SHOP_TELEGRAM_URL: Joi.string()
    .uri({ scheme: ['https'] })
    .allow('')
    .optional(),
  ENAMAD_ID: Joi.string().pattern(/^\d+$/).allow('').optional(),
  ENAMAD_CODE: Joi.string()
    .pattern(/^[A-Za-z0-9]+$/)
    .allow('')
    .optional(),
  TRUST_PROXY: Joi.string().allow('').default(''),
  THROTTLE_STORAGE: Joi.string().valid('memory', 'database').default('memory'),
  THROTTLE_LIMIT_PER_MINUTE: Joi.number().integer().min(1).default(600),
  // An empty value - as .env.example ships these two - means "use the
  // default", like every other optional setting here.
  SWAGGER_ENABLED: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().truthy('true').falsy('false').empty('').default(false),
    otherwise: Joi.boolean()
      .truthy('true')
      .falsy('false')
      .empty('')
      .default(true),
  }),
  // Published docs in production must sit behind basic auth: they are
  // a map of every route and DTO.
  SWAGGER_USER: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.when('SWAGGER_ENABLED', {
      is: true,
      then: Joi.string().min(3).required().messages({
        'any.required':
          'SWAGGER_USER and SWAGGER_PASSWORD are required when SWAGGER_ENABLED=true in production',
      }),
      otherwise: Joi.string().allow('').default(''),
    }),
    otherwise: Joi.string().allow('').default(''),
  }),
  SWAGGER_PASSWORD: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.when('SWAGGER_ENABLED', {
      is: true,
      then: Joi.string().min(12).required().messages({
        'any.required':
          'SWAGGER_USER and SWAGGER_PASSWORD are required when SWAGGER_ENABLED=true in production',
        'string.min': 'SWAGGER_PASSWORD must be at least 12 characters',
      }),
      otherwise: Joi.string().allow('').default(''),
    }),
    otherwise: Joi.string().allow('').default(''),
  }),
  SENTRY_TRACES_SAMPLE_RATE: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.number().min(0).max(1).empty('').default(0.1),
    otherwise: Joi.number().min(0).max(1).empty('').default(1),
  }),
});
