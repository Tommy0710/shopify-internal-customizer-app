"use client";

import { useEffect, useMemo, useState } from "react";
import { BlockStack, Button, Card, Checkbox, Collapsible, InlineStack, Spinner, Text, Tooltip } from "@shopify/polaris";
import { useAdminQuery } from "@/lib/admin-ui/useAdminQuery";
import { useAdminMutation } from "@/lib/admin-ui/useAdminMutation";
import { AdminErrorBanner } from "@/components/AdminErrorBanner";
import { PriceField } from "@/components/admin/PriceField";
import type { AttributeDto } from "@/lib/admin/attributes";
import type { AnimalTreeDto, PriceCellDto, PriceCellVariantDto, ProductTreeDto, StyleTreeDto } from "@/lib/admin/products";

/**
 * Ma trận giá style×leather / animal×leather (spec §12.2's mockup `▾`/`▸`).
 * Checkbox "style/animal này có active không" đã là việc của Task 4's
 * `RelationChecklist kind="styles"|"animals"` — section này CHỈ vẽ phần
 * lưới giá bên trong từng nhóm, không lặp lại checkbox đó.
 *
 * Nguồn hàng của mỗi nhóm là TOÀN BỘ leather đang active của shop (giống
 * quy ước `RelationChecklist`: checklist nguồn là attribute active của shop,
 * không phải chỉ những gì đã từng lưu cho nhóm này) — hợp với `☐ Crocodile —`
 * trong mockup: một leather CHƯA từng được thêm vào nhóm vẫn hiện, chưa tick,
 * chưa giá, để admin bật lên bất cứ lúc nào. Một ô đã lưu trước đó nhưng
 * leather bên dưới đã bị archive (PriceCellDto.archived) vẫn được giữ lại
 * trong danh sách hàng dù không còn nằm trong leathers active của shop — mất
 * một hàng khỏi UI trong khi DB vẫn còn giá cho nó sẽ trông như "biến mất".
 */
export type PriceMatrixKind = "style" | "animal";

export interface PriceMatrixSectionProps {
  matrix: PriceMatrixKind;
  product: Pick<ProductTreeDto, "id" | "styles" | "animals">;
  /** Gọi sau khi một nhóm lưu giá thành công — cha dùng để refetch cả cây,
   * vì response PUT ở đây chỉ là mảng ô giá, không mang theo readiness
   * (MISSING_PRICE/MISSING_VARIANT phụ thuộc trực tiếp vào danh sách này). */
  onSaved?: () => void;
}

const MATRIX_TITLE: Record<PriceMatrixKind, string> = {
  style: "Styles & body pricing",
  animal: "Animals & applique pricing",
};

interface MatrixGroup {
  id: string;
  name: string;
  leathers: PriceCellDto[];
}

function groupsFor(matrix: PriceMatrixKind, product: PriceMatrixSectionProps["product"]): MatrixGroup[] {
  if (matrix === "style") {
    return (product.styles as StyleTreeDto[]).map((s) => ({ id: s.styleId, name: s.name, leathers: s.leathers }));
  }
  return (product.animals as AnimalTreeDto[]).map((a) => ({ id: a.animalId, name: a.name, leathers: a.leathers }));
}

function putPathFor(matrix: PriceMatrixKind, productId: string, groupId: string): string {
  return matrix === "style"
    ? `/api/admin/products/${productId}/styles/${groupId}/leathers`
    : `/api/admin/products/${productId}/animals/${groupId}/leathers`;
}

/** Ba trạng thái đúng theo `PriceCellVariantDto` thật — P2b chưa tồn tại nên
 * `variant` luôn `null` cho tới khi variant sync ghi các cột này. */
function variantStatusLabel(variant: PriceCellVariantDto | null): string {
  if (!variant) return "—";
  if (variant.missing) return "⚠ missing";
  return `✓ ${variant.shopifyVariantId.slice(0, 4)}…`;
}

interface RowDef {
  leatherId: string;
  name: string;
}

/** Union của leather active của shop + mọi ô giá đã tồn tại cho nhóm này (kể
 * cả leather đã bị archive sau đó) — không để một hàng đã có giá "biến mất"
 * khỏi UI chỉ vì leather bên dưới không còn nằm trong danh sách active nữa. */
