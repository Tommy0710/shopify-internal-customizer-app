import type { AssetDto } from "@/lib/admin/assets";
import type { AttributeDto, AttributeKind } from "@/lib/admin/attributes";
import type { MockAdminFetchResponse } from "@/lib/admin-ui/testFetch";

/**
 * Fixture dùng chung cho `AttributeList.test.tsx` và `AttributeDrawer.test.tsx`
 * — cả hai file chạy MỘT spec cho cả bốn nhóm attribute (`it.each`), nên cần
 * cùng một cách dựng `AttributeDto`/`AssetDto`/đường dẫn thay vì mỗi file tự
 * chép lại (tiền lệ: `tests/helpers/renderWithPolaris.tsx`, `svgDom.ts`).
 */
export const ATTRIBUTE_KINDS: readonly AttributeKind[] = ["leathers", "stitches", "animals", "styles"] as const;

export const ATTRIBUTE_PATH: Record<AttributeKind, string> = {
  leathers: "/api/admin/leathers",
  stitches: "/api/admin/stitches",
  animals: "/api/admin/animals",
  styles: "/api/admin/styles",
};

export function makeAttribute(kind: AttributeKind, overrides: Partial<AttributeDto> = {}): AttributeDto {
  const dto: AttributeDto = {
    id: overrides.id ?? "attr-1",
    name: overrides.name ?? "Attr 1",
    slug: overrides.slug ?? "attr-1",
    isActive: overrides.isActive ?? true,
    sortOrder: overrides.sortOrder ?? 0,
    archivedAt: overrides.archivedAt ?? null,
    displayImage:
      overrides.displayImage !== undefined
        ? overrides.displayImage
        : { assetId: "asset-display-1", url: "https://cdn.test/display-1.png" },
  };
  if (kind === "leathers") {
    dto.textureImage =
      overrides.textureImage !== undefined
        ? overrides.textureImage
        : { assetId: "asset-texture-1", url: "https://cdn.test/texture-1.png" };
  }
  if (kind === "stitches") {
    dto.colorHex = overrides.colorHex !== undefined ? overrides.colorHex : "#112233";
  }
  return dto;
}

export function makeAsset(kind: "DISPLAY" | "TEXTURE", overrides: Partial<AssetDto> = {}): AssetDto {
  return {
    id: overrides.id ?? `asset-${kind.toLowerCase()}-new`,
    kind,
    publicUrl: overrides.publicUrl ?? `https://cdn.test/${kind.toLowerCase()}-new.png`,
    mimeType: "image/png",
    byteSize: 100,
    width: 10,
    height: 10,
    originalFilename: overrides.originalFilename ?? `${kind.toLowerCase()}-new.png`,
    createdAt: "2026-09-11T00:00:00.000Z",
  };
}

export function uploadAssetResponse(kind: "DISPLAY" | "TEXTURE", overrides: Partial<AssetDto> = {}): MockAdminFetchResponse {
  return { status: 201, body: { asset: makeAsset(kind, overrides), created: true } };
}

export function pngFile(name: string): File {
  return new File(["\x89PNG"], name, { type: "image/png" });
}
