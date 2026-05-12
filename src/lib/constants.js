export const HUBBLE_API_BASE_URL =
  process.env.HUBBLE_API_BASE_URL || "https://api.myhubble.money";

export const HUBBLE_AUTH_LOGIN_URL = `${HUBBLE_API_BASE_URL}/v1/partners/auth/login`;
export const HUBBLE_PARTNERS_PRODUCTS_URL = `${HUBBLE_API_BASE_URL}/v1/partners/products`;

export const CLOUDFRONT_BASE_URL =
  process.env.CLOUDFRONT_BASE_URL || "https://dxamcuehe5m0b.cloudfront.net";

export const HUBBLE_CLIENT_ID = process.env.HUBBLE_CLIENT_ID;
export const HUBBLE_CLIENT_SECRET = process.env.HUBBLE_CLIENT_SECRET;

export const HUBBLE_TOKEN_TTL_MS = 60 * 60 * 1000;
