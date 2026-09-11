/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mockAdminFetchResponses, stubAppBridge } from "@/lib/admin-ui/testFetch";
import { HostsSection } from "@/components/admin/products/HostsSection";
import { renderWithPolaris } from "../../../helpers/renderWithPolaris";
import { makeHost } from "../../../helpers/productFixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function textFieldIn(testId: string): HTMLElement {
  return within(screen.getByTestId(testId)).getByRole("textbox");
}

function radioIn(testId: string): HTMLElement {
  return within(screen.getByTestId(testId)).getByRole("radio");
}

describe("HostsSection", () => {
  it("hiển thị các host hiện có", () => {
    stubAppBridge();
    const hosts = [makeHost({ id: "h1", shopifyProductId: "111", isPrimary: true })];
    renderWithPolaris(<HostsSection product={{ id: "prod-1", hosts }} />);

    expect(textFieldIn("host-row-h1")).toHaveValue("111");
    expect(radioIn("host-row-h1")).toBeChecked();
  });

  it("thêm host mới rồi lưu — PUT gửi đầy đủ danh sách host đang hiển thị", async () => {
    stubAppBridge();
    const hosts = [makeHost({ id: "h1", shopifyProductId: "111", isPrimary: true })];
    const fetchMock = mockAdminFetchResponses({
      "PUT /api/admin/products/prod-1/hosts": {
        status: 200,
        body: [
          makeHost({ id: "h1", shopifyProductId: "111", isPrimary: true }),
          makeHost({ id: "h2", shopifyProductId: "222", isPrimary: false }),
        ],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(<HostsSection product={{ id: "prod-1", hosts }} />);

    fireEvent.change(screen.getByPlaceholderText("ID sản phẩm Shopify"), { target: { value: "222" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm trang" }));
    await waitFor(() => expect(textFieldIn("host-row-new-1")).toHaveValue("222"));

    fireEvent.click(screen.getByRole("button", { name: "Lưu host" }));

    await waitFor(() => {
      const call = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === "/api/admin/products/prod-1/hosts");
      expect(call).toBeDefined();
    });
    const [, init] = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === "/api/admin/products/prod-1/hosts")!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual([
      { shopifyProductId: "111", isPrimary: true },
      { shopifyProductId: "222", isPrimary: false },
    ]);
  });

  it("isPrimary là radio loại trừ lẫn nhau NGAY Ở CLIENT — chọn hàng khác tự bỏ chọn hàng cũ trước khi gửi", async () => {
    stubAppBridge();
    const hosts = [
      makeHost({ id: "h1", shopifyProductId: "111", isPrimary: true }),
      makeHost({ id: "h2", shopifyProductId: "222", isPrimary: false }),
    ];
    const fetchMock = mockAdminFetchResponses({
      "PUT /api/admin/products/prod-1/hosts": { status: 200, body: hosts },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(<HostsSection product={{ id: "prod-1", hosts }} />);

    expect(radioIn("host-row-h1")).toBeChecked();
    expect(radioIn("host-row-h2")).not.toBeChecked();

    fireEvent.click(radioIn("host-row-h2"));

    expect(radioIn("host-row-h2")).toBeChecked();
    expect(radioIn("host-row-h1")).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Lưu host" }));

    await waitFor(() => {
      const call = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === "/api/admin/products/prod-1/hosts");
      expect(call).toBeDefined();
    });
    const [, init] = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === "/api/admin/products/prod-1/hosts")!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual([
      { shopifyProductId: "111", isPrimary: false },
      { shopifyProductId: "222", isPrimary: true },
    ]);
  });

  it("gỡ một host rồi lưu — PUT không còn host đó (server sẽ xoá hẳn, không phải deactivate)", async () => {
    stubAppBridge();
    const hosts = [
      makeHost({ id: "h1", shopifyProductId: "111", isPrimary: true }),
      makeHost({ id: "h2", shopifyProductId: "222", isPrimary: false }),
    ];
    const fetchMock = mockAdminFetchResponses({
      "PUT /api/admin/products/prod-1/hosts": {
        status: 200,
        body: [makeHost({ id: "h1", shopifyProductId: "111", isPrimary: true })],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(<HostsSection product={{ id: "prod-1", hosts }} />);

    fireEvent.click(within(screen.getByTestId("host-row-h2")).getByRole("button", { name: "Gỡ" }));
    expect(screen.queryByTestId("host-row-h2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Lưu host" }));

    await waitFor(() => {
      const call = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === "/api/admin/products/prod-1/hosts");
      expect(call).toBeDefined();
    });
    const [, init] = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === "/api/admin/products/prod-1/hosts")!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual([{ shopifyProductId: "111", isPrimary: true }]);
  });

  it("409 HOST_TAKEN hiển thị chính xác shopifyProductId bị trùng, không phải lỗi chung chung", async () => {
    stubAppBridge();
    const hosts = [makeHost({ id: "h1", shopifyProductId: "111", isPrimary: true })];
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "PUT /api/admin/products/prod-1/hosts": {
          status: 409,
          body: { error: "HOST_TAKEN", shopifyProductId: "111", productId: "other-prod" },
        },
      }),
    );

    renderWithPolaris(<HostsSection product={{ id: "prod-1", hosts }} />);
    fireEvent.click(screen.getByRole("button", { name: "Lưu host" }));

    await waitFor(() => expect(screen.getByText(/111/)).toBeInTheDocument());
    expect(screen.getByText(/other-prod/)).toBeInTheDocument();
  });
});
