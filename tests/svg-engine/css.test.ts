import { describe, expect, it } from "vitest";
import { readCssVar, writeCssVar } from "@/svg-engine/css";
import { parseSvg } from "../helpers/svgDom";

const bare = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"></svg>`;
const withVar = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview" style="--wallet-stitches: #E7C337"></svg>`;
const withOthers = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview" style="opacity: 0.5; --wallet-stitches:#E7C337; display:block"></svg>`;

describe("readCssVar", () => {
  it("returns null when the element has no style attribute", () => {
    expect(readCssVar(parseSvg(bare), "--wallet-stitches")).toBeNull();
  });

  it("reads a custom property, ignoring surrounding whitespace", () => {
    expect(readCssVar(parseSvg(withVar), "--wallet-stitches")).toBe("#E7C337");
  });

  it("reads a custom property that sits among other declarations", () => {
    expect(readCssVar(parseSvg(withOthers), "--wallet-stitches")).toBe("#E7C337");
  });

  it("returns null for a property that is absent", () => {
    expect(readCssVar(parseSvg(withVar), "--nope")).toBeNull();
  });

  it("does not match a property whose name merely ends with the query", () => {
    const svg = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" style="--outer-wallet-stitches: #FFFFFF"></svg>`);
    expect(readCssVar(svg, "--wallet-stitches")).toBeNull();
  });
});

describe("writeCssVar", () => {
  it("adds the property to an element with no style attribute", () => {
    const svg = parseSvg(bare);
    writeCssVar(svg, "--wallet-stitches", "#AABBCC");
    expect(readCssVar(svg, "--wallet-stitches")).toBe("#AABBCC");
  });

  it("replaces an existing value without duplicating the declaration", () => {
    const svg = parseSvg(withVar);
    writeCssVar(svg, "--wallet-stitches", "#123456");
    expect(readCssVar(svg, "--wallet-stitches")).toBe("#123456");
    expect(svg.getAttribute("style")!.match(/--wallet-stitches/g)).toHaveLength(1);
  });

  it("preserves unrelated declarations", () => {
    const svg = parseSvg(withOthers);
    writeCssVar(svg, "--wallet-stitches", "#123456");
    const style = svg.getAttribute("style")!;
    expect(style).toContain("opacity: 0.5");
    expect(style).toContain("display:block");
    expect(readCssVar(svg, "--wallet-stitches")).toBe("#123456");
  });
});
