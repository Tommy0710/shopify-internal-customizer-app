import { parseSvgFromText } from "@/lib/svg/parseSvgNode";

/**
 * Parse SVG text thành một Element dùng được cho svg-engine.
 *
 * KHÔNG có logic riêng ở đây: helper này uỷ quyền hoàn toàn cho adapter
 * production `src/lib/svg/parseSvgNode.ts`. Trước đây phần bù namespace của
 * linkedom chỉ tồn tại trong file test này — nghĩa là 124 test xanh trong khi
 * phía server từ chối mọi tài liệu hợp lệ. Đúng một implementation, và test
 * chạy qua chính đoạn code mà production chạy.
 */
export function parseSvg(text: string): Element {
  return parseSvgFromText(text);
}
