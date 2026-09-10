import { describe, expect, it } from "vitest";
import { validateSvgContract } from "@/svg-engine/validate";
import { sanitizeSvgRoot } from "@/svg-engine/sanitize";
import { parseSvg } from "../helpers/svgDom";

function build(options: {
  rootId?: string;
  omit?: string[];
  duplicate?: string;
  bodyArtworkAs?: string;
  stitchesFill?: string;
  viewBox?: string;
} = {}): string {
  const omit = new Set(options.omit ?? []);
  const bodyArtworkTag = options.bodyArtworkAs ?? "image";
  const parts: string[] = [];

  if (!omit.has("wallet-body-shape")) parts.push(`<path id="wallet-body-shape" d="M0 0h10v10H0z"/>`);
  if (!omit.has("animal-shape")) parts.push(`<path id="animal-shape" d="M2 2h4v4H2z"/>`);
  if (!omit.has("wallet-body-clip")) parts.push(`<clipPath id="wallet-body-clip"><use href="#wallet-body-shape"/></clipPath>`);
  if (!omit.has("animal-clip")) parts.push(`<clipPath id="animal-clip"><use href="#animal-shape"/></clipPath>`);
  if (!omit.has("body-artwork")) parts.push(`<${bodyArtworkTag} id="body-artwork" clip-path="url(#wallet-body-clip)"/>`);
  if (!omit.has("animal-artwork")) parts.push(`<image id="animal-artwork" clip-path="url(#animal-clip)"/>`);
  if (!omit.has("stitches")) parts.push(`<g id="stitches" fill="${options.stitchesFill ?? "var(--wallet-stitches)"}"></g>`);
  if (options.duplicate) parts.push(`<g id="${options.duplicate}"></g>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" id="${options.rootId ?? "wallet-preview"}" viewBox="${options.viewBox ?? "0 0 1427 1102"}">${parts.join("")}</svg>`;
}

function statusOf(report: ReturnType<typeof validateSvgContract>, id: string) {
  return report.checks.find((check) => check.id === id)?.status;
}

describe("validateSvgContract", () => {
  it("accepts a document that satisfies every required element", () => {
    const report = validateSvgContract(parseSvg(build()));
    expect(report.valid).toBe(true);
    expect(report.contractVersion).toBe("animal-v1");
    expect(report.viewBox).toBe("0 0 1427 1102");
    expect(report.checks.every((check) => check.status === "ok")).toBe(true);
  });

  it("rejects a null root without throwing", () => {
    const report = validateSvgContract(null);
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("missing");
  });

  it("rejects a root whose id is not wallet-preview", () => {
    const report = validateSvgContract(parseSvg(build({ rootId: "something-else" })));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("missing");
  });

  it("reports each missing required id separately", () => {
    const report = validateSvgContract(parseSvg(build({ omit: ["animal-artwork", "stitches"] })));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "animal-artwork")).toBe("missing");
    expect(statusOf(report, "stitches")).toBe("missing");
    expect(statusOf(report, "body-artwork")).toBe("ok");
  });

  it("rejects a duplicated id", () => {
    const report = validateSvgContract(parseSvg(build({ duplicate: "animal-shape" })));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "animal-shape")).toBe("duplicate");
  });

  it("rejects an artwork target that is not an <image>", () => {
    const report = validateSvgContract(parseSvg(build({ bodyArtworkAs: "rect" })));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "body-artwork")).toBe("wrong-element");
    expect(report.checks.find((check) => check.id === "body-artwork")?.element).toBe("rect");
  });

  it("warns but stays valid when #stitches does not use the colour variable", () => {
    const report = validateSvgContract(parseSvg(build({ stitchesFill: "#E7C337" })));
    expect(statusOf(report, "stitches")).toBe("warning");
    expect(report.valid).toBe(true);
  });

  it("hints at the animal-* migration when it finds legacy fish-* ids", () => {
    const legacy = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">
      <path id="wallet-body-shape" d="M0 0h1v1H0z"/>
      <path id="fish-shape" d="M0 0h1v1H0z"/>
      <clipPath id="wallet-body-clip"><use href="#wallet-body-shape"/></clipPath>
      <clipPath id="fish-clip"><use href="#fish-shape"/></clipPath>
      <image id="body-artwork"/>
      <image id="fish-artwork"/>
      <g id="stitches" fill="var(--wallet-stitches)"></g>
    </svg>`;
    const report = validateSvgContract(parseSvg(legacy));
    expect(report.valid).toBe(false);
    for (const id of ["animal-shape", "animal-clip", "animal-artwork"]) {
      const check = report.checks.find((entry) => entry.id === id);
      expect(check?.status).toBe("missing");
      expect(check?.hint).toMatch(/fish-/);
    }
  });

  it("rejects a root that is not in the SVG namespace (explicit XHTML)", () => {
    const html = `<svg id="wallet-preview" xmlns="http://www.w3.org/1999/xhtml"><g id="stitches" fill="var(--wallet-stitches)"></g></svg>`;
    const report = validateSvgContract(parseSvg(html));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("wrong-element");
  });

  it("rejects a root with no xmlns attribute", () => {
    const svg = `<svg id="wallet-preview"><g id="stitches" fill="var(--wallet-stitches)"></g></svg>`;
    const report = validateSvgContract(parseSvg(svg));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("wrong-element");
  });

  it("rejects a root with a non-XHTML wrong namespace", () => {
    const svg = `<svg id="wallet-preview" xmlns="http://example.com/custom"><g id="stitches" fill="var(--wallet-stitches)"></g></svg>`;
    const report = validateSvgContract(parseSvg(svg));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("wrong-element");
  });

  it("accepts a correctly namespaced SVG even when other elements are missing", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"><g id="stitches" fill="var(--wallet-stitches)"></g></svg>`;
    const report = validateSvgContract(parseSvg(svg));
    expect(report.valid).toBe(false);
    // Namespace check should pass
    expect(statusOf(report, "wallet-preview")).toBe("ok");
    // But other required elements should be missing
    expect(statusOf(report, "body-artwork")).toBe("missing");
  });

  it("returns a null viewBox rather than throwing when the attribute is absent", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"><g id="stitches" fill="var(--wallet-stitches)"></g></svg>`;
    expect(validateSvgContract(parseSvg(svg)).viewBox).toBeNull();
  });
});

