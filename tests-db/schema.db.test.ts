import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb, seedAsset, seedShop } from "./helpers/db";

async function seedPriceGrid() {
  const shop = await seedShop();
  const display = await seedAsset(shop.id, "DISPLAY");
  const texture = await seedAsset(shop.id, "TEXTURE");
  const style = await db.style.create({ data: { shopId: shop.id, name: "Minimalist", slug: "minimalist", displayImageAssetId: display.id } });
  const [brown, beige] = await Promise.all(
    ["suede-brown", "suede-beige"].map((slug) =>
      db.leather.create({ data: { shopId: shop.id, name: slug, slug, displayImageAssetId: display.id, textureImageAssetId: texture.id } }),
    ),
  );
  const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "Card Holder" } });
  const productStyle = await db.productStyle.create({ data: { productId: product.id, styleId: style.id } });
  return { productStyle, brown, beige };
}

describe("schema trên Postgres thật", () => {
  beforeEach(resetDb);

  it("hàng giá tồn tại được khi chưa có variant Shopify (R1)", async () => {
    const { productStyle, brown } = await seedPriceGrid();
    const row = await db.productStyleLeather.create({
      data: { productStyleId: productStyle.id, leatherId: brown.id, priceInput: "80.00" },
    });
    expect(row.shopifyVariantId).toBeNull();
    expect(row.priceInput?.toFixed(2)).toBe("80.00");
  });

  it("nhiều hàng chưa có variant cùng tồn tại dưới @@unique([shopifyVariantId])", async () => {
    const { productStyle, brown, beige } = await seedPriceGrid();
    await db.productStyleLeather.create({ data: { productStyleId: productStyle.id, leatherId: brown.id } });
    await expect(
      db.productStyleLeather.create({ data: { productStyleId: productStyle.id, leatherId: beige.id } }),
    ).resolves.toBeDefined();
  });

  it("hai hàng KHÔNG được trỏ cùng một variant — ràng buộc vẫn giữ khi có giá trị", async () => {
    const { productStyle, brown, beige } = await seedPriceGrid();
    const variant = { shopifyProductId: "1", shopifyVariantId: "44928374652", shopifyVariantGid: "gid://shopify/ProductVariant/44928374652" };
    await db.productStyleLeather.create({ data: { productStyleId: productStyle.id, leatherId: brown.id, ...variant } });
    await expect(
      db.productStyleLeather.create({ data: { productStyleId: productStyle.id, leatherId: beige.id, ...variant } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
