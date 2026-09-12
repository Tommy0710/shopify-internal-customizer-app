"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, BlockStack, Checkbox, FormLayout, InlineStack, Modal, Select, Spinner, Text, TextField, Tooltip } from "@shopify/polaris";
import { applyStitchColor, applyTexture, MissingTargetError } from "@/svg-engine";
import { useAdminQuery } from "@/lib/admin-ui/useAdminQuery";
import { useAdminMutation } from "@/lib/admin-ui/useAdminMutation";
import { AdminErrorBanner } from "@/components/AdminErrorBanner";
import { AssetUploadField } from "@/components/admin/AssetUploadField";
import type { AttributeDto } from "@/lib/admin/attributes";
import type { AssetDto } from "@/lib/admin/assets";
import type { AnimalTreeDto, StitchTreeDto, StyleAnimalCellDto, StyleTreeDto } from "@/lib/admin/products";

/**
 * Drawer của lưới SVG (Task 6, style × animal) — màn hình DUY NHẤT dùng lại
 * chính `src/svg-engine` (không phải bản giả lập): upload xong (hoặc mở ô đã
 * có sẵn), tải nội dung SVG bằng `fetch` thẳng (asset đã public, không qua
 * `adminFetch`/session token), tự `new DOMParser()` NGOÀI `src/svg-engine/`
 * (hàng rào purity của engine cấm dựng parser BÊN TRONG thư mục đó, nhưng gọi
 * `DOMParser` từ code ngoài rồi đưa `Element` đã parse vào các hàm thuần của
 * engine chính là cách dùng dự kiến — xem brief Task 6), rồi chạy
 * `applyTexture`/`applyStitchColor` để xem trước với leather/stitch admin thử
 * chọn. Preview thuần hiển thị — SVG đã được sanitize lúc upload
 * (`POST /api/admin/assets`), ở đây không sanitize lại lần nữa.
 *
 * Field lưu qua PUT (spec §8.1): `defaultStitchId`, `displayLabel`,
 * `description`, `isActive`, `sortOrder` — TÁCH BIỆT khỏi hai dropdown xem
 * trước "Thử leather"/"Thử stitch" (chỉ đổi preview tại chỗ, không có trong
 * body PUT, không có ở DB — hợp đồng `styleAnimalItemSchema` không có trường
 * leather nào).
 */

export interface SvgGridDrawerProps {
  productId: string;
  /** Style đang mở — CẦN `animals` đầy đủ (mọi cặp của style này, không lọc)
   * để dựng payload PUT toàn bộ danh sách (whole-list PUT, Global Constraints). */
  style: Pick<StyleTreeDto, "styleId" | "name" | "animals">;
  animal: Pick<AnimalTreeDto, "animalId" | "name">;
  /** Ô hiện có của đúng cặp style×animal này, hoặc `null` nếu chưa từng lưu. */
  cell: StyleAnimalCellDto | null;
  /** Nguồn dropdown "Stitch mặc định" — `product.stitches` (mọi quan hệ
   * ProductStitch của product, không lọc `isActive`/`archived`: một
   * `defaultStitchId` đã lưu trước đó vẫn phải còn chọn được dù nay đã
   * archived, cùng triết lý union-nguồn của `PriceMatrixSection`). */
  stitches: StitchTreeDto[];
  open: boolean;
  onClose: () => void;
  /** Gọi sau khi PUT thành công — cha (SvgGridSection → ProductsTab) dùng để
   * refetch cả cây, vì response PUT ở đây chỉ là mảng ô, không mang readiness. */
  onSaved: () => void;
}

class SvgPreviewParseError extends Error {}

/**
 * Parse text SVG NGAY TRONG COMPONENT — không dùng lại
 * `src/lib/svg/parseSvgNode.ts` (adapter đó dùng `linkedom`, chỉ dành cho phía
 * Node/server; đưa nó vào bundle trình duyệt là kéo theo một thư viện Node
 * không cần thiết). `DOMParser` của trình duyệt tự phân giải `namespaceURI`
 * đúng ngay từ đầu — không cần bù như bản linkedom.
 */
function parseSvgInBrowser(text: string): Element {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.localName === "parsererror" || doc.querySelector("parsererror")) {
    throw new SvgPreviewParseError("Không parse được nội dung SVG.");
  }
  if (root.localName !== "svg") {
    throw new SvgPreviewParseError("Tài liệu không phải SVG hợp lệ.");
  }
  return root;
}

function assetDtoFromCell(cell: StyleAnimalCellDto | null): AssetDto | null {
  if (!cell) return null;
  return {
    id: cell.svgAssetId,
    kind: "SVG_MOCKUP",
    publicUrl: cell.svgUrl,
    mimeType: "image/svg+xml",
    byteSize: 0,
    width: null,
    height: null,
    originalFilename: cell.svgUrl.split("/").pop() || cell.svgAssetId,
    createdAt: "",
  };
}

