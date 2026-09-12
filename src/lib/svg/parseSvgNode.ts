import { DOMParser } from "linkedom";
import { SVG_NAMESPACE } from "@/svg-engine/contract";

/**
 * Tầng parse SVG cho phía Node (upload validator, bake lúc có đơn).
 *
 * Vì sao file này nằm NGOÀI `src/svg-engine/`: engine là thư viện thuần, không
 * bao giờ tự dựng parser — cả ba consumer (widget storefront, preview admin,
 * server) tự parse ở tầng của mình rồi đưa Element vào. Đặt linkedom vào trong
 * engine sẽ phải khoét một ngoại lệ vào chính hàng rào đó.
 *
 * BÙ NAMESPACE CHO LINKEDOM: linkedom không bao giờ phân giải thuộc tính
 * `xmlns` thành `namespaceURI` — mọi phần tử đều mang
 * `http://www.w3.org/1999/xhtml`. Validator (đúng đắn) yêu cầu
 * `namespaceURI === SVG_NAMESPACE`, nên nếu không bù ở đây thì phía server từ
 * chối MỌI tài liệu hợp lệ và `bakeDesign` ném lỗi ở mọi đơn hàng. Việc bù
 * phải nằm ở tầng parse chứ không phải trong validator: validator đọc thuộc
 * tính `xmlns` chính là hình dạng của con bug mà phase này đã sửa một lần.
 *
 * Bù CÓ ĐIỀU KIỆN: chỉ khi `xmlns` đúng bằng namespace SVG. Thiếu `xmlns` hoặc
 * `xmlns` khác thì không đụng gì — validator vẫn phải từ chối, y như trình
 * duyệt.
 */
export class SvgParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SvgParseError";
  }
}

/**
 * Parse text thành phần tử `<svg>` gốc, dùng được ngay cho `src/svg-engine`.
 * Ném `SvgParseError` khi không parse được hoặc root không phải `<svg>`.
 */
export function parseSvgFromText(text: string): Element {
  let root: Element | null = null;

  try {
    const document = new DOMParser().parseFromString(text, "image/svg+xml");
    root = (document?.documentElement ?? null) as unknown as Element | null;
  } catch (error) {
    throw new SvgParseError(
      `Could not parse the file as SVG: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!root || root.localName !== "svg") {
    throw new SvgParseError("Document root is not an <svg> element");
  }

  if (root.getAttribute("xmlns") === SVG_NAMESPACE && root.namespaceURI !== SVG_NAMESPACE) {
    Object.defineProperty(root, "namespaceURI", {
      value: SVG_NAMESPACE,
      writable: false,
      enumerable: true,
      configurable: true,
    });
  }

  return root;
}
