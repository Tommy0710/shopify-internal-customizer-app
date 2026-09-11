/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { AdminErrorBoundary, AdminShell } from "@/components/admin/AdminShell";

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

describe("AdminShell", () => {
  it("hiển thị cả hai nhãn tab", () => {
    render(<AdminShell />);
    expect(tablist().getByRole("tab", { name: "Attributes" })).toBeInTheDocument();
    expect(tablist().getByRole("tab", { name: "Products" })).toBeInTheDocument();
  });

  it("click tab Products chuyển panel hiển thị", () => {
    render(<AdminShell />);

    expect(tablist().getByRole("tab", { name: "Attributes" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(tablist().getByRole("tab", { name: "Products" }));

    expect(tablist().getByRole("tab", { name: "Products" })).toHaveAttribute("aria-selected", "true");
    expect(tablist().getByRole("tab", { name: "Attributes" })).toHaveAttribute("aria-selected", "false");
  });

  it("không ném lỗi khi window.shopify undefined lúc mount, và không tự gọi idToken()", () => {
    vi.stubGlobal("shopify", undefined);
    expect(() => render(<AdminShell />)).not.toThrow();
  });

  it("không gọi window.shopify.idToken() khi chỉ mount, không fetch nào xảy ra", () => {
    const idToken = vi.fn(async () => "token");
    vi.stubGlobal("shopify", { idToken });
    render(<AdminShell />);
    expect(idToken).not.toHaveBeenCalled();
  });
});

describe("AdminErrorBoundary", () => {
  it("bắt lỗi render của con, hiển thị fallback thay vì crash cả cây", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <AppProvider i18n={enTranslations}>
        <AdminErrorBoundary>
          <Bomb />
        </AdminErrorBoundary>
      </AppProvider>,
    );

    expect(screen.getByText(/lỗi giả lập trong tab/)).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("không có lỗi → render con bình thường", () => {
    render(
      <AppProvider i18n={enTranslations}>
        <AdminErrorBoundary>
          <p>nội dung bình thường</p>
        </AdminErrorBoundary>
      </AppProvider>,
    );
    expect(screen.getByText("nội dung bình thường")).toBeInTheDocument();
  });
});