function buildRows(cells: PriceCellDto[], shopLeathers: AttributeDto[]): RowDef[] {
  const rows: RowDef[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    rows.push({ leatherId: cell.leatherId, name: cell.name });
    seen.add(cell.leatherId);
  }
  for (const leather of shopLeathers) {
    if (seen.has(leather.id)) continue;
    rows.push({ leatherId: leather.id, name: leather.name });
    seen.add(leather.id);
  }
  return rows;
}

interface Draft {
  isActive: boolean;
  price: string | null;
}

function draftsFromCells(cells: PriceCellDto[]): Map<string, Draft> {
  const map = new Map<string, Draft>();
  for (const cell of cells) {
    map.set(cell.leatherId, { isActive: cell.isActive, price: cell.price });
  }
  return map;
}

interface PriceMatrixGroupProps {
  group: MatrixGroup;
  shopLeathers: AttributeDto[];
  putPath: string;
  onSaved?: () => void;
}

/** Mặc định GẤP LẠI — mockup spec §12.2 vẽ nhóm đầu mở sẵn (`▾`) chỉ để minh
 * hoạ hình dạng khi mở, không phải yêu cầu hành vi; gấp hết theo mặc định
 * tránh render hàng loạt ô giá ngay khi trang vừa nạp cho product có nhiều
 * style/animal. */
function PriceMatrixGroup({ group, shopLeathers, putPath, onSaved }: PriceMatrixGroupProps) {
  const [open, setOpen] = useState(false);
  const mutation = useAdminMutation<Array<Record<string, unknown>>, PriceCellDto[]>("PUT");

  const cellByLeatherId = useMemo(() => new Map(group.leathers.map((c) => [c.leatherId, c])), [group.leathers]);
  const rows = useMemo(() => buildRows(group.leathers, shopLeathers), [group.leathers, shopLeathers]);

  const [drafts, setDrafts] = useState<Map<string, Draft>>(() => draftsFromCells(group.leathers));

  // Nạp lại draft mỗi khi ô giá của nhóm đổi (fetch lần đầu của cha, hoặc cha
  // refetch sau khi lưu) — cùng quy ước `RelationChecklist`: không đồng bộ
  // ngược, draft đang sửa dở không lan ngược ra product.
  useEffect(() => {
    setDrafts(draftsFromCells(group.leathers));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.leathers]);

  function draftFor(leatherId: string): Draft {
    return drafts.get(leatherId) ?? { isActive: false, price: null };
  }

  function toggleActive(leatherId: string): void {
    setDrafts((prev) => {
      const next = new Map(prev);
      const current = next.get(leatherId) ?? { isActive: false, price: null };
      next.set(leatherId, { ...current, isActive: !current.isActive });
      return next;
    });
  }

  function setPrice(leatherId: string, price: string | null): void {
    setDrafts((prev) => {
      const next = new Map(prev);
      const current = next.get(leatherId) ?? { isActive: false, price: null };
      next.set(leatherId, { ...current, price });
      return next;
    });
  }

  /**
   * Quyết định sortOrder (P2c Task 5): hàng ĐÃ có ô giá trước đó (dù đang
   * active hay không) giữ NGUYÊN `sortOrder` cũ — không recompute lại theo vị
   * trí trong mảng đã lọc. Chỉ hàng THẬT SỰ MỚI (chưa từng có ô giá cho nhóm
   * này) mới được gán index mới, sau `sortOrder` lớn nhất hiện có. Đây là
   * điểm CỐ Ý khác với `RelationChecklist` (Task 4) — nơi đã xác nhận
   * (progress.md, "Task 4: complete") tính lại `sortOrder = index` MỌI LẦN
   * save, làm mất thứ tự cũ của hàng không đổi. Không sửa `RelationChecklist`
   * ở đây (ngoài phạm vi file của Task 5) — thứ tự các NHÓM style/animal (do
   * `RelationChecklist` ghi) vẫn có thể bị xáo khi checklist đó được dùng
   * trong cùng phiên; đó là rủi ro đã biết, ghi trong báo cáo Task 5, không
   * phải lỗi ẩn.
   */
  async function handleSave(): Promise<void> {
    const existingMaxSortOrder = group.leathers.reduce((max, c) => Math.max(max, c.sortOrder), -1);
    let nextNewSortOrder = existingMaxSortOrder + 1;

    const body = rows
      .map((row) => {
        const draft = draftFor(row.leatherId);
        if (!draft.isActive) return null;
        const existing = cellByLeatherId.get(row.leatherId);
        const sortOrder = existing ? existing.sortOrder : nextNewSortOrder++;
        return { leatherId: row.leatherId, price: draft.price, isActive: true, sortOrder };
      })
      .filter((item): item is { leatherId: string; price: string | null; isActive: true; sortOrder: number } => item !== null);

    try {
      await mutation.mutate(putPath, body);
      onSaved?.();
    } catch {
      // mutation.error đã được set, banner bên dưới tự hiển thị.
    }
  }

  return (
    <BlockStack gap="200">
      <InlineStack gap="150" blockAlign="center">
        <Button variant="plain" accessibilityLabel={`Mở/đóng nhóm ${group.name}`} onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"}
        </Button>
        <Text as="span" fontWeight="semibold">
          {group.name}
        </Text>
      </InlineStack>
      <Collapsible open={open} id={`price-matrix-group-${group.id}`}>
        <BlockStack gap="200">
          {mutation.error && <AdminErrorBanner error={mutation.error} />}
          {rows.length === 0 ? (
            <Text as="p">Shop chưa có leather nào — thêm ở tab Attributes trước.</Text>
          ) : (
            <BlockStack gap="150">
              {rows.map((row) => {
                const draft = draftFor(row.leatherId);
                const cell = cellByLeatherId.get(row.leatherId);
                return (
                  <InlineStack key={row.leatherId} gap="200" blockAlign="center">
                    <Checkbox label={row.name} checked={draft.isActive} onChange={() => toggleActive(row.leatherId)} />
                    <PriceField label={`Giá ${row.name}`} value={draft.price} onChange={(v) => setPrice(row.leatherId, v)} />
                    <Text as="span">{variantStatusLabel(cell?.variant ?? null)}</Text>
                  </InlineStack>
                );
              })}
            </BlockStack>
          )}
          <InlineStack>
            <Button variant="primary" onClick={handleSave} loading={mutation.loading}>
              Lưu giá {group.name}
            </Button>
          </InlineStack>
        </BlockStack>
      </Collapsible>
    </BlockStack>
  );
}

