/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { mockAdminFetchResponses, stubAppBridge } from "@/lib/admin-ui/testFetch";
import { useAdminQuery } from "@/lib/admin-ui/useAdminQuery";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAdminQuery", () => {
  it("loading → data khi request thành công", async () => {
    stubAppBridge();
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "GET /api/admin/leathers": { status: 200, body: { items: [1, 2, 3] } },
      }),
    );

    const { result } = renderHook(() => useAdminQuery<{ items: number[] }>("/api/admin/leathers"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual({ items: [1, 2, 3] });
    expect(result.current.error).toBeNull();
  });

  it("loading → error khi request thất bại, data vẫn undefined", async () => {
    stubAppBridge();
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "GET /api/admin/leathers": { status: 409, body: { error: "STALE_ORDER" } },
      }),
    );

    const { result } = renderHook(() => useAdminQuery("/api/admin/leathers"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toMatchObject({ status: 409, code: "STALE_ORDER" });
    expect(result.current.data).toBeUndefined();
  });

  it("refetch() gọi lại request", async () => {
    stubAppBridge();
    const fetchMock = mockAdminFetchResponses({
      "GET /api/admin/leathers": { status: 200, body: { n: 1 } },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAdminQuery<{ n: number }>("/api/admin/leathers"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("enabled:false không bao giờ fetch", async () => {
    stubAppBridge();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAdminQuery("/api/admin/leathers", { enabled: false }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("unmount trong lúc đang fetch không setState trên component đã unmount (không console.error)", async () => {
    stubAppBridge();
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "GET /api/admin/leathers": { status: 200, body: { ok: true } },
      }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = renderHook(() => useAdminQuery("/api/admin/leathers"));
    unmount();

    // Cho mọi microtask trong chuỗi adminFetch (fetch → res.json → setState) chạy hết.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
