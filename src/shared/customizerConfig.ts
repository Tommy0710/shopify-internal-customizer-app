import { z } from "zod";

/**
 * GET /apps/customizer/config — catalog công khai cho một trang sản phẩm.
 * Xem spec §8.2 để có ví dụ JSON đầy đủ.
 */

/** Id Shopify là số 64-bit. Giữ dạng chuỗi ở mọi nơi — number sẽ mất chính xác. */
const shopifyId = z.string().regex(/^\d+$/, "id Shopify phải là chuỗi chữ số");
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "màu phải là #RRGGBB");
const httpsUrl = z.string().url().startsWith("https://");

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Chỉ có giá trị khi ProductHost mang preselectStyleId (đóng gói N-product).
  // Đóng gói 1-product: cột NULL trong DB, đến đây là `null` qua JSON.
  // `.nullish()` ở đây và bên dưới = khớp đúng cột nullable trong prisma/schema.prisma;
  // tests/shared/customizerConfig.test.ts khẳng định từng trường.
  preselectStyleId: z.string().nullish(),
});

const leatherSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayImageUrl: httpsUrl,
  // Bắt buộc: thiếu texture là customizer không render được thân ví.
  textureImageUrl: httpsUrl,
  sortOrder: z.number(),
});

const stitchSchema = z.object({
  id: z.string(),
  name: z.string(),
  colorHex: hexColor,
  // Stitch.displayImageAssetId nullable — không có ảnh thì widget vẽ chấm màu từ colorHex.
  displayImageUrl: httpsUrl.nullish(),
});

/** Tham chiếu leather trong style/animal — mang theo variantId để client tra giá qua wk-variants. */
const leatherVariantRefSchema = z.object({
  leatherId: z.string(),
  variantId: shopifyId,
});

const styleAnimalSchema = z.object({
  id: z.string(),
  animalId: z.string(),
  // Bắt buộc có chủ đích dù cột displayLabel nullable: server điền
  // `displayLabel ?? animal.name`, để widget không phải tự fallback.
  label: z.string(),
  description: z.string().nullish(),
  displayImageUrl: httpsUrl,
  // Bắt buộc: không có SVG thì không tô màu được animal appliqué lên preview.
  svgUrl: httpsUrl,
  // Null = không có mặc định riêng cho tổ hợp này; widget dùng stitch đầu tiên.
  defaultStitchId: z.string().nullish(),
});

const styleSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayImageUrl: httpsUrl,
  leathers: z.array(leatherVariantRefSchema),
  animals: z.array(styleAnimalSchema),
});

const animalSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayImageUrl: httpsUrl,
  leathers: z.array(leatherVariantRefSchema),
});

/**
 * z.object() mặc định "strip" khoá lạ — server thêm field mới theo thời gian
 * không làm vỡ widget cũ đang chạy trên theme của merchant. Đây là bất biến
 * tương thích ngược quan trọng nhất của module này; xem test riêng trong
 * tests/shared/customizerConfig.test.ts khẳng định rõ điều đó.
 */
export const customizerConfigSchema = z.object({
  product: productSchema,
  leathers: z.array(leatherSchema),
  stitches: z.array(stitchSchema),
  styles: z.array(styleSchema),
  animals: z.array(animalSchema),
});

export type CustomizerConfig = z.infer<typeof customizerConfigSchema>;
