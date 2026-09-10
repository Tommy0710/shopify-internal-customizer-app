import type { Shop } from "@prisma/client";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type { AdminRouteParams } from "@/lib/auth/withAdminSession";
import type { AdminSession } from "@/lib/auth/sessionToken";
import { AdminHttpError } from "./http";
import { toAdminResponse } from "./prismaErrors";

export interface AdminApiContext<P extends AdminRouteParams = AdminRouteParams> {
  session: AdminSession;
  params: P;
  shop: Shop;
}

/**
 * Lớp thứ hai của mọi route admin, luôn nằm BÊN TRONG `withAdminSession`:
 *
 *   export const GET = withAdminSession(adminApi(async (req, { shop, params }) => …));
 *
 * `withAdminSession` đã xác thực token. Lớp này:
 *  1. tra `Shop` theo `session.shopDomain` (không phân biệt hoa thường) — shop
 *     chưa cài hoặc đã gỡ → 409 SHOP_NOT_INSTALLED;
 *  2. bắt `AdminHttpError` (404/409/422 do code nghiệp vụ ném) và lỗi Prisma đã
 *     biết, trả đúng hình lỗi của `./http`;
 *  3. để mọi lỗi khác nổi lên — Next trả 500 và lỗi vào log.
 */
export function adminApi<P extends AdminRouteParams = AdminRouteParams>(
  handler: (req: NextRequest, ctx: AdminApiContext<P>) => Promise<Response>,
): (req: NextRequest, ctx: { session: AdminSession; params: P }) => Promise<Response> {
  return async (req, { session, params }) => {
    try {
      const shop = await db.shop.findFirst({
        where: { shopDomain: { equals: session.shopDomain, mode: "insensitive" }, installed: true },
      });
      if (!shop) {
        return Response.json({ error: "SHOP_NOT_INSTALLED" }, { status: 409 });
      }
      return await handler(req, { session, params, shop });
    } catch (error) {
      if (error instanceof AdminHttpError) {
        return Response.json(error.body, { status: error.status });
      }
      const mapped = toAdminResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  };
}
