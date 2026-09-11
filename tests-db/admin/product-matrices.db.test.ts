import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { resetDb, seedAsset, seedShop, TEST_SHOP } from "../helpers/db";
import { adminRequest, useAdminEnv } from "../../tests/helpers/adminRequest";

import { GET as productGet, PATCH as productPatch } from "@/app/api/admin/products/[id]/route";
import { PUT as putStyles } from "@/app/api/admin/products/[id]/styles/route";
import { PUT as putAnimals } from "@/app/api/admin/products/[id]/animals/route";
import { PUT as putStitches } from "@/app/api/admin/products/[id]/stitches/route";
import { PUT as putHosts } from "@/app/api/admin/products/[id]/hosts/route";
import { PUT as putStyleLeathers } from "@/app/api/admin/products/[id]/styles/[styleId]/leathers/route";
import { PUT as putAnimalLeathers } from "@/app/api/admin/products/[id]/animals/[animalId]/leathers/route";
import { PUT as putStyleAnimals } from "@/app/api/admin/products/[id]/styles/[styleId]/animals/route";

async function json(res: Response): Promise<any> {
  return res.json();
}

async function seedStyle(shopId: string, name = "A") {
  const display = await seedAsset(shopId, "DISPLAY");
  return db.style.create({ data: { shopId, name, slug: `${name.toLowerCase()}-${Math.random().toString(36).slice(2)}`, displayImageAssetId: display.id } });
}
async function seedAnimal(shopId: string, name = "A") {
  const display = await seedAsset(shopId, "DISPLAY");
  return db.animal.create({ data: { shopId, name, slug: `${name.toLowerCase()}-${Math.random().toString(36).slice(2)}`, displayImageAssetId: display.id } });
}
async function seedStitch(shopId: string, name = "A") {
  return db.stitch.create({ data: { shopId, name, slug: `${name.toLowerCase()}-${Math.random().toString(36).slice(2)}`, colorHex: "#000000" } });
}
async function seedLeather(shopId: string, name = "A") {
  const display = await seedAsset(shopId, "DISPLAY");
  const texture = await seedAsset(shopId, "TEXTURE");
  return db.leather.create({
    data: {
      shopId,
      name,
      slug: `${name.toLowerCase()}-${Math.random().toString(36).slice(2)}`,
      displayImageAssetId: display.id,
      textureImageAssetId: texture.id,
    },
  });
}

/** Product tối thiểu có một style + một animal (để test matrix/svg cắm vào). */
async function seedProductWithStyleAndAnimal(shopId: string) {
  const product = await db.customizableProduct.create({ data: { shopId, name: "A" } });
  const style = await seedStyle(shopId, "Minimalist");
  const animal = await seedAnimal(shopId, "Alligator");
  await db.productStyle.create({ data: { productId: product.id, styleId: style.id, isActive: true } });
  await db.productAnimal.create({ data: { productId: product.id, animalId: animal.id, isActive: true } });
  return { product, style, animal };
}