/**
 * Guide §8 liệt kê tám điều kiện; bốn điều kiện cuối (liên kết clipPath, tham
 * chiếu phân giải được, không script/handler/tài nguyên ngoài không tin cậy)
 * trước đây không được cài đặt, nên tài liệu dưới đây từng trả `valid: true`.
 */
describe("validateSvgContract — guide §8 conditions beyond the id table", () => {
  function contract(body: string, rootAttributes = ""): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview" ${rootAttributes}>${body}</svg>`;
  }

  const SOUND_BODY = `
    <path id="wallet-body-shape" d="M0 0h10v10H0z"/>
    <path id="animal-shape" d="M2 2h4v4H2z"/>
    <clipPath id="wallet-body-clip"><use href="#wallet-body-shape"/></clipPath>
    <clipPath id="animal-clip"><use href="#animal-shape"/></clipPath>
    <image id="body-artwork" clip-path="url(#wallet-body-clip)"/>
    <image id="animal-artwork" clip-path="url(#animal-clip)"/>
    <g id="stitches" fill="var(--wallet-stitches)"></g>`;

  it("rejects the whole composite the guide warns about", () => {
    const report = validateSvgContract(
      parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview" onload="steal()">
        <script>alert(1)</script>
        <path id="wallet-body-shape" d="M0 0h1v1H0z"/>
        <path id="animal-shape" d="M0 0h1v1H0z"/>
        <clipPath id="wallet-body-clip"/>
        <clipPath id="animal-clip"><use href="#animal-shape"/></clipPath>
        <image id="body-artwork"/>
        <image id="animal-artwork" clip-path="url(#does-not-exist)"/>
        <g id="stitches" fill="var(--wallet-stitches)"></g>
      </svg>`),
    );
    expect(report.valid).toBe(false);
    expect(statusOf(report, "safety")).toBe("unsafe");
    expect(statusOf(report, "references")).toBe("dangling-ref");
    expect(statusOf(report, "body-artwork/clip-path")).toBe("unlinked");
    expect(statusOf(report, "animal-artwork/clip-path")).toBe("unlinked");
    expect(statusOf(report, "wallet-body-clip/contents")).toBe("empty");
  });

  it("rejects an artwork target with no clip-path at all", () => {
    const report = validateSvgContract(
      parseSvg(contract(SOUND_BODY.replace(` clip-path="url(#wallet-body-clip)"`, ""))),
    );
    expect(report.valid).toBe(false);
    expect(statusOf(report, "body-artwork/clip-path")).toBe("unlinked");
    expect(statusOf(report, "animal-artwork/clip-path")).toBe("ok");
  });

  it("rejects an artwork target clipped by the wrong clipPath", () => {
    const report = validateSvgContract(
      parseSvg(contract(SOUND_BODY.replace(`url(#animal-clip)"/>`, `url(#wallet-body-clip)"/>`))),
    );
    expect(report.valid).toBe(false);
    expect(statusOf(report, "animal-artwork/clip-path")).toBe("unlinked");
  });

  it("rejects a clip-path that points at an id which does not exist", () => {
    const report = validateSvgContract(
      parseSvg(contract(SOUND_BODY.replace(`url(#animal-clip)`, `url(#nope)`))),
    );
    expect(report.valid).toBe(false);
    expect(statusOf(report, "references")).toBe("dangling-ref");
  });

  it("rejects an href that points at an id which does not exist", () => {
    const report = validateSvgContract(
      parseSvg(contract(SOUND_BODY.replace(`href="#animal-shape"`, `href="#ghost"`))),
    );
    expect(report.valid).toBe(false);
    expect(statusOf(report, "references")).toBe("dangling-ref");
  });

  it("rejects an empty clipPath, which clips the artwork away entirely", () => {
    const report = validateSvgContract(
      parseSvg(contract(SOUND_BODY.replace(`<clipPath id="animal-clip"><use href="#animal-shape"/></clipPath>`, `<clipPath id="animal-clip"/>`))),
    );
    expect(report.valid).toBe(false);
    expect(statusOf(report, "animal-clip/contents")).toBe("empty");
  });

  it("rejects a surviving <script> element", () => {
    const report = validateSvgContract(parseSvg(contract(`<script>alert(1)</script>${SOUND_BODY}`)));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "safety")).toBe("unsafe");
  });

  it("rejects a surviving <style> element", () => {
    const report = validateSvgContract(
      parseSvg(contract(`<style>@import url(https://evil.example/x.css);</style>${SOUND_BODY}`)),
    );
    expect(report.valid).toBe(false);
    expect(statusOf(report, "safety")).toBe("unsafe");
  });

  it("rejects a surviving inline event handler", () => {
    const report = validateSvgContract(parseSvg(contract(SOUND_BODY, `onload="steal()"`)));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "safety")).toBe("unsafe");
  });

  it("rejects a surviving javascript: URL, leading space and all", () => {
    const report = validateSvgContract(
      parseSvg(contract(`<a href=" javascript:alert(1)"/>${SOUND_BODY}`)),
    );
    expect(report.valid).toBe(false);
    expect(statusOf(report, "safety")).toBe("unsafe");
  });

  it("accepts an https texture URL — a baked design carries two of them", () => {
    const report = validateSvgContract(
      parseSvg(contract(SOUND_BODY.replace(`<image id="body-artwork"`, `<image id="body-artwork" href="https://cdn.example/leather.webp"`))),
    );
    expect(report.valid).toBe(true);
    expect(statusOf(report, "safety")).toBe("ok");
  });

  it("catches a nested element that reuses the root id", () => {
    // querySelectorAll không bao giờ trả về chính root, nên bản cũ đếm hụt và
    // <g id="wallet-preview"> lồng bên trong lọt qua như thể không trùng.
    const report = validateSvgContract(
      parseSvg(contract(`<g id="wallet-preview"></g>${SOUND_BODY}`)),
    );
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("duplicate");
  });
});

