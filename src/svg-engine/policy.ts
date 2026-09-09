/**
 * Chính sách ALLOWLIST dùng chung cho cả hai cổng an toàn của engine:
 * `sanitizeSvgRoot` (cổng biến đổi, chạy lúc upload) và `validateSvgContract`
 * (cổng kiểm tra độc lập, chạy trước khi hiển thị hoặc bake).
 *
 * Vì sao allowlist chứ không phải blocklist: ba blocklist độc lập (tên phần tử,
 * tên thuộc tính, tiền tố scheme) đều đã rò trong cùng một vòng review —
 * `<style>`, `<embed>`, `xl:href`, `src`, và một dấu cách đứng trước
 * `javascript:`. Vá từng lỗ trong một biên giới bảo mật là nước cờ thua: mọi
 * phần tử/thuộc tính/scheme MỚI mặc định là NGUY HIỂM cho tới khi được thêm
 * vào đây một cách có chủ đích.
 *
 * Danh sách dưới đây suy ra từ hai fixture mockup thật
 * (`tests/fixtures/svg/*.svg`) cộng các phần tử hợp đồng bắt buộc, rồi mở rộng
 * sang những phần tử/thuộc tính SVG thuần trình bày tương đương (shape
 * primitive, filter primitive, thuộc tính presentation) — không cái nào chạy
 * được script, nạp tài liệu ngoài, hay tạo ngữ cảnh duyệt.
 *
 * Cố tình KHÔNG có trong danh sách:
 * - `script`, `style`: `<style>` inline KHÔNG bị giới hạn trong SVG, nó áp cho
 *   cả trang chủ — mở đường cho `@import` gọi ra ngoài, rò giá trị thuộc tính
 *   qua chuỗi selector, và phủ UI bằng `*{position:fixed}`.
 * - `foreignObject`, `iframe`, `embed`, `object`, `audio`, `video`, `canvas`,
 *   `handler`: nạp hoặc chạy nội dung ngoài SVG. `<embed>` còn nằm trong danh
 *   sách breakout foreign-content của HTML parser.
 * - `animate`, `animateTransform`, `animateMotion`, `set`: SMIL ghi đè được
 *   thuộc tính SAU khi sanitize đã chạy xong.
 * - `feImage`: filter primitive DUY NHẤT nạp tài nguyên ngoài.
 * - `metadata`: chứa XML tuỳ ý, kể cả HTML.
 * - mọi thuộc tính `on*`.
 */

/** So khớp bằng localName đã hạ chữ thường. */
export const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  // Cấu trúc
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "a",
  "title",
  "desc",
  // Hình
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polygon",
  "polyline",
  "image",
  "text",
  "tspan",
  // Paint server
  "lineargradient",
  "radialgradient",
  "stop",
  "pattern",
  // Cắt và che
  "clippath",
  "mask",
  "marker",
  // Filter primitive (trừ feImage)
  "filter",
  "feblend",
  "fecolormatrix",
  "fecomponenttransfer",
  "fecomposite",
  "feconvolvematrix",
  "fediffuselighting",
  "fedisplacementmap",
  "fedistantlight",
  "fedropshadow",
  "feflood",
  "fefunca",
  "fefuncb",
  "fefuncg",
  "fefuncr",
  "fegaussianblur",
  "femerge",
  "femergenode",
  "femorphology",
  "feoffset",
  "fepointlight",
  "fespecularlighting",
  "fespotlight",
  "fetile",
  "feturbulence",
]);

/**
 * So khớp CHÍNH XÁC theo chữ hoa/thường như file khai báo. SVG phân biệt hoa
 * thường (`viewBox`, `baseFrequency`), và so khớp chính xác đóng luôn đường
 * vòng `HREF=` / `ONCLICK=`: mọi biến thể sai chữ đều rơi ra ngoài allowlist.
 */
