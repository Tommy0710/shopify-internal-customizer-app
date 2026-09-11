import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { resetDb, seedAsset, seedShop, TEST_SHOP } from "../helpers/db";
import { adminRequest, useAdminEnv } from "../../tests/helpers/adminRequest";

// Route thật cho cả bốn nhóm attribute — CRUD dùng chung một hình, khác field.
import { GET as leathersList, POST as leathersCreate } from "@/app/api/admin/leathers/route";
import { PATCH as leatherPatch, DELETE as leatherArchive } from "@/app/api/admin/leathers/[id]/route";
import { POST as leathersReorder } from "@/app/api/admin/leathers/reorder/route";
import { GET as stitchesList, POST as stitchesCreate } from "@/app/api/admin/stitches/route";
import { GET as animalsList, POST as animalsCreate } from "@/app/api/admin/animals/route";
import { PATCH as animalPatch, DELETE as animalArchive } from "@/app/api/admin/animals/[id]/route";
import { GET as stylesList, POST as stylesCreate } from "@/app/api/admin/styles/route";

async function json(res: Response): Promise<any> {
  return res.json();
}

describe("Attributes API — Postgres thật", () => {
  beforeEach(async () => {
    await resetDb();
    useAdminEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("leathers — vòng đời đầy đủ", () => {
    it("create → list → patch → archive → idempotent archive → restore", async () => {
      const shop = await seedShop();
      const display = await seedAsset(shop.id, "DISPLAY");
      const texture = await seedAsset(shop.id, "TEXTURE");

      const createReq = await adminRequest("https://app.test/api/admin/leathers", {
        method: "POST",
        body: { name: "Suede Brown", displayImageAssetId: display.id, textureImageAssetId: texture.id },
      });
      const createRes = await leathersCreate(createReq);
      const created = await json(createRes);
      expect(createRes.status).toBe(201);
      expect(created.slug).toBe("suede-brown");
      expect(created.displayImage).toEqual({ assetId: display.id, url: display.publicUrl });
      expect(created.textureImage).toEqual({ assetId: texture.id, url: texture.publicUrl });

      const listReq = await adminRequest("https://app.test/api/admin/leathers");
      const listRes = await leathersList(listReq);
      const list = await json(listRes);
      expect(listRes.status).toBe(200);
      expect(list.items).toHaveLength(1);
      expect(list.items[0].id).toBe(created.id);

      const patchReq = await adminRequest(`https://app.test/api/admin/leathers/${created.id}`, {
        method: "PATCH",
        body: { name: "Suede Brown v2" },
      });
      const patchRes = await leatherPatch(patchReq, { params: { id: created.id } });
      const patched = await json(patchRes);
      expect(patchRes.status).toBe(200);
      expect(patched.name).toBe("Suede Brown v2");

      const archiveReq = await adminRequest(`https://app.test/api/admin/leathers/${created.id}`, { method: "DELETE" });
      const archiveRes = await leatherArchive(archiveReq, { params: { id: created.id } });
      const archived = await json(archiveRes);
      expect(archiveRes.status).toBe(200);
      expect(archived.archivedAt).not.toBeNull();

      const listDefaultReq = await adminRequest("https://app.test/api/admin/leathers");
      const listDefault = await json(await leathersList(listDefaultReq));
      expect(listDefault.items).toHaveLength(0);

      const listAllReq = await adminRequest("https://app.test/api/admin/leathers?includeArchived=true");
      const listAll = await json(await leathersList(listAllReq));
      expect(listAll.items).toHaveLength(1);

      const archiveAgainReq = await adminRequest(`https://app.test/api/admin/leathers/${created.id}`, { method: "DELETE" });
      const archiveAgainRes = await leatherArchive(archiveAgainReq, { params: { id: created.id } });
      const archivedAgain = await json(archiveAgainRes);
      expect(archiveAgainRes.status).toBe(200);
      expect(archivedAgain.archivedAt).toBe(archived.archivedAt);

      const restoreReq = await adminRequest(`https://app.test/api/admin/leathers/${created.id}`, {
        method: "PATCH",
        body: { archived: false },
      });
      const restoreRes = await leatherPatch(restoreReq, { params: { id: created.id } });
      const restored = await json(restoreRes);
      expect(restoreRes.status).toBe(200);
      expect(restored.archivedAt).toBeNull();
    });

    it("thiếu textureImageAssetId → 422 field textureImageAssetId", async () => {
      const shop = await seedShop();
      const display = await seedAsset(shop.id, "DISPLAY");
      const req = await adminRequest("https://app.test/api/admin/leathers", {
        method: "POST",
        body: { name: "X", displayImageAssetId: display.id },
      });
      const res = await leathersCreate(req);
      const body = await json(res);
      expect(res.status).toBe(422);
      expect(body.errors.some((e: any) => e.field === "textureImageAssetId")).toBe(true);
    });

    it("asset TEXTURE đưa vào chỗ displayImageAssetId → 422 invalid_asset", async () => {
      const shop = await seedShop();
      const texture = await seedAsset(shop.id, "TEXTURE");
      const texture2 = await seedAsset(shop.id, "TEXTURE");
      const req = await adminRequest("https://app.test/api/admin/leathers", {
        method: "POST",
        body: { name: "X", displayImageAssetId: texture.id, textureImageAssetId: texture2.id },
      });
      const res = await leathersCreate(req);
      const body = await json(res);
      expect(res.status).toBe(422);
      expect(body.errors).toEqual([expect.objectContaining({ field: "displayImageAssetId", code: "invalid_asset" })]);
    });

    it("asset của shop khác → 422 invalid_asset, không tiết lộ tồn tại", async () => {
      useAdminEnv([TEST_SHOP, "other-shop.myshopify.com"]);
      const shopA = await seedShop(TEST_SHOP);
      const shopB = await seedShop("other-shop.myshopify.com");
      const displayB = await seedAsset(shopB.id, "DISPLAY");
      const textureA = await seedAsset(shopA.id, "TEXTURE");
      const req = await adminRequest("https://app.test/api/admin/leathers", {
        method: "POST",
        body: { name: "X", displayImageAssetId: displayB.id, textureImageAssetId: textureA.id },
        shop: TEST_SHOP,
      });
      const res = await leathersCreate(req);
      const body = await json(res);
      expect(res.status).toBe(422);
      expect(body.errors).toEqual([expect.objectContaining({ field: "displayImageAssetId", code: "invalid_asset" })]);
    });

    it("slug trùng trong cùng shop → 409 CONFLICT; cùng slug ở shop khác → 201", async () => {
      useAdminEnv([TEST_SHOP, "other-shop.myshopify.com"]);
      const shopA = await seedShop(TEST_SHOP);
      const shopB = await seedShop("other-shop.myshopify.com");
      const displayA = await seedAsset(shopA.id, "DISPLAY");
      const textureA = await seedAsset(shopA.id, "TEXTURE");
      const displayB = await seedAsset(shopB.id, "DISPLAY");
      const textureB = await seedAsset(shopB.id, "TEXTURE");

      const req1 = await adminRequest("https://app.test/api/admin/leathers", {
        method: "POST",
        body: { name: "Suede Brown", displayImageAssetId: displayA.id, textureImageAssetId: textureA.id },
        shop: TEST_SHOP,
      });
      expect((await leathersCreate(req1)).status).toBe(201);

      const req2 = await adminRequest("https://app.test/api/admin/leathers", {
        method: "POST",
        body: { name: "Suede Brown", displayImageAssetId: displayA.id, textureImageAssetId: textureA.id },
        shop: TEST_SHOP,
      });
      const res2 = await leathersCreate(req2);
      const body2 = await json(res2);
      expect(res2.status).toBe(409);
      expect(body2.error).toBe("CONFLICT");

      const req3 = await adminRequest("https://app.test/api/admin/leathers", {
        method: "POST",
        body: { name: "Suede Brown", displayImageAssetId: displayB.id, textureImageAssetId: textureB.id },
        shop: "other-shop.myshopify.com",
      });
      expect((await leathersCreate(req3)).status).toBe(201);
    });
  });

  describe("stitches — colorHex", () => {
    it('colorHex "e7c337" → lưu "#E7C337"', async () => {
      await seedShop();
      const req = await adminRequest("https://app.test/api/admin/stitches", {
        method: "POST",
        body: { name: "Vàng cam", colorHex: "e7c337" },
      });
      const res = await stitchesCreate(req);
      const body = await json(res);
      expect(res.status).toBe(201);
      expect(body.colorHex).toBe("#E7C337");
    });

    it('colorHex "red" → 422', async () => {
      await seedShop();
      const req = await adminRequest("https://app.test/api/admin/stitches", {
        method: "POST",
        body: { name: "Đỏ", colorHex: "red" },
      });
      const res = await stitchesCreate(req);
      expect(res.status).toBe(422);
    });

    it("displayImageAssetId bỏ trống → 201", async () => {
      await seedShop();
      const req = await adminRequest("https://app.test/api/admin/stitches", {
        method: "POST",
        body: { name: "Trắng", colorHex: "#FFFFFF" },
      });
      const res = await stitchesCreate(req);
      const body = await json(res);
      expect(res.status).toBe(201);
      expect(body.displayImage).toBeNull();
    });
  });

  describe("reorder", () => {
    async function seedThreeLeathers(shopId: string) {
      const display = await seedAsset(shopId, "DISPLAY");
      const texture = await seedAsset(shopId, "TEXTURE");
      const rows = [];
      for (const name of ["A", "B", "C"]) {
        rows.push(
          await db.leather.create({
            data: { shopId, name, slug: name.toLowerCase(), displayImageAssetId: display.id, textureImageAssetId: texture.id },
          }),
        );
      }
      return rows;
    }

    it("đúng tập id → 200, sortOrder theo thứ tự", async () => {
      const shop = await seedShop();
      const [a, b, c] = await seedThreeLeathers(shop.id);
      const req = await adminRequest("https://app.test/api/admin/leathers/reorder", {
        method: "POST",
        body: { orderedIds: [c.id, a.id, b.id] },
      });
      const res = await leathersReorder(req);
      expect(res.status).toBe(200);

      const rows = await db.leather.findMany({ where: { shopId: shop.id }, orderBy: { sortOrder: "asc" } });
      expect(rows.map((r) => r.id)).toEqual([c.id, a.id, b.id]);
      expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
    });

    it("thiếu một id → 409 STALE_ORDER", async () => {
      const shop = await seedShop();
      const [a, b] = await seedThreeLeathers(shop.id);
      const req = await adminRequest("https://app.test/api/admin/leathers/reorder", {
        method: "POST",
        body: { orderedIds: [a.id, b.id] },
      });
      const res = await leathersReorder(req);
      const body = await json(res);
      expect(res.status).toBe(409);
      expect(body.error).toBe("STALE_ORDER");
    });

    it("thừa một id (không thuộc shop) → 409 STALE_ORDER", async () => {
      useAdminEnv([TEST_SHOP, "other-shop.myshopify.com"]);
      const shop = await seedShop(TEST_SHOP);
      const shopB = await seedShop("other-shop.myshopify.com");
      const [a, b, c] = await seedThreeLeathers(shop.id);
      const [x] = await seedThreeLeathers(shopB.id);
      const req = await adminRequest("https://app.test/api/admin/leathers/reorder", {
        method: "POST",
        body: { orderedIds: [a.id, b.id, c.id, x.id] },
        shop: TEST_SHOP,
      });
      const res = await leathersReorder(req);
      expect(res.status).toBe(409);
    });

    it("id trùng → 409 STALE_ORDER", async () => {
      const shop = await seedShop();
      const [a, b, c] = await seedThreeLeathers(shop.id);
      const req = await adminRequest("https://app.test/api/admin/leathers/reorder", {
        method: "POST",
        body: { orderedIds: [a.id, a.id, c.id] },
      });
      const res = await leathersReorder(req);
      expect(res.status).toBe(409);
    });

    it("hàng archived không bắt buộc có trong orderedIds", async () => {
      const shop = await seedShop();
      const [a, b, c] = await seedThreeLeathers(shop.id);
      await db.leather.update({ where: { id: c.id }, data: { archivedAt: new Date() } });
      const req = await adminRequest("https://app.test/api/admin/leathers/reorder", {
        method: "POST",
        body: { orderedIds: [b.id, a.id] },
      });
      const res = await leathersReorder(req);
      expect(res.status).toBe(200);
    });
  });

  describe("cô lập shop", () => {
    it("token shop B PATCH/DELETE leather của shop A → 404, hàng của A không đổi", async () => {
      useAdminEnv([TEST_SHOP, "other-shop.myshopify.com"]);
      const shopA = await seedShop(TEST_SHOP);
      await seedShop("other-shop.myshopify.com");
      const display = await seedAsset(shopA.id, "DISPLAY");
      const texture = await seedAsset(shopA.id, "TEXTURE");
      const leather = await db.leather.create({
        data: { shopId: shopA.id, name: "A", slug: "a", displayImageAssetId: display.id, textureImageAssetId: texture.id },
      });

      const patchReq = await adminRequest(`https://app.test/api/admin/leathers/${leather.id}`, {
        method: "PATCH",
        body: { name: "hacked" },
        shop: "other-shop.myshopify.com",
      });
      const patchRes = await leatherPatch(patchReq, { params: { id: leather.id } });
      expect(patchRes.status).toBe(404);

      const deleteReq = await adminRequest(`https://app.test/api/admin/leathers/${leather.id}`, {
        method: "DELETE",
        shop: "other-shop.myshopify.com",
      });
      const deleteRes = await leatherArchive(deleteReq, { params: { id: leather.id } });
      expect(deleteRes.status).toBe(404);

      const row = await db.leather.findUniqueOrThrow({ where: { id: leather.id } });
      expect(row.name).toBe("A");
      expect(row.archivedAt).toBeNull();
    });
  });

  describe("bảng dữ liệu cho cả bốn nhóm", () => {
    it("create hợp lệ tối thiểu → 201, GET thấy nó", async () => {
      const shop = await seedShop();
      const display = await seedAsset(shop.id, "DISPLAY");
      const texture = await seedAsset(shop.id, "TEXTURE");

      const cases: Array<{
        create: (req: any) => Promise<Response>;
        list: (req: any) => Promise<Response>;
        url: string;
        body: Record<string, unknown>;
      }> = [
        {
          create: leathersCreate,
          list: leathersList,
          url: "leathers",
          body: { name: "Leather X", displayImageAssetId: display.id, textureImageAssetId: texture.id },
        },
        { create: stitchesCreate, list: stitchesList, url: "stitches", body: { name: "Stitch X", colorHex: "#000000" } },
        {
          create: animalsCreate,
          list: animalsList,
          url: "animals",
          body: { name: "Animal X", displayImageAssetId: display.id },
        },
        {
          create: stylesCreate,
          list: stylesList,
          url: "styles",
          body: { name: "Style X", displayImageAssetId: display.id },
        },
      ];

      for (const testCase of cases) {
        const createReq = await adminRequest(`https://app.test/api/admin/${testCase.url}`, {
          method: "POST",
          body: testCase.body,
        });
        const createRes = await testCase.create(createReq);
        expect(createRes.status, testCase.url).toBe(201);

        const listReq = await adminRequest(`https://app.test/api/admin/${testCase.url}`);
        const listRes = await testCase.list(listReq);
        const list = await json(listRes);
        expect(list.items, testCase.url).toHaveLength(1);
      }
    });
  });

  describe("401 khi không token", () => {
    it.each([
      ["GET leathers", () => adminRequest("https://app.test/api/admin/leathers", { token: null }), leathersList],
      [
        "POST leathers",
        () => adminRequest("https://app.test/api/admin/leathers", { method: "POST", body: {}, token: null }),
        leathersCreate,
      ],
    ])("%s → 401", async (_name, makeReq, handler) => {
      await seedShop();
      const req = await makeReq();
      const res = await (handler as any)(req);
      expect(res.status).toBe(401);
    });
  });
});
