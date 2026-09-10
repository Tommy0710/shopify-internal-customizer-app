import { createStorageClient, type AssetStorageClient } from "@/lib/storage";

/**
 * Seam DUY NHẤT giữa admin API và Supabase Storage. Test DB thay module này
 * bằng `vi.mock` — Storage là ranh giới ngoài hợp lệ để giả; Postgres thì không.
 */
export function assetStorageClient(): AssetStorageClient {
  return createStorageClient();
}
