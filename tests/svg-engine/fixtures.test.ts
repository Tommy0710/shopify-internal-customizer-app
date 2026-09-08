import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateSvgContract } from "@/svg-engine/validate";
import { parseSvg } from "../helpers/svgDom";

const FIXTURES = ["angler-fish", "crocodile"] as const;

function load(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/svg/${name}.svg`, import.meta.url)), "utf8");
}

describe.each(FIXTURES)("fixture %s", (name) => {
  const source = load(name);

  it("satisfies the animal-* contract", () => {
    const report = validateSvgContract(parseSvg(source));
    const failed = report.checks.filter((check) => check.status !== "ok" && check.status !== "warning");
    expect(failed).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it("retains no legacy fish-* identifiers or references", () => {
    expect(source).not.toMatch(/\bid="fish-/);
    expect(source).not.toMatch(/href="#fish-/);
    expect(source).not.toMatch(/url\(#fish-/);
  });

  it("declares a viewBox", () => {
    expect(validateSvgContract(parseSvg(source)).viewBox).toMatch(/^[\d.\s-]+$/);
  });

  it("keeps the stitch group wired to the colour variable", () => {
    const stitches = parseSvg(source).querySelector(`[id="stitches"]`)!;
    expect(stitches.getAttribute("fill")).toContain("var(--wallet-stitches)");
  });
});
