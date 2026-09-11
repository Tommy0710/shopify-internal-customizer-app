import { withAdminSession } from "@/lib/auth/withAdminSession";
import { adminApi } from "@/lib/admin/adminApi";
import { productHandlers } from "@/lib/admin/products";

export const dynamic = "force-dynamic";

export const GET = withAdminSession(adminApi(productHandlers.list));
export const POST = withAdminSession(adminApi(productHandlers.create));
