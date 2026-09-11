/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { mockAdminFetchResponses, stubAppBridge } from "@/lib/admin-ui/testFetch";
import { ProductsTab } from "@/components/admin/ProductsTab";
import { renderWithPolaris } from "../../../helpers/renderWithPolaris";
import { makeProductSummary, makeProductTree } from "../../../helpers/productFixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("ProductsTab — list", () => {
  it("hiển thị danh sách sản phẩm", async () => {
    stubAppBridge();
    const items = [makeProductSummary({ id: "a", name: "Wallet A" }), makeProductSummary({ id: "b", name: "Wallet B" })];
    vi.stubGlobal("fetch", mockAdminFetchResponses({ "GET /api/admin/products": { status: 200, body: { items } } }));

    renderWithPolaris(<ProductsTab />);

    await waitFor(() => expect(screen.getByText("Wallet A")).toBeInTheDocument());
    expect(screen.getByText("Wallet B")).toBeInTheDocument();
  });

  it("danh sách rỗng hiển thị trạng thái trống", async () => {
    stubAppBridge();
    vi.stubGlobal("fetch", mockAdminFetchResponses({ "GET /api/admin/products": { status: 200, body: { items: [] } } }));

    renderWithPolaris(<ProductsTab />);

    await waitFor(() => expect(screen.getByText("Chưa có sản phẩm nào.")).toBeInTheDocument());
  });

  it("lỗi tải danh sách hiện banner lỗi", async () => {
    stubAppBridge();
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({ "GET /api/admin/products": { status: 500, body: { error: "INTERNAL" } } }),
    );

    renderWithPolaris(<ProductsTab />);

    await waitFor(() => expect(screen.getByText(/INTERNAL/)).toBeInTheDocument());
  });

  it("bấm 'Thêm sản phẩm' mở form chỉ có tên; tạo xong chuyển sang detail của product mới, không điều hướng trang", async () => {
    stubAppBridge();
    const created = makeProductSummary({ id: "new-1", name: "New Wallet" });
    const detailTree = makeProductTree({ id: "new-1", name: "New Wallet" });
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "GET /api/admin/products": { status: 200, body: { items: [] } },
        "POST /api/admin/products": { status: 201, body: created },
        "GET /api/admin/products/new-1": { status: 200, body: detailTree },
      }),
    );

    renderWithPolaris(<ProductsTab />);
    await waitFor(() => expect(screen.getByText("Chưa có sản phẩm nào.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Thêm sản phẩm" }));
    const nameInput = await screen.findByPlaceholderText("Tên sản phẩm");
    fireEvent.change(nameInput, { target: { value: "New Wallet" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));

    // Chuyển thẳng sang detail — list biến mất, không còn form tạo.
    await waitFor(() => expect(screen.getByRole("heading", { name: "New Wallet" })).toBeInTheDocument());
    expect(screen.queryByText("Chưa có sản phẩm nào.")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Tên sản phẩm")).not.toBeInTheDocument();

    // Không phải điều hướng trang thật — vẫn cùng document, URL phản chiếu id.
    expect(window.location.search).toContain("product=new-1");
  });
});

describe("ProductsTab — detail", () => {
  it("render name/isEnabled từ DTO phẳng (không có .product.name)", async () => {
    stubAppBridge();
    const tree = makeProductTree({ id: "p1", name: "Detail Wallet", isEnabled: true });
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "GET /api/admin/products": { status: 200, body: { items: [makeProductSummary({ id: "p1", name: "Detail Wallet" })] } },
        "GET /api/admin/products/p1": { status: 200, body: tree },
        "GET /api/admin/leathers": { status: 200, body: { items: [] } },
      }),
    );

    renderWithPolaris(<ProductsTab />);
    await waitFor(() => expect(screen.getByText("Detail Wallet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Detail Wallet" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Detail Wallet" })).toBeInTheDocument());
    // isEnabled: true phản ánh qua checkbox "Bật trên storefront" của ReadinessBanner.
    expect(screen.getByLabelText("Bật trên storefront (isEnabled)")).toBeChecked();
  });

  it("nút 'Quay lại danh sách' trở về list", async () => {
    stubAppBridge();
    const tree = makeProductTree({ id: "p1", name: "Detail Wallet" });
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "GET /api/admin/products": { status: 200, body: { items: [makeProductSummary({ id: "p1", name: "Detail Wallet" })] } },
        "GET /api/admin/products/p1": { status: 200, body: tree },
        "GET /api/admin/leathers": { status: 200, body: { items: [] } },
      }),
    );

    renderWithPolaris(<ProductsTab />);
    await waitFor(() => expect(screen.getByText("Detail Wallet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Detail Wallet" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Detail Wallet" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "← Quay lại danh sách" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Thêm sản phẩm" })).toBeInTheDocument());
    expect(window.location.search).not.toContain("product=");
  });

  it("ma trận giá (Task 5) render hai section thật; lưới SVG vẫn placeholder (Task 6)", async () => {
    stubAppBridge();
    const tree = makeProductTree({ id: "p1", name: "Detail Wallet" });
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "GET /api/admin/products": { status: 200, body: { items: [] } },
        "GET /api/admin/products/p1": { status: 200, body: tree },
        "GET /api/admin/leathers": { status: 200, body: { items: [] } },
      }),
    );

    window.history.replaceState(null, "", "/?product=p1");
    renderWithPolaris(<ProductsTab />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Detail Wallet" })).toBeInTheDocument());
    expect(screen.getByText("Styles & body pricing")).toBeInTheDocument();
    expect(screen.getByText("Animals & applique pricing")).toBeInTheDocument();
    expect(screen.getByText("Sẽ có ở Task 6.")).toBeInTheDocument();
  });
});