describe("sanitize then validate", () => {
  it("catches a clipPath the sanitizer legitimately gutted", () => {
    // <use> trỏ sang tài liệu khác bị gỡ đúng luật, nhưng nó là con DUY NHẤT
    // của clipPath — còn lại một clipPath rỗng, cắt sạch artwork. Test của
    // sanitize không bao giờ validate lại, test của validate không bao giờ
    // thấy tài liệu đã sanitize, nên không bên nào bắt được.
    //
    // Test này TỪNG khẳng định `validateSvgContract(root).valid === true` ở
    // dòng đầu — và chính khẳng định đó là lỗ hổng tương đương mà bản vá
    // `foreignUseTarget` đóng lại: validator gọi tài liệu này hợp lệ trong khi
    // sanitize gỡ một phần tử khỏi nó. Giờ validator từ chối ngay ở `safety`.
    // Phần còn lại của test giữ nguyên vai trò: sau khi sanitize, clipPath
    // rỗng phải bị bắt bằng một check KHÁC.
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">
      <path id="wallet-body-shape" d="M0 0h10v10H0z"/>
      <path id="animal-shape" d="M2 2h4v4H2z"/>
      <clipPath id="wallet-body-clip"><use href="https://evil.example/x.svg#a"/></clipPath>
      <clipPath id="animal-clip"><use href="#animal-shape"/></clipPath>
      <image id="body-artwork" clip-path="url(#wallet-body-clip)"/>
      <image id="animal-artwork" clip-path="url(#animal-clip)"/>
      <g id="stitches" fill="var(--wallet-stitches)"></g>
    </svg>`);

    const before = validateSvgContract(root);
    expect(before.valid).toBe(false);
    expect(statusOf(before, "safety")).toBe("unsafe");
    expect(statusOf(before, "wallet-body-clip/contents")).toBe("ok");

    const report = sanitizeSvgRoot(root);
    expect(report.removedElements).toContain("use");

    const after = validateSvgContract(root);
    expect(after.valid).toBe(false);
    expect(statusOf(after, "safety")).toBe("ok");
    expect(statusOf(after, "wallet-body-clip/contents")).toBe("empty");
  });

  it("leaves a clean document valid before and after sanitizing", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">
      <path id="wallet-body-shape" d="M0 0h10v10H0z"/>
      <path id="animal-shape" d="M2 2h4v4H2z"/>
      <clipPath id="wallet-body-clip"><use href="#wallet-body-shape"/></clipPath>
      <clipPath id="animal-clip"><use href="#animal-shape"/></clipPath>
      <image id="body-artwork" clip-path="url(#wallet-body-clip)"/>
      <image id="animal-artwork" clip-path="url(#animal-clip)"/>
      <g id="stitches" fill="var(--wallet-stitches)"></g>
    </svg>`);
    expect(validateSvgContract(root).valid).toBe(true);
    expect(sanitizeSvgRoot(root).removedElements).toEqual([]);
    expect(validateSvgContract(root).valid).toBe(true);
  });
});

