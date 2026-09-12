"use client";

import { useEffect, useState } from "react";
import { Checkbox, FormLayout, Modal, TextField } from "@shopify/polaris";
import { useAdminMutation } from "@/lib/admin-ui/useAdminMutation";
import { AdminErrorBanner } from "@/components/AdminErrorBanner";
import { AssetUploadField } from "./AssetUploadField";
import type { AssetDto } from "@/lib/admin/assets";
import type { AttributeDto, AttributeKind } from "@/lib/admin/attributes";

/**
 * Bốn nhóm attribute dùng CHUNG list+drawer, khác nhau ở field nào hiển thị
 * (spec §12.1). `src/lib/admin/attributes.ts` có `KIND_CONFIG` y hệt nhưng
 * không export nó (chỉ export `AttributeKind`/`AttributeDto`/`attributeHandlers`)
 * — bảng dưới đây là bản client-side, PHẢI sửa cùng lúc nếu `KIND_CONFIG` bên
 * server đổi. `displayRequired`/`hasTexture`/`hasColor` khớp đúng tên và giá
 * trị của `KIND_CONFIG` bên đó.
 */
export interface AttributeFieldConfig {
  /** Có field ảnh hiển thị không (cả bốn nhóm đều có). */
  hasDisplayImage: boolean;
  /** Ảnh hiển thị bắt buộc lúc tạo mới? (stitches: không). */
  displayRequired: boolean;
  /** Có field ảnh texture không (chỉ leathers). */
  hasTexture: boolean;
  /** Có field mã màu hex không (chỉ stitches). */
  hasColor: boolean;
}

export const ATTRIBUTE_FIELD_CONFIG: Record<AttributeKind, AttributeFieldConfig> = {
  leathers: { hasDisplayImage: true, displayRequired: true, hasTexture: true, hasColor: false },
  stitches: { hasDisplayImage: true, displayRequired: false, hasTexture: false, hasColor: true },
  animals: { hasDisplayImage: true, displayRequired: true, hasTexture: false, hasColor: false },
  styles: { hasDisplayImage: true, displayRequired: true, hasTexture: false, hasColor: false },
};

export const ATTRIBUTE_KIND_LABELS: Record<AttributeKind, string> = {
  leathers: "da (leather)",
  stitches: "chỉ may (stitch)",
  animals: "loài vật (animal)",
  styles: "kiểu dáng (style)",
};

/**
 * `AttributeDto.displayImage`/`textureImage` chỉ mang `{assetId, url}` —
 * không đủ hình `AssetDto` mà `AssetUploadField` cần để hiển thị thumbnail.
 * Component chỉ đọc `publicUrl`/`originalFilename` lúc render (xem
 * `AssetUploadField.tsx`), nên phần còn lại chỉ cần khớp KIỂU, không cần
 * đúng giá trị thật — dựng một `AssetDto` tối thiểu từ ref đã có.
 */
function assetDtoFromRef(ref: { assetId: string; url: string } | null | undefined, kind: "DISPLAY" | "TEXTURE"): AssetDto | null {
  if (!ref) return null;
  return {
    id: ref.assetId,
    kind,
    publicUrl: ref.url,
    mimeType: "",
    byteSize: 0,
    width: null,
    height: null,
    originalFilename: ref.url.split("/").pop() || ref.assetId,
    createdAt: "",
  };
}

export interface AttributeDrawerProps {
  kind: AttributeKind;
  /** `null` mở drawer ở chế độ tạo mới; khác `null` là sửa, prefill từ item. */
  item: AttributeDto | null;
  open: boolean;
  onClose: () => void;
  /** Gọi với DTO trả về từ chính response create/update — caller cập nhật
   * danh sách từ đây, KHÔNG tự refetch (Global Constraints P2c). */
  onSaved: (dto: AttributeDto) => void;
}

