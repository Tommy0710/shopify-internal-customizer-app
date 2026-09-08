import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as authStart } from "@/app/api/auth/route";
import { GET as authCallback } from "@/app/api/auth/callback/route";

/**
 * `shop` is interpolated into a redirect host in /api/auth and into the host of
 * a fetch carrying `client_secret` in /api/auth/callback. Both must reject
 * anything that is not a real *.myshopify.com domain — the callback before its
 * HMAC check, which WK_SKIP_HMAC can switch off on a developer machine.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

function get(url: string): any {
  return new Request(url);
}

describe("shop parameter validation", () => {
  it("400s /api/auth for a host outside myshopify.com", async () => {
    const res = await authStart(get("https://app.test/api/auth?shop=evil.example.com"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid shop domain" });
  });

  it("redirects /api/auth to the shop for a valid domain", async () => {
    vi.stubEnv("SHOPIFY_API_KEY", "key");
    vi.stubEnv("SHOPIFY_APP_URL", "https://app.test");
    const res = await authStart(
      get("https://app.test/api/auth?shop=wildandking-demo.myshopify.com"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(
      /^https:\/\/wildandking-demo\.myshopify\.com\/admin\/oauth\/authorize\?/,
    );
  });

  it("400s the OAuth callback for a host outside myshopify.com, even with HMAC skipped", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WK_SKIP_HMAC", "1");
    vi.stubEnv("SHOPIFY_API_SECRET", "a_real_looking_secret");
    const res = await authCallback(
      get("https://app.test/api/auth/callback?shop=evil.example.com&code=abc&hmac=deadbeef"),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid shop domain" });
  });
});
