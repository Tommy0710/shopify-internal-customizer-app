import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { purityViolations } from "../helpers/purityFence";

const SHARED_DIR = fileURLToPath(new URL("../../src/shared/", import.meta.url));

function sharedSources(directory: string = SHARED_DIR, prefix = ""): Array<[string, string]> {
  const files: Array<[string, string]> = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...sharedSources(`${directory}${entry.name}/`, `${prefix}${entry.name}/`));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    files.push([`${prefix}${entry.name}`, readFileSync(directory + entry.name, "utf8")]);
  }
  return files;
}

/**
 * P3 có thể bundle `src/shared/` vào theme extension bằng esbuild (quyết định
 * cuối để ở P3). Bất cứ thứ gì vi phạm luật dưới đây sẽ hoặc làm vỡ build, hoặc
 * kéo hàng trăm KB vào bundle storefront, hoặc — tệ nhất — kéo mã server vào mã
 * chạy ở trình duyệt khách. Luật dùng chung với hàng rào svg-engine, sống ở
 * `tests/helpers/purityFence.ts` để hai bên không lệch nhau được.
 */
describe("src/shared thuần TypeScript", () => {
  it("không vi phạm luật hàng rào thuần nào", () => {
    expect(purityViolations(sharedSources())).toEqual([]);
  });

  it("có ít nhất một file — hàng rào rỗng là hàng rào vô nghĩa", () => {
    expect(sharedSources().length).toBeGreaterThan(0);
  });
});
