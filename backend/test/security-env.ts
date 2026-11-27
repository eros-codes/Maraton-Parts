// Imported first by security.e2e-spec.ts, before the app module: the
// configuration reads CORS_ORIGIN once, when that module loads, so the
// allowed origins have to be in place by then - as they are in production.
export const SHOP_ORIGIN = 'https://shop.e2e.test';
export const PANEL_ORIGIN = 'https://admin.shop.e2e.test';
export const previousCorsOrigin = process.env.CORS_ORIGIN;
process.env.CORS_ORIGIN = `${SHOP_ORIGIN},${PANEL_ORIGIN}`;
