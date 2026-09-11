import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { resetDb, seedAsset, seedShop, TEST_SHOP } from "../helpers/db";
import { adminRequest, useAdminEnv } from "../../tests/helpers/adminRequest";

import { GET as productsList, POST as productsCreate } from "@/app/api/admin/products/route";
import { GET as productGet, PATCH as productPatch } from "@/app/api/admin/products/[id]/route";
import { PUT as putHosts } from "@/app/api/admin/products/[id]/hosts/route";
import { PUT as putStyles } from "@/app/api/admin/products/[id]/styles/route";
import { PUT as putAnimals } from "@/app/api/admin/products/[id]/animals/route";
import { PUT as putStitches } from "@/app/api/admin/products/[id]/stitches/route";

async function json(res: Response): Promise<any> {
  return res.json();
}

async function seedStyle(shopId: string, name = "A") {
  const display = await seedAsset(shopId, "DISPLAY");
  return db.style.create({ data: { shopId, name, slug: name.toLowerCase(), displayImageAssetId: display.id } });
}
async function seedAnimal(shopId: string, name = "A") {
  const display = await seedAsset(shopId, "DISPLAY");
  return db.animal.create({ data: { shopId, name, slug: name.toLowerCase(), displayImageAssetId: display.id } });
}
async function seedStitch(shopId: string, name = "A") {
  return db.stitch.create({ data: { shopId, name, slug: name.toLowerCase(), colorHex: "#000000" } });
}

