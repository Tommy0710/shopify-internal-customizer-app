/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { mockAdminFetchResponses, stubAppBridge } from "@/lib/admin-ui/testFetch";
import { ReadinessBanner } from "@/components/admin/products/ReadinessBanner";
import { renderWithPolaris } from "../../../helpers/renderWithPolaris";
import { makeProblem, makeProductSummary, makeReadiness } from "../../../helpers/productFixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReadinessBanner", () => {
  it("ready:true hiển thị trạng thái thành công", () => {
    stubAppBridge();
    renderWithPolaris(
      <ReadinessBanner productId="p1" isEnabled={false} readiness={makeReadiness([])} onToggleEnabled={vi.fn()} />,
    );

    expect(screen.getByText("Sẵn sàng bật lên storefront")).toBeInTheDocument();
  });

  it("ready:false liệt kê message của MỌI problem, không chỉ code", () => {
    stubAppBridge();
    const problems = [
      makeProblem({ code: "NO_HOST", message: "Product chưa gắn trang Shopify nào" }),
      makeProblem({ code: "NO_ACTIVE_STYLE", message: "Chưa có style nào đang bật" }),
    ];
    renderWithPolaris(
      <ReadinessBanner productId="p1" isEnabled={false} readiness={makeReadiness(problems)} onToggleEnabled={vi.fn()} />,
    );

    expect(screen.getByText("Product chưa gắn trang Shopify nào")).toBeInTheDocument();
    expect(screen.getByText("Chưa có style nào đang bật")).toBeInTheDocument();
    expect(screen.queryByText("NO_HOST")).not.toBeInTheDocument();
  });

  it("bật toggle gọi PATCH {isEnabled:true}, thành công gọi onToggleEnabled với DTO mới", async () => {
    stubAppBridge();
    const updated = makeProductSummary({ id: "p1", isEnabled: true });
    const fetchMock = mockAdminFetchResponses({ "PATCH /api/admin/products/p1": { status: 200, body: updated } });
    vi.stubGlobal("fetch", fetchMock);
    const onToggleEnabled = vi.fn();

    renderWithPolaris(
      <ReadinessBanner productId="p1" isEnabled={false} readiness={makeReadiness([])} onToggleEnabled={onToggleEnabled} />,
    );

    fireEvent.click(screen.getByLabelText("Bật trên storefront (isEnabled)"));

    await waitFor(() => expect(onToggleEnabled).toHaveBeenCalledWith(updated));
    const [, init] = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === "/api/admin/products/p1")!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ isEnabled: true });
  });

  it("409 NOT_READY hiện lại đúng danh sách problem MỚI NHẤT từ response lỗi, không phải thông báo lỗi chung chung", async () => {
    stubAppBridge();
    const freshProblems = [{ code: "MISSING_PRICE", message: "Ô giá leather abc chưa nhập giá", path: ["styles", "s1", "leathers", "abc"] }];
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "PATCH /api/admin/products/p1": { status: 409, body: { error: "NOT_READY", problems: freshProblems } },
      }),
    );

    renderWithPolaris(
      <ReadinessBanner
        productId="p1"
        isEnabled={false}
        readiness={makeReadiness([makeProblem({ code: "NO_HOST", message: "vấn đề cũ đã hết hạn" })])}
        onToggleEnabled={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Bật trên storefront (isEnabled)"));

    await waitFor(() => expect(screen.getByText("Ô giá leather abc chưa nhập giá")).toBeInTheDocument());
    expect(screen.queryByText("vấn đề cũ đã hết hạn")).not.toBeInTheDocument();
    expect(screen.queryByText(/NOT_READY/)).not.toBeInTheDocument();
  });
});