describe("checkSafety means 'sanitize would remove nothing' — non-element nodes too", () => {
  const SOUND_BODY = `
    <path id="wallet-body-shape" d="M0 0h10v10H0z"/>
    <path id="animal-shape" d="M2 2h4v4H2z"/>
    <clipPath id="wallet-body-clip"><use href="#wallet-body-shape"/></clipPath>
    <clipPath id="animal-clip"><use href="#animal-shape"/></clipPath>
    <image id="body-artwork" clip-path="url(#wallet-body-clip)"/>
    <image id="animal-artwork" clip-path="url(#animal-clip)"/>
    <g id="stitches" fill="var(--wallet-stitches)"></g>`;

  function contract(body: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">${body}</svg>`;
  }

  it("rejects a document carrying a comment node", () => {
    // Cổng thứ hai phải chặn ĐÚNG cái mà sanitize gỡ. Trước bản vá, tài liệu
    // này trả `valid: true` với `safety: ok` trong khi payload sống nguyên vẹn.
    const report = validateSvgContract(
      parseSvg(contract(`<!-- --!><script>alert(document.domain)</script><!-- -->${SOUND_BODY}`)),
    );
    expect(statusOf(report, "safety")).toBe("unsafe");
    expect(report.valid).toBe(false);
    expect(report.checks.find((check) => check.id === "safety")?.hint).toContain("#comment");
  });

  it("rejects a comment nested anywhere, not only under the root", () => {
    const report = validateSvgContract(
      parseSvg(contract(SOUND_BODY.replace(`<g id="stitches" fill="var(--wallet-stitches)">`, `<g id="stitches" fill="var(--wallet-stitches)"><!--x-->`))),
    );
    expect(statusOf(report, "safety")).toBe("unsafe");
    expect(report.valid).toBe(false);
  });

  it("rejects a CDATA section", () => {
    // linkedom coi <title> trong SVG là RCDATA và không cài luật CDATA của nội
    // dung foreign, nên CDATA này parse lại thành một <script> sống.
    const report = validateSvgContract(
      parseSvg(contract(`<title><![CDATA[</title><script>alert(1)</script>]]></title>${SOUND_BODY}`)),
    );
    expect(statusOf(report, "safety")).toBe("unsafe");
    expect(report.valid).toBe(false);
    expect(report.checks.find((check) => check.id === "safety")?.hint).toContain("#cdata-section");
  });

  it("rejects a <use> that points at another document", () => {
    // `isAllowedUrlValue("https://…")` trả true một cách chính đáng — texture
    // da hợp lệ LÀ URL ngoài — nên vòng kiểm tra URL không bao giờ bắt được
    // cái này. Trước bản vá: `safety: ok`, `valid: true`, trong khi
    // sanitizeSvgRoot gỡ phần tử đó.
    const report = validateSvgContract(
      parseSvg(contract(`<use href="https://evil.example/x.svg#a"/>${SOUND_BODY}`)),
    );
    expect(statusOf(report, "safety")).toBe("unsafe");
    expect(report.valid).toBe(false);
    expect(report.checks.find((check) => check.id === "safety")?.hint).toContain(
      `<use href="https://evil.example/x.svg#a">`,
    );
  });

  it("still accepts an https: texture on <image> — one character from the case above", () => {
    const report = validateSvgContract(
      parseSvg(
        contract(
          SOUND_BODY.replace(
            `<image id="body-artwork"`,
            `<image id="body-artwork" href="https://cdn.example/leather.webp"`,
          ),
        ),
      ),
    );
    expect(statusOf(report, "safety")).toBe("ok");
    expect(report.valid).toBe(true);
  });

  it.each([
    ["a comment", `<!--x-->${SOUND_BODY}`],
    ["a nested comment", `<g><!--x--></g>${SOUND_BODY}`],
    ["a CDATA section", `<title><![CDATA[</title><script>alert(1)</script>]]></title>${SOUND_BODY}`],
    ["a URL( external beacon", `<rect style="background-image:URL(http://evil.example/b.png)"/>${SOUND_BODY}`],
    ["a <use> pointing off-document", `<use href="https://evil.example/x.svg#a"/>${SOUND_BODY}`],
    ["an xlink:href <use> pointing off-document", `<use xlink:href="https://evil.example/x.svg#a"/>${SOUND_BODY}`],
    [
      "an https: texture on <image>",
      SOUND_BODY.replace(`<image id="body-artwork"`, `<image id="body-artwork" href="https://cdn.example/leather.webp"`),
    ],
    ["an https: texture inside url()", `<rect style="fill:URL(https://cdn.example/t.webp)"/>${SOUND_BODY}`],
    ["a same-document <use>", `<use href="#animal-shape"/>${SOUND_BODY}`],
    ["a clean document", SOUND_BODY],
  ])("agrees with sanitizeSvgRoot about %s", (_label, body) => {
    const source = contract(body);
    const safety = statusOf(validateSvgContract(parseSvg(source)), "safety");
    const report = sanitizeSvgRoot(parseSvg(source));
    const sanitizerRemovedSomething =
      report.removedElements.length > 0 || report.removedAttributes.length > 0;
    expect(safety === "unsafe").toBe(sanitizerRemovedSomething);
  });
});

