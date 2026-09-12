import { withAdminSession } from "@/lib/auth/withAdminSession";
import { adminApi } from "@/lib/admin/adminApi";
import { attributeHandlers } from "@/lib/admin/attributes";

export const dynamic = "force-dynamic";

const handlers = attributeHandlers("leathers");

export const GET = withAdminSession(adminApi(handlers.list));
export const POST = withAdminSession(adminApi(handlers.create));
