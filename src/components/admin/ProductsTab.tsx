"use client";

import { useEffect, useState } from "react";
import { BlockStack, Button, Card, InlineStack, Spinner, Text, TextField } from "@shopify/polaris";
import { useAdminQuery } from "@/lib/admin-ui/useAdminQuery";
import { useAdminMutation } from "@/lib/admin-ui/useAdminMutation";
import { AdminErrorBanner } from "@/components/AdminErrorBanner";
import { HostsSection } from "./products/HostsSection";
import { RelationChecklist } from "./products/RelationChecklist";
import { ReadinessBanner } from "./products/ReadinessBanner";
import { PriceMatrixSection } from "./products/PriceMatrixSection";
import type { ProductSummaryDto, ProductTreeDto } from "@/lib/admin/products";

/**
 * Tab Products (spec §12.2, nửa đầu — Task 4): tạo product, gắn host, chọn
 * style/animal/stitch nào tham gia. Ma trận giá và lưới SVG (Task 5/6) render
 * dạng placeholder ở đây.
 *
 * List-vs-detail là STATE React, không phải route (Ruling R6 —
 * `next.config.mjs`'s CSP `frame-ancestors` chỉ khai cho "/"; một page.tsx
 * mới ở route khác sẽ phục vụ THIẾU header đó). URL `?product=<id>` chỉ là
 * phản chiếu MỀM qua History API gốc (`replaceState`) — không dùng
 * `next/navigation`'s router, vốn sẽ tính là một lượt điều hướng App Router
 * thật (và đòi hỏi bọc Suspense cho `useSearchParams`, không cần thiết ở đây
 * vì đây không phải nguồn sự thật của state, chỉ là tiện ích chia sẻ/refresh
 * link).
 */

type View = { kind: "list" } | { kind: "detail"; id: string };

function readInitialProductId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("product");
  } catch {
    return null;
  }
}

function reflectProductInUrl(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("product", id);
    else url.searchParams.delete("product");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  } catch {
    // Môi trường thiếu History API đầy đủ — đây chỉ là tiện ích phụ, không
    // phải nguồn sự thật của state, bỏ qua an toàn.
  }
}

interface ProductListProps {
  onSelect: (id: string) => void;
  onCreated: (product: ProductSummaryDto) => void;
}

function ProductList({ onSelect, onCreated }: ProductListProps) {
  const { data, loading, error } = useAdminQuery<{ items: ProductSummaryDto[] }>("/api/admin/products");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const createMutation = useAdminMutation<{ name: string }, ProductSummaryDto>("POST");

  async function handleCreate(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const created = await createMutation.mutate("/api/admin/products", { name: trimmed });
      setCreating(false);
      setName("");
      onCreated(created);
    } catch {
      // createMutation.error đã được set — banner trong form tự hiển thị.
    }
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Products
          </Text>
          {!creating && <Button onClick={() => setCreating(true)}>Thêm sản phẩm</Button>}
        </InlineStack>

        {creating && (
          <InlineStack gap="200" blockAlign="center">
            <TextField
              label="Tên sản phẩm"
              labelHidden
              placeholder="Tên sản phẩm"
              value={name}
              onChange={setName}
              autoComplete="off"
              disabled={createMutation.loading}
            />
            <Button variant="primary" onClick={handleCreate} loading={createMutation.loading}>
              Tạo
            </Button>
            <Button
              onClick={() => {
                setCreating(false);
                setName("");
              }}
              disabled={createMutation.loading}
            >
              Huỷ
            </Button>
          </InlineStack>
        )}
        {createMutation.error && <AdminErrorBanner error={createMutation.error} />}

        {error && <AdminErrorBanner error={error} />}
        {loading ? (
          <InlineStack gap="200" blockAlign="center">
            <Spinner size="small" accessibilityLabel="Đang tải" />
            <Text as="span">Đang tải…</Text>
          </InlineStack>
        ) : !data || data.items.length === 0 ? (
          <Text as="p">Chưa có sản phẩm nào.</Text>
        ) : (
          <ul data-testid="product-list">
            {data.items.map((product) => (
              <li key={product.id}>
                <InlineStack gap="200" blockAlign="center">
                  <Button variant="plain" onClick={() => onSelect(product.id)}>
                    {product.name}
                  </Button>
                  <Text as="span">{product.isEnabled ? "Đang bật" : "Đang tắt"}</Text>
                </InlineStack>
              </li>
            ))}
          </ul>
        )}
      </BlockStack>
    </Card>
  );
}

interface ProductDetailProps {
  id: string;
  onBack: () => void;
}

function ProductDetail({ id, onBack }: ProductDetailProps) {
  const { data, loading, error, refetch } = useAdminQuery<ProductTreeDto>(`/api/admin/products/${id}`);
  const [product, setProduct] = useState<ProductTreeDto | undefined>(undefined);

  useEffect(() => {
    if (data) setProduct(data);
  }, [data]);

  if (error) {
    return (
      <BlockStack gap="300">
        <Button onClick={onBack}>← Quay lại danh sách</Button>
        <AdminErrorBanner error={error} />
      </BlockStack>
    );
  }

  if (!product) {
    return (
      <InlineStack gap="200" blockAlign="center">
        <Spinner size="small" accessibilityLabel="Đang tải" />
        <Text as="span">Đang tải…</Text>
      </InlineStack>
    );
  }

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <Button onClick={onBack}>← Quay lại danh sách</Button>
        <Text as="h1" variant="headingLg">
          {product.name}
        </Text>
      </InlineStack>

      <ReadinessBanner
        productId={product.id}
        isEnabled={product.isEnabled}
        readiness={product.readiness}
        onToggleEnabled={(updated) =>
          setProduct((prev) => (prev ? { ...prev, isEnabled: updated.isEnabled } : prev))
        }
      />

      <HostsSection product={product} onSaved={refetch} />
      <RelationChecklist kind="styles" product={product} onSaved={refetch} />
      <RelationChecklist kind="animals" product={product} onSaved={refetch} />
      <RelationChecklist kind="stitches" product={product} onSaved={refetch} />

      <PriceMatrixSection matrix="style" product={product} onSaved={refetch} />
      <PriceMatrixSection matrix="animal" product={product} onSaved={refetch} />

      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            Lưới SVG mockup (style × animal)
          </Text>
          <Text as="p">Sẽ có ở Task 6.</Text>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

export function ProductsTab() {
  const [view, setView] = useState<View>(() => {
    const initialId = readInitialProductId();
    return initialId ? { kind: "detail", id: initialId } : { kind: "list" };
  });

  function goToDetail(id: string): void {
    setView({ kind: "detail", id });
    reflectProductInUrl(id);
  }

  function goToList(): void {
    setView({ kind: "list" });
    reflectProductInUrl(null);
  }

  if (view.kind === "list") {
    return <ProductList onSelect={goToDetail} onCreated={(product) => goToDetail(product.id)} />;
  }
  return <ProductDetail id={view.id} onBack={goToList} />;
}
