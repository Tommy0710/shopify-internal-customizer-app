/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminErrorBoundary, AdminShell } from "@/components/admin/AdminShell";
import { mockAdminFetchResponses, stubAppBridge } from "@/lib/admin-ui/testFetch";
import { renderWithPolaris } from "../../helpers/renderWithPolaris";

function Bomb(): never {
  throw new Error("lỗi giả lập trong tab");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Polaris Tabs render một `Polaris-Tabs__TabsMeasurer` ẩn (visibility:hidden
// qua CSS, không có `aria-controls`, không nằm trong `role="tablist"`) song
// song với tab list thật để đo bề rộng responsive. jsdom không nạp CSS nên
// `visibility:hidden` không ẩn nó khỏi accessibility tree — scope query vào
// đúng `tablist` thật để tránh khớp trùng "measurer".
function tablist() {
  return within(screen.getByRole("tablist"));
}

/**
 * Task 3 thay `AttributesPlaceholder` bằng `AttributeList` thật (sub-nav bốn
 * nhóm + danh sách) — tab Attributes giờ tự fetch `GET /api/admin/leathers`
 * (nhóm mặc định) ngay khi mount, nên hầu hết test dưới đây phải mock
 * `window.shopify`/`fetch` và `waitFor` cho vòng fetch đó ổn định TRƯỚC khi
 * test kết thúc — nếu không, promise của `useAdminQuery` resolve sau khi test
 * đã return, gây cảnh báo `act()` rơi vào test kế tiếp.
 */
function mockEmptyLeathersList(): ReturnType<typeof mockAdminFetchResponses> {
  return mockAdminFetchResponses({ "GET /api/admin/leathers": { status: 200, body: { items: [] } } });
}

describe("AdminShell", () => {
  it("hiển thị cả hai nhãn tab", async () => {
    stubAppBridge();
    vi.stubGlobal("fetch", mockEmptyLeathersList());

    render(<AdminShell />);
    expect(tablist().getByRole("tab", { name: "Attributes" })).toBeInTheDocument();
    expect(tablist().getByRole("tab", { name: "Products" })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Chưa có mục nào.")).toBeInTheDocument());
  });

  it("click tab Products chuyển panel hiển thị", async () => {
    stubAppBridge();
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "GET /api/admin/leathers": { status: 200, body: { items: [] } },
        "GET /api/admin/products": { status: 200, body: { items: [] } },
      }),
    );

    render(<AdminShell />);

    expect(tablist().getByRole("tab", { name: "Attributes" })).toHaveAttribute("aria-selected", "true");
    // Không chỉ kiểm aria-selected — kiểm cả NỘI DUNG panel thật sự đổi:
    // sub-nav "Leathers" của AttributeList (Task 3) chỉ có mặt khi panel
    // Attributes đang hiển thị.
    expect(screen.getByRole("button", { name: "Leathers" })).toBeInTheDocument();
    expect(screen.queryByText("Chưa có sản phẩm nào.")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Chưa có mục nào.")).toBeInTheDocument());

    fireEvent.click(tablist().getByRole("tab", { name: "Products" }));

    expect(tablist().getByRole("tab", { name: "Products" })).toHaveAttribute("aria-selected", "true");
    expect(tablist().getByRole("tab", { name: "Attributes" })).toHaveAttribute("aria-selected", "false");
    // Task 4 thay ProductsPlaceholder bằng ProductsTab thật — panel giờ tự
    // fetch GET /api/admin/products (mock ở trên) thay vì hiện văn bản tĩnh.
    await waitFor(() => expect(screen.getByText("Chưa có sản phẩm nào.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Leathers" })).not.toBeInTheDocument();
  });

  it("không ném lỗi khi window.shopify undefined lúc mount, tab Attributes tự hiện banner lỗi thay vì crash", async () => {
    expect(() => render(<AdminShell />)).not.toThrow();
    await waitFor(() => expect(screen.getByText(/Không tìm thấy App Bridge/)).toBeInTheDocument());
  });

  it("tab Attributes đang chọn mặc định lúc mount → AttributeList gọi idToken() ngay để tải danh sách", async () => {
    const idToken = vi.fn(async () => "token");
    vi.stubGlobal("shopify", { idToken });
    vi.stubGlobal("fetch", mockEmptyLeathersList());

    render(<AdminShell />);

    await waitFor(() => expect(idToken).toHaveBeenCalled());
  });
});

describe("AdminErrorBoundary", () => {
  it("bắt lỗi render của con, hiển thị fallback thay vì crash cả cây", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithPolaris(
      <AdminErrorBoundary>
        <Bomb />
      </AdminErrorBoundary>,
    );

    expect(screen.getByText(/lỗi giả lập trong tab/)).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("không có lỗi → render con bình thường", () => {
    renderWithPolaris(
      <AdminErrorBoundary>
        <p>nội dung bình thường</p>
      </AdminErrorBoundary>,
    );
    expect(screen.getByText("nội dung bình thường")).toBeInTheDocument();
  });
});
