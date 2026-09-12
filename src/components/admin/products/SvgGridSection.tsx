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

function findCell(style: StyleTreeDto, animalId: string): StyleAnimalCellDto | null {
  return style.animals.find((c) => c.animalId === animalId && c.isActive) ?? null;
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
                      const cell = findCell(style, animal.animalId);
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
          cell={findCell(selected.style, selected.animal.animalId)}
          stitches={product.stitches}
          open
          onClose={closeDrawer}
          onSaved={handleSaved}
        />
      )}
    </Card>
  );
}
