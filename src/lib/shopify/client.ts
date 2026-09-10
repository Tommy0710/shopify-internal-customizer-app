import "@shopify/shopify-api/adapters/node";
import { LogSeverity, shopifyApi } from "@shopify/shopify-api";
import { SHOPIFY_API_VERSION, adminGraphqlUrl } from "./apiVersion";

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY || "local_dev_key",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "local_dev_secret",
  scopes: (process.env.SCOPES || "read_products,write_products,read_orders,write_orders").split(","),
  hostName: (process.env.SHOPIFY_APP_URL || "http://localhost:3000").replace(/^https?:\/\//, ""),
  apiVersion: SHOPIFY_API_VERSION,
  isEmbeddedApp: true,
  logger: {
    level: process.env.NODE_ENV === "development" ? LogSeverity.Info : LogSeverity.Error,
  },
});

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
