import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as engine from "@/svg-engine";

const SRC_DIR = fileURLToPath(new URL("../../src/svg-engine/", import.meta.url));

/**
 * Đệ quy, vì `readdirSync` phẳng không nhìn thấy thư mục con: một
 * `src/svg-engine/adapters/…` trong tương lai sẽ thoát hoàn toàn khỏi hàng rào
 * kiến trúc mà không ai nhận ra.
 */
function engineSources(directory: string = SRC_DIR, prefix = ""): Array<[string, string]> {
  const files: Array<[string, string]> = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...engineSources(`${directory}${entry.name}/`, `${prefix}${entry.name}/`));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    files.push([`${prefix}${entry.name}`, readFileSync(directory + entry.name, "utf8")]);
  }
  return files;
}

/** Mọi cách nạp một module, không chỉ `import … from`. */
function importPatterns(moduleName: string): RegExp[] {
  return [
    new RegExp(`from\\s*["']${moduleName}`),
    new RegExp(`require\\s*\\(\\s*["']${moduleName}`),
    new RegExp(`import\\s*\\(\\s*["']${moduleName}`),
  ];
}

describe("svg-engine public API", () => {
  it("exports every documented entry point", () => {
    for (const name of [
      "CONTRACT_VERSION",
      "SVG_ROOT_ID",
      "STITCH_CSS_VAR",
      "ARTWORK_TARGET_IDS",
      "ARTWORK_CLIP_BINDINGS",
      "REQUIRED_ELEMENTS",
      "normalizeHex",
      "readCssVar",
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

  it("keeps the raw CSS-variable writer out of the public surface", () => {
    // `writeCssVar` ghi chuỗi tuỳ ý vào thuộc tính `style`. `applyStitchColor`
    // là wrapper an toàn duy nhất (giá trị qua normalizeHex trước) — guide §6.
    expect(engine).not.toHaveProperty("writeCssVar");
  });

  it("stays free of framework and environment coupling", () => {
    const forbidden = [
      ...importPatterns("react"),
      ...importPatterns("next"),
      ...importPatterns("@prisma"),
      ...importPatterns("linkedom"),
      // process.env, process["env"], process['env'], process[`env`]
      /process\s*(?:\.\s*env|\[\s*["'`]env)/,
    ];
    for (const [file, source] of engineSources()) {
      for (const pattern of forbidden) {
        expect(source, `${file} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("never parses SVG itself — callers supply the document", () => {
    // Cả cái tên: `new DOMParser`, `globalThis.DOMParser`, `window.DOMParser`,
    // hay giữ tham chiếu tới nó đều bị chặn. Engine không có lý do gì chạm vào.
    for (const [file, source] of engineSources()) {
      expect(source, `${file} must not reference DOMParser`).not.toMatch(/\bDOMParser\b/);
    }
  });

  it("actually reads the real engine directory", () => {
    const names = engineSources().map(([file]) => file);
    expect(names).toContain("index.ts");
    expect(names).toContain("sanitize.ts");
    expect(names.length).toBeGreaterThan(5);
  });
});
