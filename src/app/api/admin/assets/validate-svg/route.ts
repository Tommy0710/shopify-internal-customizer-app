import { withAdminSession } from "@/lib/auth/withAdminSession";
import { adminApi } from "@/lib/admin/adminApi";
import { handleValidateSvg } from "@/lib/admin/assets";

export const dynamic = "force-dynamic";

export const POST = withAdminSession(adminApi(handleValidateSvg));
