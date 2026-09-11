/**
 * Fetch cho admin UI (P2c) — mọi request tới `/api/admin/*` phải đi qua đây.
 *
 * Lấy session token App Bridge qua global `window.shopify.idToken()` (R2: không
 * dùng `@shopify/app-bridge-react`, `layout.tsx` đã nạp CDN script mở khoá global
 * đó). Token được lấy MỚI cho mỗi lần gọi — không cache — vì token App Bridge
 * ngắn hạn và tự làm mới; cache một bản cũ sẽ khiến request bị 401 giữa chừng.
 *
 * Hai hình lỗi mà server thật sự trả (xem `src/lib/admin/http.ts`):
 *   422 → { errors: [{ field, code, message }] }
 *   khác (404/409/500/…) → { error: "<CODE>", ...extra }
 * `AdminApiError` chuẩn hoá cả hai hình đó, cộng thêm hai trường hợp không phải
 * lỗi server (thiếu App Bridge, lỗi mạng) dùng `status: 0` với `code` riêng để
 * UI phân biệt được — không lẫn với một 4xx/5xx thật.
 */

export interface AdminFieldError {
  field: string;
  code: string;
  message: string;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly fieldErrors: AdminFieldError[] | null,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

declare global {
  interface Window {
    shopify?: {
      idToken: () => Promise<string>;
    };
  }
}

async function getIdToken(): Promise<string> {
  const bridge = typeof window !== "undefined" ? window.shopify : undefined;
  if (!bridge) {
    throw new AdminApiError(
      0,
      "APP_BRIDGE_UNAVAILABLE",
      null,
      "Không tìm thấy App Bridge (window.shopify) — hãy mở app này từ trong Shopify Admin.",
    );
  }
  return bridge.idToken();
}

async function parseErrorBody(res: Response): Promise<{ code: string | null; fieldErrors: AdminFieldError[] | null }> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { code: null, fieldErrors: null };
  }
  if (!body || typeof body !== "object") return { code: null, fieldErrors: null };
  const record = body as Record<string, unknown>;
  if (res.status === 422 && Array.isArray(record.errors)) {
    return { code: null, fieldErrors: record.errors as AdminFieldError[] };
  }
  const code = typeof record.error === "string" ? record.error : null;
  return { code, fieldErrors: null };
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getIdToken();

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AdminApiError(0, "NETWORK_ERROR", null, `Lỗi mạng khi gọi ${path}: ${detail}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  if (!res.ok) {
    const { code, fieldErrors } = await parseErrorBody(res);
    throw new AdminApiError(res.status, code, fieldErrors, code ?? `HTTP ${res.status}`);
  }

  return (await res.json()) as T;
}
