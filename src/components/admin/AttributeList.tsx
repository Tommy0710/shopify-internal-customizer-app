"use client";

import { useEffect, useState } from "react";
import { Badge, Banner, BlockStack, Button, Card, Checkbox, InlineStack, Spinner, Text } from "@shopify/polaris";
import { ArrowDownIcon, ArrowUpIcon, DragHandleIcon } from "@shopify/polaris-icons";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAdminQuery } from "@/lib/admin-ui/useAdminQuery";
import { useAdminMutation } from "@/lib/admin-ui/useAdminMutation";
import { AdminApiError } from "@/lib/admin-ui/adminFetch";
import { AdminErrorBanner } from "@/components/AdminErrorBanner";
import { ATTRIBUTE_KIND_LABELS, AttributeDrawer } from "./AttributeDrawer";
import type { AttributeDto, AttributeKind } from "@/lib/admin/attributes";

/**
 * Tab Attributes (spec §12.1) — một component dùng chung cho cả bốn nhóm
 * (leathers/stitches/animals/styles), tự fetch danh sách của đúng `kind`,
 * quản lý drawer tạo/sửa, và drag-reorder.
 *
 * State list ("items") KHÔNG phải bản sao trực tiếp của response `GET` —
 * `useAdminQuery` chỉ là nguồn nạp LẦN ĐẦU (và mỗi lần `refetch()`/đổi
 * `includeArchived`); mọi thay đổi sau đó (tạo/sửa/archive/reorder) áp thẳng
 * lên "items" từ chính response của mutation đó, không gọi `GET` lần hai
 * (Global Constraints P2c — tránh refetch flicker).
 */
export interface AttributeListProps {
  kind: AttributeKind;
}

interface ListResponse {
  items: AttributeDto[];
}

function sortBySortOrder(items: AttributeDto[]): AttributeDto[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder);
}

function buildPath(kind: AttributeKind, includeArchived: boolean): string {
  return includeArchived ? `/api/admin/${kind}?includeArchived=true` : `/api/admin/${kind}`;
}

interface RowProps {
  item: AttributeDto;
  index: number;
  total: number;
  onEdit: (item: AttributeDto) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onArchive: (item: AttributeDto) => void;
}

/** Hàng cho item ACTIVE — draggable qua dnd-kit, cộng thêm nút lên/xuống làm
 * đường thay thế accessible (bàn phím/test) cho kéo-thả bằng chuột. */
function SortableAttributeRow({ item, index, total, onEdit, onMove, onArchive }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li ref={setNodeRef} style={style} data-testid={`attribute-row-${item.id}`}>
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        <span
          {...attributes}
          {...listeners}
          role="button"
          tabIndex={0}
          aria-label={`Kéo để sắp xếp ${item.name}`}
          style={{ cursor: "grab", display: "inline-flex" }}
        >
          <DragHandleIcon width="20" height="20" />
        </span>
        <Button
          icon={ArrowUpIcon}
          accessibilityLabel={`Di chuyển ${item.name} lên`}
          onClick={() => onMove(item.id, "up")}
          disabled={index === 0}
          variant="tertiary"
          size="slim"
        />
        <Button
          icon={ArrowDownIcon}
          accessibilityLabel={`Di chuyển ${item.name} xuống`}
          onClick={() => onMove(item.id, "down")}
          disabled={index === total - 1}
          variant="tertiary"
          size="slim"
        />
        <Button variant="plain" onClick={() => onEdit(item)}>
          {item.name}
        </Button>
        {!item.isActive && <Badge tone="attention">Inactive</Badge>}
        <Button variant="tertiary" tone="critical" onClick={() => onArchive(item)}>
          Lưu trữ
        </Button>
      </InlineStack>
    </li>
  );
}

/** Hàng cho item ĐÃ ARCHIVE — chỉ hiện khi bật "Hiện cả đã lưu trữ", không
 * tham gia kéo-thả (archive không có sortOrder có ý nghĩa để sắp lại). */
function ArchivedAttributeRow({ item, onEdit }: { item: AttributeDto; onEdit: (item: AttributeDto) => void }) {
  return (
    <li data-testid={`attribute-row-${item.id}`}>
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        <Button variant="plain" onClick={() => onEdit(item)}>
          {item.name}
        </Button>
        <Badge tone="critical">Archived</Badge>
      </InlineStack>
    </li>
  );
}