describe("validateSvgContract url( is case-insensitive", () => {
  const SOUND_BODY = `
    <path id="wallet-body-shape" d="M0 0h10v10H0z"/>
    <path id="animal-shape" d="M2 2h4v4H2z"/>
    <clipPath id="wallet-body-clip"><use href="#wallet-body-shape"/></clipPath>
    <clipPath id="animal-clip"><use href="#animal-shape"/></clipPath>
    <image id="body-artwork" clip-path="url(#wallet-body-clip)"/>
    <image id="animal-artwork" clip-path="url(#animal-clip)"/>
    <g id="stitches" fill="var(--wallet-stitches)"></g>`;

  function contract(body: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">${body}</svg>`;
  }

  it.each(["url", "URL", "Url", "uRl"])("catches %j(#missing) as a dangling reference", (spelling) => {
    const report = validateSvgContract(
      parseSvg(contract(`<rect clip-path="${spelling}(#does-not-exist)"/>${SOUND_BODY}`)),
    );
    expect(statusOf(report, "references")).toBe("dangling-ref");
    expect(report.valid).toBe(false);
  });

  it.each(["url", "URL", "Url", "uRl"])("catches %j(javascript:) as unsafe", (spelling) => {
    const report = validateSvgContract(
      parseSvg(contract(`<rect style="fill:${spelling}(javascript:alert(1))"/>${SOUND_BODY}`)),
    );
    expect(statusOf(report, "safety")).toBe("unsafe");
    expect(report.valid).toBe(false);
  });

  it.each(["url", "URL", "Url"])("still accepts an https texture behind %j(", (spelling) => {
    const report = validateSvgContract(
      parseSvg(contract(`<rect style="fill:${spelling}(https://cdn.example/texture.webp)"/>${SOUND_BODY}`)),
    );
    expect(statusOf(report, "safety")).toBe("ok");
    expect(statusOf(report, "references")).toBe("ok");
    expect(report.valid).toBe(true);
  });

  it("catches a CSS-escaped url( pointing at a missing id", () => {
    const report = validateSvgContract(
      parseSvg(contract(`<rect clip-path="\\75 rl(#does-not-exist)"/>${SOUND_BODY}`)),
    );
    expect(statusOf(report, "references")).toBe("dangling-ref");
    expect(report.valid).toBe(false);
  });
});
