import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { sanitizeSvgRoot } from "@/svg-engine/sanitize";
import { parseSvg } from "../helpers/svgDom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateSvgContract } from "@/svg-engine/validate";

describe("sanitizeSvgRoot", () => {
  it("removes script elements", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><g id="stitches"/></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector("script")).toBeNull();
    expect(report.removedElements).toContain("script");
  });

  it("removes foreignObject elements", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector("foreignObject")).toBeNull();
    expect(report.removedElements).toContain("foreignObject");
  });

  it("strips every inline event handler regardless of case", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><g id="a" onload="steal()" ONCLICK="x()" onMouseOver="y()"/></svg>`);
    const report = sanitizeSvgRoot(root);
    const g = root.querySelector(`[id="a"]`)!;
    expect(g.getAttributeNames().filter((name) => name.toLowerCase().startsWith("on"))).toEqual([]);
    expect(report.removedAttributes).toHaveLength(3);
  });

  it("strips javascript: and data:text/html hrefs but keeps ordinary ones", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <a id="evil" href="javascript:alert(1)"/>
      <a id="alsoEvil" href="data:text/html;base64,PHNjcmlwdD4="/>
      <image id="fine" href="https://cdn.example/leather.webp"/>
      <use id="internal" href="#animal-shape"/>
    </svg>`);
    sanitizeSvgRoot(root);
    expect(root.querySelector(`[id="evil"]`)!.hasAttribute("href")).toBe(false);
    expect(root.querySelector(`[id="alsoEvil"]`)!.hasAttribute("href")).toBe(false);
    expect(root.querySelector(`[id="fine"]`)!.getAttribute("href")).toBe("https://cdn.example/leather.webp");
    expect(root.querySelector(`[id="internal"]`)!.getAttribute("href")).toBe("#animal-shape");
  });

  it("records external references without removing them", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><image id="fine" href="https://cdn.example/leather.webp"/></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(report.externalRefs).toEqual(["https://cdn.example/leather.webp"]);
    expect(root.querySelector(`[id="fine"]`)!.hasAttribute("href")).toBe(true);
  });

  it("leaves a clean document byte-identical in structure", () => {
    const clean = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"><path id="animal-shape" d="M0 0h1v1H0z"/><g id="stitches" fill="var(--wallet-stitches)"/></svg>`;
    const root = parseSvg(clean);
    const report = sanitizeSvgRoot(root);
    expect(report).toEqual({ removedElements: [], removedAttributes: [], externalRefs: [] });
    expect(root.querySelector(`[id="animal-shape"]`)).not.toBeNull();
    expect(root.querySelector(`[id="stitches"]`)).not.toBeNull();
  });

  it("removes a use element that points at another document", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><use id="external" href="https://evil.example/x.svg#a"/><use id="local" href="#animal-shape"/></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector(`[id="external"]`)).toBeNull();
    expect(root.querySelector(`[id="local"]`)).not.toBeNull();
    expect(report.removedElements).toContain("use");
  });

  it("blocks embedded tab in javascript: scheme", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><a id="test" href="java\tscript:alert(1)"/></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector('[id="test"]')!.hasAttribute("href")).toBe(false);
    expect(report.removedAttributes).toContain("a@href");
  });

  it("blocks embedded newline in javascript: scheme", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><a id="test" href="java\nscript:alert(1)"/></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector('[id="test"]')!.hasAttribute("href")).toBe(false);
    expect(report.removedAttributes).toContain("a@href");
  });

  it("removes animate elements unconditionally", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><a href="#safe"><animate attributeName="href" to="javascript:alert(1)"/></a></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector("animate")).toBeNull();
    expect(report.removedElements).toContain("animate");
  });

  it("removes set elements unconditionally", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect><set attributeName="onmouseover" to="alert(1)"/></rect></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector("set")).toBeNull();
    expect(report.removedElements).toContain("set");
  });

  it("blocks url(javascript:) in any attribute", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect id="test" style="fill:url(javascript:alert(1))"/></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector('[id="test"]')!.hasAttribute("style")).toBe(false);
    expect(report.removedAttributes).toContain("rect@style");
  });

  it("records external URLs from url() references", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://cdn.example/texture.webp)"/></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(report.externalRefs).toContain("https://cdn.example/texture.webp");
    expect(root.querySelector("rect")!.hasAttribute("style")).toBe(true);
  });
});

