"use client";

import { useEffect, useState } from "react";
import { BlockStack, Button, Card, InlineStack, RadioButton, Text, TextField } from "@shopify/polaris";
import { useAdminMutation } from "@/lib/admin-ui/useAdminMutation";
import { AdminApiError } from "@/lib/admin-ui/adminFetch";
import { AdminErrorBanner } from "@/components/AdminErrorBanner";
import type { ProductHostDto, ProductTreeDto } from "@/lib/admin/products";

/**
 * Phần "trang Shopify nào host product này" (spec §12.2, trên cùng detail).
 * Ngoại lệ DUY NHẤT của quy ước whole-list PUT (xem `products.ts`): một host
 * vắng mặt khỏi danh sách gửi lên bị XOÁ hẳn (`putHosts` gọi thẳng
 * `deleteMany`), không phải deactivate như style/animal/stitch — UI không cần
 * tự làm gì khác, chỉ cần KHÔNG gửi hàng đã "Gỡ".
 *
 * `preselectStyleId` (P2a schema có, optional) CHƯA có UI ở task này — luôn
 * gửi `undefined`; một dropdown chọn style là việc của phase sau khi cần
 * preselect thật trên storefront.
 */

export interface HostsSectionProps {
  product: Pick<ProductTreeDto, "id" | "hosts">;
  /** Gọi sau khi PUT thành công — cha dùng để refetch cả cây, vì response PUT
   * ở đây chỉ là mảng host, không mang theo readiness (NO_HOST phụ thuộc
   * trực tiếp vào danh sách này). */
  onSaved?: () => void;
}

interface HostRow {
  /** Khoá React ổn định — id thật của hàng đã tồn tại, hoặc một khoá tạm cho
   * hàng vừa thêm (chưa có id server). */
  key: string;
  shopifyProductId: string;
  isPrimary: boolean;
}

let nextTempKey = 0;
function newTempKey(): string {
  nextTempKey += 1;
  return `new-${nextTempKey}`;
}

function toRows(hosts: ProductHostDto[]): HostRow[] {
  return hosts.map((h) => ({ key: h.id, shopifyProductId: h.shopifyProductId, isPrimary: h.isPrimary }));
}

export function HostsSection({ product, onSaved }: HostsSectionProps) {
  const [rows, setRows] = useState<HostRow[]>(() => toRows(product.hosts));
  const [newId, setNewId] = useState("");
  const mutation = useAdminMutation<Array<{ shopifyProductId: string; isPrimary: boolean }>, ProductHostDto[]>("PUT");

  useEffect(() => {
    setRows(toRows(product.hosts));
  }, [product.hosts]);

  function handleAdd(): void {
    const trimmed = newId.trim();
    if (!trimmed) return;
    setRows((prev) => [...prev, { key: newTempKey(), shopifyProductId: trimmed, isPrimary: prev.length === 0 }]);
    setNewId("");
  }

  function handleRemove(key: string): void {
    setRows((prev) => prev.filter((row) => row.key !== key));
  }

  // ★ Radio-exclusive NGAY Ở CLIENT — không đợi 422 "multiple_primary" của
  // server mới sửa; chọn primary hàng này luôn bỏ chọn mọi hàng khác.
  function handleSetPrimary(key: string): void {
    setRows((prev) => prev.map((row) => ({ ...row, isPrimary: row.key === key })));
  }

  function handleShopifyIdChange(key: string, value: string): void {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, shopifyProductId: value } : row)));
  }

  async function handleSave(): Promise<void> {
    const body = rows.map((row) => ({ shopifyProductId: row.shopifyProductId.trim(), isPrimary: row.isPrimary }));
    try {
      const saved = await mutation.mutate(`/api/admin/products/${product.id}/hosts`, body);
      setRows(toRows(saved));
      onSaved?.();
    } catch {
      // mutation.error đã được set — banner bên dưới tự hiển thị (HOST_TAKEN
      // xử lý riêng, xem `hostTaken` bên dưới).
    }
  }

  const hostTaken =
    mutation.error instanceof AdminApiError && mutation.error.status === 409 && mutation.error.code === "HOST_TAKEN"
      ? (mutation.error.details as { shopifyProductId?: string; productId?: string } | null)
      : null;

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          Trang Shopify (host)
        </Text>

        {hostTaken && (
          <AdminErrorBanner
            error={`shopifyProductId ${hostTaken.shopifyProductId ?? "?"} đã được product khác (id ${hostTaken.productId ?? "?"}) sử dụng — mỗi trang Shopify chỉ thuộc một customizer.`}
          />
        )}
        {mutation.error && !hostTaken && <AdminErrorBanner error={mutation.error} />}

        {rows.length === 0 ? (
          <Text as="p">Chưa gắn trang Shopify nào.</Text>
        ) : (
          <BlockStack gap="200">
            {rows.map((row) => (
              <div key={row.key} data-testid={`host-row-${row.key}`}>
                <InlineStack gap="300" blockAlign="center" wrap={false}>
                  <RadioButton
                    label="Trang chính"
                    labelHidden
                    checked={row.isPrimary}
                    name="host-primary"
                    onChange={() => handleSetPrimary(row.key)}
                  />
                  <div style={{ minWidth: 180 }}>
                    <TextField
                      label="shopifyProductId"
                      labelHidden
                      value={row.shopifyProductId}
                      onChange={(value) => handleShopifyIdChange(row.key, value)}
                      autoComplete="off"
                    />
                  </div>
                  {row.isPrimary && <Text as="span">Chính</Text>}
                  <Button variant="tertiary" tone="critical" onClick={() => handleRemove(row.key)}>
                    Gỡ
                  </Button>
                </InlineStack>
              </div>
            ))}
          </BlockStack>
        )}

        <InlineStack gap="200" blockAlign="center">
          <div style={{ minWidth: 200 }}>
            <TextField
              label="shopifyProductId mới"
              labelHidden
              placeholder="ID sản phẩm Shopify"
              value={newId}
              onChange={setNewId}
              autoComplete="off"
            />
          </div>
          <Button onClick={handleAdd}>Thêm trang</Button>
        </InlineStack>

        <InlineStack>
          <Button variant="primary" onClick={handleSave} loading={mutation.loading}>
            Lưu host
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
