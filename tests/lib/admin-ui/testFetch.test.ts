/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetchResponses, stubAppBridge } from "@/lib/admin-ui/testFetch";
import { adminFetch } from "@/lib/admin-ui/adminFetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mockAdminFetchResponses", () => {
  it("khớp đúng METHOD + path đã khai và trả body/status đã khai", async () => {
    stubAppBridge();
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "GET /api/admin/leathers": { status: 200, body: { items: [1, 2, 3] } },
      }),
    );

    const result = await adminFetch<{ items: number[] }>("/api/admin/leathers");
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it("route chưa mock ném lỗi ồn ào thay vì trả undefined im lặng", async () => {
    stubAppBridge();
    vi.stubGlobal("fetch", mockAdminFetchResponses({}));

    await expect(adminFetch("/api/admin/unmocked")).rejects.toThrow(/không có mock/);
  });

  it("mock 204 hoạt động với adminFetch (resolve undefined)", async () => {
    stubAppBridge();
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "DELETE /api/admin/leathers/x": { status: 204, body: null },
      }),
    );

    const result = await adminFetch("/api/admin/leathers/x", { method: "DELETE" });
    expect(result).toBeUndefined();
  });
});
