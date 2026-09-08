"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Every /api/admin/* route now requires an App Bridge session token, so 401 and
 * 403 are live failure modes for the admin screens. Silently rendering zeros
 * for them is indistinguishable from "the production data is gone" — these
 * helpers turn a failed Response into something an operator can act on.
 */
export async function adminFetchErrorMessage(
  res: Response,
  context: string,
): Promise<string> {
  if (res.status === 401) {
    return `${context}: phiên đăng nhập Shopify không hợp lệ hoặc đã hết hạn (401). Mở app từ bên trong Shopify Admin thay vì mở URL trực tiếp.`;
  }
  if (res.status === 403) {
    return `${context}: shop này không nằm trong WK_ALLOWED_SHOPS (403). Kiểm tra biến môi trường trên Vercel rồi Redeploy.`;
  }

  let detail = "";
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") detail = ` — ${body.error}`;
  } catch {
    // Body was not JSON; the status code alone is enough to report.
  }
  return `${context}: HTTP ${res.status}${detail}.`;
}

export function adminNetworkErrorMessage(error: unknown, context: string): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${context}: không kết nối được tới API admin — ${detail}.`;
}

export function AdminErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 p-3 bg-red-50 text-red-800 text-xs rounded-lg border border-red-300 font-medium"
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
