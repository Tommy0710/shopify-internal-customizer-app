import { afterEach, describe, expect, it, vi } from "vitest";
import { hmacBypassEnabled, verifyShopifyProxySignature } from "@/lib/hmac";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hmacBypassEnabled", () => {
  it("is off when the variable is unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WK_SKIP_HMAC", "");
    expect(hmacBypassEnabled()).toBe(false);
  });

  it("is off for any value other than the exact string 1", () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const value of ["true", "yes", "0", "01", " 1"]) {
      vi.stubEnv("WK_SKIP_HMAC", value);
      expect(hmacBypassEnabled()).toBe(false);
    }
  });

  it("is on outside production when explicitly set to 1", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WK_SKIP_HMAC", "1");
    expect(hmacBypassEnabled()).toBe(true);
  });

  it("throws rather than disabling verification in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WK_SKIP_HMAC", "1");
    expect(() => hmacBypassEnabled()).toThrow(/production/i);
  });
});

describe("verifyShopifyProxySignature", () => {
  it("rejects a request with no signature even when no secret is configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    const params = new URLSearchParams({ shop: "wildandking-demo.myshopify.com" });
    expect(verifyShopifyProxySignature(params, "")).toBe(false);
  });

  it("accepts a correctly signed request", async () => {
    const { createHmac } = await import("node:crypto");
    const secret = "test_secret";
    const params = new URLSearchParams({
      productId: "8129384729101",
      shop: "wildandking-demo.myshopify.com",
    });
    const message = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("");
    params.set("signature", createHmac("sha256", secret).update(message).digest("hex"));
    expect(verifyShopifyProxySignature(params, secret)).toBe(true);
  });

  it("rejects a tampered request", () => {
    const params = new URLSearchParams({
      productId: "999",
      shop: "wildandking-demo.myshopify.com",
      signature: "deadbeef",
    });
    expect(verifyShopifyProxySignature(params, "test_secret")).toBe(false);
  });
});
