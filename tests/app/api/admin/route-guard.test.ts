import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard `/api/admin/*` là prologue chép tay ở đầu mỗi handler — không có gì ở
 * tầng type hay lint ép nó phải có mặt. Bản trước kiểm hai route gọi đích danh;
 * P2 sẽ thêm khoảng 30 route nữa và một danh sách viết tay chắc chắn lạc hậu.
 *
 * Bản này quét thư mục. Giới hạn đã biết: nó đếm lời gọi chứ không phân tích cú
 * pháp, nên một file có 2 handler và 2 lời gọi `requireAdminSession` nằm cả trong
 * một handler sẽ lọt. Đổi lại nó bắt được đúng lỗi hay xảy ra nhất — thêm handler
 * mới mà quên guard — và không bao giờ lạc hậu.
 */

const ADMIN_API = fileURLToPath(new URL("../../../../src/app/api/admin/", import.meta.url));
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function routeFiles(dir: string, prefix = ""): Array<[string, string]> {
  if (!existsSync(dir)) return [];
  const found: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...routeFiles(`${dir}${entry.name}/`, `${prefix}${entry.name}/`));
      continue;
    }
    if (entry.name !== "route.ts") continue;
    found.push([`${prefix}${entry.name}`, readFileSync(dir + entry.name, "utf8")]);
  }
  return found;
}

/** Đếm handler HTTP được export trong một file route. */
export function exportedHandlers(source: string): string[] {
  return HTTP_METHODS.filter((method) =>
    new RegExp(`export\\s+(?:async\\s+)?(?:function\\s+${method}\\b|const\\s+${method}\\s*[:=])`).test(source),
  );
}

/**
 * Số lời GỌI `requireAdminSession(` trong một file route.
 *
 * Dòng `import { requireAdminSession } from "…"` KHÔNG được đếm: trong đó tên hàm
 * theo sau là ` }` và `"`, không phải `(`. Nên con số trả về đã là số lời gọi
 * thật — đừng trừ đi 1 ở nơi dùng.
 */
export function guardCallCount(source: string): number {
  return (source.match(/requireAdminSession\s*\(/g) ?? []).length;
}

describe("bộ dò guard", () => {
  // Kiểm soát âm: nếu bộ dò hỏng, cả bộ quét bên dưới xanh một cách vô nghĩa.
  it("nhận ra handler thiếu guard", () => {
    const source = `
      import { requireAdminSession } from "@/lib/auth/requireAdminSession";
      export async function GET(req: Request) { const s = await requireAdminSession(req); return Response.json({}); }
      export async function POST(req: Request) { return Response.json({}); }
    `;
    expect(exportedHandlers(source)).toEqual(["GET", "POST"]);
    // Hai handler nhưng chỉ một lời gọi guard — POST bị hở.
    expect(guardCallCount(source)).toBe(1);
    expect(guardCallCount(source)).toBeLessThan(exportedHandlers(source).length);
  });

  it("nhận ra cả handler khai bằng const", () => {
    expect(exportedHandlers(`export const PATCH = async (req: Request) => {};`)).toEqual(["PATCH"]);
  });
});

describe("/api/admin/* session guard", () => {
  const files = routeFiles(ADMIN_API);

  it.each(files.length ? files : [["(chưa có route admin nào)", ""]])(
    "%s gọi requireAdminSession trong mọi handler",
    (name, source) => {
      const handlers = exportedHandlers(source);
      if (handlers.length === 0) return;
      expect(
        source,
        `${name}: phải import requireAdminSession`,
      ).toContain('from "@/lib/auth/requireAdminSession"');
      expect(
        guardCallCount(source),
        `${name}: ${handlers.length} handler (${handlers.join(", ")}) nhưng chỉ ${guardCallCount(source)} lời gọi guard`,
      ).toBeGreaterThanOrEqual(handlers.length);
    },
  );
});
