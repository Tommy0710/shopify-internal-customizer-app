import { describe, expect, it } from "vitest";
import { customizerConfigSchema } from "@/shared/customizerConfig";

/**
 * Fixture khớp đúng ví dụ JSON ở spec §8.2 (mục "8.2. Storefront —
 * `/apps/customizer/*`"). Mọi test dưới đây clone + sửa fixture này.
 */
function validConfig() {
  return {
    product: {
      id: "cfg_01",
      name: "Custom Animal Card Holder",
      preselectStyleId: "sty_01",
    },
    leathers: [
      {
        id: "lth_01",
        name: "Suede Brown",
        displayImageUrl: "https://cdn.example.com/display/ab12.webp",
        textureImageUrl: "https://cdn.example.com/texture/cd34.webp",
        sortOrder: 1,
      },
    ],
    stitches: [
      {
        id: "st_01",
        name: "Gold",
        colorHex: "#E7C337",
        displayImageUrl: "https://cdn.example.com/stitch/gold.webp",
      },
    ],
    styles: [
      {
        id: "sty_01",
        name: "Minimalist",
        displayImageUrl: "https://cdn.example.com/style/sty01.webp",
        leathers: [{ leatherId: "lth_01", variantId: "44928374652" }],
        animals: [
          {
            id: "psa_01",
            animalId: "ani_01",
            label: "Alligator",
            description: "Đường vân tự nhiên, sang trọng.",
            displayImageUrl: "https://cdn.example.com/psa/psa01.webp",
            svgUrl: "https://cdn.example.com/svg/9f8e7d.svg",
            defaultStitchId: "st_01",
          },
        ],
      },
    ],
    animals: [
      {
        id: "ani_01",
        name: "Alligator",
        displayImageUrl: "https://cdn.example.com/animal/ani01.webp",
        leathers: [{ leatherId: "lth_01", variantId: "55110022334" }],
      },
    ],
  };
}

describe("customizerConfigSchema", () => {
  it("parse thành công fixture đầy đủ đúng ví dụ spec §8.2", () => {
    const result = customizerConfigSchema.safeParse(validConfig());
    expect(result.success).toBe(true);
  });

  it("preselectStyleId là optional — đóng gói 1-product không có nó vẫn parse được", () => {
    const config = validConfig();
    delete (config.product as { preselectStyleId?: string }).preselectStyleId;

    const result = customizerConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("thiếu textureImageUrl ở một leather → fail (customizer không render được thân ví)", () => {
    const config = validConfig();
    delete (config.leathers[0] as { textureImageUrl?: string }).textureImageUrl;

    const result = customizerConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it.each([
    ["tên màu thay vì hex", "red"],
    ["hex rút gọn 3 ký tự", "#FFF"],
    ["thiếu dấu #", "E7C337"],
    ["hex quá dài", "#E7C337AA"],
  ])("colorHex của stitch từ chối %s", (_label, badHex) => {
    const config = validConfig();
    config.stitches[0].colorHex = badHex;

    const result = customizerConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("colorHex hợp lệ dạng #RRGGBB parse được", () => {
    const config = validConfig();
    config.stitches[0].colorHex = "#000000";

    expect(customizerConfigSchema.safeParse(config).success).toBe(true);
  });

  it("variantId phải là chuỗi chữ số, không phải number — Shopify id 64-bit mất chính xác qua JSON.parse(number)", () => {
    const config = validConfig();
    // @ts-expect-error cố tình gửi number để test zod từ chối
    config.styles[0].leathers[0].variantId = 44928374652;

    const result = customizerConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("variantId chuỗi không toàn chữ số → fail", () => {
    const config = validConfig();
    config.animals[0].leathers[0].variantId = "abc123";

    const result = customizerConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("mảng leathers rỗng vẫn parse được — product chưa cấu hình xong", () => {
    const config = validConfig();
    config.leathers = [];

    const result = customizerConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("mảng styles rỗng vẫn parse được — product chưa cấu hình xong", () => {
    const config = validConfig();
    config.styles = [];

    const result = customizerConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("styles[].animals[].svgUrl thiếu → fail", () => {
    const config = validConfig();
    delete (config.styles[0].animals[0] as { svgUrl?: string }).svgUrl;

    const result = customizerConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("payload thừa khoá lạ vẫn parse được, và khoá lạ bị loại bỏ — tương thích ngược quan trọng nhất của task này", () => {
    // Server thêm field mới theo thời gian; widget cũ đang chạy trên theme của
    // merchant KHÔNG được vỡ khi payload có thêm khoá nó chưa biết. zod
    // z.object() mặc định "strip" — khoá lạ bị loại, không bị coi là lỗi và
    // cũng không được giữ lại trong kết quả parse.
    const config = validConfig() as Record<string, unknown>;
    config.futureTopLevelField = "server thêm sau này";
    (config.product as Record<string, unknown>).futureProductField = 123;
    (config.leathers as Array<Record<string, unknown>>)[0].futureLeatherField = "x";

    const result = customizerConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("futureTopLevelField");
      expect(result.data.product).not.toHaveProperty("futureProductField");
      expect(result.data.leathers[0]).not.toHaveProperty("futureLeatherField");
    }
  });
});

// Hợp đồng phải nhận đúng thứ DB sinh ra được. Các cột này nullable trong
// prisma/schema.prisma; server serialize qua JSON nên chúng đến dưới dạng
// `null`, không phải vắng mặt. Từ chối null ở đây nghĩa là một stitch lưu
// không kèm ảnh làm sập customizer trên MỌI trang host product đó.
describe("customizerConfigSchema — cột DB nullable đến dưới dạng null", () => {
  const viaJson = (value: unknown) => JSON.parse(JSON.stringify(value));

  it.each([
    ["product.preselectStyleId (ProductHost, đóng gói 1-product)", (c: any) => { c.product.preselectStyleId = null; }],
    ["stitches[].displayImageUrl (Stitch.displayImageAssetId)", (c: any) => { c.stitches[0].displayImageUrl = null; }],
    ["styles[].animals[].defaultStitchId (ProductStyleAnimal)", (c: any) => { c.styles[0].animals[0].defaultStitchId = null; }],
    ["styles[].animals[].description (ProductStyleAnimal)", (c: any) => { c.styles[0].animals[0].description = null; }],
  ])("nhận null ở %s", (_label, mutate) => {
    const config = viaJson(validConfig());
    mutate(config);
    const result = customizerConfigSchema.safeParse(viaJson(config));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  // `label` KHÔNG nullish có chủ đích: server phải điền `displayLabel ?? animal.name`.
  // Widget luôn cần một nhãn để hiển thị; đẩy fallback về một chỗ (server) thay vì
  // bắt mọi widget tự xử lý.
  it("label vẫn bắt buộc — server chịu trách nhiệm fallback về tên animal", () => {
    const config = viaJson(validConfig());
    config.styles[0].animals[0].label = null;
    expect(customizerConfigSchema.safeParse(config).success).toBe(false);
  });

  it("các trường bắt buộc trong DB vẫn không nhận null", () => {
    const config = viaJson(validConfig());
    config.leathers[0].textureImageUrl = null;
    expect(customizerConfigSchema.safeParse(config).success).toBe(false);
  });
});
