import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as engine from "@/svg-engine";

const SRC_DIR = fileURLToPath(new URL("../../src/svg-engine/", import.meta.url));

describe("svg-engine public API", () => {
  it("exports every documented entry point", () => {
    for (const name of [
      "CONTRACT_VERSION",
      "SVG_ROOT_ID",
      "STITCH_CSS_VAR",
      "ARTWORK_TARGET_IDS",
      "REQUIRED_ELEMENTS",
      "normalizeHex",
      "readCssVar",
      "writeCssVar",
      "validateSvgContract",
      "applyTexture",
      "applyStitchColor",
      "MissingTargetError",
      "createMockupLoader",
      "sanitizeSvgRoot",
      "bakeDesign",
      "BakeError",
    ]) {
      expect(engine).toHaveProperty(name);
    }
  });

  it("stays free of framework and environment coupling", () => {
    const forbidden = [/from ["']react/, /from ["']next/, /from ["']@prisma/, /process\.env/];
    for (const file of readdirSync(SRC_DIR).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(SRC_DIR + file, "utf8");
      for (const pattern of forbidden) {
        expect(source, `${file} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("never parses SVG itself — callers supply the document", () => {
    for (const file of readdirSync(SRC_DIR).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(SRC_DIR + file, "utf8");
      expect(source, `${file} must not construct a DOMParser`).not.toMatch(/new DOMParser/);
    }
  });
});
