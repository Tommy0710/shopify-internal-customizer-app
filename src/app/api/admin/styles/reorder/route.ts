import { withAdminSession } from "@/lib/auth/withAdminSession";
import { adminApi } from "@/lib/admin/adminApi";
import { attributeHandlers } from "@/lib/admin/attributes";

export const dynamic = "force-dynamic";

const handlers = attributeHandlers("styles");

export const POST = withAdminSession(adminApi(handlers.reorder));
