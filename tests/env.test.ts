import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const EXAMPLE = readFileSync(`${REPO}.env.example`, "utf8");

interface SourceFile {
  /** Đường dẫn tương đối từ repo root, chỉ để thông báo lỗi dễ đọc. */
  path: string;
  body: string;
}

function sourceFiles(dir: string, relPrefix: string, acc: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}${entry.name}`;
    const rel = `${relPrefix}${entry.name}`;
    if (entry.isDirectory()) sourceFiles(`${full}/`, `${rel}/`, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push({ path: rel, body: readFileSync(full, "utf8") });
  }
  return acc;
}

describe(".env.example", () => {
  it("khai mọi biến mà src/ thật sự đọc", () => {
    const used = new Set<string>();
    for (const { body } of sourceFiles(`${REPO}src/`, "src/")) {
      // 1) process.env.NAME
      for (const match of body.matchAll(/process\.env\.([A-Z0-9_]+)/g)) used.add(match[1]);

      // 2) process.env["NAME"] / process.env['NAME'] — khoá là string literal.
      // Bản gốc của test này (brief task-7) chỉ bắt được dạng dấu chấm — một
      // module đọc qua `process.env[name]` với `name` là literal truyền vào
      // trốn được hoàn toàn. Đây chính là lỗ mà `src/lib/storage/index.ts`
      // (đọc qua `readRequiredEnv("SUPABASE_URL", …)`) lọt qua nếu không vá.
      for (const match of body.matchAll(/process\.env\[\s*["']([A-Z0-9_]+)["']\s*\]/g)) used.add(match[1]);

      // 3) Lời gọi tới một helper đọc env — tên hàm kết thúc bằng "Env"/"env"
      // (readRequiredEnv, requireEnv, getEnv, …) — với tham số đầu là string
      // literal: readRequiredEnv("SUPABASE_URL", "createStorageClient").
      // Bản thân helper đọc `process.env[name]` với `name` là tham số động
      // (không phải literal) nên hai regex trên không thấy được; ta bắt ở
      // TỪNG NƠI GỌI helper đó thay vì cố suy luận trong định nghĩa helper.
      for (const match of body.matchAll(/\b\w*[Ee]nv\s*\(\s*["']([A-Z0-9_]+)["']/g)) used.add(match[1]);
    }
    // NODE_ENV do runtime cung cấp, không phải biến ta khai.
    used.delete("NODE_ENV");
    const missing = [...used].filter((name) => !new RegExp(`^${name}=`, "m").test(EXAMPLE)).sort();
    expect(missing, "biến bị đọc nhưng không có trong .env.example").toEqual([]);
  });

  it("không chứa credential thật", () => {
    expect(EXAMPLE).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // JWT Supabase
    expect(EXAMPLE).not.toMatch(/postgresql:\/\/[^:]+:(?!your_)[^@\s]{8,}@/); // mật khẩu DB thật
  });
});

describe("process.env[key động]", () => {
  /**
   * Hàng rào cho chính cơ chế nhận diện ở trên: một `process.env[key]` với
   * `key` KHÔNG phải string literal (biến, biểu thức…) không được regex #2
   * hay #3 ở trên nhìn thấy — nếu nó xảy ra NGOÀI một helper tên kết thúc
   * "Env"/"env" (nơi ta chấp nhận đọc động vì mọi lời gọi helper đó đã bị bắt
   * bằng literal ở nơi gọi), nó âm thầm né được toàn bộ test ở trên. Test này
   * KHÔNG cố phân tích AST — chỉ tìm dòng khai báo hàm/arrow gần nhất PHÍA
   * TRÊN dòng vi phạm trong cùng file, và đòi tên hàm đó kết thúc bằng
   * "Env"/"env". Cố tình đơn giản: không brace-matching, không import phân
   * tích cú pháp thật.
   */
  it("cấm process.env[key động] bên ngoài helper tên kết thúc bằng Env/env", () => {
    // Yêu cầu "=>" ngay trên dòng khai báo cho nhánh arrow function — nếu
    // không, một dòng bình thường kiểu `const value = (bieu_thuc).trim();`
    // (KHÔNG phải khai báo hàm, chỉ là ngoặc nhóm biểu thức) sẽ bị nhận nhầm
    // thành một "hàm" tên "value", che mất hàm bao quanh thật sự nằm phía
    // trên. `function NAME(` thì luôn là khai báo hàm thật, không cần điều
    // kiện thêm.
    const FUNCTION_DECL_RE =
      /(?:function\s+([A-Za-z0-9_]+)\s*\()|(?:(?:const|let|var)\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*=>)/;
    const DYNAMIC_ENV_RE = /process\.env\[\s*([^\]]+?)\s*\]/g;
    const STRING_LITERAL_RE = /^["'][^"']*["']$/;
    const MAX_LOOKBACK_LINES = 40;

    const violations: string[] = [];
    for (const { path, body } of sourceFiles(`${REPO}src/`, "src/")) {
      const lines = body.split("\n");
      lines.forEach((line, idx) => {
        for (const match of line.matchAll(DYNAMIC_ENV_RE)) {
          const key = match[1].trim();
          if (STRING_LITERAL_RE.test(key)) continue; // khoá literal — đã được test trên bắt

          let enclosingName: string | null = null;
          for (let i = idx; i >= 0 && idx - i < MAX_LOOKBACK_LINES; i--) {
            const declMatch = lines[i].match(FUNCTION_DECL_RE);
            if (declMatch) {
              enclosingName = declMatch[1] ?? declMatch[2] ?? null;
              break;
            }
          }

          if (!enclosingName || !/env$/i.test(enclosingName)) {
            violations.push(
              `${path}:${idx + 1}: process.env[${key}] — khoá động ngoài helper tên kết thúc Env/env` +
                (enclosingName ? ` (hàm bao quanh gần nhất: "${enclosingName}")` : " (không tìm thấy hàm bao quanh)"),
            );
          }
        }
      });
    }

    expect(
      violations,
      "process.env[key ĐỘNG] chỉ được phép trong một helper tên kết thúc Env/env — nếu không, nó né được test " +
        '".env.example khai mọi biến mà src/ thật sự đọc" ở trên',
    ).toEqual([]);
  });
});
