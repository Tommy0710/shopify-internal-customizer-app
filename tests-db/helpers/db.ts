import type { Asset, AssetKind, Shop } from "@prisma/client";
import { db } from "@/lib/db";

// `new URL()` trả IPv6 kèm ngoặc vuông: hostname của `postgresql://…@[::1]:5432` là "[::1]".
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Xoá sạch dữ liệu giữa các test. Tự kiểm lại host dù `test-db.mjs` đã kiểm:
 * một ai đó chạy thẳng `vitest --config vitest.db.config.ts` với `.env` trỏ
 * Supabase thì hàm này là thứ duy nhất đứng giữa họ và việc mất dữ liệu.
 */
export async function resetDb(): Promise<void> {
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://invalid").hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`resetDb: TỪ CHỐI truncate DB ở host "${host}"`);
  }
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export const TEST_SHOP = "wildandking-demo.myshopify.com";

export function seedShop(shopDomain: string = TEST_SHOP): Promise<Shop> {
  return db.shop.create({ data: { shopDomain, accessToken: "test-access-token" } });
}

let assetCounter = 0;

/** Asset giả hợp lệ — checksum khác nhau mỗi lần để không đụng @@unique. */
export function seedAsset(shopId: string, kind: AssetKind, overrides: Partial<Asset> = {}): Promise<Asset> {
  assetCounter += 1;
  const checksum = assetCounter.toString(16).padStart(64, "0");
  const extension = kind === "SVG_MOCKUP" || kind === "DESIGN_SVG" ? "svg" : "webp";
  return db.asset.create({
    data: {
      shopId,
      kind,
      storagePath: `${kind.toLowerCase()}/${checksum}.${extension}`,
      publicUrl: `https://storage.test/wk-assets/${kind.toLowerCase()}/${checksum}.${extension}`,
      mimeType: extension === "svg" ? "image/svg+xml" : "image/webp",
      byteSize: 1024,
      checksumSha256: checksum,
      originalFilename: `seed.${extension}`,
      svgValidatedAt: kind === "SVG_MOCKUP" ? new Date() : null,
      ...overrides,
    },
  });
}
