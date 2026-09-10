import { describe, expect, it } from "vitest";
import { extractUrlReferences, foreignUseTarget, unsafeNodeName } from "@/svg-engine/policy";

/**
 * `policy.ts` là định nghĩa "an toàn" DUY NHẤT, dùng chung bởi `sanitizeSvgRoot`
 * và `validateSvgContract`. Hai lỗ hổng gần nhất đều là bản sao của một quy tắc
 * trong policy bị viết lại sai ở nơi khác, nên quy tắc được test thẳng ở đây.
 */

describe("unsafeNodeName", () => {
  it("names the node kinds that must be removed", () => {
    expect(unsafeNodeName({ nodeType: 8 })).toBe("#comment");
    expect(unsafeNodeName({ nodeType: 7 })).toBe("#processing-instruction");
    // CDATA nằm đây vì lập luận "không thoát ra được ở parser nào" SAI với
    // parser repo này đang ship: linkedom không cài luật CDATA của nội dung
    // foreign, nên `<title><![CDATA[</title><script>…]]></title>` parse lại
    // thành một <script> sống. Xem test tương ứng ở sanitize.test.ts.
    expect(unsafeNodeName({ nodeType: 4 })).toBe("#cdata-section");
  });

  it("keeps elements and text", () => {
    for (const nodeType of [1, 3]) {
      expect(unsafeNodeName({ nodeType })).toBeNull();
    }
  });
});

describe("foreignUseTarget", () => {
  function element(localName: string, attributes: Record<string, string> = {}) {
    return { localName, getAttribute: (name: string) => attributes[name] ?? null };
  }

  it("names a <use> that pulls in another document", () => {
    expect(foreignUseTarget(element("use", { href: "https://evil.example/x.svg#a" }))).toBe(
      "https://evil.example/x.svg#a",
    );
    expect(foreignUseTarget(element("use", { "xlink:href": "https://evil.example/x.svg#a" }))).toBe(
      "https://evil.example/x.svg#a",
    );
    expect(foreignUseTarget(element("USE", { href: "https://evil.example/x.svg#a" }))).not.toBeNull();
  });

  it("leaves a same-document <use> alone", () => {
    expect(foreignUseTarget(element("use", { href: "#animal-shape" }))).toBeNull();
    expect(foreignUseTarget(element("use", {}))).toBeNull();
    expect(foreignUseTarget(element("use", { href: "" }))).toBeNull();
  });

  it("is about <use> only — an https: texture on <image> is legitimate", () => {
    // Hai dòng này cách nhau một chữ trong code và rất dễ lẫn: `<image href>`
    // nạp một ẢNH, `<use href>` kéo NỘI DUNG tài liệu khác vào cây.
    expect(foreignUseTarget(element("image", { href: "https://cdn.example/leather.webp" }))).toBeNull();
    expect(foreignUseTarget(element("a", { href: "https://cdn.example/x" }))).toBeNull();
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
