/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AdminErrorBanner } from "@/components/AdminErrorBanner";
import { AdminApiError } from "@/lib/admin-ui/adminFetch";

afterEach(() => {
  cleanup();
});

describe("AdminErrorBanner", () => {
  it("error:null → không render gì", () => {
    const { container } = render(<AdminErrorBanner error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("error là chuỗi → hiển thị nguyên văn", () => {
    render(<AdminErrorBanner error="Không kết nối được tới API" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Không kết nối được tới API");
  });

  it("AdminApiError có fieldErrors → render một dòng mỗi field, không phải message đơn", () => {
    const error = new AdminApiError(
      422,
      null,
      [
        { field: "name", code: "too_small", message: "Bắt buộc" },
        { field: "price", code: "invalid", message: "Giá phải có dạng 80 hoặc 80.50" },
      ],
      "unused",
    );
    render(<AdminErrorBanner error={error} />);

    expect(screen.getByText(/name: Bắt buộc/)).toBeInTheDocument();
    expect(screen.getByText(/price: Giá phải có dạng 80 hoặc 80\.50/)).toBeInTheDocument();
  });

  it("AdminApiError 401 → thông điệp thân thiện, gợi ý mở trong Shopify Admin", () => {
    const error = new AdminApiError(401, null, null, "unused");
    render(<AdminErrorBanner error={error} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Shopify Admin/i);
  });

  it("AdminApiError 403 → thông điệp thân thiện, gợi ý WK_ALLOWED_SHOPS", () => {
    const error = new AdminApiError(403, "FORBIDDEN", null, "unused");
    render(<AdminErrorBanner error={error} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/WK_ALLOWED_SHOPS/);
  });

  it("AdminApiError không fieldErrors, không 401/403 → hiển thị error.message", () => {
    const error = new AdminApiError(409, "STALE_ORDER", null, "STALE_ORDER");
    render(<AdminErrorBanner error={error} />);
    expect(screen.getByRole("alert")).toHaveTextContent("STALE_ORDER");
  });
});
