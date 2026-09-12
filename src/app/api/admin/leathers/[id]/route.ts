import { withAdminSession } from "@/lib/auth/withAdminSession";
import { adminApi } from "@/lib/admin/adminApi";
import { attributeHandlers } from "@/lib/admin/attributes";

export const dynamic = "force-dynamic";

const handlers = attributeHandlers("leathers");

export const PATCH = withAdminSession(adminApi(handlers.update));
export const DELETE = withAdminSession(adminApi(handlers.archive));
