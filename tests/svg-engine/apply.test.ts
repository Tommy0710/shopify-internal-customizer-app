import { describe, expect, it } from "vitest";
import { MissingTargetError, applyStitchColor, applyTexture } from "@/svg-engine/apply";
import { readCssVar } from "@/svg-engine/css";
import { parseSvg } from "../helpers/svgDom";

const doc = () =>
  parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview" style="--wallet-stitches: #E7C337">
    <image id="body-artwork" hidden="hidden"/>
    <image id="animal-artwork" hidden="hidden"/>
    <g id="stitches" fill="var(--wallet-stitches)"></g>
  </svg>`);

const target = (root: Element, id: string) => root.querySelector(`[id="${id}"]`)!;

describe("applyTexture", () => {
  it("sets href and reveals the image", () => {
    const root = doc();
    applyTexture(root, "body", "https://cdn.example/leather.webp");
    const image = target(root, "body-artwork");
    expect(image.getAttribute("href")).toBe("https://cdn.example/leather.webp");
    expect(image.hasAttribute("hidden")).toBe(false);
    expect(image.getAttribute("visibility")).toBe("visible");
  });

  it("touches only the requested target", () => {
    const root = doc();
    applyTexture(root, "animal", "https://cdn.example/togo.webp");
    expect(target(root, "animal-artwork").getAttribute("href")).toBe("https://cdn.example/togo.webp");
    expect(target(root, "body-artwork").hasAttribute("href")).toBe(false);
    expect(target(root, "body-artwork").hasAttribute("hidden")).toBe(true);
  });

  it("clears href and hides the image again when given null", () => {
    const root = doc();
    applyTexture(root, "body", "https://cdn.example/leather.webp");
    applyTexture(root, "body", null);
    const image = target(root, "body-artwork");
    expect(image.hasAttribute("href")).toBe(false);
    expect(image.getAttribute("hidden")).toBe("");
    expect(image.getAttribute("visibility")).toBe("hidden");
  });

  it("throws a typed error when the target is absent", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"></svg>`);
    expect(() => applyTexture(root, "body", "https://cdn.example/x.webp")).toThrow(MissingTargetError);
  });
});

describe("applyStitchColor", () => {
  it("writes a normalised colour and returns it", () => {
    const root = doc();
    expect(applyStitchColor(root, "#abc")).toBe("#AABBCC");
    expect(readCssVar(root, "--wallet-stitches")).toBe("#AABBCC");
  });

  it("leaves the existing colour untouched when the input is invalid", () => {
    const root = doc();
    expect(applyStitchColor(root, "rebeccapurple")).toBeNull();
    expect(readCssVar(root, "--wallet-stitches")).toBe("#E7C337");
  });

  it("does not write anything for a non-string input", () => {
    const root = doc();
    expect(applyStitchColor(root, 123456)).toBeNull();
    expect(readCssVar(root, "--wallet-stitches")).toBe("#E7C337");
  });

  it("does not disturb the artwork targets", () => {
    const root = doc();
    applyTexture(root, "body", "https://cdn.example/leather.webp");
    applyStitchColor(root, "#123456");
    expect(target(root, "body-artwork").getAttribute("href")).toBe("https://cdn.example/leather.webp");
  });
});
