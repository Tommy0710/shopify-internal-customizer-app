import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Hợp đồng bắt buộc cho mọi handler HTTP dưới `src/app/api/admin/`: phải được
 * viết đúng hình `export const <METHOD> = withAdminSession(...)`
 * (`src/lib/auth/withAdminSession.ts`). Không có hình nào khác được coi là
 * hợp lệ — kể cả gọi `requireAdminSession` trực tiếp với đủ `if ("response"
 * in auth) return auth.response;`, kể cả bọc wrapper bên trong thân hàm thay
 * vì gán trực tiếp.
 *
 * Lịch sử hai lỗ hổng đã tìm thấy và đóng lại ở đây:
 *
 * 1. Bản đầu tiên chỉ ĐẾM số lần xuất hiện `requireAdminSession(`.
 *    `requireAdminSession` không throw, nó trả `{ session } | { response }`,
 *    nên một handler gọi hàm rồi BỎ kết quả (không `if (...) return
 *    auth.response;`) biên dịch sạch và qua được bộ đếm — probe thật xác
 *    nhận: scanner báo pass, route trả 200 không cần Authorization header.
 *    Vá bằng cách bỏ hẳn việc đếm-lời-gọi, ép hình gán trực tiếp từ
 *    `withAdminSession(`.
 *
 * 2. Vá xong (1) vẫn có khe hở: `exportedHandlers` đòi token `export` nằm
 *    NGAY TRƯỚC `function GET` / `const GET`. Một route viết
 *    `async function GET(req) { ...không guard... } export { GET };` — hình
 *    rất bình thường khi ai đó tách handler ra để import thẳng trong unit
 *    test — cho `exportedHandlers` thấy ZERO handler, `it.each` bỏ qua sớm,
 *    và route phục vụ không xác thực mà không có tín hiệu gì. Vá bằng cách
 *    TỪ CHỐI thẳng mọi `export { ... }` có chứa tên một HTTP method trong
 *    file route admin — không cố truy xem binding khai riêng có được gán từ
 *    `withAdminSession` hay không (đó là bài toán AST, regex không giải
 *    được). Một hình duy nhất được chấp nhận; `export { ... }` luôn đỏ.
 *
 * Giới hạn còn lại, chấp nhận có chủ đích: đây vẫn là quét văn bản. Một file
 * tự khai `function withAdminSession(h) { return h; }` (shadow cùng tên,
 * pass-through không guard gì) rồi `export const GET =
 * withAdminSession(handler);` sẽ qua được scanner này dù không có xác thực
 * thật. Cách vá đòi hỏi cố ý khai một decoy trùng tên ngay trong file đó —
 * không phải hình dạng vô tình ai đó gõ nhầm — nên được coi là chấp nhận
 * được, không phải lỗ hổng cần vá tiếp.
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

/**
 * Method nào bị export qua hình `export { ... }` thay vì `export const
 * <METHOD> = withAdminSession(...)` trực tiếp — ví dụ `export { GET };` sau
 * một khai báo `function GET(req) {...}` rời. `exportedHandlers` không thấy
 * hình này (không có `export` ngay trước `function GET`), nên đây là kênh
 * riêng bắt nó: gom nội dung mọi khối `export { ... }` trong file rồi tìm tên
 * method như một identifier trọn vẹn bên trong. Không cố phân biệt
 * `export { GET }` với `export { internalGet as GET }` — cả hai đều bị từ
 * chối, vì hình duy nhất được chấp nhận là gán trực tiếp, không phải re-export.
 */
export function reExportedMethods(source: string): string[] {
  const blocks = source.match(/export\s*\{[^}]*\}/g) ?? [];
  const combined = blocks.join(" ");
  return HTTP_METHODS.filter((method) => new RegExp(`\\b${method}\\b`).test(combined));
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

  // Fix round 2: khe hở còn lại sau khi vá Finding 1. `exportedHandlers` đòi
  // token `export` ngay trước `function GET`/`const GET`; tách handler ra rồi
  // `export { GET }` riêng là hình bình thường (ví dụ để import thẳng trong
  // unit test khác) nhưng khiến exportedHandlers thấy ZERO handler — it.each
  // bỏ qua sớm, route không guard lọt qua hoàn toàn không tín hiệu.
  it("nhận ra route né bằng `export { GET }` không guard — khe hở Fix round 2", () => {
    const source = `
      import { NextRequest, NextResponse } from "next/server";
      async function GET(req: NextRequest) {
        return NextResponse.json({ leaked: true }); // không guard gì cả
      }
      export { GET };
    `;
    // Đúng là lỗ hổng: exportedHandlers không thấy gì.
    expect(exportedHandlers(source)).toEqual([]);
    // reExportedMethods phải bắt được GET dù exportedHandlers đã bỏ lỡ.
    expect(reExportedMethods(source)).toEqual(["GET"]);
  });
});

describe("/api/admin/* session guard", () => {
  const files = routeFiles(ADMIN_API);

  it.each(files.length ? files : [["(chưa có route admin nào)", ""]])(
    "%s: mọi handler export được gán từ withAdminSession(...)",
    (name, source) => {
      // Chạy TRƯỚC early-return của exportedHandlers: `export { GET }` khiến
      // exportedHandlers thấy zero handler, nên nếu kiểm tra này nằm sau early
      // return thì không bao giờ chạy tới — đúng khe hở Fix round 2.
      const reExported = reExportedMethods(source);
      expect(
        reExported,
        `${name}: dùng "export { ${reExported.join(", ") || "…"} }" để export handler — không được phép. ` +
          `Viết trực tiếp "export const <METHOD> = withAdminSession(...)" cho từng method.`,
      ).toEqual([]);

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
