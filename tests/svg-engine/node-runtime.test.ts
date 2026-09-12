import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOMParser } from "linkedom";
import { describe, expect, it } from "vitest";
import { SvgParseError, parseSvgFromText } from "@/lib/svg/parseSvgNode";
import { SVG_NAMESPACE } from "@/svg-engine/contract";
import { bakeDesign } from "@/svg-engine/bake";
import { readCssVar } from "@/svg-engine/css";
import { sanitizeSvgRoot } from "@/svg-engine/sanitize";
import { validateSvgContract } from "@/svg-engine/validate";

/**
 * Test này CỐ TÌNH không import gì từ `tests/helpers/`.
 *
 * Lý do tồn tại: phần bù namespace của linkedom từng chỉ nằm trong helper test
 * và không bao giờ được ship. Toàn bộ 124 test xanh trong khi hai trong ba
 * consumer của engine — upload validator và bake lúc có đơn, cả hai chạy Node —
 * từ chối MỌI tài liệu hợp lệ. Mọi test khác chạm engine qua helper đó, nên
 * không test nào thấy được.
 *
 * Đây cũng là test tích hợp cả phase: parse → sanitize → validate → bake.
 */

const FIXTURES = ["angler-fish", "crocodile"] as const;

const input = {
  bodyTextureUrl: "https://cdn.example/texture/suede-brown.webp",
  animalTextureUrl: "https://cdn.example/texture/togo-brown.webp",
  stitchHex: "#e7c337",
};

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/svg/${name}.svg`, import.meta.url)), "utf8");
}

describe("linkedom without any test shim", () => {
  it.each(FIXTURES)("never resolves xmlns into namespaceURI for %s", (name) => {
    const root = new DOMParser().parseFromString(fixture(name), "image/svg+xml").documentElement;
    expect(root.getAttribute("xmlns")).toBe(SVG_NAMESPACE);
    expect(root.namespaceURI).not.toBe(SVG_NAMESPACE);
  });

  it("is the reason the Node parse adapter exists", () => {
    const root = new DOMParser().parseFromString(fixture("crocodile"), "image/svg+xml")
      .documentElement as unknown as Element;
    expect(validateSvgContract(root).valid).toBe(false);
  });
});

describe("the shipped Node runtime, end to end", () => {
  it.each(FIXTURES)("parses, sanitizes, validates and bakes %s", (name) => {
    const root = parseSvgFromText(fixture(name));

    expect(root.namespaceURI).toBe(SVG_NAMESPACE);

    const sanitized = sanitizeSvgRoot(root);
    expect(sanitized.removedElements).toEqual([]);
    expect(sanitized.removedAttributes).toEqual([]);

    const report = validateSvgContract(root);
    expect(report.checks.filter((check) => check.status !== "ok")).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.viewBox).toMatch(/^[\d.\s-]+$/);

    bakeDesign(root, input);

    expect(root.querySelector(`[id="body-artwork"]`)!.getAttribute("href")).toBe(
      input.bodyTextureUrl,
    );
    expect(root.querySelector(`[id="animal-artwork"]`)!.getAttribute("href")).toBe(
      input.animalTextureUrl,
    );
    expect(readCssVar(root, "--wallet-stitches")).toBe("#E7C337");
    expect(validateSvgContract(root).valid).toBe(true);
  });

  it("records the baked texture URLs as external references for the host allowlist", () => {
    const root = parseSvgFromText(fixture("crocodile"));
    bakeDesign(root, input);
    expect(sanitizeSvgRoot(root).externalRefs).toEqual([
      input.bodyTextureUrl,
      input.animalTextureUrl,
    ]);
  });
});

describe("parseSvgFromText", () => {
  it("leaves a document without xmlns for the validator to reject", () => {
    const root = parseSvgFromText(`<svg id="wallet-preview"><g id="stitches"/></svg>`);
    expect(root.namespaceURI).not.toBe(SVG_NAMESPACE);
    expect(validateSvgContract(root).valid).toBe(false);
  });

  it("leaves a document with the wrong xmlns alone too", () => {
    const root = parseSvgFromText(
      `<svg id="wallet-preview" xmlns="http://www.w3.org/1999/xhtml"><g id="stitches"/></svg>`,
    );
    expect(root.namespaceURI).not.toBe(SVG_NAMESPACE);
    expect(validateSvgContract(root).valid).toBe(false);
  });

  it("throws when the root is not an <svg> element", () => {
    expect(() => parseSvgFromText(`<html><body>nope</body></html>`)).toThrow(SvgParseError);
  });
});
