"use client";

import { useEffect, useState } from "react";
import { Banner, BlockStack, Checkbox } from "@shopify/polaris";
import { useAdminMutation } from "@/lib/admin-ui/useAdminMutation";
import { AdminApiError } from "@/lib/admin-ui/adminFetch";
import { AdminErrorBanner } from "@/components/AdminErrorBanner";
import type { ProductSummaryDto, ProductTreeDto } from "@/lib/admin/products";
import type { ReadinessProblem } from "@/lib/admin/readiness";

/**
 * "Product này bật lên storefront được chưa" (spec §12.2) + nút bật/tắt.
 * `ready:true` → banner thành công. `ready:false` → liệt kê MESSAGE (không
 * chỉ code) của từng problem, đủ ngữ cảnh để người vận hành sửa.
 *
 * Toggle gọi PATCH {isEnabled}. Server chỉ chặn (409 NOT_READY) khi thực sự
 * xin bật lên `true` — tắt (`false`) không bao giờ bị chặn (`products.ts`
 * `updateHandler`). Khi bị chặn, lỗi 409 mang theo `problems` đã tính lại
 * NGAY LÚC ĐÓ (không phải bản `readiness` cũ truyền vào lúc mount) — hiển thị
 * đúng bản đó thay vì thông báo lỗi chung chung.
 */
export interface ReadinessBannerProps {
  productId: string;
  isEnabled: boolean;
  readiness: ProductTreeDto["readiness"];
  /** Gọi sau khi PATCH isEnabled thành công — cha cập nhật `isEnabled` cục bộ
   * từ chính response, không cần refetch cả cây (bật/tắt không chạm
   * style/animal/stitch/host nên readiness không đổi). */
  onToggleEnabled: (updated: ProductSummaryDto) => void;
}

export function ReadinessBanner({ productId, isEnabled, readiness, onToggleEnabled }: ReadinessBannerProps) {
  const [problems, setProblems] = useState<ReadinessProblem[]>(readiness.problems);
  const mutation = useAdminMutation<{ isEnabled: boolean }, ProductSummaryDto>("PATCH");

  useEffect(() => {
    setProblems(readiness.problems);
  }, [readiness]);

  async function handleToggle(next: boolean): Promise<void> {
    try {
      const updated = await mutation.mutate(`/api/admin/products/${productId}`, { isEnabled: next });
      onToggleEnabled(updated);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 409 && err.code === "NOT_READY") {
        const nowProblems = (err.details?.problems as ReadinessProblem[] | undefined) ?? [];
        setProblems(nowProblems);
        return;
      }
      // Lỗi khác: `mutation.error` đã được set, banner chung bên dưới hiển thị.
    }
  }

  const ready = problems.length === 0;
  const isNotReadyConflict = mutation.error?.status === 409 && mutation.error.code === "NOT_READY";

  return (
    <BlockStack gap="300">
      <Checkbox
        label="Bật trên storefront (isEnabled)"
        checked={isEnabled}
        onChange={handleToggle}
        disabled={mutation.loading}
      />
      {ready ? (
        <Banner tone="success" title="Sẵn sàng bật lên storefront">
          <p>Product đã đủ host, style/animal/stitch active, giá và SVG đầy đủ.</p>
        </Banner>
      ) : (
        <Banner tone="warning" title={`Chưa sẵn sàng — còn ${problems.length} vấn đề`}>
          <ul>
            {problems.map((problem, index) => (
              <li key={`${problem.code}-${index}`}>{problem.message}</li>
            ))}
          </ul>
        </Banner>
      )}
      {mutation.error && !isNotReadyConflict && <AdminErrorBanner error={mutation.error} />}
    </BlockStack>
  );
}
