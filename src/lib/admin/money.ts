import { Prisma } from "@prisma/client";
import { z } from "zod";

/** Decimal(10,2): tối đa 8 chữ số phần nguyên. */
const MAX_CENTS = 9_999_999_999;
const PRICE_STRING = /^\d{1,8}(?:\.\d{1,2})?$/;

/**
 * Giá admin gửi lên: chuỗi hoặc số, không âm, tối đa 2 chữ số thập phân.
 * Chuẩn hoá về chuỗi "80.00" — tiền không bao giờ đi qua float trong đường ghi.
 * Số như `0.1 + 0.2` bị TỪ CHỐI chứ không làm tròn: làm tròn tiền âm thầm là
 * cách một cent biến mất.
 *
 * LƯU Ý so với bản nháp trong brief: bản nháp dùng dung sai `1e-6` trên
 * `value * 100` để phát hiện số không "tròn cent". Dung sai đó KHÔNG tách
 * được `0.1 + 0.2` (số) khỏi `19.99` (số hợp lệ phải chấp nhận) — đã kiểm
 * bằng thực thi: `(0.1+0.2)*100` lệch số nguyên gần nhất chỉ 3.5e-15, còn
 * `19.99*100` lệch 2.3e-13, tức sai số biểu diễn của 19.99 CÒN LỚN HƠN sai số
 * của phép cộng 0.1+0.2. Không có ngưỡng dung sai nào chấp nhận 19.99 mà từ
 * chối 0.1+0.2 cùng lúc.
 *
 * Cách sửa: chuyển số về chuỗi bằng `String(value)` — JS luôn in ra chuỗi
 * NGẮN NHẤT khôi phục đúng giá trị float đó — rồi áp đúng regex 2-chữ-số-thập-
 * phân dùng cho nhánh chuỗi. `String(19.99) === "19.99"` (khớp regex, chấp
 * nhận); `String(0.1 + 0.2) === "0.30000000000000004"` (không khớp, từ chối).
 * Cách này cũng gộp luôn việc kiểm âm/NaN/Infinity: `String(-1)` không khớp
 * (regex không có dấu trừ), `String(NaN)` = "NaN", `String(Infinity)` =
 * "Infinity" — cả hai không khớp regex, không cần kiểm `Number.isFinite`
 * riêng.
 */
export const priceSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const asString = typeof value === "number" ? String(value) : value;
  if (!PRICE_STRING.test(asString)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Giá phải có dạng 80 hoặc 80.50" });
    return z.NEVER;
  }
  const [whole, fraction = ""] = asString.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents > MAX_CENTS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Giá vượt quá 99999999.99" });
    return z.NEVER;
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
});

/** Decimal Prisma → "80.00". Không bao giờ JSON.stringify thẳng một Decimal. */
export function formatPrice(value: Prisma.Decimal | null | undefined): string | null {
  return value == null ? null : value.toFixed(2);
}
