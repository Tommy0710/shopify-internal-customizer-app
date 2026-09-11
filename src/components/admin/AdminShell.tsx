"use client";

import { Component, useState, type ReactNode } from "react";
import { AppProvider, Banner, BlockStack, Button, Frame, InlineStack, Tabs } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { AttributeList } from "./AttributeList";
import type { AttributeKind } from "@/lib/admin/attributes";

/**
 * Khung admin duy nhất, render dưới đúng route "/" (Ruling R6 — xem
 * next.config.mjs: CSP `frame-ancestors` chỉ khai cho "/", một page.tsx mới ở
 * route khác sẽ phục vụ thiếu header đó và Shopify Admin từ chối iframe không
 * báo lỗi). Chuyển tab là state React trong component này, không phải điều
 * hướng route.
 *
 * `AdminShell` chính nó không gọi `adminFetch`/`window.shopify.idToken()` lúc
 * mount — chỉ tab con mới gọi khi thật sự cần dữ liệu. Kể từ Task 3,
 * `AttributesPanel` (tab mặc định, `selected === 0`) LÀ tab con đó: nó mount
 * `AttributeList`, và `AttributeList` gọi `idToken()` ngay để tải danh sách —
 * đây là hành vi ĐÚNG dự kiến, không phải regression của quy tắc trên.
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

const ATTRIBUTE_KINDS: readonly AttributeKind[] = ["leathers", "stitches", "animals", "styles"] as const;
const ATTRIBUTE_SUBNAV_LABELS: Record<AttributeKind, string> = {
  leathers: "Leathers",
  stitches: "Stitches",
  animals: "Animals",
  styles: "Styles",
};

/**
 * Sub-nav bốn nhóm (spec §12.1: "Leathers · Stitches · Animals · Styles"),
 * CỐ Ý không dùng Polaris `Tabs` ở đây — `Tabs` dựng `role="tablist"`, và
 * `AdminShell.test.tsx` (Task 1) đã chọn đúng MỘT `getByRole("tablist")` cho
 * cặp tab Attributes/Products ngoài cùng; một `Tabs` lồng bên trong sẽ tạo
 * tablist thứ hai và làm chính test đó vỡ vì khớp nhiều phần tử. Một hàng
 * `Button` chọn-một (segmented) tránh hẳn xung đột role mà vẫn chuyển
 * `AttributeList` state, không điều hướng route (Ruling R6).
 */
function AttributesPanel(): ReactNode {
  const [kind, setKind] = useState<AttributeKind>("leathers");

  return (
    <BlockStack gap="400">
      <InlineStack gap="200">
        {ATTRIBUTE_KINDS.map((candidate) => (
          <Button
            key={candidate}
            pressed={candidate === kind}
            variant={candidate === kind ? "primary" : "secondary"}
            onClick={() => setKind(candidate)}
          >
            {ATTRIBUTE_SUBNAV_LABELS[candidate]}
          </Button>
        ))}
      </InlineStack>
      <AttributeList kind={kind} />
    </BlockStack>
  );
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
          <AdminErrorBoundary>{selected === 0 ? <AttributesPanel /> : <ProductsPlaceholder />}</AdminErrorBoundary>
        </Tabs>
      </Frame>
    </AppProvider>
  );
}
