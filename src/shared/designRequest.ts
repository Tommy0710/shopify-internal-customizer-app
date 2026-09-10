import { z } from "zod";
import { designIdSchema, shareTokenSchema } from "./ids";

/**
 * POST /apps/customizer/designs — tạo design từ lựa chọn của khách, đổi lấy
 * hai dòng cart cần add. Xem spec §8.2. "Không có endpoint /validate riêng —
 * validate LÀ tạo, một round-trip."
 */

/** Id Shopify là số 64-bit. Giữ dạng chuỗi ở mọi nơi — number sẽ mất chính xác. */
const shopifyId = z.string().regex(/^\d+$/, "id Shopify phải là chuỗi chữ số");
const httpsUrl = z.string().url().startsWith("https://");

/**
 * uuid v4 cụ thể, không phải uuid nói chung — client sinh key này một lần khi
 * mount và gửi lại nguyên vẹn khi retry (idempotency theo (shopId, key)).
 */
const uuidV4 = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89abAB][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "idempotencyKey phải là uuid v4",
  );

export const createDesignRequestSchema = z.object({
  // Id Shopify của TRANG đang đứng — cùng giá trị với `?productId=` của GET config,
  // KHÔNG phải `product.id` nội bộ mà config trả về. Server cần đúng id này để tra
  // `ProductHost(shopId, shopifyProductId)` và xác minh mọi lựa chọn thuộc về product
  // mà trang đó thật sự host. Widget có sẵn nó từ `data-*` của App Block.
  productId: shopifyId,
  styleId: z.string().min(1),
  bodyLeatherId: z.string().min(1),
  animalId: z.string().min(1),
  animalLeatherId: z.string().min(1),
  stitchId: z.string().min(1),
  idempotencyKey: uuidV4,
});

export type CreateDesignRequest = z.infer<typeof createDesignRequestSchema>;

/** Một dòng cart cần add qua Cart AJAX API — dòng chính hoặc dòng addon ẩn. */
const lineSchema = z.object({
  variantId: shopifyId,
  quantity: z.number().int().positive(),
  properties: z.record(z.string(), z.string()),
});

/**
 * bodyPrice/animalPrice/total là số tiền (đơn vị lớn, có thể có phần thập
 * phân). So sánh bất biến `total === bodyPrice + animalPrice` phải quy đổi ra
 * **cent nguyên** trước khi so — cộng float trực tiếp có thể sai (0.1 + 0.2
 * !== 0.3 trong IEEE754) dù đúng về mặt tiền tệ.
 */
const toCents = (amount: number): number => Math.round(amount * 100);

const summarySchema = z
  .object({
    // `.finite()`: nonnegative() vẫn cho Infinity qua, và Infinity === Infinity
    // làm refine bên dưới gật đầu với một phản hồi server hỏng.
    bodyPrice: z.number().finite().nonnegative(),
    animalPrice: z.number().finite().nonnegative(),
    total: z.number().finite().nonnegative(),
  })
  .refine((summary) => toCents(summary.total) === toCents(summary.bodyPrice) + toCents(summary.animalPrice), {
    message: "total phải bằng bodyPrice + animalPrice (so sánh bằng cent nguyên)",
    path: ["total"],
  });

/**
 * Mô hình hai dòng cart (một dòng chính + một dòng addon ẩn) là bất biến
 * cứng của spec §4.2 — tuple, không phải array kiểm độ dài, để type suy ra là
 * `[Line, Line]` và P3 truy cập lines[0]/lines[1] không cần kiểm undefined.
 */
export const createDesignResponseSchema = z.object({
  designId: designIdSchema,
  shareToken: shareTokenSchema,
  previewUrl: httpsUrl,
  lines: z.tuple([lineSchema, lineSchema]),
  summary: summarySchema,
});

export type CreateDesignResponse = z.infer<typeof createDesignResponseSchema>;

/** Sáu mã lỗi spec §8.2 liệt kê — đúng bằng, không thiếu không thừa. */
export const DESIGN_ERROR_CODES = [
  "NOT_AVAILABLE",
  "NOT_IN_PRODUCT",
  "MISSING_SVG",
  "VARIANT_MISSING",
  "VARIANT_UNAVAILABLE",
  "INVALID_COMBINATION",
] as const;

export const designErrorCodeSchema = z.enum(DESIGN_ERROR_CODES);

export type DesignErrorCode = z.infer<typeof designErrorCodeSchema>;
