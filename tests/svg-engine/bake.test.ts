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
});
