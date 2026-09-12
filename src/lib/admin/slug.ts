/**
 * Chuyển tên hiển thị (leather/stitch/animal/style) thành slug URL-safe.
 *
 * Quy trình: lowercase → thay riêng "đ"/"Đ" thành "d" (KHÔNG tách được bằng
 * NFD — nó không phải một chữ cái Latin cơ bản + dấu tổ hợp, mà là một chữ
 * cái riêng trong Unicode) → NFD decompose rồi bỏ các dấu tổ hợp (khoảng
 * ̀–ͯ — dấu sắc/huyền/hỏi/ngã/nặng và các dấu mũ/trăng tiếng Việt
 * đều nằm trong khoảng này) → thay mọi dải ký tự không phải [a-z0-9] bằng một
 * dấu gạch ngang duy nhất → cắt gạch ngang ở đầu/cuối.
 *
 * Chuỗi chỉ toàn ký tự đặc biệt (không còn chữ/số nào sau khi lọc) trả về
 * `""` — caller (create handler trong `attributes.ts`) chịu trách nhiệm biến
 * đó thành lỗi 422 `field: "slug"`, `slugify` không tự ném lỗi.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DIACRITIC_MARKS = /[̀-ͯ]/g;
const NON_SLUG_CHARS = /[^a-z0-9]+/g;
const LEADING_TRAILING_DASHES = /^-+|-+$/g;

export function slugify(name: string): string {
  const withoutDStroke = name.trim().toLowerCase().replace(/đ/g, "d");
  const decomposed = withoutDStroke.normalize("NFD").replace(DIACRITIC_MARKS, "");
  return decomposed.replace(NON_SLUG_CHARS, "-").replace(LEADING_TRAILING_DASHES, "");
}
