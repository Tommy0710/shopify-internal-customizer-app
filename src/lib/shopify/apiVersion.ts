import { ApiVersion } from "@shopify/shopify-api";

/**
 * NGUỒN SỰ THẬT DUY NHẤT cho Shopify API version.
 *
 * Trước P1b, con số này lệch ở ba nơi (`shopify.app.toml` = 2026-10,
 * client = 2024-10, URL GraphQL hardcode 2024-10). `tests/lib/shopify/
 * apiVersion.test.ts` giữ cho ba nơi đó không lệch lại được.
 *
 * Đang chọn 2026-07 chứ không phải 2026-10 vì tại thời điểm chốt, 2026-10
 * mới là release candidate. Nâng version = đổi đúng dòng này rồi chạy
 * `npm run shopify:deploy` để đăng ký lại webhook theo version mới.
 */
export const SHOPIFY_API_VERSION: ApiVersion = ApiVersion.July26;

/** URL Admin GraphQL của một shop, luôn theo version đã chốt. */
export function adminGraphqlUrl(shop: string): string {
  return `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
}