export function AttributeDrawer({ kind, item, open, onClose, onSaved }: AttributeDrawerProps) {
  const config = ATTRIBUTE_FIELD_CONFIG[kind];
  const isEdit = item !== null;

  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [displayImage, setDisplayImage] = useState<AssetDto | null>(null);
  const [textureImage, setTextureImage] = useState<AssetDto | null>(null);
  const [colorHex, setColorHex] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const createMutation = useAdminMutation<Record<string, unknown>, AttributeDto>("POST");
  const patchMutation = useAdminMutation<Record<string, unknown>, AttributeDto>("PATCH");
  const mutation = isEdit ? patchMutation : createMutation;

  // Nạp lại field mỗi lần drawer MỞ (không phải mỗi lần `item` đổi tham chiếu
  // trong lúc đang mở — tránh field bị reset giữa chừng lúc người dùng gõ nếu
  // caller re-render với cùng item).
  useEffect(() => {
    if (!open) return;
    setValidationError(null);
    if (item) {
      setName(item.name);
      setIsActive(item.isActive);
      setDisplayImage(assetDtoFromRef(item.displayImage, "DISPLAY"));
      setTextureImage(assetDtoFromRef(item.textureImage ?? null, "TEXTURE"));
      setColorHex(item.colorHex ?? "");
    } else {
      setName("");
      setIsActive(true);
      setDisplayImage(null);
      setTextureImage(null);
      setColorHex("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  function validate(): string | null {
    if (!name.trim()) return "Tên là bắt buộc.";
    if (config.displayRequired && !displayImage) return "Ảnh hiển thị là bắt buộc.";
    if (config.hasTexture && !textureImage) return "Ảnh texture là bắt buộc.";
    if (config.hasColor && !colorHex.trim()) return "Mã màu là bắt buộc.";
    return null;
  }

  async function handleSubmit(): Promise<void> {
    const err = validate();
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);

    const body: Record<string, unknown> = { name: name.trim(), isActive };
    if (config.hasDisplayImage && displayImage) body.displayImageAssetId = displayImage.id;
    if (config.hasTexture && textureImage) body.textureImageAssetId = textureImage.id;
    if (config.hasColor) body.colorHex = colorHex.trim();

    const path = isEdit ? `/api/admin/${kind}/${item!.id}` : `/api/admin/${kind}`;
    try {
      const result = await mutation.mutate(path, body);
      onSaved(result);
      onClose();
    } catch {
      // `mutation.error` đã được hook set — banner bên dưới tự hiển thị,
      // không cần làm gì thêm ở đây (drawer ở lại mở để người dùng sửa).
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Sửa ${item!.name}` : `Thêm ${ATTRIBUTE_KIND_LABELS[kind]} mới`}
      primaryAction={{ content: "Lưu", onAction: handleSubmit, loading: mutation.loading }}
      secondaryActions={[{ content: "Huỷ", onAction: onClose }]}
    >
      <Modal.Section>
        <FormLayout>
          <TextField
            label="Tên"
            value={name}
            onChange={setName}
            autoComplete="off"
            requiredIndicator
            disabled={mutation.loading}
          />
          {config.hasDisplayImage && (
            <AssetUploadField
              kind="DISPLAY"
              value={displayImage}
              onChange={setDisplayImage}
              label="Ảnh hiển thị"
              disabled={mutation.loading}
            />
          )}
          {config.hasTexture && (
            <AssetUploadField
              kind="TEXTURE"
              value={textureImage}
              onChange={setTextureImage}
              label="Ảnh texture"
              disabled={mutation.loading}
            />
          )}
          {config.hasColor && (
            <TextField
              label="Mã màu (hex)"
              value={colorHex}
              onChange={setColorHex}
              autoComplete="off"
              placeholder="#RRGGBB"
              disabled={mutation.loading}
            />
          )}
          <Checkbox label="Đang hoạt động" checked={isActive} onChange={setIsActive} disabled={mutation.loading} />
          {validationError && <AdminErrorBanner error={validationError} />}
          {mutation.error && <AdminErrorBanner error={mutation.error} />}
        </FormLayout>
      </Modal.Section>
    </Modal>
  );
}
