import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `withAdminSession` (`src/lib/auth/withAdminSession.ts`) là cách DUY NHẤT
 * được phép viết handler `/api/admin/*`. Bản trước của bộ quét này chấp nhận
 * một prologue chép tay — gọi `requireAdminSession(req)` rồi tự `if
 * ("response" in auth) return auth.response;`. Vấn đề: `requireAdminSession`
 * không throw, nó trả `{ session } | { response }`, nên một handler gọi hàm
 * đó và BỎ kết quả (`await requireAdminSession(req);` rồi đi tiếp) biên dịch
 * sạch và qua được bộ đếm cũ — request lọt không xác thực. Một probe thật đã
 * xác nhận: scanner cũ báo pass, route trả 200 không cần Authorization header.
 *
 * Bộ quét này không còn cố phát hiện một prologue tự do đúng hình dạng — nó
 * ép một hợp đồng chính xác: mọi handler HTTP export trong `route.ts` dưới
 * `src/app/api/admin/` phải được GÁN trực tiếp từ một lời gọi
 * `withAdminSession(`. Không có hợp đồng nào khác được coi là hợp lệ, kể cả
 * gọi `requireAdminSession` trực tiếp — đúng nhưng không qua wrapper vẫn đỏ,
 * có chủ ý.
 *
 * Giới hạn đã biết: đây vẫn là quét văn bản, không phân tích cú pháp thật.
 * `export const GET = withAdminSession(...)` là hình dạng bắt buộc; nếu ai đó
 * viết `export async function GET(req) { return withAdminSession(inner)(req); }`
 * (gọi wrapper bên trong thân hàm thay vì gán trực tiếp) sẽ bị báo đỏ dù đúng
 * — chấp nhận được, vì đó không phải hình dạng route P2 dự định dùng.
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
 * Handler nào trong số các HTTP method được gán trực tiếp từ
 * `withAdminSession(...)`, ví dụ `export const GET = withAdminSession(handler);`.
 *
 * Không đếm số lời gọi chung chung — phải khớp đúng hình dạng gán cho từng
 * method, nên `GET` được bọc nhưng `POST` chỉ gọi `requireAdminSession` trực
 * tiếp (kể cả có `if ("response" in auth) return auth.response;` đủ dòng) vẫn
 * bị báo thiếu, đúng dự kiến — wrapper là hợp đồng duy nhất.
 */
export function wrappedHandlers(source: string): string[] {
  return HTTP_METHODS.filter((method) =>
    new RegExp(`export\\s+const\\s+${method}\\s*=\\s*withAdminSession\\s*\\(`).test(source),
  );
}

describe("bộ dò guard", () => {
  it("nhận ra handler không được bọc withAdminSession", () => {
    const source = `
      export const GET = withAdminSession(getHandler);
      export async function POST(req: Request) { return Response.json({}); }
    `;
    expect(exportedHandlers(source)).toEqual(["GET", "POST"]);
    expect(wrappedHandlers(source)).toEqual(["GET"]);
    // Hai handler nhưng chỉ một được bọc — POST bị hở.
    expect(wrappedHandlers(source).length).toBeLessThan(exportedHandlers(source).length);
  });

  // Finding 1 từ review: đây là lỗ hổng thật mà bản đếm-lời-gọi cũ lọt qua.
  // Gọi requireAdminSession trực tiếp rồi bỏ kết quả (không throw, không
  // return sớm) biên dịch sạch và scanner cũ báo pass. Bộ quét mới phải đỏ vì
  // không có `export const POST = withAdminSession(`.
  it("nhận ra handler gọi requireAdminSession trực tiếp rồi bỏ kết quả — lỗ hổng Finding 1", () => {
    const source = `
      import { requireAdminSession } from "@/lib/auth/requireAdminSession";
      export async function POST(req: Request) {
        await requireAdminSession(req); // kết quả bị bỏ — không xác thực gì cả
        return Response.json({ ok: true });
      }
    `;
    expect(exportedHandlers(source)).toEqual(["POST"]);
    expect(wrappedHandlers(source)).toEqual([]);
  });

  it("nhận ra cả handler khai bằng const không dùng withAdminSession", () => {
    expect(exportedHandlers(`export const PATCH = async (req: Request) => {};`)).toEqual(["PATCH"]);
    expect(wrappedHandlers(`export const PATCH = async (req: Request) => {};`)).toEqual([]);
  });

  it("chấp nhận handler đúng hợp đồng", () => {
    const source = `export const DELETE = withAdminSession(async (req, { session }) => Response.json({}));`;
    expect(wrappedHandlers(source)).toEqual(["DELETE"]);
  });
});

describe("/api/admin/* session guard", () => {
  const files = routeFiles(ADMIN_API);

  it.each(files.length ? files : [["(chưa có route admin nào)", ""]])(
    "%s: mọi handler export được gán từ withAdminSession(...)",
    (name, source) => {
      const handlers = exportedHandlers(source);
      if (handlers.length === 0) return;
      expect(
        source,
        `${name}: phải import withAdminSession`,
      ).toContain('from "@/lib/auth/withAdminSession"');
      const wrapped = wrappedHandlers(source);
      const unwrapped = handlers.filter((method) => !wrapped.includes(method));
      expect(
        unwrapped,
        `${name}: handler chưa bọc withAdminSession: ${unwrapped.join(", ") || "(none)"}`,
      ).toEqual([]);
    },
  );
});
