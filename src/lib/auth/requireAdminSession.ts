import { NextResponse } from "next/server";
import {
  type AdminSession,
  SessionTokenError,
  verifySessionToken,
} from "./sessionToken";

export type AdminGuardResult =
  | { session: AdminSession }
  | { response: NextResponse };

/**
 * Shops allowed to reach the embedded admin. Empty means deny everything —
 * a missing env var must never widen access.
 */
export function getAllowedShops(): string[] {
  return (process.env.WK_ALLOWED_SHOPS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token === "" ? null : token;
}

export async function requireAdminSession(req: Request): Promise<AdminGuardResult> {
  try {
    const session = await verifySessionToken(bearerToken(req), {
      apiKey: process.env.SHOPIFY_API_KEY ?? "",
      apiSecret: process.env.SHOPIFY_API_SECRET ?? "",
      allowedShops: getAllowedShops(),
    });
    return { session };
  } catch (error) {
    const code =
      error instanceof SessionTokenError ? error.code : "INVALID_TOKEN";
    return {
      response: NextResponse.json(
        { error: code },
        { status: code === "SHOP_NOT_ALLOWED" ? 403 : 401 },
      ),
    };
  }
}