export function PriceMatrixSection({ matrix, product, onSaved }: PriceMatrixSectionProps) {
  const { data, loading, error } = useAdminQuery<{ items: AttributeDto[] }>("/api/admin/leathers");
  const groups = groupsFor(matrix, product);
  const shopLeathers = data?.items ?? [];

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {MATRIX_TITLE[matrix]}
          </Text>
          {/* Ruling R5: nút hiện disabled kèm tooltip giải thích — P2b (sinh
           * biến thể Shopify) chưa tồn tại, không wire tới endpoint nào. */}
          <Tooltip content="Cần sinh biến thể Shopify (P2b) trước — chưa sẵn sàng.">
            <Button disabled>Generate variants</Button>
          </Tooltip>
        </InlineStack>

        {error && <AdminErrorBanner error={error} />}
        {loading ? (
          <InlineStack gap="200" blockAlign="center">
            <Spinner size="small" accessibilityLabel="Đang tải" />
            <Text as="span">Đang tải…</Text>
          </InlineStack>
        ) : groups.length === 0 ? (
          <Text as="p">
            Product chưa có {matrix === "style" ? "style" : "animal"} nào — tick ở checklist {matrix === "style" ? "Styles" : "Animals"} bên
            trên trước.
          </Text>
        ) : (
          <BlockStack gap="300">
            {groups.map((group) => (
              <PriceMatrixGroup
                key={group.id}
                group={group}
                shopLeathers={shopLeathers}
                putPath={putPathFor(matrix, product.id, group.id)}
                onSaved={onSaved}
              />
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
