import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { withAdminSession } from "@/lib/auth/withAdminSession";

/**
 * `withAdminSession` là cách duy nhất được phép viết handler `/api/admin/*`
 * (xem comment ở nguồn). Điểm mấu chốt cần test không phải "trả đúng status"
 * — `requireAdminSession` đã có test riêng cho việc đó — mà là: khi guard
 * chặn, handler bên trong KHÔNG BAO GIỜ chạy. Đó là lý do wrapper tồn tại.
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

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://example.test/api/admin/probe", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("withAdminSession", () => {
  it("401s an unauthenticated request and never invokes the inner handler", async () => {
    useEnv();
    const inner = vi.fn(async () => Response.json({ ok: true }));
    const route = withAdminSession(inner);

    const res = await route(req());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "MISSING_TOKEN" });
    expect(inner).not.toHaveBeenCalled();
  });

  it("403s a shop outside WK_ALLOWED_SHOPS and never invokes the inner handler", async () => {
    useEnv();
    const inner = vi.fn(async () => Response.json({ ok: true }));
    const route = withAdminSession(inner);

    const res = await route(
      req({ authorization: `Bearer ${await mintToken("intruder.myshopify.com")}` }),
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "SHOP_NOT_ALLOWED" });
    expect(inner).not.toHaveBeenCalled();
  });

  it("invokes the inner handler exactly once with the session for a valid token", async () => {
    useEnv();
    const inner = vi.fn(async (_req: NextRequest, ctx: { session: { shopDomain: string; userId: string } }) =>
      Response.json({ shop: ctx.session.shopDomain }),
    );
    const route = withAdminSession(inner);

    const res = await route(req({ authorization: `Bearer ${await mintToken()}` }));

    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner.mock.calls[0][1]).toEqual({ session: { shopDomain: SHOP, userId: "42" } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ shop: SHOP });
  });
});