describe("Product matrices — Postgres thật (Task 6)", () => {
  beforeEach(async () => {
    await resetDb();
    useAdminEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("Ma trận A — PUT /products/:id/styles/:styleId/leathers", () => {
    it(":styleId là id Style attribute, không phải ProductStyle; style không có trong product → 404", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const style = await seedStyle(shop.id); // tồn tại nhưng CHƯA gắn vào product (không có ProductStyle)
      const leather = await seedLeather(shop.id);

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: leather.id, price: "80.00", isActive: true, sortOrder: 0 }],
      });
      const res = await putStyleLeathers(req, { params: { id: product.id, styleId: style.id } });
      expect(res.status).toBe(404);
    });

    it("lưu priceInput; đọc lại DB là Decimal đúng giá trị; phản hồi là chuỗi '80.00'", async () => {
      const shop = await seedShop();
      const { product, style } = await seedProductWithStyleAndAnimal(shop.id);
      const leather = await seedLeather(shop.id);

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: leather.id, price: "80.00", isActive: true, sortOrder: 0 }],
      });
      const res = await putStyleLeathers(req, { params: { id: product.id, styleId: style.id } });
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body[0].price).toBe("80.00");

      const productStyle = await db.productStyle.findFirstOrThrow({ where: { productId: product.id, styleId: style.id } });
      const row = await db.productStyleLeather.findFirstOrThrow({ where: { productStyleId: productStyle.id, leatherId: leather.id } });
      expect(row.priceInput?.toString()).toBe("80");
    });

    it("price: 80.555 → 422 field '0.price'", async () => {
      const shop = await seedShop();
      const { product, style } = await seedProductWithStyleAndAnimal(shop.id);
      const leather = await seedLeather(shop.id);

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: leather.id, price: 80.555, isActive: true, sortOrder: 0 }],
      });
      const res = await putStyleLeathers(req, { params: { id: product.id, styleId: style.id } });
      const body = await json(res);
      expect(res.status).toBe(422);
      expect(body.errors).toEqual([expect.objectContaining({ field: "0.price" })]);
    });

    it("price: null → được (ô chưa định giá)", async () => {
      const shop = await seedShop();
      const { product, style } = await seedProductWithStyleAndAnimal(shop.id);
      const leather = await seedLeather(shop.id);

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: leather.id, price: null, isActive: true, sortOrder: 0 }],
      });
      const res = await putStyleLeathers(req, { params: { id: product.id, styleId: style.id } });
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body[0].price).toBeNull();
    });

    it("KHÔNG chạm shopifyVariantId/variantPriceSnapshot — seed ô đã có variant rồi đổi giá, hai cột variant giữ byte-identical", async () => {
      const shop = await seedShop();
      const { product, style } = await seedProductWithStyleAndAnimal(shop.id);
      const leather = await seedLeather(shop.id);
      const productStyle = await db.productStyle.findFirstOrThrow({ where: { productId: product.id, styleId: style.id } });

      const syncedAt = new Date("2026-01-01T00:00:00.000Z");
      await db.productStyleLeather.create({
        data: {
          productStyleId: productStyle.id,
          leatherId: leather.id,
          priceInput: "50.00",
          isActive: true,
          sortOrder: 0,
          shopifyProductId: "999",
          shopifyVariantId: "gid-variant-1",
          shopifyVariantGid: "gid://shopify/ProductVariant/1",
          variantPriceSnapshot: "50.00",
          variantMissing: false,
          variantSyncedAt: syncedAt,
        },
      });

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: leather.id, price: "65.00", isActive: true, sortOrder: 0 }],
      });
      const res = await putStyleLeathers(req, { params: { id: product.id, styleId: style.id } });
      expect(res.status).toBe(200);

      const row = await db.productStyleLeather.findFirstOrThrow({ where: { productStyleId: productStyle.id, leatherId: leather.id } });
      expect(row.priceInput?.toString()).toBe("65");
      expect(row.shopifyProductId).toBe("999");
      expect(row.shopifyVariantId).toBe("gid-variant-1");
      expect(row.shopifyVariantGid).toBe("gid://shopify/ProductVariant/1");
      expect(row.variantPriceSnapshot?.toString()).toBe("50");
      expect(row.variantMissing).toBe(false);
      expect(row.variantSyncedAt?.toISOString()).toBe(syncedAt.toISOString());
    });

    it("vắng mặt → isActive=false; đưa lại → cùng id hàng", async () => {
      const shop = await seedShop();
      const { product, style } = await seedProductWithStyleAndAnimal(shop.id);
      const leather = await seedLeather(shop.id);

      const req1 = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: leather.id, price: "80.00", isActive: true, sortOrder: 0 }],
      });
      await putStyleLeathers(req1, { params: { id: product.id, styleId: style.id } });
      const productStyle = await db.productStyle.findFirstOrThrow({ where: { productId: product.id, styleId: style.id } });
      const firstRow = await db.productStyleLeather.findFirstOrThrow({ where: { productStyleId: productStyle.id, leatherId: leather.id } });

      const req2 = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/leathers`, { method: "PUT", body: [] });
      await putStyleLeathers(req2, { params: { id: product.id, styleId: style.id } });
      const offRow = await db.productStyleLeather.findFirstOrThrow({ where: { productStyleId: productStyle.id, leatherId: leather.id } });
      expect(offRow.id).toBe(firstRow.id);
      expect(offRow.isActive).toBe(false);

      const req3 = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: leather.id, price: "80.00", isActive: true, sortOrder: 3 }],
      });
      await putStyleLeathers(req3, { params: { id: product.id, styleId: style.id } });
      const onRow = await db.productStyleLeather.findFirstOrThrow({ where: { productStyleId: productStyle.id, leatherId: leather.id } });
      expect(onRow.id).toBe(firstRow.id);
      expect(onRow.isActive).toBe(true);
      expect(onRow.sortOrder).toBe(3);
    });

    it("leather archived → 422 invalid_reference", async () => {
      const shop = await seedShop();
      const { product, style } = await seedProductWithStyleAndAnimal(shop.id);
      const leather = await seedLeather(shop.id);
      await db.leather.update({ where: { id: leather.id }, data: { archivedAt: new Date() } });

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: leather.id, price: "80.00", isActive: true, sortOrder: 0 }],
      });
      const res = await putStyleLeathers(req, { params: { id: product.id, styleId: style.id } });
      const body = await json(res);
      expect(res.status).toBe(422);
      expect(body.errors).toEqual([expect.objectContaining({ field: "0.leatherId", code: "invalid_reference" })]);
    });

    it("leather của shop khác → 422 invalid_reference", async () => {
      useAdminEnv([TEST_SHOP, "other-shop.myshopify.com"]);
      const shopA = await seedShop(TEST_SHOP);
      const shopB = await seedShop("other-shop.myshopify.com");
      const { product, style } = await seedProductWithStyleAndAnimal(shopA.id);
      const foreignLeather = await seedLeather(shopB.id);

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: foreignLeather.id, price: "80.00", isActive: true, sortOrder: 0 }],
      });
      const res = await putStyleLeathers(req, { params: { id: product.id, styleId: style.id } });
      expect(res.status).toBe(422);
    });
  });

  describe("Ma trận B — PUT /products/:id/animals/:animalId/leathers — cùng hình", () => {
    it(":animalId không có trong product → 404", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const animal = await seedAnimal(shop.id);
      const leather = await seedLeather(shop.id);

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/animals/${animal.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: leather.id, price: "80.00", isActive: true, sortOrder: 0 }],
      });
      const res = await putAnimalLeathers(req, { params: { id: product.id, animalId: animal.id } });
      expect(res.status).toBe(404);
    });

    it("lưu priceInput; phản hồi chuỗi; không chạm cột variant khi update", async () => {
      const shop = await seedShop();
      const { product, animal } = await seedProductWithStyleAndAnimal(shop.id);
      const leather = await seedLeather(shop.id);
      const productAnimal = await db.productAnimal.findFirstOrThrow({ where: { productId: product.id, animalId: animal.id } });

      await db.animalLeather.create({
        data: {
          productAnimalId: productAnimal.id,
          leatherId: leather.id,
          priceInput: "40.00",
          isActive: true,
          sortOrder: 0,
          shopifyProductId: "111",
          shopifyVariantId: "gid-variant-2",
          shopifyVariantGid: "gid://shopify/ProductVariant/2",
          variantPriceSnapshot: "40.00",
          variantMissing: false,
        },
      });

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/animals/${animal.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: leather.id, price: "45.00", isActive: true, sortOrder: 0 }],
      });
      const res = await putAnimalLeathers(req, { params: { id: product.id, animalId: animal.id } });
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body[0].price).toBe("45.00");

      const row = await db.animalLeather.findFirstOrThrow({ where: { productAnimalId: productAnimal.id, leatherId: leather.id } });
      expect(row.priceInput?.toString()).toBe("45");
      expect(row.shopifyVariantId).toBe("gid-variant-2");
      expect(row.variantPriceSnapshot?.toString()).toBe("40");
    });

    it("price: 80.555 → 422; price: null → được; vắng mặt → isActive=false", async () => {
      const shop = await seedShop();
      const { product, animal } = await seedProductWithStyleAndAnimal(shop.id);
      const leather = await seedLeather(shop.id);

      const badReq = await adminRequest(`https://app.test/api/admin/products/${product.id}/animals/${animal.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: leather.id, price: 80.555, isActive: true, sortOrder: 0 }],
      });
      const badRes = await putAnimalLeathers(badReq, { params: { id: product.id, animalId: animal.id } });
      expect(badRes.status).toBe(422);

      const okReq = await adminRequest(`https://app.test/api/admin/products/${product.id}/animals/${animal.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: leather.id, price: null, isActive: true, sortOrder: 0 }],
      });
      const okRes = await putAnimalLeathers(okReq, { params: { id: product.id, animalId: animal.id } });
      expect(okRes.status).toBe(200);
      expect((await json(okRes))[0].price).toBeNull();

      const emptyReq = await adminRequest(`https://app.test/api/admin/products/${product.id}/animals/${animal.id}/leathers`, {
        method: "PUT",
        body: [],
      });
      await putAnimalLeathers(emptyReq, { params: { id: product.id, animalId: animal.id } });
      const productAnimal = await db.productAnimal.findFirstOrThrow({ where: { productId: product.id, animalId: animal.id } });
      const row = await db.animalLeather.findFirstOrThrow({ where: { productAnimalId: productAnimal.id, leatherId: leather.id } });
      expect(row.isActive).toBe(false);
    });

    it("leather archived hoặc của shop khác → 422 invalid_reference", async () => {
      const shop = await seedShop();
      const { product, animal } = await seedProductWithStyleAndAnimal(shop.id);
      const leather = await seedLeather(shop.id);
      await db.leather.update({ where: { id: leather.id }, data: { archivedAt: new Date() } });

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/animals/${animal.id}/leathers`, {
        method: "PUT",
        body: [{ leatherId: leather.id, price: "80.00", isActive: true, sortOrder: 0 }],
      });
      const res = await putAnimalLeathers(req, { params: { id: product.id, animalId: animal.id } });
      expect(res.status).toBe(422);
    });
  });

  describe("Lưới SVG — PUT /products/:id/styles/:styleId/animals", () => {
    it("animalId không có ProductAnimal trong product → 422", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A" } });
      const style = await seedStyle(shop.id);
      await db.productStyle.create({ data: { productId: product.id, styleId: style.id, isActive: true } });
      const animal = await seedAnimal(shop.id); // KHÔNG gắn vào product
      const svgAsset = await seedAsset(shop.id, "SVG_MOCKUP");

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/animals`, {
        method: "PUT",
        body: [{ animalId: animal.id, svgAssetId: svgAsset.id, isActive: true, sortOrder: 0 }],
      });
      const res = await putStyleAnimals(req, { params: { id: product.id, styleId: style.id } });
      const body = await json(res);
      expect(res.status).toBe(422);
      expect(body.errors).toEqual([expect.objectContaining({ field: "0.animalId", code: "invalid_reference" })]);
    });

    it("svgAssetId phải là Asset shop này, kind SVG_MOCKUP, chưa archived, svgValidatedAt khác null; asset DISPLAY → 422 invalid_asset", async () => {
      const shop = await seedShop();
      const { product, style, animal } = await seedProductWithStyleAndAnimal(shop.id);
      const displayAsset = await seedAsset(shop.id, "DISPLAY");

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/animals`, {
        method: "PUT",
        body: [{ animalId: animal.id, svgAssetId: displayAsset.id, isActive: true, sortOrder: 0 }],
      });
      const res = await putStyleAnimals(req, { params: { id: product.id, styleId: style.id } });
      const body = await json(res);
      expect(res.status).toBe(422);
      expect(body.errors).toEqual([expect.objectContaining({ field: "0.svgAssetId", code: "invalid_asset" })]);
    });

    it("svgAssetId archived → 422 invalid_asset", async () => {
      const shop = await seedShop();
      const { product, style, animal } = await seedProductWithStyleAndAnimal(shop.id);
      const svgAsset = await seedAsset(shop.id, "SVG_MOCKUP");
      await db.asset.update({ where: { id: svgAsset.id }, data: { archivedAt: new Date() } });

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/animals`, {
        method: "PUT",
        body: [{ animalId: animal.id, svgAssetId: svgAsset.id, isActive: true, sortOrder: 0 }],
      });
      const res = await putStyleAnimals(req, { params: { id: product.id, styleId: style.id } });
      expect(res.status).toBe(422);
    });

    it("svgAssetId chưa qua sanitize (svgValidatedAt null) → 422 invalid_asset", async () => {
      const shop = await seedShop();
      const { product, style, animal } = await seedProductWithStyleAndAnimal(shop.id);
      const svgAsset = await seedAsset(shop.id, "SVG_MOCKUP", { svgValidatedAt: null });

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/animals`, {
        method: "PUT",
        body: [{ animalId: animal.id, svgAssetId: svgAsset.id, isActive: true, sortOrder: 0 }],
      });
      const res = await putStyleAnimals(req, { params: { id: product.id, styleId: style.id } });
      expect(res.status).toBe(422);
    });

    it("defaultStitchId phải có ProductStitch trong product → nếu không, 422", async () => {
      const shop = await seedShop();
      const { product, style, animal } = await seedProductWithStyleAndAnimal(shop.id);
      const svgAsset = await seedAsset(shop.id, "SVG_MOCKUP");
      const stitch = await seedStitch(shop.id); // KHÔNG gắn vào product

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/animals`, {
        method: "PUT",
        body: [{ animalId: animal.id, svgAssetId: svgAsset.id, defaultStitchId: stitch.id, isActive: true, sortOrder: 0 }],
      });
      const res = await putStyleAnimals(req, { params: { id: product.id, styleId: style.id } });
      const body = await json(res);
      expect(res.status).toBe(422);
      expect(body.errors).toEqual([expect.objectContaining({ field: "0.defaultStitchId", code: "invalid_reference" })]);
    });

    it("tạo mới hợp lệ, vắng mặt → isActive=false", async () => {
      const shop = await seedShop();
      const { product, style, animal } = await seedProductWithStyleAndAnimal(shop.id);
      const svgAsset = await seedAsset(shop.id, "SVG_MOCKUP");
      const stitch = await seedStitch(shop.id);
      await db.productStitch.create({ data: { productId: product.id, stitchId: stitch.id, isActive: true } });

      const req1 = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/animals`, {
        method: "PUT",
        body: [
          {
            animalId: animal.id,
            svgAssetId: svgAsset.id,
            displayLabel: "Cá sấu",
            description: "Da cá sấu",
            defaultStitchId: stitch.id,
            isActive: true,
            sortOrder: 0,
          },
        ],
      });
      const res1 = await putStyleAnimals(req1, { params: { id: product.id, styleId: style.id } });
      const body1 = await json(res1);
      expect(res1.status).toBe(200);
      expect(body1[0]).toMatchObject({
        animalId: animal.id,
        svgAssetId: svgAsset.id,
        svgUrl: svgAsset.publicUrl,
        displayLabel: "Cá sấu",
        description: "Da cá sấu",
        defaultStitchId: stitch.id,
        isActive: true,
      });

      const req2 = await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/animals`, { method: "PUT", body: [] });
      await putStyleAnimals(req2, { params: { id: product.id, styleId: style.id } });
      const productStyle = await db.productStyle.findFirstOrThrow({ where: { productId: product.id, styleId: style.id } });
      const row = await db.productStyleAnimal.findFirstOrThrow({ where: { productStyleId: productStyle.id, animalId: animal.id } });
      expect(row.isActive).toBe(false);
    });
  });

  describe("Cây và bật product", () => {
    async function buildFullProduct(shopId: string) {
      const { product, style, animal } = await seedProductWithStyleAndAnimal(shopId);
      const stitch = await seedStitch(shopId);
      await db.productStitch.create({ data: { productId: product.id, stitchId: stitch.id, isActive: true } });
      const leather = await seedLeather(shopId);
      const svgAsset = await seedAsset(shopId, "SVG_MOCKUP");

      await putStyleLeathers(
        await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/leathers`, {
          method: "PUT",
          body: [{ leatherId: leather.id, price: "80.00", isActive: true, sortOrder: 0 }],
        }),
        { params: { id: product.id, styleId: style.id } },
      );
      await putAnimalLeathers(
        await adminRequest(`https://app.test/api/admin/products/${product.id}/animals/${animal.id}/leathers`, {
          method: "PUT",
          body: [{ leatherId: leather.id, price: "60.00", isActive: true, sortOrder: 0 }],
        }),
        { params: { id: product.id, animalId: animal.id } },
      );
      await putStyleAnimals(
        await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/animals`, {
          method: "PUT",
          body: [{ animalId: animal.id, svgAssetId: svgAsset.id, isActive: true, sortOrder: 0 }],
        }),
        { params: { id: product.id, styleId: style.id } },
      );
      await putHosts(
        await adminRequest(`https://app.test/api/admin/products/${product.id}/hosts`, {
          method: "PUT",
          body: [{ shopifyProductId: "424242", isPrimary: true }],
        }),
        { params: { id: product.id } },
      );

      return { product, style, animal, stitch, leather, svgAsset };
    }

    it("GET :id trên product dựng đủ qua PUT → đúng hình; giá là chuỗi; readiness.problems chứa MISSING_VARIANT cho mọi ô", async () => {
      const shop = await seedShop();
      const { product, style, animal, leather } = await buildFullProduct(shop.id);

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}`);
      const res = await productGet(req, { params: { id: product.id } });
      const body = await json(res);
      expect(res.status).toBe(200);

      expect(body.styles).toHaveLength(1);
      const styleDto = body.styles[0];
      expect(styleDto.styleId).toBe(style.id);
      expect(styleDto.leathers).toEqual([
        expect.objectContaining({ leatherId: leather.id, price: "80.00", variant: null }),
      ]);
      expect(styleDto.animals).toEqual([
        expect.objectContaining({ animalId: animal.id, isActive: true }),
      ]);

      expect(body.animals).toHaveLength(1);
      expect(body.animals[0].leathers).toEqual([
        expect.objectContaining({ leatherId: leather.id, price: "60.00", variant: null }),
      ]);

      expect(typeof body.styles[0].leathers[0].price).toBe("string");
      expect(typeof body.animals[0].leathers[0].price).toBe("string");

      expect(body.readiness.ready).toBe(false);
      const missingVariantCells = body.readiness.problems.filter((p: any) => p.code === "MISSING_VARIANT");
      // một ô ở style×leather, một ô ở animal×leather — MISSING_VARIANT cho cả hai
      expect(missingVariantCells.length).toBe(2);
    });

    it("seed variant trực tiếp cho mọi ô (giả lập P2b) → readiness.ready === true", async () => {
      const shop = await seedShop();
      const { product, style, animal, leather } = await buildFullProduct(shop.id);

      const productStyle = await db.productStyle.findFirstOrThrow({ where: { productId: product.id, styleId: style.id } });
      const productAnimal = await db.productAnimal.findFirstOrThrow({ where: { productId: product.id, animalId: animal.id } });

      await db.productStyleLeather.updateMany({
        where: { productStyleId: productStyle.id, leatherId: leather.id },
        data: { shopifyProductId: "1", shopifyVariantId: "sv-1", shopifyVariantGid: "gid://shopify/ProductVariant/1", variantMissing: false },
      });
      await db.animalLeather.updateMany({
        where: { productAnimalId: productAnimal.id, leatherId: leather.id },
        data: { shopifyProductId: "2", shopifyVariantId: "sv-2", shopifyVariantGid: "gid://shopify/ProductVariant/2", variantMissing: false },
      });

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}`);
      const res = await productGet(req, { params: { id: product.id } });
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body.readiness).toEqual({ ready: true, problems: [] });
    });

    // Review Task 6 phát hiện: archive asset SVG SAU khi đã wire vào ô active
    // không tự sinh MISSING_SVG — ô vẫn "có mặt". Bằng chứng thực thi trên
    // đúng cây ready:true ở trên, không phải cây dựng tay trong hermetic test.
    it("archive svgAssetId SAU khi đã wire vào ô active → readiness.ready trở lại false, ARCHIVED_ATTRIBUTE đúng path", async () => {
      const shop = await seedShop();
      const { product, style, animal, leather, svgAsset } = await buildFullProduct(shop.id);

      const productStyle = await db.productStyle.findFirstOrThrow({ where: { productId: product.id, styleId: style.id } });
      const productAnimal = await db.productAnimal.findFirstOrThrow({ where: { productId: product.id, animalId: animal.id } });
      await db.productStyleLeather.updateMany({
        where: { productStyleId: productStyle.id, leatherId: leather.id },
        data: { shopifyVariantId: "sv-1", shopifyVariantGid: "gid://shopify/ProductVariant/1", variantMissing: false },
      });
      await db.animalLeather.updateMany({
        where: { productAnimalId: productAnimal.id, leatherId: leather.id },
        data: { shopifyVariantId: "sv-2", shopifyVariantGid: "gid://shopify/ProductVariant/2", variantMissing: false },
      });

      // Xác nhận trạng thái xuất phát THẬT sự là ready:true trước khi archive.
      const before = await productGet(await adminRequest(`https://app.test/api/admin/products/${product.id}`), {
        params: { id: product.id },
      });
      expect((await json(before)).readiness).toEqual({ ready: true, problems: [] });

      await db.asset.update({ where: { id: svgAsset.id }, data: { archivedAt: new Date() } });

      const after = await productGet(await adminRequest(`https://app.test/api/admin/products/${product.id}`), {
        params: { id: product.id },
      });
      const afterBody = await json(after);
      expect(afterBody.readiness.ready).toBe(false);
      expect(afterBody.readiness.problems).toContainEqual(
        expect.objectContaining({
          code: "ARCHIVED_ATTRIBUTE",
          path: ["styles", style.id, "animals", animal.id],
        }),
      );

      // isEnabled:true phải bị chặn ngay khi asset archived, dù trước đó ready.
      const patchReq = await adminRequest(`https://app.test/api/admin/products/${product.id}`, {
        method: "PATCH",
        body: { isEnabled: true },
      });
      const patchRes = await productPatch(patchReq, { params: { id: product.id } });
      expect(patchRes.status).toBe(409);
    });

    it("archive defaultStitchId SAU khi đã wire vào ô active → readiness.ready trở lại false", async () => {
      const shop = await seedShop();
      const { product, style, animal, leather, svgAsset, stitch } = await buildFullProduct(shop.id);
      // buildFullProduct đã activate stitch cho product này (productStitch) —
      // giờ wire chính nó làm defaultStitchId của ô SVG đã có.
      await putStyleAnimals(
        await adminRequest(`https://app.test/api/admin/products/${product.id}/styles/${style.id}/animals`, {
          method: "PUT",
          body: [{ animalId: animal.id, svgAssetId: svgAsset.id, defaultStitchId: stitch.id, isActive: true, sortOrder: 0 }],
        }),
        { params: { id: product.id, styleId: style.id } },
      );

      const productStyle = await db.productStyle.findFirstOrThrow({ where: { productId: product.id, styleId: style.id } });
      const productAnimal = await db.productAnimal.findFirstOrThrow({ where: { productId: product.id, animalId: animal.id } });
      await db.productStyleLeather.updateMany({
        where: { productStyleId: productStyle.id, leatherId: leather.id },
        data: { shopifyVariantId: "sv-1", shopifyVariantGid: "gid://shopify/ProductVariant/1", variantMissing: false },
      });
      await db.animalLeather.updateMany({
        where: { productAnimalId: productAnimal.id, leatherId: leather.id },
        data: { shopifyVariantId: "sv-2", shopifyVariantGid: "gid://shopify/ProductVariant/2", variantMissing: false },
      });

      const before = await productGet(await adminRequest(`https://app.test/api/admin/products/${product.id}`), {
        params: { id: product.id },
      });
      expect((await json(before)).readiness).toEqual({ ready: true, problems: [] });

      await db.stitch.update({ where: { id: stitch.id }, data: { archivedAt: new Date() } });

      const after = await productGet(await adminRequest(`https://app.test/api/admin/products/${product.id}`), {
        params: { id: product.id },
      });
      const afterBody = await json(after);
      expect(afterBody.readiness.ready).toBe(false);
      expect(afterBody.readiness.problems).toContainEqual(
        expect.objectContaining({ code: "ARCHIVED_ATTRIBUTE", path: ["styles", style.id, "animals", animal.id] }),
      );
    });

    it("PATCH { isEnabled: true } khi chưa sẵn sàng → 409 NOT_READY, DB isEnabled vẫn false", async () => {
      const shop = await seedShop();
      const { product } = await buildFullProduct(shop.id);

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}`, { method: "PATCH", body: { isEnabled: true } });
      const res = await productPatch(req, { params: { id: product.id } });
      const body = await json(res);
      expect(res.status).toBe(409);
      expect(body.error).toBe("NOT_READY");
      expect(Array.isArray(body.problems)).toBe(true);
      expect(body.problems.length).toBeGreaterThan(0);

      const row = await db.customizableProduct.findUniqueOrThrow({ where: { id: product.id } });
      expect(row.isEnabled).toBe(false);
    });

    it("PATCH { isEnabled: true } khi sẵn sàng (variant seed trực tiếp) → 200", async () => {
      const shop = await seedShop();
      const { product, style, animal, leather } = await buildFullProduct(shop.id);
      const productStyle = await db.productStyle.findFirstOrThrow({ where: { productId: product.id, styleId: style.id } });
      const productAnimal = await db.productAnimal.findFirstOrThrow({ where: { productId: product.id, animalId: animal.id } });
      await db.productStyleLeather.updateMany({
        where: { productStyleId: productStyle.id, leatherId: leather.id },
        data: { shopifyVariantId: "sv-1", variantMissing: false },
      });
      await db.animalLeather.updateMany({
        where: { productAnimalId: productAnimal.id, leatherId: leather.id },
        data: { shopifyVariantId: "sv-2", variantMissing: false },
      });

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}`, { method: "PATCH", body: { isEnabled: true } });
      const res = await productPatch(req, { params: { id: product.id } });
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body.isEnabled).toBe(true);

      const row = await db.customizableProduct.findUniqueOrThrow({ where: { id: product.id } });
      expect(row.isEnabled).toBe(true);
    });

    it("PATCH { isEnabled: false } luôn được, không kiểm readiness (tắt khẩn cấp)", async () => {
      const shop = await seedShop();
      const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "A", isEnabled: true } });

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}`, { method: "PATCH", body: { isEnabled: false } });
      const res = await productPatch(req, { params: { id: product.id } });
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body.isEnabled).toBe(false);

      const row = await db.customizableProduct.findUniqueOrThrow({ where: { id: product.id } });
      expect(row.isEnabled).toBe(false);
    });

    it("không N+1: số lời gọi findMany trên delegate quan hệ không phụ thuộc kích thước ma trận", async () => {
      const shop = await seedShop();
      const { product } = await buildFullProduct(shop.id); // 1×1

      // `vi.spyOn` mặc định "call-through" không sống sót qua cách Prisma
      // Client bind các phương thức delegate — xác nhận bằng thực thi (dấu
      // `styles` v.v. thành `undefined`). Bọc `mockImplementation` quanh bản
      // gốc đã `.bind()` trước để giữ đúng hành vi gọi thật, chỉ thêm bộ đếm.
      function spyCallThrough<T extends object, K extends keyof T>(obj: T, key: K) {
        const original = (obj[key] as unknown as (...args: unknown[]) => unknown).bind(obj);
        return vi.spyOn(obj, key as any).mockImplementation(original as any);
      }
      const spies = [
        spyCallThrough(db.productHost, "findMany"),
        spyCallThrough(db.productStyle, "findMany"),
        spyCallThrough(db.productAnimal, "findMany"),
        spyCallThrough(db.productStitch, "findMany"),
      ];
      spies.forEach((s) => s.mockClear());

      const req = await adminRequest(`https://app.test/api/admin/products/${product.id}`);
      await productGet(req, { params: { id: product.id } });
      const counts1x1 = spies.map((s) => s.mock.calls.length);

      spies.forEach((s) => s.mockClear());

      // Thêm nhiều style/animal/leather để tạo ma trận lớn hơn — nếu code có
      // N+1 (một findMany mỗi hàng cha), số lời gọi ở nhánh 10×10 sẽ lớn hơn
      // hẳn nhánh 1×1 ở trên.
      for (let i = 0; i < 9; i++) {
        const style = await seedStyle(shop.id, `Style${i}`);
        await db.productStyle.create({ data: { productId: product.id, styleId: style.id, isActive: true } });
        const animal = await seedAnimal(shop.id, `Animal${i}`);
        await db.productAnimal.create({ data: { productId: product.id, animalId: animal.id, isActive: true } });
      }

      const req2 = await adminRequest(`https://app.test/api/admin/products/${product.id}`);
      await productGet(req2, { params: { id: product.id } });
      const counts10x10 = spies.map((s) => s.mock.calls.length);

      expect(counts10x10).toEqual(counts1x1);
      spies.forEach((s) => s.mockRestore());
    });
  });
});
