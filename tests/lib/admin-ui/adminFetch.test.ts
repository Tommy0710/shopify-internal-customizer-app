/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError, adminFetch } from "@/lib/admin-ui/adminFetch";

declare global {
  // eslint-disable-next-line no-var
  var shopify: { idToken: () => Promise<string> } | undefined;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("shopify", { idToken: async () => "token-abc" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("adminFetch", () => {
  it("GET thành công gắn Authorization: Bearer <token> và trả JSON đã parse", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: 42 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminFetch<{ ok: boolean; value: number }>("/api/admin/leathers");

    expect(result).toEqual({ ok: true, value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/leathers");
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Authorization")).toBe("Bearer token-abc");
  });

  it("gọi idToken() mới cho MỖI lần adminFetch — không cache token", async () => {
    let call = 0;
    const idToken = vi.fn(async () => `token-${++call}`);
    vi.stubGlobal("shopify", { idToken });
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    vi.stubGlobal("fetch", fetchMock);

    await adminFetch("/api/admin/leathers");
    await adminFetch("/api/admin/leathers");

    expect(idToken).toHaveBeenCalledTimes(2);
    const firstHeaders = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
    const secondHeaders = new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers);
    expect(firstHeaders.get("Authorization")).toBe("Bearer token-1");
    expect(secondHeaders.get("Authorization")).toBe("Bearer token-2");
  });

  it("422 với {errors:[...]} ném AdminApiError status:422, code:null, fieldErrors populated", async () => {
    const errors = [{ field: "name", code: "too_small", message: "Bắt buộc" }];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(422, { errors })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(adminFetch("/api/admin/leathers", { method: "POST" })).rejects.toMatchObject({
      status: 422,
      code: null,
      fieldErrors: errors,
    });
    await expect(adminFetch("/api/admin/leathers", { method: "POST" })).rejects.toBeInstanceOf(AdminApiError);
  });

  it("409 với {error:\"STALE_ORDER\"} ném AdminApiError status:409, code:STALE_ORDER, fieldErrors:null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(409, { error: "STALE_ORDER" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(adminFetch("/api/admin/order-lines/x", { method: "PATCH" })).rejects.toMatchObject({
      status: 409,
      code: "STALE_ORDER",
      fieldErrors: null,
    });
  });

  it("204 không body → resolve undefined, không gọi res.json()", async () => {
    const res = new Response(null, { status: 204 });
    const jsonSpy = vi.spyOn(res, "json");
    const fetchMock = vi.fn().mockResolvedValue(res);
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminFetch("/api/admin/leathers/x", { method: "DELETE" });

    expect(result).toBeUndefined();
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("fetch reject (lỗi mạng) → AdminApiError status:0, message nhận diện được là lỗi mạng, khác 4xx/5xx", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await adminFetch("/api/admin/leathers");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AdminApiError);
    const err = caught as AdminApiError;
    expect(err.status).toBe(0);
    expect(err.code).not.toBeNull();
    expect(err.message.toLowerCase()).toMatch(/network|mạng/);
  });

  it("window.shopify vắng mặt → ném lỗi riêng biệt TRƯỚC khi gọi fetch, thông điệp gợi ý mở trong Shopify Admin", async () => {
    vi.stubGlobal("shopify", undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await adminFetch("/api/admin/leathers");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AdminApiError);
    const err = caught as AdminApiError;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(err.message).toMatch(/Shopify Admin/i);
  });

  it("body lỗi không phải JSON (204 khác, response hỏng) → vẫn dựng AdminApiError với code:null, fieldErrors:null, không ném lỗi thứ hai không liên quan", async () => {
    const res = new Response("<html>not json</html>", { status: 500 });
    const fetchMock = vi.fn().mockResolvedValue(res);
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await adminFetch("/api/admin/leathers");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AdminApiError);
    const err = caught as AdminApiError;
    expect(err.status).toBe(500);
    expect(err.code).toBeNull();
    expect(err.fieldErrors).toBeNull();
  });
});
