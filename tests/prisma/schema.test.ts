import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

const SCHEMA = readFileSync(
  fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)),
  "utf8",
);

/** Lấy phần thân của một `model X { … }`. */
function modelBody(name: string): string {
  const match = SCHEMA.match(new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Không tìm thấy model ${name}`);
  return match[1];
}

const EXPECTED_MODELS = [
  "Shop", "Asset", "Leather", "Stitch", "Animal", "Style",
  "CustomizableProduct", "ProductHost", "ProductStyle", "ProductStyleLeather",
  "ProductAnimal", "AnimalLeather", "ProductStyleAnimal", "ProductStitch",
  "CustomDesign", "CustomDesignSelection", "OrderLineDesign", "WebhookEvent",
] as const;

const EXPECTED_ENUMS = {
  AssetKind: ["SVG_MOCKUP", "TEXTURE", "DISPLAY", "DESIGN_SVG"],
  DesignStatus: ["DRAFT", "ORDERED", "CANCELLED"],
  LineRole: ["MAIN", "ADDON"],
  ProductionStatus: ["NEW", "IN_PRODUCTION", "QC", "SHIPPED", "ON_HOLD"],
  AttributeType: ["STYLE", "BODY_LEATHER", "ANIMAL", "ANIMAL_LEATHER", "STITCH"],
} as const;

describe("prisma schema", () => {
  it("khai đủ mọi model spec §7 đòi", () => {
    for (const model of EXPECTED_MODELS) {
      expect(SCHEMA, `thiếu model ${model}`).toMatch(new RegExp(`model\\s+${model}\\s*\\{`));
    }
  });

  it("không còn model nào của schema cũ", () => {
    for (const gone of ["ProductConfig", "OptionGroup", "OptionValue", "CompatibilityRule", "PriceRule", "Design", "DesignSelection", "ProductionJob"]) {
      expect(SCHEMA, `model cũ ${gone} vẫn còn`).not.toMatch(new RegExp(`model\\s+${gone}\\s*\\{`));
    }
  });

  it("khai đủ enum với đủ giá trị", () => {
    for (const [name, values] of Object.entries(EXPECTED_ENUMS)) {
      const body = SCHEMA.match(new RegExp(`enum\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
      expect(body, `thiếu enum ${name}`).toBeDefined();
      for (const value of values) {
        expect(body, `enum ${name} thiếu ${value}`).toMatch(new RegExp(`\\b${value}\\b`));
      }
    }
  });

  // Spec §7.2 — mỗi ràng buộc chống một cách hỏng dữ liệu cụ thể.
  it.each([
    ["Asset", "@@unique([shopId, kind, checksumSha256])"],
    ["ProductStyleLeather", "@@unique([shopifyVariantId])"],
    ["AnimalLeather", "@@unique([shopifyVariantId])"],
    ["ProductStyleAnimal", "@@unique([productStyleId, animalId])"],
    ["ProductHost", "@@unique([shopId, shopifyProductId])"],
    ["CustomDesign", "@@unique([shopId, idempotencyKey])"],
    ["CustomDesign", "@@unique([shopId, shareToken])"],
    ["OrderLineDesign", "@@unique([shopifyOrderId, shopifyLineItemId])"],
    ["WebhookEvent", "@@unique([shopifyWebhookId])"],
  ])("%s giữ ràng buộc %s", (model, constraint) => {
    expect(modelBody(model).replace(/\s+/g, " ")).toContain(constraint.replace(/\s+/g, " "));
  });

  // Ruling R5 — cụm bất biến không được có FK nào.
  it.each(["CustomDesign", "CustomDesignSelection", "OrderLineDesign", "WebhookEvent"])(
    "%s không khai @relation nào (soft reference, không FK)",
    (model) => {
      expect(modelBody(model)).not.toContain("@relation");
    },
  );

  // Mặt còn lại của R5: bảng cấu hình PHẢI có FK thật.
  it.each([
    ["Leather", 3],              // shop + displayImage + textureImage
    ["ProductStyleLeather", 2],  // productStyle + leather
    ["ProductStyleAnimal", 3],   // productStyle + animal + svgAsset
  ])("%s khai ít nhất %i @relation", (model, least) => {
    expect((modelBody(model).match(/@relation/g) ?? []).length).toBeGreaterThanOrEqual(least);
  });

  // Ruling R6.
  it.each(["ProductStyleLeather", "AnimalLeather"])("%s lưu cả giá admin nhập và giá đọc ngược", (model) => {
    const body = modelBody(model);
    expect(body).toMatch(/priceInput\s+Decimal\?\s+@db\.Decimal\(10,\s*2\)/);
    expect(body).toMatch(/variantPriceSnapshot\s+Decimal\?\s+@db\.Decimal\(10,\s*2\)/);
  });

  it("client sinh ra biết mọi model", () => {
    for (const model of EXPECTED_MODELS) {
      expect(Prisma.ModelName, `client chưa generate lại?`).toHaveProperty(model);
    }
  });
});