describe("sanitizeSvgRoot leading-whitespace scheme bypasses", () => {
  // WHATWG URL parser gỡ TOÀN BỘ C0 control và space (U+0000–U+0020) ở hai đầu
  // trước khi đọc scheme. Bản cũ chỉ gỡ \t \n \r, nên đúng một dấu cách đứng
  // trước là đủ để `javascript:` sống sót trong khi trình duyệt vẫn chạy nó.
  it.each([
    ["space", " "],
    ["form feed", "\f"],
    ["vertical tab", "\v"],
    ["control U+0001", "\u0001"],
    ["tab", "\t"],
    ["NUL", "\u0000"],
    ["newline", "\n"],
    ["carriage return", "\r"],
    ["mixed", " \u0001\f"],
  ])("blocks a javascript: href prefixed with %s", (_label, prefix) => {
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><a id="t" href="${prefix}javascript:alert(1)"/></svg>`,
    );
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector('[id="t"]')!.hasAttribute("href")).toBe(false);
    expect(report.removedAttributes).toContain("a@href");
  });

  it("blocks a trailing-whitespace javascript: href", () => {
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><a id="t" href="javascript:alert(1) "/></svg>`,
    );
    sanitizeSvgRoot(root);
    expect(root.querySelector('[id="t"]')!.hasAttribute("href")).toBe(false);
  });
});

describe("sanitizeSvgRoot allowlist", () => {
  it("removes a style element and reports it", () => {
    // <style> trong SVG inline KHÔNG bị giới hạn trong SVG — nó áp cho cả trang
    // admin: @import gọi ra ngoài, selector rò giá trị thuộc tính, *{position:fixed}
    // phủ UI. Bản cũ trả về báo cáo trắng "không gỡ gì".
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/x.css);</style></svg>`,
    );
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector("style")).toBeNull();
    expect(report.removedElements).toContain("style");
  });

  it.each(["embed", "object", "iframe", "handler", "video", "audio", "metadata", "feImage"])(
    "removes <%s>, which no blocklist ever named",
    (name) => {
      const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><${name}/></svg>`);
      const report = sanitizeSvgRoot(root);
      expect(root.querySelector(name)).toBeNull();
      expect(report.removedElements).toContain(name);
    },
  );

  it("reports a removed subtree once, not once per descendant", () => {
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div><span/></div></foreignObject></svg>`,
    );
    const report = sanitizeSvgRoot(root);
    expect(report.removedElements).toEqual(["foreignObject"]);
  });

  it.each(["xl:href", "src", "data", "poster", "formaction", "xlink:show", "onfocusin"])(
    "removes the %s attribute, which was never scheme-checked",
    (attribute) => {
      const root = parseSvg(
        `<svg xmlns="http://www.w3.org/2000/svg"><image id="t" ${attribute}="javascript:alert(1)"/></svg>`,
      );
      const report = sanitizeSvgRoot(root);
      expect(root.querySelector('[id="t"]')!.hasAttribute(attribute)).toBe(false);
      expect(report.removedAttributes).toContain(`image@${attribute}`);
    },
  );

  it("removes a mis-cased HREF rather than trusting the exact spelling", () => {
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><a id="t" HREF="javascript:alert(1)"/></svg>`,
    );
    sanitizeSvgRoot(root);
    expect(root.querySelector('[id="t"]')!.hasAttribute("HREF")).toBe(false);
  });

  it("keeps a data:image href and drops every other scheme", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <image id="dataImage" href="data:image/png;base64,iVBORw0KGgo="/>
      <image id="insecure" href="http://cdn.example/leather.webp"/>
      <image id="relative" href="leather.webp"/>
      <image id="protocolRelative" href="//cdn.example/leather.webp"/>
      <image id="blobbed" href="blob:https://shop.example/1234"/>
    </svg>`);
    sanitizeSvgRoot(root);
    expect(root.querySelector('[id="dataImage"]')!.hasAttribute("href")).toBe(true);
    for (const id of ["insecure", "relative", "protocolRelative", "blobbed"]) {
      expect(root.querySelector(`[id="${id}"]`)!.hasAttribute("href"), id).toBe(false);
    }
  });

  it("keeps the whole fixture attribute vocabulary — filters, gradients, aria", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 1 1">
      <filter id="f" color-interpolation-filters="sRGB"><feTurbulence baseFrequency="0.8" numOctaves="3" seed="7" type="fractalNoise" result="n"/><feColorMatrix in="n" type="saturate" values="0"/><feDropShadow dx="1" dy="2" stdDeviation="3" flood-color="#000" flood-opacity=".4"/></filter>
      <linearGradient id="grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="8"><stop offset=".3" stop-color="#FFF" stop-opacity=".38"/></linearGradient>
      <g pointer-events="none" preserveAspectRatio="xMidYMid slice" class="x" style="opacity:.5"><path d="M0 0h1v1H0z" fill="url(#grad)" stroke="#333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".2" fill-opacity=".9" filter="url(#f)"/></g>
    </svg>`);
    const report = sanitizeSvgRoot(root);
    expect(report).toEqual({ removedElements: [], removedAttributes: [], externalRefs: [] });
  });
});

