import { withAdminSession } from "@/lib/auth/withAdminSession";
import { adminApi } from "@/lib/admin/adminApi";
import { productHandlers } from "@/lib/admin/products";

export const dynamic = "force-dynamic";

export const PUT = withAdminSession(adminApi<{ id: string; animalId: string }>(productHandlers.putAnimalLeathers));
