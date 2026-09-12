/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { mockAdminFetchResponses, stubAppBridge } from "@/lib/admin-ui/testFetch";
import { useAdminMutation } from "@/lib/admin-ui/useAdminMutation";
import { AdminApiError } from "@/lib/admin-ui/adminFetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAdminMutation", () => {
  it("mutate() resolve với body đã parse khi thành công", async () => {
    stubAppBridge();
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "POST /api/admin/leathers": { status: 201, body: { id: "l1", name: "Da bò" } },
      }),
    );

    const { result } = renderHook(() => useAdminMutation<{ name: string }, { id: string; name: string }>("POST"));

    let resolved: unknown;
    await act(async () => {
      resolved = await result.current.mutate("/api/admin/leathers", { name: "Da bò" });
    });

    expect(resolved).toEqual({ id: "l1", name: "Da bò" });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("mutate() reject với AdminApiError khi lỗi, đồng thời set error state — caller có thể dùng cả hai kiểu", async () => {
    stubAppBridge();
    const errors = [{ field: "name", code: "too_small", message: "Bắt buộc" }];
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "POST /api/admin/leathers": { status: 422, body: { errors } },
      }),
    );

    const { result } = renderHook(() => useAdminMutation("POST"));

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutate("/api/admin/leathers", { name: "" });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(AdminApiError);
    expect(result.current.error).toMatchObject({ status: 422, fieldErrors: errors });
    expect(result.current.loading).toBe(false);
  });

  it("loading là true trong lúc mutate() đang chạy, false sau khi xong", async () => {
    stubAppBridge();
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "PATCH /api/admin/leathers/x": { status: 200, body: { ok: true } },
      }),
    );

    const { result } = renderHook(() => useAdminMutation("PATCH"));

    let mutatePromise!: Promise<unknown>;
    act(() => {
      mutatePromise = result.current.mutate("/api/admin/leathers/x", { isActive: true });
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      await mutatePromise;
    });

    expect(result.current.loading).toBe(false);
  });

  it("unmount giữa chừng khi mutate() đang chạy không gây console.error từ React", async () => {
    stubAppBridge();
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "POST /api/admin/leathers": { status: 200, body: { ok: true } },
      }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result, unmount } = renderHook(() => useAdminMutation("POST"));
    const pending = result.current.mutate("/api/admin/leathers", {}).catch(() => {});
    unmount();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