describe("sanitizeSvgRoot on real mockups", () => {
  it.each(["angler-fish", "crocodile"])("leaves %s contract-valid and removes nothing", (name) => {
    const source = readFileSync(fileURLToPath(new URL(`../fixtures/svg/${name}.svg`, import.meta.url)), "utf8");
    const root = parseSvg(source);
    const report = sanitizeSvgRoot(root);
    expect(report.removedElements).toEqual([]);
    expect(report.removedAttributes).toEqual([]);
    expect(validateSvgContract(root).valid).toBe(true);
  });
});

describe("sanitizeSvgRoot non-element nodes", () => {
  // Bản cũ chỉ duyệt `element.children`, nên MỌI node không phải phần tử đi qua
  // nguyên văn với báo cáo trắng. Parser XML coi cả chuỗi dưới đây là MỘT
  // comment; tokenizer HTML thì kết thúc comment ở `--!>` (trạng thái
  // comment-end-bang) rồi mở một `<script>` THẬT trong namespace SVG — chạy
  // trong origin Shopify Admin đang giữ session token.
  const PAYLOAD = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"><!-- --!><script>alert(document.domain)</script><!-- --><path id="animal-shape" d="M0 0h1v1H0z"/><g id="stitches" fill="var(--wallet-stitches)"/></svg>`;

  it("removes the comment-end-bang payload and names what it removed", () => {
    const root = parseSvg(PAYLOAD);
    const report = sanitizeSvgRoot(root);

    const serialized = root.outerHTML;
    expect(serialized).not.toContain("alert(document.domain)");
    expect(serialized).not.toContain("--!>");
    expect(serialized).not.toContain("<!--");
    expect(report.removedElements).toEqual(["#comment"]);
    // Cái còn lại phải nguyên vẹn: gỡ comment không được đụng nội dung thật.
    expect(root.querySelector(`[id="animal-shape"]`)).not.toBeNull();
    expect(root.querySelector(`[id="stitches"]`)).not.toBeNull();
  });

  it("removes a comment nested deep in the tree, not just at the root", () => {
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><g id="a"><g id="b"><!-- --!><script>alert(1)</script><!-- --></g></g></svg>`,
    );
    const report = sanitizeSvgRoot(root);
    expect(root.outerHTML).not.toContain("<!--");
    expect(report.removedElements).toEqual(["#comment"]);
  });

  it("counts a comment inside a removed subtree once, as the subtree", () => {
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><!--x--></foreignObject></svg>`,
    );
    expect(sanitizeSvgRoot(root).removedElements).toEqual(["foreignObject"]);
  });

  it("keeps text content — only comments and processing instructions go", () => {
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><title>Angler fish<!--x--></title></svg>`,
    );
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector("title")!.textContent).toBe("Angler fish");
    expect(report.removedElements).toEqual(["#comment"]);
  });
});

describe("sanitizeSvgRoot url( is case-insensitive", () => {
  // Tên hàm CSS không phân biệt hoa thường, và `extractUrlReferences` vốn đã có
  // cờ `i` — nhưng hai cổng viết tay `value.includes("url(")` đứng trước nó thì
  // không, nên `URL(` đi thẳng qua cả sanitize lẫn validate.
  const SPELLINGS = ["url", "URL", "Url", "uRl", "url ", "URL\t"];

  it.each(SPELLINGS)("strips a dangerous scheme behind %j(", (spelling) => {
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><rect id="t" style="fill:${spelling}(javascript:alert(1))"/></svg>`,
    );
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector('[id="t"]')!.hasAttribute("style")).toBe(false);
    expect(report.removedAttributes).toContain("rect@style");
  });

  it.each(SPELLINGS)("strips an http: beacon behind %j(", (spelling) => {
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><rect id="t" style="background-image:${spelling}(http://evil.example/beacon.png)"/></svg>`,
    );
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector('[id="t"]')!.hasAttribute("style")).toBe(false);
    expect(report.removedAttributes).toContain("rect@style");
  });

  it.each(SPELLINGS)("records an external https texture behind %j( too", (spelling) => {
    // Nếu URL ngoài không vào `externalRefs`, allowlist host của caller — cơ
    // chế tin-cậy-host DUY NHẤT — không bao giờ nhìn thấy nó.
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><rect id="t" style="fill:${spelling}(https://cdn.example/texture.webp)"/></svg>`,
    );
    const report = sanitizeSvgRoot(root);
    expect(report.externalRefs).toEqual(["https://cdn.example/texture.webp"]);
    expect(root.querySelector('[id="t"]')!.hasAttribute("style")).toBe(true);
  });

  it("sees through a CSS-escaped url( as the browser's CSS tokenizer does", () => {
    // `\75 rl` là ident `url` với bộ tokenize CSS, nên trình duyệt VẪN fetch —
    // cùng lỗ hổng như `URL(`, chỉ đổi cách viết.
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><rect id="t" style="filter:\\75 rl(http://evil.example/x.svg#f)"/></svg>`,
    );
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector('[id="t"]')!.hasAttribute("style")).toBe(false);
    expect(report.removedAttributes).toContain("rect@style");
  });

  it("records a CSS-escaped external texture instead of hiding it", () => {
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><rect id="t" style="fill:\\75 rl(https://cdn.example/texture.webp)"/></svg>`,
    );
    expect(sanitizeSvgRoot(root).externalRefs).toEqual(["https://cdn.example/texture.webp"]);
  });

  it("leaves a backslash-free value untouched — decoding only widens the net", () => {
    const root = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><rect id="t" fill="url(#grad)" font-family="Helvetica Neue"/><linearGradient id="grad"/></svg>`,
    );
    const report = sanitizeSvgRoot(root);
    expect(report).toEqual({ removedElements: [], removedAttributes: [], externalRefs: [] });
    expect(root.querySelector('[id="t"]')!.getAttribute("fill")).toBe("url(#grad)");
  });
});

describe("sanitizeSvgRoot CDATA", () => {
  // Lập luận đầu tiên để GIỮ CDATA là "dữ liệu của nó không bao giờ chứa được
  // `]]>` nên không thoát ra được ở parser nào". Vế sau chỉ đúng với parser
  // ĐÚNG CHUẨN. linkedom — parser repo này đang ship — không cài luật CDATA của
  // nội dung foreign và coi <title> trong SVG là RCDATA, nên `</title>` bên
  // trong CDATA đóng thẻ và phần còn lại thành markup thật.
  const PAYLOAD = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"><title><![CDATA[</title><script>alert(1)</script>]]></title></svg>`;

  it("removes a CDATA section and names it", () => {
    const root = parseSvg(PAYLOAD);
    const report = sanitizeSvgRoot(root);
    expect(report.removedElements).toEqual(["#cdata-section"]);
    expect(root.outerHTML).not.toContain("CDATA");
    expect(root.outerHTML).not.toContain("alert(1)");
  });

  it("leaves nothing an HTML parser can turn back into a script", () => {
    const root = parseSvg(PAYLOAD);
    sanitizeSvgRoot(root);
    const { document } = parseHTML(`<!doctype html><body><div>${root.outerHTML}</div>`);
    expect(Array.from(document.querySelectorAll("script"))).toEqual([]);
  });
});
