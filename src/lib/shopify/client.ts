import "@shopify/shopify-api/adapters/node";
import { LogSeverity, shopifyApi } from "@shopify/shopify-api";
import { SHOPIFY_API_VERSION, adminGraphqlUrl } from "./apiVersion";

type ShopifyApi = ReturnType<typeof shopifyApi>;

/**
 * Đọc một biến bắt buộc; rỗng hoặc chỉ khoảng trắng là LỖI, không bao giờ rơi
 * về giá trị mặc định. Bản cũ rơi về một chuỗi secret cố định viết sẵn trong
 * mã nguồn, và final review P1b xác minh `decodeSessionToken` chấp nhận token
 * tự ký bằng chuỗi đó — cùng loại lỗi với khoá HMAC rỗng ở P0. Cùng khuôn với
 * `readRequiredEnv` trong `src/lib/storage/index.ts`.
 */
function requiredShopifyEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Shopify client: thiếu biến môi trường ${name} (rỗng hoặc chỉ có khoảng trắng)`);
  }
  return value;
}

let cached: ShopifyApi | undefined;

/**
 * Dựng client LƯỜI, lần gọi đầu tiên. Không dựng lúc import: `next build` nạp
 * route module để thu thập cấu hình, và ném lúc import sẽ làm vỡ build trên
 * máy không có env — trong khi thiếu env lúc CHẠY thì phải ném, ồn ào.
 */
export function getShopify(): ShopifyApi {
  if (cached) return cached;
  cached = shopifyApi({
    apiKey: requiredShopifyEnv("SHOPIFY_API_KEY"),
    apiSecretKey: requiredShopifyEnv("SHOPIFY_API_SECRET"),
    // Scope không phải bí mật; mặc định an toàn khi thiếu.
    scopes: (process.env.SCOPES || "read_products,write_products,read_orders,write_orders").split(","),
    hostName: requiredShopifyEnv("SHOPIFY_APP_URL").replace(/^https?:\/\//, ""),
    apiVersion: SHOPIFY_API_VERSION,
    isEmbeddedApp: true,
    logger: {
      level: process.env.NODE_ENV === "development" ? LogSeverity.Info : LogSeverity.Error,
    },
  });
  return cached;
}

/** Gọi Admin GraphQL. Ném lỗi khi HTTP không 2xx; caller tự xử lý `errors[]` trong body. */
export async function executeShopifyGraphQL(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
) {
  const response = await fetch(adminGraphqlUrl(shop), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Shopify GraphQL Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
