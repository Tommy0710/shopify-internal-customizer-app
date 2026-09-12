import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BakeError, bakeDesign } from "@/svg-engine/bake";
import { readCssVar } from "@/svg-engine/css";
import { validateSvgContract } from "@/svg-engine/validate";
import { parseSvg } from "../helpers/svgDom";

const input = {
  bodyTextureUrl: "https://cdn.example/texture/suede-brown.webp",
  animalTextureUrl: "https://cdn.example/texture/togo-brown.webp",
  stitchHex: "#e7c337",
};

function realMockup(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/svg/${name}.svg`, import.meta.url)), "utf8");
}

describe("bakeDesign", () => {
  it("writes both textures and the stitch colour into a real mockup", () => {
    const root = parseSvg(realMockup("angler-fish"));
    bakeDesign(root, input);

    expect(root.querySelector(`[id="body-artwork"]`)!.getAttribute("href")).toBe(input.bodyTextureUrl);
    expect(root.querySelector(`[id="animal-artwork"]`)!.getAttribute("href")).toBe(input.animalTextureUrl);
    expect(readCssVar(root, "--wallet-stitches")).toBe("#E7C337");
  });

  it("reveals both artwork layers so the baked file renders standalone", () => {
    const root = parseSvg(realMockup("crocodile"));
    bakeDesign(root, input);
    for (const id of ["body-artwork", "animal-artwork"]) {
      const image = root.querySelector(`[id="${id}"]`)!;
      expect(image.hasAttribute("hidden")).toBe(false);
      expect(image.getAttribute("visibility")).toBe("visible");
    }
  });

  it("keeps the result contract-valid", () => {
    const root = parseSvg(realMockup("angler-fish"));
    bakeDesign(root, input);
    expect(validateSvgContract(root).valid).toBe(true);
  });

  it("is deterministic — same input yields identical output", () => {
    const a = parseSvg(realMockup("angler-fish"));
    const b = parseSvg(realMockup("angler-fish"));
    bakeDesign(a, input);
    bakeDesign(b, input);
    expect(a.outerHTML).toBe(b.outerHTML);
  });

  it("refuses a mockup that does not satisfy the contract", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"></svg>`);
    expect(() => bakeDesign(root, input)).toThrow(BakeError);
  });

  it("refuses an invalid stitch colour rather than writing a broken value", () => {
    const root = parseSvg(realMockup("angler-fish"));
    expect(() => bakeDesign(root, { ...input, stitchHex: "rebeccapurple" })).toThrow(BakeError);
    expect(readCssVar(root, "--wallet-stitches")).not.toBe("rebeccapurple");
  });

  it("leaves the document byte-identical when it throws", () => {
    // Bản cũ gắn cả hai texture RỒI mới kiểm màu chỉ, nên sau khi ném lỗi
    // #body-artwork đã mang href — một tài liệu nửa vời mà caller không thấy.
    const root = parseSvg(realMockup("angler-fish"));
    const before = root.outerHTML;
    expect(() => bakeDesign(root, { ...input, stitchHex: "rebeccapurple" })).toThrow(BakeError);
    expect(root.outerHTML).toBe(before);
    expect(root.querySelector(`[id="body-artwork"]`)!.hasAttribute("href")).toBe(false);
  });

  it.each(["", "   "])("refuses a blank texture URL instead of hiding the layer (%j)", (blank) => {
    // applyTexture coi chuỗi rỗng là TÍN HIỆU GỠ ảnh: bản cũ bake thành công và
    // sinh ra hồ sơ lưu trữ có lớp thân ví vô hình.
    const root = parseSvg(realMockup("crocodile"));
    const before = root.outerHTML;
    expect(() => bakeDesign(root, { ...input, bodyTextureUrl: blank })).toThrow(BakeError);
    expect(root.outerHTML).toBe(before);
  });

  it("refuses a texture URL whose scheme the validator would reject", () => {
    const root = parseSvg(realMockup("crocodile"));
    expect(() =>
      bakeDesign(root, { ...input, animalTextureUrl: "javascript:alert(1)" }),
    ).toThrow(BakeError);
    expect(root.querySelector(`[id="body-artwork"]`)!.hasAttribute("href")).toBe(false);
  });

  it("refuses a mockup whose #stitches ignores the colour variable", () => {
    // "warning" không phá `valid` là đúng cho cổng PREVIEW. Với cổng LƯU TRỮ
    // thì sai: màu khách chọn rơi vào một custom property không ai đọc, chỉ vẫn
    // đen, và đơn hàng lưu vĩnh viễn sai màu (spec §6.6).
    const source = realMockup("crocodile").replace(
      'fill="var(--wallet-stitches)"',
      'fill="#000000"',
    );
    const root = parseSvg(source);
    expect(root.querySelector(`[id="stitches"]`)!.getAttribute("fill")).toBe("#000000");
    expect(validateSvgContract(root).valid).toBe(true);
    expect(validateSvgContract(root).checks.some((check) => check.status === "warning")).toBe(true);
    expect(() => bakeDesign(root, input)).toThrow(BakeError);
  });
});
