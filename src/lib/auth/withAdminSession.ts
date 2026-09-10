import type { NextRequest } from "next/server";
import { requireAdminSession } from "./requireAdminSession";
import type { AdminSession } from "./sessionToken";

/**
 * Bọc một handler `/api/admin/*` để việc gọi guard không thể bị bỏ dở.
 *
 * Trước đây mỗi route tự chép `const auth = await requireAdminSession(req);
 * if ("response" in auth) return auth.response;` ở đầu handler — không có gì ở
 * tầng type ép hai dòng đó phải tồn tại đủ. `requireAdminSession` KHÔNG throw,
 * nó trả `{ session } | { response }`; một người chép prologue mà quên dòng
 * `if` thứ hai (hoặc gọi `requireAdminSession(req)` rồi bỏ luôn kết quả) vẫn
 * biên dịch được và request lọt qua không xác thực. `withAdminSession` là cách
 * DUY NHẤT được phép viết route admin: nó tự return `auth.response` ở nhánh
 * lỗi, nên không còn chỗ nào để quên. Bộ quét ở
 * `tests/app/api/admin/route-guard.test.ts` ép mọi handler export phải được
 * gán từ lời gọi `withAdminSession(`.
 */
export function withAdminSession(
  handler: (
    req: NextRequest,
    ctx: { session: AdminSession },
  ) => Promise<Response>,
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest): Promise<Response> => {
    const auth = await requireAdminSession(req);
    if ("response" in auth) return auth.response;
    return handler(req, { session: auth.session });
  };
}
