import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/cart/validate/route";

/**
 * This route writes Design and DesignSelection rows. It used to accept any
 * caller. The guard now runs before every `db` call, so no database is needed.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

function post(url: string, body: unknown): any {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/cart/validate", () => {
  it("401s a request with no App Proxy signature", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WK_SKIP_HMAC", "");
    vi.stubEnv("SHOPIFY_API_SECRET", "test_secret");
    const res = await POST(post("https://app.test/api/cart/validate", { productId: "1" }));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Invalid HMAC signature" });
  });

  it("401s a request whose signature does not match", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WK_SKIP_HMAC", "");
    vi.stubEnv("SHOPIFY_API_SECRET", "test_secret");
    const res = await POST(
      post(
        "https://app.test/api/cart/validate?shop=wildandking-demo.myshopify.com&signature=deadbeef",
        { productId: "1" },
      ),
    );
    expect(res.status).toBe(401);
  });

  it("401s even when no secret is configured at all", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WK_SKIP_HMAC", "");
    vi.stubEnv("SHOPIFY_API_SECRET", "");
    const res = await POST(
      post("https://app.test/api/cart/validate?signature=deadbeef", { productId: "1" }),
    );
    expect(res.status).toBe(401);
  });
});
