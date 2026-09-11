"use client";

import { useEffect, useMemo, useState } from "react";
import { BlockStack, Button, Card, Checkbox, InlineStack, Spinner, Text } from "@shopify/polaris";
import { useAdminQuery } from "@/lib/admin-ui/useAdminQuery";
import { useAdminMutation } from "@/lib/admin-ui/useAdminMutation";
import { AdminErrorBanner } from "@/components/AdminErrorBanner";
import type { AttributeDto } from "@/lib/admin/attributes";
import type { ProductRelationDto, ProductTreeDto } from "@/lib/admin/products";

/**
 * Checkbox "product này có offer style/animal/stitch nào của shop" (spec
 * §12.2's phần Styles/Animals/Stitches trong detail). Nguồn checkbox là
 * DANH SÁCH ATTRIBUTE ĐANG ACTIVE của shop (`GET /api/admin/{kind}`, mặc
 * định không kèm archived) — không phải danh sách quan hệ hiện có của
 * product. Một attribute đã archived nhưng còn active trong product sẽ
 * không hiện ở đây; lưu (PUT chỉ gửi id đã tick) sẽ khiến nó bị server
 * deactivate qua "missing" (R4) — đúng cách giải quyết readiness
 * `ARCHIVED_ATTRIBUTE`, không phải lỗi.
 */
export type RelationKind = "styles" | "animals" | "stitches";

const RELATION_KEY_FIELD: Record<RelationKind, string> = {
  styles: "styleId",
  animals: "animalId",
  stitches: "stitchId",
};

const RELATION_LABELS: Record<RelationKind, string> = {
  styles: "Styles",
  animals: "Animals",
  stitches: "Stitches",
};

export interface RelationChecklistProps {
  kind: RelationKind;
  product: Pick<ProductTreeDto, "id" | "styles" | "animals" | "stitches">;
  /** Cha dùng để refetch cây sau khi lưu — readiness phụ thuộc trực tiếp vào
   * danh sách style/animal/stitch active, và response PUT ở đây (mảng phẳng
   * `ProductRelationDto`) không mang theo readiness đã tính lại. */
  onSaved?: () => void;
}

interface RelationEntry {
  isActive: boolean;
  [key: string]: unknown;
}

/** `StyleTreeDto`/`AnimalTreeDto`/`StitchTreeDto` không có index signature (mỗi
 * cái khai field cố định `styleId`/`animalId`/`stitchId`) — đọc động theo
 * `keyField` cần một cast tường minh ở ĐÚNG một chỗ này, phần còn lại của
 * component vẫn thao tác qua kiểu `RelationEntry` đã khai rõ. */
function currentEntries(kind: RelationKind, product: RelationChecklistProps["product"]): RelationEntry[] {
  switch (kind) {
    case "styles":
      return product.styles as unknown as RelationEntry[];
    case "animals":
      return product.animals as unknown as RelationEntry[];
    case "stitches":
      return product.stitches as unknown as RelationEntry[];
  }
}

export function RelationChecklist({ kind, product, onSaved }: RelationChecklistProps) {
  const keyField = RELATION_KEY_FIELD[kind];
  const path = `/api/admin/${kind}`;
  const { data, loading, error } = useAdminQuery<{ items: AttributeDto[] }>(path);
  const mutation = useAdminMutation<Array<Record<string, unknown>>, ProductRelationDto[]>("PUT");

  const relationArray = currentEntries(kind, product);
  const activeIds = useMemo(
    () => new Set(relationArray.filter((e) => e.isActive).map((e) => String(e[keyField]))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relationArray, keyField],
  );

  const [checked, setChecked] = useState<Set<string>>(activeIds);

  // Nạp lại checkbox mỗi khi tập active của product đổi (fetch lần đầu của
  // cha, hoặc cha refetch sau khi lưu ở đây/HostsSection). Không đồng bộ
  // ngược — checkbox đang tick dở của người dùng không lan ngược ra product.
  useEffect(() => {
    setChecked(activeIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIds]);

  function toggle(id: string): void {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Quyết định sortOrder — cùng cơ chế đã dựng và kiểm chứng ở
   * `PriceMatrixSection.tsx` (Task 5): hàng ĐÃ có quan hệ product trước đó
   * (dù đang active hay không — `relationArray` không lọc isActive) giữ
   * NGUYÊN `sortOrder` cũ, tra theo id từ chính `relationArray` của product,
   * không recompute lại theo vị trí trong mảng đã lọc `checked`. Chỉ id THẬT
   * SỰ MỚI (chưa từng có quan hệ) mới được gán index mới, sau `sortOrder`
   * lớn nhất hiện có. Đây là fix cho lỗi đã xác nhận bằng thực thi hai lần
   * (sau Task 4, và lại ở review Task 5): bản cũ tính `sortOrder = index`
   * MỖI LẦN save, nên một save không đụng tới hàng X vẫn âm thầm đổi
   * sortOrder của X nếu vị trí của nó trong mảng đã lọc thay đổi.
   */
  async function handleSave(): Promise<void> {
    const existingSortOrder = new Map(relationArray.map((e) => [String(e[keyField]), e.sortOrder as number]));
    const existingMaxSortOrder = relationArray.reduce((max, e) => Math.max(max, e.sortOrder as number), -1);
    let nextNewSortOrder = existingMaxSortOrder + 1;

    const items = (data?.items ?? []).filter((attr) => checked.has(attr.id));
    const body = items.map((attr) => {
      const sortOrder = existingSortOrder.has(attr.id) ? existingSortOrder.get(attr.id)! : nextNewSortOrder++;
      return { [keyField]: attr.id, isActive: true, sortOrder };
    });
    try {
      await mutation.mutate(`/api/admin/products/${product.id}/${kind}`, body);
      onSaved?.();
    } catch {
      // mutation.error đã được set, banner bên dưới tự hiển thị.
    }
  }

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {RELATION_LABELS[kind]}
        </Text>
        {error && <AdminErrorBanner error={error} />}
        {mutation.error && <AdminErrorBanner error={mutation.error} />}
        {loading ? (
          <InlineStack gap="200" blockAlign="center">
            <Spinner size="small" accessibilityLabel="Đang tải" />
            <Text as="span">Đang tải…</Text>
          </InlineStack>
        ) : !data || data.items.length === 0 ? (
          <Text as="p">Shop chưa có {RELATION_LABELS[kind].toLowerCase()} nào — thêm ở tab Attributes trước.</Text>
        ) : (
          <BlockStack gap="150">
            {data.items.map((attr) => (
              <Checkbox key={attr.id} label={attr.name} checked={checked.has(attr.id)} onChange={() => toggle(attr.id)} />
            ))}
          </BlockStack>
        )}
        <InlineStack>
          <Button variant="primary" onClick={handleSave} loading={mutation.loading} disabled={loading}>
            Lưu {RELATION_LABELS[kind].toLowerCase()}
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
