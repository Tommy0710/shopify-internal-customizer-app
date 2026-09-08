import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";

const API_KEY = "21102b2e2138173c5ab87e5ad38ef1e4";
const API_SECRET = "test_secret_that_is_long_enough_for_hs256";
const SHOP = "wildandking-demo.myshopify.com";

function useEnv() {
  vi.stubEnv("SHOPIFY_API_KEY", API_KEY);
  vi.stubEnv("SHOPIFY_API_SECRET", API_SECRET);
  vi.stubEnv("WK_ALLOWED_SHOPS", `${SHOP}, another-shop.myshopify.com`);
}

async function mintToken(shop = SHOP): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: API_KEY,
    sub: "42",
    nbf: now - 10,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(now + 60)
    .sign(new TextEncoder().encode(API_SECRET));
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/admin/products", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireAdminSession", () => {
  it("returns the session for a valid Bearer token", async () => {
    useEnv();
    const result = await requireAdminSession(
      request({ authorization: `Bearer ${await mintToken()}` }),
    );
    expect(result).toEqual({ session: { shopDomain: SHOP, userId: "42" } });
  });

  it("accepts a lowercase bearer scheme", async () => {
    useEnv();
    const result = await requireAdminSession(
      request({ authorization: `bearer ${await mintToken()}` }),
    );
    expect("session" in result).toBe(true);
  });

  it("returns 401 when the Authorization header is absent", async () => {
    useEnv();
    const result = await requireAdminSession(request());
    expect("response" in result).toBe(true);
    if (!("response" in result)) throw new Error("expected a response");
    expect(result.response.status).toBe(401);
    await expect(result.response.json()).resolves.toEqual({ error: "MISSING_TOKEN" });
  });

  it("returns 401 when the scheme is not Bearer", async () => {
    useEnv();
    const result = await requireAdminSession(
      request({ authorization: `Basic ${await mintToken()}` }),
    );
    if (!("response" in result)) throw new Error("expected a response");
    expect(result.response.status).toBe(401);
  });

  it("returns 401 for a token this app did not sign", async () => {
    useEnv();
    const result = await requireAdminSession(
      request({ authorization: "Bearer not.a.jwt" }),
    );
    if (!("response" in result)) throw new Error("expected a response");
    expect(result.response.status).toBe(401);
    await expect(result.response.json()).resolves.toEqual({ error: "INVALID_TOKEN" });
  });

  it("returns 403 for a shop outside the allowlist", async () => {
    useEnv();
    const result = await requireAdminSession(
      request({ authorization: `Bearer ${await mintToken("intruder.myshopify.com")}` }),
    );
    if (!("response" in result)) throw new Error("expected a response");
    expect(result.response.status).toBe(403);
    await expect(result.response.json()).resolves.toEqual({ error: "SHOP_NOT_ALLOWED" });
  });

  it("matches the allowlist case-insensitively", async () => {
    vi.stubEnv("SHOPIFY_API_KEY", API_KEY);
    vi.stubEnv("SHOPIFY_API_SECRET", API_SECRET);
    // `new URL().host` is lowercase, so an operator typing mixed case here
    // used to lock everyone out with no error to read.
    vi.stubEnv("WK_ALLOWED_SHOPS", " WildAndKing-Demo.MyShopify.com ");
    const result = await requireAdminSession(
      request({ authorization: `Bearer ${await mintToken()}` }),
    );
    expect(result).toEqual({ session: { shopDomain: SHOP, userId: "42" } });
  });

  it("returns 401 when SHOPIFY_API_SECRET is unset", async () => {
    vi.stubEnv("SHOPIFY_API_KEY", API_KEY);
    vi.stubEnv("SHOPIFY_API_SECRET", "");
    vi.stubEnv("WK_ALLOWED_SHOPS", SHOP);
    const forged = await new SignJWT({
      iss: `https://${SHOP}/admin`,
      dest: `https://${SHOP}`,
      aud: API_KEY,
      sub: "42",
      nbf: Math.floor(Date.now() / 1000) - 10,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(new TextEncoder().encode(""));
    const result = await requireAdminSession(request({ authorization: `Bearer ${forged}` }));
    if (!("response" in result)) throw new Error("expected a response");
    expect(result.response.status).toBe(401);
  });

  it("denies every shop when WK_ALLOWED_SHOPS is unset", async () => {
    vi.stubEnv("SHOPIFY_API_KEY", API_KEY);
    vi.stubEnv("SHOPIFY_API_SECRET", API_SECRET);
    vi.stubEnv("WK_ALLOWED_SHOPS", "");
    const result = await requireAdminSession(
      request({ authorization: `Bearer ${await mintToken()}` }),
    );
    if (!("response" in result)) throw new Error("expected a response");
    expect(result.response.status).toBe(403);
  });
});
