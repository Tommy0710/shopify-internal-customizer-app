import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { withAdminSession } from "@/lib/auth/withAdminSession";
import { adminApi, type AdminApiContext } from "@/lib/admin/adminApi";
import { notFound } from "@/lib/admin/http";
import { db } from "@/lib/db";
import { resetDb, seedAsset, seedShop, TEST_SHOP } from "../helpers/db";
import { ADMIN_SHOP, adminRequest, useAdminEnv } from "../../tests/helpers/adminRequest";

/**
 * `adminApi` là lớp thứ hai của mọi route admin, luôn nằm bên trong
 * `withAdminSession`. Test này dựng một route thật tại chỗ bằng đúng hình mà
 * mọi route P2 sau này sẽ dùng — `withAdminSession(adminApi(handler))` — và
 * chạy nó trên Postgres thật, vì phần lõi (tra Shop, dịch lỗi P2002 thật) chỉ
 * có ý nghĩa khi chạm DB.
 */

function makeRoute<P extends Record<string, string | string[]> = Record<string, string | string[]>>(
  handler: (req: NextRequest, ctx: AdminApiContext<P>) => Promise<Response>,
) {
  return withAdminSession<P>(adminApi<P>(handler));
}

describe("adminApi — trên Postgres thật", () => {
  beforeEach(async () => {
    await resetDb();
    useAdminEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shop đã cài → handler nhận đúng shop.id, session.userId, params được chuyển tiếp", async () => {
    const shop = await seedShop();
    const route = makeRoute<{ id: string }>(async (_req, ctx) =>
      Response.json({ shopId: ctx.shop.id, userId: ctx.session.userId, params: ctx.params }),
    );

    const req = await adminRequest("https://app.test/api/admin/probe/abc");
    const res = await route(req, { params: { id: "abc" } });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ shopId: shop.id, userId: "42", params: { id: "abc" } });
  });

  it("shopDomain lưu khác hoa thường với token → vẫn tìm thấy shop (tra không phân biệt hoa thường)", async () => {
    const mixedCaseDomain = "WildAndKing-Demo.myshopify.com";
    const shop = await db.shop.create({ data: { shopDomain: mixedCaseDomain, accessToken: "test-access-token" } });
    const route = makeRoute(async (_req, ctx) => Response.json({ shopId: ctx.shop.id, shopDomain: ctx.shop.shopDomain }));

    // Token ký với domain thường (viết như Shopify sẽ gửi ở host); URL host luôn
    // lowercase, nên session.shopDomain sẽ là bản lowercase của ADMIN_SHOP.
    const req = await adminRequest("https://app.test/api/admin/probe", { shop: ADMIN_SHOP });
    const res = await route(req);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ shopId: shop.id, shopDomain: mixedCaseDomain });
  });

  it("shop trong allowlist nhưng không có hàng Shop → 409 SHOP_NOT_INSTALLED, handler không chạy", async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const route = makeRoute(handler);

    const req = await adminRequest("https://app.test/api/admin/probe");
    const res = await route(req);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "SHOP_NOT_INSTALLED" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("shop có hàng nhưng installed: false → 409 SHOP_NOT_INSTALLED", async () => {
    await db.shop.create({ data: { shopDomain: TEST_SHOP, accessToken: "test-access-token", installed: false } });
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const route = makeRoute(handler);

    const req = await adminRequest("https://app.test/api/admin/probe");
    const res = await route(req);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "SHOP_NOT_INSTALLED" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("handler ném notFound() → 404 { error: NOT_FOUND }", async () => {
    await seedShop();
    const route = makeRoute(async () => notFound());

    const req = await adminRequest("https://app.test/api/admin/probe");
    const res = await route(req);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "NOT_FOUND" });
  });

  it("P2002 thật từ Postgres (hai Leather trùng shopId+slug) → 409 CONFLICT kèm fields", async () => {
    const shop = await seedShop();
    const display = await seedAsset(shop.id, "DISPLAY");
    const texture = await seedAsset(shop.id, "TEXTURE");
    const route = makeRoute(async (_req, ctx) => {
      await db.leather.create({
        data: { shopId: ctx.shop.id, name: "Suede Brown", slug: "suede-brown", displayImageAssetId: display.id, textureImageAssetId: texture.id },
      });
      // Vi phạm @@unique([shopId, slug]) thật, không dựng lỗi tay.
      await db.leather.create({
        data: { shopId: ctx.shop.id, name: "Suede Brown 2", slug: "suede-brown", displayImageAssetId: display.id, textureImageAssetId: texture.id },
      });
      return Response.json({ ok: true });
    });

    const req = await adminRequest("https://app.test/api/admin/probe");
    const res = await route(req);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; fields: string[] };
    expect(body.error).toBe("CONFLICT");
    expect(body.fields.sort()).toEqual(["shopId", "slug"]);
  });

  it("handler ném lỗi lạ → lời gọi route reject, không bị nuốt thành 4xx", async () => {
    await seedShop();
    const route = makeRoute(async () => {
      throw new Error("boom");
    });

    const req = await adminRequest("https://app.test/api/admin/probe");

    await expect(route(req)).rejects.toThrow("boom");
  });

  it("không có token → 401, không chạm DB", async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const route = makeRoute(handler);

    const req = await adminRequest("https://app.test/api/admin/probe", { token: null });
    const res = await route(req);

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    // Không chạm DB: không có Shop nào được tạo trong test này, và route vẫn
    // 401 — nếu adminApi lỡ chạy trước khi guard, hành vi (409 thay vì 401,
    // hoặc một query) sẽ lộ ra ở status hoặc ở lần gọi handler phía trên.
    await expect(db.shop.count()).resolves.toBe(0);
  });
});
