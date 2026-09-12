/**
 * A Shopify shop domain, exactly as Shopify issues it:
 * `<handle>.myshopify.com`, nothing more.
 *
 * Anything that reaches a redirect target or a `fetch` URL built as
 * `https://${shop}/...` must pass through here first. Without it
 * `?shop=evil.example.com` turns `/api/auth` into an open redirect and
 * `/api/auth/callback` into a POST of `client_secret` to an attacker's host.
 */
const SHOP_DOMAIN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

export function isValidShopDomain(value: unknown): value is string {
  return typeof value === "string" && SHOP_DOMAIN.test(value);
}
