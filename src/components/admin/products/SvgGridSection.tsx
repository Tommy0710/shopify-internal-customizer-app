"use client";

import { useState } from "react";
import { Badge, Button, Card, InlineStack, Text, Tooltip } from "@shopify/polaris";
import { SvgGridDrawer } from "./SvgGridDrawer";
import type { AnimalTreeDto, ProductTreeDto, StyleAnimalCellDto, StyleTreeDto } from "@/lib/admin/products";

/**
 * Lưới SVG mockup style×animal (spec §12.2's ASCII table). Đây là section
 * DUY NHẤT trong admin dùng lại chính `src/svg-engine` — qua `SvgGridDrawer`
 * khi click một ô.
 *
 * Hàng = style ĐANG ACTIVE của product (`StyleTreeDto.isActive`), cột = animal
 * ĐANG ACTIVE (`AnimalTreeDto.isActive`) — style/animal bị tắt (không phải
 * archived, mà đơn giản chưa/không còn offer) không hiện ở đây; bật lại qua
 * `RelationChecklist` (Task 4) mới thấy lại cột/hàng đó. Một style/animal có
 * thể ĐANG active nhưng attribute gốc đã bị `archived` (readiness's
 * `ARCHIVED_ATTRIBUTE`) — hiện badge cảnh báo trên tên hàng/cột thay vì ẩn đi,
 * vì nó vẫn "có mặt" và cần admin xử lý.
 */
export interface SvgGridSectionProps {
  product: Pick<ProductTreeDto, "id" | "styles" | "animals" | "stitches">;
  onSaved?: () => void;
}

interface SelectedCell {
  style: StyleTreeDto;
  animal: AnimalTreeDto;
}

/** Dùng cho LƯỚI (✓/⚠) — chỉ ô đang active mới tính là "đã có mockup". Một ô
 * đã từng lưu rồi bị tắt (isActive:false, không phải archived) vẫn hiện
 * ⚠ missing ở đây, đúng quy ước "isActive:false = chưa offer" xuyên suốt phase
 * này (giống PriceMatrixSection/RelationChecklist). */
function findActiveCell(style: StyleTreeDto, animalId: string): StyleAnimalCellDto | null {
  return style.animals.find((c) => c.animalId === animalId && c.isActive) ?? null;
}

/**
 * Dùng để PREFILL DRAWER — theo `(styleId, animalId)`, KHÔNG lọc `isActive`.
 *
 * Bug đã sửa (fix round 1): trước đây drawer prefill cũng gọi hàm lọc
 * `isActive`, nên một ô đã từng lưu (còn nguyên `displayLabel`/`description`/
 * `defaultStitchId`/`svgAssetId` thật trong DB) nhưng đang `isActive:false` —
 * khác `archived` — mở drawer HOÀN TOÀN RỖNG, giống hệt một cặp chưa từng
 * lưu. Hậu quả thật: admin mất quyền nhìn lại nhãn/mô tả/stitch mặc định cũ,
 * bị buộc tải lại SVG chỉ để bỏ chặn nút Lưu, và nếu quên gõ lại các trường
 * cũ thì lần lưu đó ÂM THẦM xoá chúng (whole-list PUT gửi cell mới thay cell
 * cũ). Việc lưới hiện ⚠ missing cho ô này là ĐÚNG (xem `findActiveCell`) —
 * chỉ nguồn prefill của drawer là sai, sửa đúng một chỗ đó. Checkbox "Đang
 * hoạt động" trong drawer (khởi tạo từ `cell.isActive`) vẫn là nơi DUY NHẤT
 * quyết định bật lại ô này khi lưu — hàm này không đổi ngữ nghĩa đó.
 */
function findAnyCell(style: StyleTreeDto, animalId: string): StyleAnimalCellDto | null {
  return style.animals.find((c) => c.animalId === animalId) ?? null;
}

export function SvgGridSection({ product, onSaved }: SvgGridSectionProps) {
  const styles = product.styles.filter((s) => s.isActive);
  const animals = product.animals.filter((a) => a.isActive);
  const [selected, setSelected] = useState<SelectedCell | null>(null);

  function closeDrawer(): void {
    setSelected(null);
  }

  function handleSaved(): void {
    onSaved?.();
    closeDrawer();
  }

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <Text as="h2" variant="headingMd">
          SVG mockups (Style × Animal)
        </Text>

        {styles.length === 0 || animals.length === 0 ? (
          <Text as="p">
            Product chưa có style hoặc animal active nào — bật ở checklist Styles/Animals bên trên trước khi gán mockup.
          </Text>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0.5rem" }} />
                  {animals.map((animal) => (
                    <th key={animal.animalId} style={{ textAlign: "left", padding: "0.5rem" }}>
                      <InlineStack gap="100" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {animal.name}
                        </Text>
                        {animal.archived && <Badge tone="warning">Đã archive</Badge>}
                      </InlineStack>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {styles.map((style) => (
                  <tr key={style.styleId}>
                    <th scope="row" style={{ textAlign: "left", padding: "0.5rem" }}>
                      <InlineStack gap="100" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {style.name}
                        </Text>
                        {style.archived && <Badge tone="warning">Đã archive</Badge>}
                      </InlineStack>
                    </th>
                    {animals.map((animal) => {
                      const cell = findActiveCell(style, animal.animalId);
                      const stateLabel = cell ? "✓ SVG" : "⚠ missing";
                      const button = (
                        <Button
                          key={animal.animalId}
                          accessibilityLabel={`Ô ${style.name} × ${animal.name}: ${stateLabel}`}
                          tone={cell ? "success" : undefined}
                          onClick={() => setSelected({ style, animal })}
                        >
                          {stateLabel}
                        </Button>
                      );
                      return (
                        <td key={animal.animalId} style={{ padding: "0.5rem" }}>
                          <InlineStack gap="100" blockAlign="center">
                            {cell?.svgAssetArchived ? (
                              <Tooltip content="Asset SVG của ô này đã bị archive ở tab Attributes — sẽ bị loại khỏi lần lưu kế tiếp của style này trừ khi tải mockup mới.">
                                <InlineStack gap="100" blockAlign="center">
                                  {button}
                                  <Badge tone="warning">Đã archive</Badge>
                                </InlineStack>
                              </Tooltip>
                            ) : (
                              button
                            )}
                          </InlineStack>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <SvgGridDrawer
          productId={product.id}
          style={selected.style}
          animal={selected.animal}
          cell={findAnyCell(selected.style, selected.animal.animalId)}
          stitches={product.stitches}
          open
          onClose={closeDrawer}
          onSaved={handleSaved}
        />
      )}
    </Card>
  );
}
