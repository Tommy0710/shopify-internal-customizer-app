import { z } from "zod";
import { designIdSchema } from "./ids";

/**
 * Property version. Tăng số này khi đổi hình dạng property — cho phép webhook
 * phân biệt design cũ/mới nếu sau này cần migrate cách đọc.
 */
export const WK_PROPERTY_VERSION = 1;

/**
 * Khoá kỹ thuật, luôn bắt đầu bằng `_wk_` để Shopify ẩn khỏi cart hiển thị cho
 * khách (property có tiền tố `_` không hiện trên cart/checkout mặc định).
 */
export const WK_PROP = {
  designId: "_wk_design_id",
  role: "_wk_role",
  preview: "_wk_preview",
  version: "_wk_v",
} as const;

/**
 * Nhãn hiển thị — KHÔNG có tiền tố `_wk_`, cố ý hiện ra cho khách xem trong
 * giỏ hàng/đơn hàng (ví dụ "Animal: Alligator").
 */
export const WK_LABEL = {
  animal: "Animal",
  animalLeather: "Animal Leather",
  stitch: "Stitch",
} as const;

export interface MainLineInput {
  designId: string;
  previewUrl: string;
  animalName: string;
  animalLeatherName: string;
  stitchName: string;
}

/**
 * Property cho dòng cart chính (giá trị sản phẩm). Không lặp lại "Style" hay
 * "Body Leather" — chúng đã nằm trong variant title của Shopify product.
 * Không bao giờ chứa giá hay mã hex — đó là dữ liệu định giá/thiết kế nội bộ,
 * không phải thứ hiện cho khách hay khớp nối đơn hàng.
 */
export function buildMainLineProperties(input: MainLineInput): Record<string, string> {
  return {
    [WK_PROP.designId]: input.designId,
    [WK_PROP.role]: "main",
    [WK_PROP.preview]: input.previewUrl,
    [WK_PROP.version]: String(WK_PROPERTY_VERSION),
    [WK_LABEL.animal]: input.animalName,
    [WK_LABEL.animalLeather]: input.animalLeatherName,
    [WK_LABEL.stitch]: input.stitchName,
  };
}

/**
 * Property cho dòng cart ẩn mang phụ phí giá. Chỉ ba khoá kỹ thuật — không
 * preview, không nhãn hiện cho khách (dòng này vốn ẩn). Dùng cùng `designId`
 * với dòng chính; đó là thứ duy nhất nối hai dòng lại với nhau.
 */
export function buildAddonLineProperties(designId: string): Record<string, string> {
  return {
    [WK_PROP.designId]: designId,
    [WK_PROP.role]: "addon",
    [WK_PROP.version]: String(WK_PROPERTY_VERSION),
  };
}

/**
 * Giới hạn 1–6 chữ số (tối đa 999999). `_wk_v` dùng để phân biệt design cũ/mới
 * (`parsed.version > WK_PROPERTY_VERSION` cho migration sau này) — một chuỗi
 * số không giới hạn độ dài (vd. "9".repeat(400)) sẽ `Number()` thành `Infinity`,
 * khiến check đó coi mọi design là "tương lai". Chặn ngay ở tầng chuỗi trước
 * khi `Number()` chạy, thay vì tin `.int()` bắt được `Infinity` sau đó.
 */
const versionSchema = z
  .string()
  .regex(/^\d{1,6}$/, "version phải là chuỗi số 1-6 chữ số")
  .transform(Number);

const mainRoleSchema = z.object({
  [WK_PROP.designId]: designIdSchema,
  [WK_PROP.role]: z.literal("main"),
  [WK_PROP.preview]: z.string().regex(/^https:\/\//, "preview phải là URL https://"),
  [WK_PROP.version]: versionSchema,
});

const addonRoleSchema = z.object({
  [WK_PROP.designId]: designIdSchema,
  [WK_PROP.role]: z.literal("addon"),
  [WK_PROP.version]: versionSchema,
  // Dòng addon không được mang preview. Khai rõ z.undefined() thay vì bỏ qua
  // để một dòng addon bị gắn _wk_preview (cố ý hay do bug) bị TỪ CHỐI, không
  // âm thầm rơi rụng — spec §4.4 muốn phát hiện lệch dữ liệu, không che nó đi.
  [WK_PROP.preview]: z.undefined(),
});

const lineItemPropertiesSchema = z.discriminatedUnion(WK_PROP.role, [mainRoleSchema, addonRoleSchema]);

export type ParsedLineProperties =
  | { role: "main"; designId: string; version: number; previewUrl: string }
  | { role: "addon"; designId: string; version: number };

function toParsed(
  data: z.infer<typeof mainRoleSchema> | z.infer<typeof addonRoleSchema>,
): ParsedLineProperties {
  // Dot-notation (không phải `data[WK_PROP.role]`) — TS chỉ hẹp discriminated
  // union qua truy cập chỉ mục tĩnh, bracket access qua biến không hẹp được dù
  // biến đó có kiểu literal.
  if (data._wk_role === "main") {
    return {
      role: "main",
      designId: data._wk_design_id,
      version: data._wk_v,
      previewUrl: data._wk_preview,
    };
  }
  return {
    role: "addon",
    designId: data._wk_design_id,
    version: data._wk_v,
  };
}

/**
 * Chuẩn hoá hai dạng property Shopify gửi về một `Record<string, unknown>`:
 * - object phẳng `{ [key]: value }` — dạng client tự gửi qua Cart AJAX API.
 * - mảng `{ name, value }[]` — dạng Shopify trả trong payload webhook.
 *
 * Trả `null` cho bất cứ thứ gì không khớp hai dạng trên, kể cả `null`/chuỗi/số.
 */
function normalizeToRecord(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;

  if (Array.isArray(raw)) {
    const record: Record<string, string> = {};
    for (const entry of raw) {
      if (typeof entry !== "object" || entry === null) return null;
      const { name, value } = entry as Record<string, unknown>;
      if (typeof name !== "string" || typeof value !== "string") return null;
      record[name] = value;
    }
    return record;
  }

  if (typeof raw === "object") return raw as Record<string, unknown>;

  return null;
}

/**
 * Property line item đến từ Cart AJAX API và webhook là dữ liệu người lạ ghi
 * được, không phải dữ liệu ta ghi ra — nên parse bằng zod, đừng `as` thẳng.
 *
 * Không bao giờ ném lỗi: webhook xử lý MỌI đơn hàng, kể cả đơn không custom,
 * và một exception ở đó nghĩa là Shopify retry vô hạn. Bất cứ thứ gì không
 * parse được trả về `null` để caller coi đó là "không phải đơn custom".
 */
export function parseLineProperties(raw: unknown): ParsedLineProperties | null {
  const record = normalizeToRecord(raw);
  if (record === null) return null;

  const result = lineItemPropertiesSchema.safeParse(record);
  if (!result.success) return null;

  return toParsed(result.data);
}