export function AttributeList({ kind }: AttributeListProps) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [items, setItems] = useState<AttributeDto[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AttributeDto | null>(null);
  const [reorderBanner, setReorderBanner] = useState<string | null>(null);

  const path = buildPath(kind, includeArchived);
  const { data, loading, error, refetch } = useAdminQuery<ListResponse>(path);
  const reorderMutation = useAdminMutation<{ orderedIds: string[] }, { ok: boolean }>("POST");
  const archiveMutation = useAdminMutation<undefined, AttributeDto>("DELETE");

  // Nạp lại "items" từ response GET mỗi khi nó đổi (fetch đầu, đổi toggle,
  // hoặc refetch() sau 409 STALE_ORDER). Sắp theo sortOrder tường minh ở đây
  // — không tin thứ tự mảng của response, dù server cũng đã ORDER BY sẵn.
  useEffect(() => {
    if (data) setItems(sortBySortOrder(data.items));
  }, [data]);

  const activeItems = items.filter((item) => item.archivedAt === null);
  const archivedItems = items.filter((item) => item.archivedAt !== null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function applyReorder(newActiveOrder: AttributeDto[]): void {
    setItems([...newActiveOrder, ...archivedItems]);
    setReorderBanner(null);
    reorderMutation.mutate(`/api/admin/${kind}/reorder`, { orderedIds: newActiveOrder.map((item) => item.id) }).catch((err) => {
      if (err instanceof AdminApiError && err.code === "STALE_ORDER") {
        // Không đoán ý người dùng, không thử lại — tải lại danh sách thật từ
        // server và báo cho người vận hành biết vì sao thứ tự vừa đổi lại.
        setReorderBanner("Danh sách đã bị thay đổi ở nơi khác — đã tải lại thứ tự mới nhất.");
        refetch();
      }
      // Lỗi khác: `reorderMutation.error` đã được hook set, banner chung bên
      // dưới tự hiển thị.
    });
  }

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = activeItems.findIndex((item) => item.id === active.id);
    const newIndex = activeItems.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    applyReorder(arrayMove(activeItems, oldIndex, newIndex));
  }

  function handleMove(id: string, direction: "up" | "down"): void {
    const index = activeItems.findIndex((item) => item.id === id);
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= activeItems.length) return;
    applyReorder(arrayMove(activeItems, index, newIndex));
  }

  function openCreate(): void {
    setEditingItem(null);
    setDrawerOpen(true);
  }

  function openEdit(item: AttributeDto): void {
    setEditingItem(item);
    setDrawerOpen(true);
  }

  function closeDrawer(): void {
    setDrawerOpen(false);
  }

  function handleSaved(dto: AttributeDto): void {
    setItems((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === dto.id);
      if (existingIndex === -1) {
        return sortBySortOrder([...prev, dto]);
      }
      const next = [...prev];
      next[existingIndex] = dto;
      return next;
    });
  }

  function handleArchive(item: AttributeDto): void {
    archiveMutation.mutate(`/api/admin/${kind}/${item.id}`).then((dto) => {
      setItems((prev) => {
        if (includeArchived) {
          return prev.map((existing) => (existing.id === dto.id ? dto : existing));
        }
        return prev.filter((existing) => existing.id !== dto.id);
      });
    }).catch(() => {
      // `archiveMutation.error` đã được hook set, banner chung hiển thị.
    });
  }

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              {ATTRIBUTE_KIND_LABELS[kind]}
            </Text>
            <InlineStack gap="300" blockAlign="center">
              <Checkbox label="Hiện cả đã lưu trữ" checked={includeArchived} onChange={setIncludeArchived} />
              <Button onClick={openCreate}>Thêm mới</Button>
            </InlineStack>
          </InlineStack>

          {reorderBanner && (
            <Banner tone="warning" onDismiss={() => setReorderBanner(null)}>
              {reorderBanner}
            </Banner>
          )}
          {error && <AdminErrorBanner error={error} />}
          {reorderMutation.error && <AdminErrorBanner error={reorderMutation.error} />}
          {archiveMutation.error && <AdminErrorBanner error={archiveMutation.error} />}

          {loading ? (
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" accessibilityLabel="Đang tải" />
              <Text as="span">Đang tải…</Text>
            </InlineStack>
          ) : items.length === 0 ? (
            <Text as="p">Chưa có mục nào.</Text>
          ) : (
            <BlockStack gap="300">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={activeItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                  <ul data-testid="attribute-active-list">
                    {activeItems.map((item, index) => (
                      <SortableAttributeRow
                        key={item.id}
                        item={item}
                        index={index}
                        total={activeItems.length}
                        onEdit={openEdit}
                        onMove={handleMove}
                        onArchive={handleArchive}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>

              {includeArchived && archivedItems.length > 0 && (
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Đã lưu trữ
                  </Text>
                  <ul data-testid="attribute-archived-list">
                    {archivedItems.map((item) => (
                      <ArchivedAttributeRow key={item.id} item={item} onEdit={openEdit} />
                    ))}
                  </ul>
                </BlockStack>
              )}
            </BlockStack>
          )}
        </BlockStack>
      </Card>

      <AttributeDrawer kind={kind} item={editingItem} open={drawerOpen} onClose={closeDrawer} onSaved={handleSaved} />
    </BlockStack>
  );
}
