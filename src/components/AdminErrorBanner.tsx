"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import type { AdminApiError } from "@/lib/admin-ui/adminFetch";

/**
 * Every /api/admin/* route now requires an App Bridge session token, so 401 and
 * 403 are live failure modes for the admin screens. Silently rendering zeros
 * for them is indistinguishable from "the production data is gone" — these
 * helpers turn a failed Response into something an operator can act on.
 *
 * These two operate on a raw `Response` — legacy call sites (pre-`adminFetch`)
 * that hand-rolled their own fetch. Kept as-is (P2c Task 2 brief: "extend, not
 * replace"). `AdminErrorBanner` below now ALSO special-cases 401/403 for the
 * `AdminApiError` shape adminFetch actually throws, so the same friendly text
 * shows up regardless of which path a screen took to get an error.
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

/**
 * Cùng thông điệp 401/403 thân thiện như `adminFetchErrorMessage`, nhưng đọc
 * từ `AdminApiError.status` (không có `Response` gốc để đọc lại — `adminFetch`
 * đã tiêu thụ nó).
 */
function friendlyStatusMessage(error: AdminApiError): string | null {
  if (error.status === 401) {
    return "Phiên đăng nhập Shopify không hợp lệ hoặc đã hết hạn (401). Mở app này từ bên trong Shopify Admin thay vì mở URL trực tiếp.";
  }
  if (error.status === 403) {
    return "Shop này không nằm trong WK_ALLOWED_SHOPS (403). Kiểm tra biến môi trường trên Vercel rồi Redeploy.";
  }
  return null;
}

function messageFor(error: AdminApiError | string): string {
  if (typeof error === "string") return error;
  return friendlyStatusMessage(error) ?? error.message;
}

export interface AdminErrorBannerProps {
  error: AdminApiError | string | null;
}

/**
 * `error.fieldErrors` (422 — `AdminApiError` của `adminFetch`) render thành
 * một danh sách, mỗi dòng một field — khác `message` đơn (mọi lỗi khác:
 * 401/403/404/409/500, hoặc một chuỗi tự do do caller tự dựng).
 */
export function AdminErrorBanner({ error }: AdminErrorBannerProps) {
  if (!error) return null;

  const fieldErrors = typeof error !== "string" ? error.fieldErrors : null;

  return (
    <div
      role="alert"
      className="flex items-start gap-2 p-3 bg-red-50 text-red-800 text-xs rounded-lg border border-red-300 font-medium"
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      {fieldErrors && fieldErrors.length > 0 ? (
        <ul className="list-disc list-inside">
          {fieldErrors.map((fieldError, index) => (
            <li key={`${fieldError.field}-${index}`}>
              {fieldError.field ? `${fieldError.field}: ` : ""}
              {fieldError.message}
            </li>
          ))}
        </ul>
      ) : (
        <span>{messageFor(error)}</span>
      )}
    </div>
  );
}
