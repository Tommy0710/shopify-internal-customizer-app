import { describe, expect, it } from "vitest";
import { extractUrlReferences, unsafeNodeName } from "@/svg-engine/policy";

/**
 * `policy.ts` là định nghĩa "an toàn" DUY NHẤT, dùng chung bởi `sanitizeSvgRoot`
 * và `validateSvgContract`. Hai lỗ hổng gần nhất đều là bản sao của một quy tắc
 * trong policy bị viết lại sai ở nơi khác, nên quy tắc được test thẳng ở đây.
 */

describe("unsafeNodeName", () => {
  it("names the node kinds that must be removed", () => {
    expect(unsafeNodeName({ nodeType: 8 })).toBe("#comment");
    expect(unsafeNodeName({ nodeType: 7 })).toBe("#processing-instruction");
  });

  it("keeps elements, text and CDATA", () => {
    // CDATA không nằm trong danh sách có chủ đích: dữ liệu của nó không bao giờ
    // chứa được `]]>`, nên nó không thoát ra được ở cả parser XML lẫn HTML.
    for (const nodeType of [1, 3, 4]) {
      expect(unsafeNodeName({ nodeType })).toBeNull();
    }
  });

  it("returns names that can never collide with an element localName", () => {
    // `#` không phải ký tự mở đầu hợp lệ của tên XML.
    for (const nodeType of [7, 8]) {
      expect(unsafeNodeName({ nodeType })!.startsWith("#")).toBe(true);
    }
  });
});

describe("extractUrlReferences is the only url( gate", () => {
  it.each(["url(#a)", "URL(#a)", "Url(#a)", "uRl(#a)", "url (#a)", "URL\t(#a)"])(
    "matches %j the way a CSS tokenizer does",
    (value) => {
      expect(extractUrlReferences(value)).toEqual(["#a"]);
    },
  );

  it("answers 'no url() here' with an empty array, so no caller needs a second gate", () => {
    expect(extractUrlReferences("#a")).toEqual([]);
    expect(extractUrlReferences("M0 0h1v1H0z")).toEqual([]);
  });

  it("decodes CSS escapes before matching", () => {
    expect(extractUrlReferences("\\75 rl(https://cdn.example/a.webp)")).toEqual([
      "https://cdn.example/a.webp",
    ]);
    // Decode xong thành `url(javascript:alert(1)`; nhánh cuối dừng ở `)` đầu
    // tiên nên trả `javascript:alert(1` — vẫn trượt kiểm tra scheme, đúng ý đồ.
    expect(extractUrlReferences("url(java\\73 cript:alert(1)")).toEqual(["javascript:alert(1"]);
    expect(extractUrlReferences("url(\\68 ttps://cdn.example/a.webp)")).toEqual([
      "https://cdn.example/a.webp",
    ]);
  });

  it("leaves a value without backslashes byte-identical", () => {
    expect(extractUrlReferences(`url("https://cdn.example/a.webp")`)).toEqual([
      "https://cdn.example/a.webp",
    ]);
    expect(extractUrlReferences("fill:url(#grad) stroke:url(#other)")).toEqual(["#grad", "#other"]);
  });
});
