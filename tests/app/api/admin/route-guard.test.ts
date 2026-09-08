import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { GET as productsGet, POST as productsPost } from "@/app/api/admin/products/route";
import { GET as ordersGet, PATCH as ordersPatch } from "@/app/api/admin/orders/route";

/**
 * The guard is a hand-copied two-line prologue in every /api/admin/* handler,
 * with nothing at the type or lint level forcing it to be there. These tests
 * exercise the handlers themselves so a route that forgets it fails here.
 *
 * No database is needed: the guard returns before any `db` call and Prisma
 * connects lazily, so the module import is safe.
 */

const API_KEY = "21102b2e2138173c5ab87e5ad38ef1e4";
const API_SECRET = "test_secret_that_is_long_enough_for_hs256";
const SHOP = "wildandking-demo.myshopify.com";

function useEnv() {
  vi.stubEnv("SHOPIFY_API_KEY", API_KEY);
  vi.stubEnv("SHOPIFY_API_SECRET", API_SECRET);
  vi.stubEnv("WK_ALLOWED_SHOPS", SHOP);
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

function req(url: string, init: RequestInit = {}): any {
  return new Request(url, init);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const PRODUCTS = "https://app.test/api/admin/products";
const ORDERS = "https://app.test/api/admin/orders";

const routes: Array<[string, () => Promise<Response>]> = [
  ["GET /api/admin/products", () => productsGet(req(PRODUCTS))],
  [
    "POST /api/admin/products",
    () =>
      productsPost(
        req(PRODUCTS, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ shopifyProductId: "1", productTitle: "x" }),
        }),
      ),
  ],
  ["GET /api/admin/orders", () => ordersGet(req(ORDERS))],
  [
    "PATCH /api/admin/orders",
    () =>
      ordersPatch(
        req(ORDERS, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId: "job_1", status: "QC" }),
        }),
      ),
  ],
];

describe("/api/admin/* session guard", () => {
  for (const [name, call] of routes) {
    it(`401s an unauthenticated ${name}`, async () => {
      useEnv();
      const res = await call();
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: "MISSING_TOKEN" });
    });
  }

  it("401s a GET carrying a token this app did not sign", async () => {
    useEnv();
    const res = await productsGet(
      req(PRODUCTS, { headers: { authorization: "Bearer not.a.jwt" } }),
    );
    expect(res.status).toBe(401);
  });

  it("403s a GET from a shop outside the allowlist", async () => {
    useEnv();
    const res = await ordersGet(
      req(ORDERS, {
        headers: { authorization: `Bearer ${await mintToken("intruder.myshopify.com")}` },
      }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "SHOP_NOT_ALLOWED" });
  });
});