export const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  // Lõi
  "id",
  "class",
  "style",
  "transform",
  "viewBox",
  "version",
  "xmlns",
  "xmlns:xlink",
  "xml:space",
  "preserveAspectRatio",
  "href",
  "xlink:href",
  "role",
  "aria-hidden",
  "aria-label",
  "aria-labelledby",
  "hidden",
  "visibility",
  "display",
  "overflow",
  "pointer-events",
  "vector-effect",
  "shape-rendering",
  "image-rendering",
  "color-interpolation-filters",
  "color",
  "opacity",
  "mix-blend-mode",
  "isolation",
  "paint-order",
  // Hình học
  "x",
  "y",
  "width",
  "height",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x1",
  "y1",
  "x2",
  "y2",
  "d",
  "points",
  "dx",
  "dy",
  "offset",
  "rotate",
  "pathLength",
  "textLength",
  "lengthAdjust",
  // Tô và nét
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "clip-path",
  "clip-rule",
  "mask",
  "filter",
  "marker-start",
  "marker-mid",
  "marker-end",
  "stop-color",
  "stop-opacity",
  "flood-color",
  "flood-opacity",
  "lighting-color",
  // Chữ
  "font-family",
  "font-size",
  "font-style",
  "font-stretch",
  "font-variant",
  "font-weight",
  "letter-spacing",
  "word-spacing",
  "text-anchor",
  "text-decoration",
  "dominant-baseline",
  "alignment-baseline",
  "baseline-shift",
  "white-space",
  "writing-mode",
  // Gradient và pattern
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "fx",
  "fy",
  "fr",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  // Clip, mask, marker
  "clipPathUnits",
  "maskUnits",
  "maskContentUnits",
  "markerUnits",
  "markerWidth",
  "markerHeight",
  "refX",
  "refY",
  "orient",
  // Filter
  "filterUnits",
  "primitiveUnits",
  "in",
  "in2",
  "result",
  "mode",
  "operator",
  "k1",
  "k2",
  "k3",
  "k4",
  "values",
  "type",
  "tableValues",
  "slope",
  "intercept",
  "amplitude",
  "exponent",
  "stdDeviation",
  "edgeMode",
  "order",
  "kernelMatrix",
  "divisor",
  "bias",
  "targetX",
  "targetY",
  "preserveAlpha",
  "radius",
  "scale",
  "xChannelSelector",
  "yChannelSelector",
  "baseFrequency",
  "numOctaves",
  "seed",
  "stitchTiles",
  "surfaceScale",
  "specularConstant",
  "specularExponent",
  "diffuseConstant",
  "azimuth",
  "elevation",
  "pointsAtX",
  "pointsAtY",
  "pointsAtZ",
  "limitingConeAngle",
  "z",
]);

/** Thuộc tính mang URL trực tiếp, không qua `url(...)`. */
export const HREF_ATTRIBUTES: readonly string[] = ["href", "xlink:href"];

/**
 * Chuẩn hoá y như WHATWG URL parser làm TRƯỚC khi đọc scheme: gỡ toàn bộ C0
 * control và space (U+0000–U+0020) ở hai đầu, rồi gỡ mọi tab / line-feed /
 * carriage-return nằm bên trong.
 *
 * Thiếu vế đầu thì `" javascript:alert(1)"` lọt lưới trong khi trình duyệt vẫn
 * chạy nó; thiếu vế sau thì `"java\tscript:"` lọt.
 */
export function normalizeUrlForSchemeCheck(value: string): string {
  return value
    .replace(/^[\u0000-\u0020]+/, "")
    .replace(/[\u0000-\u0020]+$/, "")
    .replace(/[\t\n\r]/g, "");
}

/**
 * Scheme được phép: fragment cùng tài liệu (`#…`), `https:`, và `data:image/*`.
 * Mọi thứ khác — kể cả `http:`, `//host`, đường dẫn tương đối, `blob:`,
 * `javascript:`, `data:text/html` — bị loại.
 *
 * Chuỗi rỗng hợp lệ: nó trỏ về chính tài liệu hiện tại, không nạp gì từ ngoài.
 */
export function isAllowedUrlValue(value: string): boolean {
  const normalized = normalizeUrlForSchemeCheck(value);
  if (normalized === "") return true;
  if (normalized.startsWith("#")) return true;
  if (/^https:\/\//i.test(normalized)) return true;
  if (/^data:image\//i.test(normalized)) return true;
  return false;
}

/** URL ngoài hợp lệ — texture da thật chính là một cái. Caller tự áp allowlist host. */
export function isExternalUrlValue(value: string): boolean {
  return /^https:\/\//i.test(normalizeUrlForSchemeCheck(value));
}

/**
 * Rút mọi tham chiếu `url(...)` trong một giá trị thuộc tính.
 *
 * Nhánh có dấu nháy đứng trước nên giá trị trả về không dính dấu nháy; nhánh
 * cuối dừng ở `)` đầu tiên, nên `url(javascript:alert(1))` trả
 * `javascript:alert(1` — vẫn trượt kiểm tra scheme, đúng ý đồ.
 */
export function extractUrlReferences(value: string): string[] {
  const pattern = /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    urls.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return urls;
}

/** Fragment `#id` mà một giá trị trỏ tới, hoặc `null` nếu nó không phải fragment. */
export function fragmentIdOf(value: string): string | null {
  const normalized = normalizeUrlForSchemeCheck(value).trim();
  return normalized.startsWith("#") && normalized.length > 1 ? normalized.slice(1) : null;
}
