import { vi } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";

export const ADMIN_API_KEY = "21102b2e2138173c5ab87e5ad38ef1e4";
export const ADMIN_API_SECRET = "test_secret_that_is_long_enough_for_hs256";
export const ADMIN_SHOP = "wildandking-demo.myshopify.com";

/** Env tối thiểu để `withAdminSession` chấp nhận token do `mintAdminToken` ký. */
export function useAdminEnv(allowedShops: string[] = [ADMIN_SHOP]): void {
  vi.stubEnv("SHOPIFY_API_KEY", ADMIN_API_KEY);
  vi.stubEnv("SHOPIFY_API_SECRET", ADMIN_API_SECRET);
  vi.stubEnv("WK_ALLOWED_SHOPS", allowedShops.join(","));
}

export async function mintAdminToken(shop: string = ADMIN_SHOP, userId = "42"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: ADMIN_API_KEY, sub: userId, nbf: now - 10 })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(now + 60)
    .sign(new TextEncoder().encode(ADMIN_API_SECRET));
}

export interface AdminRequestInit {
  method?: string;
  /** Object → JSON. FormData → multipart. */
  body?: unknown;
  shop?: string;
  /** `null` = không gửi Authorization. */
  token?: string | null;
}

export async function adminRequest(url: string, init: AdminRequestInit = {}): Promise<NextRequest> {
  const headers = new Headers();
  const token = init.token === undefined ? await mintAdminToken(init.shop) : init.token;
  if (token) headers.set("authorization", `Bearer ${token}`);
  let body: BodyInit | undefined;
  if (init.body instanceof FormData) {
    body = init.body;
  } else if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  return new NextRequest(new URL(url, "https://app.test"), { method: init.method ?? "GET", headers, body });
}
