import crypto from "crypto";

/**
 * Có được phép bỏ qua xác thực HMAC không.
 *
 * Trước đây điều này suy ra từ NODE_ENV, nghĩa là mọi môi trường không phải
 * production — kể cả preview deployment công khai — đều chạy không xác thực.
 * Giờ phải bật tường minh, và không bao giờ bật được ở production.
 */
export function hmacBypassEnabled(): boolean {
  const enabled = process.env.WK_SKIP_HMAC === "1";
  if (enabled && process.env.NODE_ENV === "production") {
    throw new Error(
      "WK_SKIP_HMAC=1 while NODE_ENV=production. Refusing to serve requests with HMAC verification disabled.",
    );
  }
  return enabled;
}

/**
 * Verify Shopify App Proxy request signature
 * Shopify calculates HMAC SHA256 over alphabetically sorted query parameters (excluding 'signature').
 */
export function verifyShopifyProxySignature(
  searchParams: URLSearchParams,
  apiSecret: string = process.env.SHOPIFY_API_SECRET || ""
): boolean {
  const signature = searchParams.get("signature");
  if (!signature || !apiSecret) {
    return false;
  }

  const params: [string, string][] = [];
  searchParams.forEach((value, key) => {
    if (key !== "signature") {
      params.push([key, value]);
    }
  });

  // Sort query params alphabetically by key
  params.sort(([a], [b]) => a.localeCompare(b));
  const queryString = params.map(([k, v]) => `${k}=${v}`).join("");

  const calculatedSignature = crypto
    .createHmac("sha256", apiSecret)
    .update(queryString)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "utf-8"),
      Buffer.from(calculatedSignature, "utf-8")
    );
  } catch {
    return false;
  }
}

/**
 * Verify Shopify Webhook HMAC header (X-Shopify-Hmac-Sha256)
 */
export function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string | null,
  apiSecret: string = process.env.SHOPIFY_API_SECRET || ""
): boolean {
  if (!hmacHeader || !apiSecret) return false;

  const generatedHash = crypto
    .createHmac("sha256", apiSecret)
    .update(rawBody, "utf8")
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(hmacHeader, "utf-8"),
      Buffer.from(generatedHash, "utf-8")
    );
  } catch {
    return false;
  }
}
