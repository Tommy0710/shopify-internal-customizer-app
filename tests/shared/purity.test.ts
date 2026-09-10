import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

function importPatterns(moduleName: string): RegExp[] {
  return [
    new RegExp(`from\\s*["']${moduleName}`),
    new RegExp(`require\\s*\\(\\s*["']${moduleName}`),
    new RegExp(`import\\s*\\(\\s*["']${moduleName}`),
  ];
}

/**
 * P3 bundle `src/shared/` vào theme extension bằng esbuild. Bất cứ thứ gì lọt vào
 * danh sách cấm này sẽ hoặc làm vỡ build, hoặc kéo vài trăm KB vào một bundle mục
 * tiêu 8KB, hoặc — tệ nhất — kéo mã server vào mã chạy ở trình duyệt khách.
 */
describe("src/shared thuần TypeScript", () => {
  const forbidden = ["next", "react", "react-dom", "@prisma/client", "linkedom", "@supabase/supabase-js"];

  it.each(forbidden)("không import %s", (moduleName) => {
    for (const [file, body] of sharedSources()) {
      for (const pattern of importPatterns(moduleName)) {
        expect(body, `${file} import ${moduleName}`).not.toMatch(pattern);
      }
    }
  });

  it("không import module node:*", () => {
    for (const [file, body] of sharedSources()) {
      expect(body, `${file} dùng node builtin`).not.toMatch(/from\s*["']node:/);
    }
  });

  it("không đọc process.env", () => {
    for (const [file, body] of sharedSources()) {
      expect(body, `${file} đọc process.env`).not.toMatch(/process\.env/);
    }
  });

  it("có ít nhất một file — hàng rào rỗng là hàng rào vô nghĩa", () => {
    expect(sharedSources().length).toBeGreaterThan(0);
  });
});
