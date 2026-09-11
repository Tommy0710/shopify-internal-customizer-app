/**
 * Helper test dùng chung cho mọi test gọi `adminFetch` (task này và Task 2-6:
 * `useAdminQuery`/`useAdminMutation`, các tab component). Thay `global.fetch`
 * bằng một `vi.fn()` biết trả đúng response đã khai theo `"<METHOD> <path>"`.
 *
 * Cố tình ném lỗi ồn ào khi gặp method+path chưa khai — một test gọi route
 * chưa mock mà âm thầm nhận `undefined` là false pass, không phải test xanh
 * thật.
 */
import { vi } from "vitest";

export interface MockAdminFetchResponse {
  status: number;
  body: unknown;
}

export function mockAdminFetchResponses(responses: Record<string, MockAdminFetchResponse>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : String(input);
    const key = `${method} ${path}`;
    const mocked = responses[key];
    if (!mocked) {
      throw new Error(
        `mockAdminFetchResponses: không có mock cho "${key}". Các key đã khai: ${Object.keys(responses).join(", ") || "(không có)"}`,
      );
    }
    return new Response(mocked.status === 204 ? null : JSON.stringify(mocked.body), {
      status: mocked.status,
      headers: mocked.status === 204 ? undefined : { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

/** Stub `window.shopify.idToken()` cho test — mặc định trả token cố định. */
export function stubAppBridge(token = "test-token"): void {
  vi.stubGlobal("shopify", { idToken: vi.fn(async () => token) });
}
