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

/** Hằng số `Node.*_NODE`, viết tay vì engine không được phụ thuộc vào global DOM nào. */
const PROCESSING_INSTRUCTION_NODE = 7;
const COMMENT_NODE = 8;

/**
 * Node KHÔNG phải phần tử mà cả hai cổng coi là không an toàn, kèm tên dùng để
 * báo cáo. Trả `null` nghĩa là node được giữ (phần tử, text).
 *
 * Vì sao comment là lỗ hổng thật: markup đã lưu sẽ được inline vào trang HTML
 * của Shopify Admin, và tokenizer HTML kết thúc comment ở `--!>` (trạng thái
 * *comment-end-bang*) trong khi parser XML thì không. Chuỗi
 * `<!-- --!><script>…</script><!-- -->` là MỘT node comment với XML — nên
 * sanitize duyệt-theo-phần-tử không thấy gì để gỡ — nhưng với HTML nó là một
 * comment rồi một `<script>` THẬT trong namespace SVG, chạy trong origin đang
 * giữ session token.
 *
 * Processing instruction cùng hình dạng: HTML không có PI, `<?x ?>` bị parse
 * thành *bogus comment* kết thúc ở dấu `>` ĐẦU TIÊN, nên `<?x ><script>…` cũng
 * mở ra một phần tử thật.
 *
 * CDATA cố tình KHÔNG nằm đây: dữ liệu của một node CDATA không bao giờ chứa
 * được `]]>` (đó chính là điều kiện để nó là một node), và trong HTML nội dung
 * foreign cũng đóng CDATA ở đúng `]]>` — không có cách nào thoát ra. Nó là
 * text, và text được serializer escape.
 *
 * Tên trả về là `nodeName` chuẩn của DOM cho hai loại node này. `#` không phải
 * ký tự mở đầu hợp lệ của tên XML, nên chúng không bao giờ đụng tên một phần
 * tử trong `SanitizeReport.removedElements`.
 */
export function unsafeNodeName(node: { nodeType: number }): string | null {
  if (node.nodeType === COMMENT_NODE) return "#comment";
  if (node.nodeType === PROCESSING_INSTRUCTION_NODE) return "#processing-instruction";
  return null;
}

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
 * Giải mã escape của CSS (`\\75 rl(` → `url(`, `\\2f` → `/`) trước khi đi tìm
 * `url(...)`.
 *
 * Vì sao cần: giá trị của `style` và của mọi thuộc tính trình bày được TRÌNH
 * DUYỆT đọc bằng bộ tokenize CSS, và ở đó `\\75 rl` là ident `url` chứ không
 * phải sáu ký tự. `style="filter:\\75 rl(http://evil.example/x.svg#f)"` vì thế
 * vẫn nạp tài nguyên ngoài trong khi một cổng so khớp chuỗi thô không thấy gì —
 * cùng hình dạng với lỗi phân biệt hoa thường, chỉ đổi cách viết.
 *
 * Chỉ dùng cho nhánh `url(...)`; giá trị `href` KHÔNG đi qua đây vì nó không
 * phải CSS, dấu `\\` trong đó là một ký tự thật.
 *
 * Đây không phải bộ tokenize CSS đầy đủ và không cần phải là: nó chỉ mở rộng
 * tập giá trị bị soi, không bao giờ thu hẹp — một chuỗi không có `\\` đi qua
 * nguyên vẹn.
 */
function decodeCssEscapes(value: string): string {
  if (!value.includes("\\")) return value;
  return value.replace(
    /\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n\r\f])/g,
    (_match, hex: string | undefined, literal: string | undefined) => {
      if (hex === undefined) return literal ?? "";
      const codePoint = Number.parseInt(hex, 16);
      // 0 và các code point ngoài dải Unicode được CSS thay bằng U+FFFD.
      if (codePoint === 0 || codePoint > 0x10ffff) return "\uFFFD";
      return String.fromCodePoint(codePoint);
    },
  );
}

/**
 * Rút mọi tham chiếu `url(...)` trong một giá trị thuộc tính.
 *
 * ĐÂY LÀ CỔNG DUY NHẤT. Cả `sanitizeSvgRoot` lẫn `validateSvgContract` từng
 * đứng trước hàm này một cổng viết tay `value.includes("url(")` — phân biệt hoa
 * thường và không cho phép khoảng trắng — nên `URL(`, `Url(` và `url (` đi
 * thẳng qua cả hai: thuộc tính được giữ, URL ngoài không vào `externalRefs`
 * (allowlist host của caller không bao giờ thấy nó), và `URL(#khong-ton-tai)`
 * không bị bắt là dangling. Hai bản sao của cùng một quy tắc là cách con bug
 * đó sống sót, nên giờ không còn bản sao nào: caller gọi thẳng hàm này và một
 * mảng rỗng chính là câu trả lời "không có url() nào ở đây".
 *
 * Tên hàm CSS không phân biệt hoa thường (cờ `i`) và cho phép khoảng trắng
 * trước `(`. Nhánh có dấu nháy đứng trước nên giá trị trả về không dính dấu
 * nháy; nhánh cuối dừng ở `)` đầu tiên, nên `url(javascript:alert(1))` trả
 * `javascript:alert(1` — vẫn trượt kiểm tra scheme, đúng ý đồ.
 */
export function extractUrlReferences(value: string): string[] {
  const pattern = /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  const decoded = decodeCssEscapes(value);
  while ((match = pattern.exec(decoded)) !== null) {
    urls.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return urls;
}

/** Fragment `#id` mà một giá trị trỏ tới, hoặc `null` nếu nó không phải fragment. */
export function fragmentIdOf(value: string): string | null {
  const normalized = normalizeUrlForSchemeCheck(value).trim();
  return normalized.startsWith("#") && normalized.length > 1 ? normalized.slice(1) : null;
}
