/**
 * Chuẩn hoá đầu vào màu thành hex sáu ký tự viết hoa.
 *
 * Port từ implementation nguyên mẫu tại
 * `test svg/src/stitches-color.js`. Trả `null` cho mọi giá trị không hợp lệ —
 * caller có trách nhiệm KHÔNG ghi `null` vào SVG (guide §6).
 */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const draft = value.trim().replace(/^#/, "");

  if (/^[0-9a-f]{3}$/i.test(draft)) {
    return `#${[...draft].map((character) => character.repeat(2)).join("").toUpperCase()}`;
  }

  if (/^[0-9a-f]{6}$/i.test(draft)) {
    return `#${draft.toUpperCase()}`;
  }

  return null;
}
