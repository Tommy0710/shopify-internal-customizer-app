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