const NONE_OPTION = { label: "— Không —", value: "" };

interface StyleAnimalPutItem {
  animalId: string;
  svgAssetId: string;
  displayLabel: string | null;
  description: string | null;
  defaultStitchId: string | null;
  isActive: boolean;
  sortOrder: number;
}

export function SvgGridDrawer({ productId, style, animal, cell, stitches, open, onClose, onSaved }: SvgGridDrawerProps) {
  const [displayLabel, setDisplayLabel] = useState("");
  const [description, setDescription] = useState("");
  const [defaultStitchId, setDefaultStitchId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [svgAsset, setSvgAsset] = useState<AssetDto | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [previewLeatherId, setPreviewLeatherId] = useState("");
  const [previewStitchId, setPreviewStitchId] = useState("");
  const [previewMarkup, setPreviewMarkup] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const svgRootRef = useRef<Element | null>(null);
  // Tăng mỗi lần root parse XONG (không phải mỗi lần fetch) — dùng làm dep
  // cho effect áp preview, vì bản thân `Element` (ref) không đổi tham chiếu
  // khi effect kia mutate nó tại chỗ.
  const [rootVersion, setRootVersion] = useState(0);

  const { data: leathersData } = useAdminQuery<{ items: AttributeDto[] }>("/api/admin/leathers", { enabled: open });
  const shopLeathers = leathersData?.items ?? [];

  const mutation = useAdminMutation<StyleAnimalPutItem[], StyleAnimalCellDto[]>("PUT");

  // Nạp lại field mỗi khi drawer MỞ cho một cặp style×animal khác (hoặc mở
  // lại cùng cặp) — không phải mỗi lần `cell` đổi tham chiếu trong lúc đang mở
  // (cùng quy ước `AttributeDrawer`).
  useEffect(() => {
    if (!open) return;
    setValidationError(null);
    setDisplayLabel(cell?.displayLabel ?? "");
    setDescription(cell?.description ?? "");
    setDefaultStitchId(cell?.defaultStitchId ?? "");
    setIsActive(cell?.isActive ?? true);
    setSvgAsset(assetDtoFromCell(cell));
    setPreviewLeatherId("");
    setPreviewStitchId(cell?.defaultStitchId ?? "");
    setPreviewMarkup("");
    setPreviewError(null);
    svgRootRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, style.styleId, animal.animalId, cell?.svgAssetId]);

  // Fetch + parse NGAY khi asset đổi (upload mới, hoặc asset của ô đã có sẵn
  // lúc mở) — CHỈ ở đây, không lặp lại khi dropdown preview đổi.
  useEffect(() => {
    if (!open || !svgAsset) return;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    fetch(svgAsset.publicUrl)
      .then((res) => res.text())
      .then((text) => {
        if (cancelled) return;
        const root = parseSvgInBrowser(text);
        svgRootRef.current = root;
        setRootVersion((v) => v + 1);
        setPreviewLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        svgRootRef.current = null;
        setPreviewMarkup("");
        setPreviewError(err instanceof Error ? err.message : String(err));
        setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, svgAsset?.id, svgAsset?.publicUrl]);

  // Áp lại preview lên CÙNG cây đã parse (không fetch/parse lại) mỗi khi cây
  // vừa parse xong (`rootVersion`) HOẶC dropdown "Thử leather"/"Thử stitch"
  // đổi — đúng yêu cầu brief Task 6: đổi dropdown chạy lại applyTexture/
  // applyStitchColor trên cây cũ, không re-fetch.
  useEffect(() => {
    const root = svgRootRef.current;
    if (!root) return;
    try {
      const leather = shopLeathers.find((l) => l.id === previewLeatherId);
      const textureUrl = leather?.textureImage?.url ?? null;
      applyTexture(root, "body", textureUrl);
      applyTexture(root, "animal", textureUrl);

      const stitch = stitches.find((s) => s.stitchId === previewStitchId);
      if (stitch) applyStitchColor(root, stitch.colorHex);

      setPreviewError(null);
      setPreviewMarkup(root.outerHTML);
    } catch (err) {
      setPreviewError(
        err instanceof MissingTargetError
          ? `SVG thiếu target bắt buộc: ${err.targetId}`
          : err instanceof Error
            ? err.message
            : String(err),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootVersion, previewLeatherId, previewStitchId, shopLeathers, stitches]);

  async function handleSave(): Promise<void> {
    if (!svgAsset) {
      setValidationError("Cần tải lên SVG mockup trước khi lưu.");
      return;
    }
    setValidationError(null);

    const existingCells = style.animals;
    const existingMaxSortOrder = existingCells.reduce((max, c) => Math.max(max, c.sortOrder), -1);
    const existingForThisAnimal = existingCells.find((c) => c.animalId === animal.animalId);
    const sortOrder = existingForThisAnimal ? existingForThisAnimal.sortOrder : existingMaxSortOrder + 1;

    // Hàng khác trong CÙNG style, giữ nguyên — TRỪ hàng đã svgAssetArchived
    // (loại hoàn toàn khỏi payload, không phải chỉ tắt: server
    // `putStyleAnimals` reject NGUYÊN mảng nếu bất kỳ svgAssetId nào trong đó
    // đã archive, đúng pattern đã kiểm chứng ở `PriceMatrixSection`/fix c4898c8).
    const otherRows: StyleAnimalPutItem[] = existingCells
      .filter((c) => c.animalId !== animal.animalId && !c.svgAssetArchived)
      .map((c) => ({
        animalId: c.animalId,
        svgAssetId: c.svgAssetId,
        displayLabel: c.displayLabel,
        description: c.description,
        defaultStitchId: c.defaultStitchId,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
      }));

    const thisRow: StyleAnimalPutItem = {
      animalId: animal.animalId,
      svgAssetId: svgAsset.id,
      displayLabel: displayLabel.trim() ? displayLabel.trim() : null,
      description: description.trim() ? description.trim() : null,
      defaultStitchId: defaultStitchId || null,
      isActive,
      sortOrder,
    };

    try {
      await mutation.mutate(`/api/admin/products/${productId}/styles/${style.styleId}/animals`, [...otherRows, thisRow]);
      onSaved();
      onClose();
    } catch {
      // mutation.error đã được set — banner bên dưới tự hiển thị, drawer ở lại mở.
    }
  }

  const leatherOptions = [NONE_OPTION, ...shopLeathers.map((l) => ({ label: l.name, value: l.id }))];
  const stitchSelectOptions = [
    NONE_OPTION,
    ...stitches.map((s) => ({ label: s.archived ? `${s.name} (đã archive)` : s.name, value: s.stitchId })),
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${style.name} × ${animal.name}`}
      primaryAction={{ content: "Lưu", onAction: handleSave, loading: mutation.loading }}
      secondaryActions={[{ content: "Huỷ", onAction: onClose }]}
    >
      <Modal.Section>
        <FormLayout>
          {cell?.svgAssetArchived && (
            <Tooltip content="Asset SVG này đã bị archive ở tab Attributes — lưu lại sẽ cần tải lên mockup mới, nếu không hàng này sẽ bị server từ chối.">
              <Badge tone="warning">Đã archive</Badge>
            </Tooltip>
          )}

          <AssetUploadField kind="SVG_MOCKUP" value={svgAsset} onChange={setSvgAsset} label="Tệp SVG mockup" disabled={mutation.loading} />

          <TextField
            label="Nhãn hiển thị"
            value={displayLabel}
            onChange={setDisplayLabel}
            autoComplete="off"
            disabled={mutation.loading}
          />
          <TextField
            label="Mô tả"
            value={description}
            onChange={setDescription}
            autoComplete="off"
            multiline={3}
            disabled={mutation.loading}
          />
          <Select
            label="Stitch mặc định"
            options={stitchSelectOptions}
            value={defaultStitchId}
            onChange={setDefaultStitchId}
            disabled={mutation.loading}
          />
          <Checkbox label="Đang hoạt động" checked={isActive} onChange={setIsActive} disabled={mutation.loading} />

          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Xem trước (svg-engine)
            </Text>
            <InlineStack gap="200">
              <Select label="Thử leather" options={leatherOptions} value={previewLeatherId} onChange={setPreviewLeatherId} />
              <Select label="Thử stitch" options={stitchSelectOptions} value={previewStitchId} onChange={setPreviewStitchId} />
            </InlineStack>
            {!svgAsset && <Text as="p">Chưa có mockup — tải lên SVG ở trên để xem trước.</Text>}
            {previewLoading && (
              <InlineStack gap="200" blockAlign="center">
                <Spinner size="small" accessibilityLabel="Đang tải preview" />
                <Text as="span">Đang tải preview…</Text>
              </InlineStack>
            )}
            {previewError && <AdminErrorBanner error={previewError} />}
            <div
              data-testid="svg-grid-preview"
              style={{ width: 200, height: 200, border: "1px solid var(--p-color-border)" }}
              // Preview HIỂN THỊ THÔI — nội dung đã qua sanitize lúc upload
              // (`POST /api/admin/assets`), không sanitize lại lần hai ở đây
              // (đúng hợp đồng brief Task 6: "display only").
              dangerouslySetInnerHTML={{ __html: previewMarkup }}
            />
          </BlockStack>

          {validationError && <AdminErrorBanner error={validationError} />}
          {mutation.error && <AdminErrorBanner error={mutation.error} />}
        </FormLayout>
      </Modal.Section>
    </Modal>
  );
}