describe("Products API — Postgres thật", () => {
  beforeEach(async () => {
    await resetDb();
    useAdminEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("Product — create / list / get / update", () => {
    it("POST { name } → 201 { id, name, isEnabled: false }", async () => {
      await seedShop();
      const req = await adminRequest("https://app.test/api/admin/products", { method: "POST", body: { name: "Card Holder" } });
      const res = await productsCreate(req);
      const body = await json(res);
      expect(res.status).toBe(201);
      expect(body).toEqual({ id: expect.any(String), name: "Card Holder", isEnabled: false });
    });

    it("name rỗng → 422", async () => {
      await seedShop();
      const req = await adminRequest("https://app.test/api/admin/products", { method: "POST", body: { name: "" } });
      const res = await productsCreate(req);
      expect(res.status).toBe(422);
    });

    it("GET list chỉ thấy product của shop mình, bỏ archived", async () => {
      useAdminEnv([TEST_SHOP, "other-shop.myshopify.com"]);
      const shopA = await seedShop(TEST_SHOP);
      const shopB = await seedShop("other-shop.myshopify.com");
      const mine = await db.customizableProduct.create({ data: { shopId: shopA.id, name: "Mine" } });
      await db.customizableProduct.create({ data: { shopId: shopA.id, name: "Archived", archivedAt: new Date() } });
      await db.customizableProduct.create({ data: { shopId: shopB.id, name: "Other shop" } });

      const req = await adminRequest("https://app.test/api/admin/products", { shop: TEST_SHOP });
      const res = await productsList(req);
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(mine.id);
    });

    it("GET :id của shop khác → 404; id không tồn tại → 404 — cùng một phản hồi", async () => {
      useAdminEnv([TEST_SHOP, "other-shop.myshopify.com"]);
      const shopA = await seedShop(TEST_SHOP);
      await seedShop("other-shop.myshopify.com");
      const product = await db.customizableProduct.create({ data: { shopId: shopA.id, name: "A" } });

      const wrongShopReq = await adminRequest(`https://app.test/api/admin/products/${product.id}`, { shop: "other-shop.myshopify.com" });
      const wrongShopRes = await productGet(wrongShopReq, { params: { id: product.id } });
      const wrongShopBody = await json(wrongShopRes);

      const missingReq = await adminRequest("https://app.test/api/admin/products/does-not-exist", { shop: "other-shop.myshopify.com" });
      const missingRes = await productGet(missingReq, { params: { id: "does-not-exist" } });
      const missingBody = await json(missingRes);

      expect(wrongShopRes.status).toBe(404);
      expect(missingRes.status).toBe(404);
      expect(wrongShopBody).toEqual(missingBody);
    });

    it("GET :id → full tree: hosts/styles/animals/stitches kèm tên attribute", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const style = await seedStyle(shop.id, "Minimalist");
      const animal = await seedAnimal(shop.id, "Alligator");
      const stitch = await seedStitch(shop.id, "Gold");
      await db.productStyle.create({ data: { productId: product.id, styleId: style.id, sortOrder: 0 } });
      await db.productAnimal.create({ data: { productId: product.id, animalId: animal.id, sortOrder: 0 } });
      await db.productStitch.create({ data: { productId: product.id, stitchId: stitch.id, sortOrder: 0 } });
      await db.productHost.create({
        data: { shopId: shop.id, productId: product.id, shopifyProductId: "42", shopifyProductGid: "gid://shopify/Product/42", isPrimary: true },
      });

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}`);
      const res = await productGet(req, { params: { id: product.id } });
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body.id).toBe(product.id);
      expect(body.hosts).toEqual([expect.objectContaining({ shopifyProductId: "42", isPrimary: true })]);
      expect(body.styles).toEqual([expect.objectContaining({ styleId: style.id, name: "Minimalist" })]);
      expect(body.animals).toEqual([expect.objectContaining({ animalId: animal.id, name: "Alligator" })]);
      expect(body.stitches).toEqual([expect.objectContaining({ stitchId: stitch.id, name: "Gold" })]);
    });

    it("PATCH { name } → 200", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "Old" } });
      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}`, { method: "PATCH", body: { name: "New" } });
      const res = await productPatch(req, { params: { id: product.id } });
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body.name).toBe("New");
    });
  });

  describe("Host — PUT /products/:id/hosts", () => {
    it("tạo mới: shopifyProductGid derive từ shopifyProductId; handleSnapshot/titleSnapshot null", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/hosts`, {
        method: "PUT",
        body: [{ shopifyProductId: "123456789", isPrimary: true }],
      });
      const res = await putHosts(req, { params: { id: product.id } });
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        shopifyProductId: "123456789",
        shopifyProductGid: "gid://shopify/Product/123456789",
        handleSnapshot: null,
        titleSnapshot: null,
        isPrimary: true,
      });
    });

    it("shopifyProductId không phải chuỗi chữ số → 422", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/hosts`, {
        method: "PUT",
        body: [{ shopifyProductId: "abc123", isPrimary: false }],
      });
      const res = await putHosts(req, { params: { id: product.id } });
      expect(res.status).toBe(422);
    });

    it("host đã gắn với product khác cùng shop → 409 HOST_TAKEN", async () => {
      const shop = await seedShop();
      const productA = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const productB = await db.customizableProduct.create({ data: { shopId: shop.id, name: "B" } });
      await db.productHost.create({
        data: { shopId: shop.id, productId: productA.id, shopifyProductId: "999", shopifyProductGid: "gid://shopify/Product/999" },
      });

      const req = await adminRequest(`https://app.test/api/admin/products/${productB.id}/hosts`, {
        method: "PUT",
        body: [{ shopifyProductId: "999", isPrimary: false }],
      });
      const res = await putHosts(req, { params: { id: productB.id } });
      const body = await json(res);
      expect(res.status).toBe(409);
      expect(body).toEqual({ error: "HOST_TAKEN", shopifyProductId: "999", productId: productA.id });
    });

    it("cùng shopifyProductId ở shop khác → được (unique theo shop)", async () => {
      useAdminEnv([TEST_SHOP, "other-shop.myshopify.com"]);
      const shopA = await seedShop(TEST_SHOP);
      const shopB = await seedShop("other-shop.myshopify.com");
      const productA = await db.customizableProduct.create({ data: { shopId: shopA.id, name: "A" } });
      const productB = await db.customizableProduct.create({ data: { shopId: shopB.id, name: "B" } });
      await db.productHost.create({
        data: { shopId: shopA.id, productId: productA.id, shopifyProductId: "555", shopifyProductGid: "gid://shopify/Product/555" },
      });

      const req = await adminRequest(`https://app.test/api/admin/products/${productB.id}/hosts`, {
        method: "PUT",
        body: [{ shopifyProductId: "555", isPrimary: false }],
        shop: "other-shop.myshopify.com",
      });
      const res = await putHosts(req, { params: { id: productB.id } });
      expect(res.status).toBe(200);
    });

    it("preselectStyleId phải là style có ProductStyle active trong product này", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const style = await seedStyle(shop.id);
      // style tồn tại nhưng CHƯA active trong product này (không có ProductStyle nào)
      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/hosts`, {
        method: "PUT",
        body: [{ shopifyProductId: "111", preselectStyleId: style.id, isPrimary: false }],
      });
      const res = await putHosts(req, { params: { id: product.id } });
      expect(res.status).toBe(422);

      await db.productStyle.create({ data: { productId: product.id, styleId: style.id, isActive: true } });
      const req2 = await adminRequest(`https://app.test/api/admin/products/${product.id}/hosts`, {
        method: "PUT",
        body: [{ shopifyProductId: "111", preselectStyleId: style.id, isPrimary: false }],
      });
      const res2 = await putHosts(req2, { params: { id: product.id } });
      expect(res2.status).toBe(200);
    });

    it("hai host isPrimary: true → 422", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/hosts`, {
        method: "PUT",
        body: [
          { shopifyProductId: "111", isPrimary: true },
          { shopifyProductId: "222", isPrimary: true },
        ],
      });
      const res = await putHosts(req, { params: { id: product.id } });
      expect(res.status).toBe(422);
    });

    it("host vắng mặt khỏi danh sách → bị XOÁ (ngoại lệ của R4)", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const req1 = await adminRequest(`https://app.test/api/admin/products/${product.id}/hosts`, {
        method: "PUT",
        body: [
          { shopifyProductId: "111", isPrimary: true },
          { shopifyProductId: "222", isPrimary: false },
        ],
      });
      await putHosts(req1, { params: { id: product.id } });

      const req2 = await adminRequest(`https://app.test/api/admin/products/${product.id}/hosts`, {
        method: "PUT",
        body: [{ shopifyProductId: "111", isPrimary: true }],
      });
      const res2 = await putHosts(req2, { params: { id: product.id } });
      expect(res2.status).toBe(200);

      const rows = await db.productHost.findMany({ where: { productId: product.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].shopifyProductId).toBe("111");
    });

    it("shopifyProductId trùng trong chính request → 422", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/hosts`, {
        method: "PUT",
        body: [
          { shopifyProductId: "111", isPrimary: false },
          { shopifyProductId: "111", isPrimary: false },
        ],
      });
      const res = await putHosts(req, { params: { id: product.id } });
      expect(res.status).toBe(422);
    });
  });

  describe("Style / Animal / Stitch — PUT quan hệ, cùng hình", () => {
    it("styleId không thuộc shop hoặc đã archived → 422 field '0.styleId' code invalid_reference", async () => {
      useAdminEnv([TEST_SHOP, "other-shop.myshopify.com"]);
      const shopA = await seedShop(TEST_SHOP);
      const shopB = await seedShop("other-shop.myshopify.com");
      const product = await db.customizableProduct.create({ data: { shopId: shopA.id, name: "A" } });
      const foreignStyle = await seedStyle(shopB.id);

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles`, {
        method: "PUT",
        body: [{ styleId: foreignStyle.id, isActive: true, sortOrder: 0 }],
      });
      const res = await putStyles(req, { params: { id: product.id } });
      const body = await json(res);
      expect(res.status).toBe(422);
      expect(body.errors).toEqual([expect.objectContaining({ field: "0.styleId", code: "invalid_reference" })]);
    });

    it("archived style → 422 invalid_reference", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const style = await seedStyle(shop.id);
      await db.style.update({ where: { id: style.id }, data: { archivedAt: new Date() } });

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles`, {
        method: "PUT",
        body: [{ styleId: style.id, isActive: true, sortOrder: 0 }],
      });
      const res = await putStyles(req, { params: { id: product.id } });
      expect(res.status).toBe(422);
    });

    it("phần tử vắng mặt → isActive=false, hàng vẫn còn (đọc lại DB để khẳng định)", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const [styleA, styleB] = await Promise.all([seedStyle(shop.id, "A"), seedStyle(shop.id, "B")]);

      const req1 = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles`, {
        method: "PUT",
        body: [
          { styleId: styleA.id, isActive: true, sortOrder: 0 },
          { styleId: styleB.id, isActive: true, sortOrder: 1 },
        ],
      });
      await putStyles(req1, { params: { id: product.id } });

      const req2 = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles`, {
        method: "PUT",
        body: [{ styleId: styleA.id, isActive: true, sortOrder: 0 }],
      });
      const res2 = await putStyles(req2, { params: { id: product.id } });
      expect(res2.status).toBe(200);

      const rows = await db.productStyle.findMany({ where: { productId: product.id } });
      expect(rows).toHaveLength(2);
      const rowB = rows.find((r) => r.styleId === styleB.id);
      expect(rowB?.isActive).toBe(false);
    });

    it("đưa lại một phần tử đã tắt → bật lại, CÙNG id hàng (không tạo hàng mới)", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const style = await seedStyle(shop.id, "A");

      const req1 = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles`, {
        method: "PUT",
        body: [{ styleId: style.id, isActive: true, sortOrder: 0 }],
      });
      await putStyles(req1, { params: { id: product.id } });
      const firstRow = await db.productStyle.findFirstOrThrow({ where: { productId: product.id, styleId: style.id } });

      // Vắng mặt → tắt
      const req2 = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles`, { method: "PUT", body: [] });
      await putStyles(req2, { params: { id: product.id } });
      const offRow = await db.productStyle.findFirstOrThrow({ where: { productId: product.id, styleId: style.id } });
      expect(offRow.id).toBe(firstRow.id);
      expect(offRow.isActive).toBe(false);

      // Đưa lại → bật lại, cùng id
      const req3 = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles`, {
        method: "PUT",
        body: [{ styleId: style.id, isActive: true, sortOrder: 5 }],
      });
      await putStyles(req3, { params: { id: product.id } });
      const rows = await db.productStyle.findMany({ where: { productId: product.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(firstRow.id);
      expect(rows[0].isActive).toBe(true);
      expect(rows[0].sortOrder).toBe(5);
    });

    it("trùng styleId trong request → 422", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const style = await seedStyle(shop.id);

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles`, {
        method: "PUT",
        body: [
          { styleId: style.id, isActive: true, sortOrder: 0 },
          { styleId: style.id, isActive: true, sortOrder: 1 },
        ],
      });
      const res = await putStyles(req, { params: { id: product.id } });
      expect(res.status).toBe(422);
    });

    it("một transaction: phần tử cuối không hợp lệ → các phần tử trước KHÔNG được ghi", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const validStyle = await seedStyle(shop.id, "Valid");

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles`, {
        method: "PUT",
        body: [
          { styleId: validStyle.id, isActive: true, sortOrder: 0 },
          { styleId: "does-not-exist", isActive: true, sortOrder: 1 },
        ],
      });
      const res = await putStyles(req, { params: { id: product.id } });
      expect(res.status).toBe(422);

      const rows = await db.productStyle.findMany({ where: { productId: product.id } });
      expect(rows).toHaveLength(0); // validStyle KHÔNG được ghi dù hợp lệ
    });

    it("phản hồi là danh sách sau cập nhật, sắp theo sortOrder, kèm tên attribute", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const [styleA, styleB] = await Promise.all([seedStyle(shop.id, "Zeta"), seedStyle(shop.id, "Alpha")]);

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles`, {
        method: "PUT",
        body: [
          { styleId: styleA.id, isActive: true, sortOrder: 1 },
          { styleId: styleB.id, isActive: true, sortOrder: 0 },
        ],
      });
      const res = await putStyles(req, { params: { id: product.id } });
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body).toEqual([
        expect.objectContaining({ styleId: styleB.id, name: "Alpha", sortOrder: 0 }),
        expect.objectContaining({ styleId: styleA.id, name: "Zeta", sortOrder: 1 }),
      ]);
    });

    it("animals: cùng hình (invalid_reference, isActive=false khi vắng mặt)", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const animal = await seedAnimal(shop.id, "Alligator");

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/animals`, {
        method: "PUT",
        body: [{ animalId: animal.id, isActive: true, sortOrder: 0 }],
      });
      const res = await putAnimals(req, { params: { id: product.id } });
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body).toEqual([expect.objectContaining({ animalId: animal.id, name: "Alligator" })]);

      const req2 = await adminRequest(`https://app.test/api/admin/products/${product.id}/animals`, { method: "PUT", body: [] });
      await putAnimals(req2, { params: { id: product.id } });
      const rows = await db.productAnimal.findMany({ where: { productId: product.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].isActive).toBe(false);
    });

    it("stitches: cùng hình (invalid_reference, isActive=false khi vắng mặt)", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const stitch = await seedStitch(shop.id, "Gold");

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/stitches`, {
        method: "PUT",
        body: [{ stitchId: stitch.id, isActive: true, sortOrder: 0 }],
      });
      const res = await putStitches(req, { params: { id: product.id } });
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body).toEqual([expect.objectContaining({ stitchId: stitch.id, name: "Gold" })]);

      const req2 = await adminRequest(`https://app.test/api/admin/products/${product.id}/stitches`, { method: "PUT", body: [] });
      await putStitches(req2, { params: { id: product.id } });
      const rows = await db.productStitch.findMany({ where: { productId: product.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].isActive).toBe(false);
    });
  });

  describe("cô lập shop — bare-join table không có shopId", () => {
    it("PUT styles của product thuộc shop khác → 404, không tạo hàng nào", async () => {
      useAdminEnv([TEST_SHOP, "other-shop.myshopify.com"]);
      const shopA = await seedShop(TEST_SHOP);
      await seedShop("other-shop.myshopify.com");
      const product = await db.customizableProduct.create({ data: { shopId: shopA.id, name: "A" } });
      const style = await seedStyle(shopA.id);

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles`, {
        method: "PUT",
        body: [{ styleId: style.id, isActive: true, sortOrder: 0 }],
        shop: "other-shop.myshopify.com",
      });
      const res = await putStyles(req, { params: { id: product.id } });
      expect(res.status).toBe(404);

      const rows = await db.productStyle.findMany({ where: { productId: product.id } });
      expect(rows).toHaveLength(0);
    });
  });
});
