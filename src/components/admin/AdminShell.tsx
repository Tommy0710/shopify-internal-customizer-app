"use client";

import { Component, useState, type ReactNode } from "react";
import { AppProvider, Banner, Frame, Tabs } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

/**
 * Khung admin duy nhất, render dưới đúng route "/" (Ruling R6 — xem
 * next.config.mjs: CSP `frame-ancestors` chỉ khai cho "/", một page.tsx mới ở
 * route khác sẽ phục vụ thiếu header đó và Shopify Admin từ chối iframe không
 * báo lỗi). Chuyển tab là state React trong component này, không phải điều
 * hướng route.
 *
 * Không gọi `adminFetch`/`window.shopify.idToken()` ở đây lúc mount — token
 * chỉ được lấy khi một tab con thực sự cần fetch dữ liệu (Task 2 trở đi).
 */

interface AdminErrorBoundaryState {
  error: Error | null;
}

/**
 * Một tab lỗi (throw lúc render, hoặc exception nghiệp vụ) không được kéo sập
 * toàn bộ shell — người vận hành vẫn phải bấm được sang tab còn lại. Bọc
 * riêng nội dung tab, không bọc `AppProvider`/`Tabs` (chrome luôn phải sống).
 */
export class AdminErrorBoundary extends Component<{ children: ReactNode }, AdminErrorBoundaryState> {
  state: AdminErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AdminErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    // eslint-disable-next-line no-console
    console.error("AdminShell: lỗi khi render tab", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Banner tone="critical" title="Không hiển thị được tab này">
          <p>{this.state.error.message || "Lỗi không xác định."}</p>
        </Banner>
      );
    }
    return this.props.children;
  }
}

const TABS = [
  { id: "attributes", content: "Attributes", panelID: "attributes-panel" },
  { id: "products", content: "Products", panelID: "products-panel" },
] as const;

function AttributesPlaceholder(): ReactNode {
  return <p>Attributes — sẽ có ở Task 3.</p>;
}

function ProductsPlaceholder(): ReactNode {
  return <p>Products — sẽ có ở Task 4.</p>;
}

export function AdminShell(): ReactNode {
  const [selected, setSelected] = useState(0);

  return (
    <AppProvider i18n={enTranslations}>
      <Frame>
        <Tabs tabs={[...TABS]} selected={selected} onSelect={setSelected}>
          <AdminErrorBoundary>{selected === 0 ? <AttributesPlaceholder /> : <ProductsPlaceholder />}</AdminErrorBoundary>
        </Tabs>
      </Frame>
    </AppProvider>
  );
}
