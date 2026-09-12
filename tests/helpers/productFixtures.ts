import type {
  AnimalTreeDto,
  PriceCellDto,
  PriceCellVariantDto,
  ProductHostDto,
  ProductSummaryDto,
  ProductTreeDto,
  StitchTreeDto,
  StyleAnimalCellDto,
  StyleTreeDto,
} from "@/lib/admin/products";
import type { ReadinessProblem } from "@/lib/admin/readiness";
import type { AttributeDto } from "@/lib/admin/attributes";

/**
 * Fixture dùng chung cho mọi test tab Products (Task 4-5) —
 * `ProductsTab.test.tsx`, `HostsSection.test.tsx`, `RelationChecklist.test.tsx`,
 * `ReadinessBanner.test.tsx`, `PriceMatrixSection.test.tsx` — cùng tiền lệ
 * `attributeFixtures.ts` của Task 3.
 */

export function makeProductSummary(overrides: Partial<ProductSummaryDto> = {}): ProductSummaryDto {
  return {
    id: overrides.id ?? "prod-1",
    name: overrides.name ?? "Wallet A",
    isEnabled: overrides.isEnabled ?? false,
  };
}

export function makeHost(overrides: Partial<ProductHostDto> = {}): ProductHostDto {
  return {
    id: overrides.id ?? "host-1",
    shopifyProductId: overrides.shopifyProductId ?? "111",
    shopifyProductGid: overrides.shopifyProductGid ?? "gid://shopify/Product/111",
    handleSnapshot: overrides.handleSnapshot ?? null,
    titleSnapshot: overrides.titleSnapshot ?? null,
    preselectStyleId: overrides.preselectStyleId ?? null,
    isPrimary: overrides.isPrimary ?? true,
    syncedAt: overrides.syncedAt ?? null,
  };
}

export function makeProblem(overrides: Partial<ReadinessProblem> = {}): ReadinessProblem {
  return {
    code: overrides.code ?? "NO_HOST",
    message: overrides.message ?? "Product chưa gắn trang Shopify nào",
    path: overrides.path ?? ["hosts"],
  };
}

export function makeReadiness(problems: ReadinessProblem[] = []): ProductTreeDto["readiness"] {
  return { ready: problems.length === 0, problems };
}

export function makeStyleRelation(overrides: Partial<StyleTreeDto> = {}): StyleTreeDto {
  return {
    styleId: overrides.styleId ?? "style-1",
    name: overrides.name ?? "Bifold",
    isActive: overrides.isActive ?? true,
    sortOrder: overrides.sortOrder ?? 0,
    archived: overrides.archived ?? false,
    leathers: overrides.leathers ?? [],
    animals: overrides.animals ?? [],
  };
}

export function makeAnimalRelation(overrides: Partial<AnimalTreeDto> = {}): AnimalTreeDto {
  return {
    animalId: overrides.animalId ?? "animal-1",
    name: overrides.name ?? "Alligator",
    isActive: overrides.isActive ?? true,
    sortOrder: overrides.sortOrder ?? 0,
    archived: overrides.archived ?? false,
    leathers: overrides.leathers ?? [],
  };
}

export function makeStitchRelation(overrides: Partial<StitchTreeDto> = {}): StitchTreeDto {
  return {
    stitchId: overrides.stitchId ?? "stitch-1",
    name: overrides.name ?? "Saddle",
    colorHex: overrides.colorHex ?? "#112233",
    isActive: overrides.isActive ?? true,
    sortOrder: overrides.sortOrder ?? 0,
    archived: overrides.archived ?? false,
  };
}

export function makeProductTree(overrides: Partial<ProductTreeDto> = {}): ProductTreeDto {
  return {
    id: overrides.id ?? "prod-1",
    name: overrides.name ?? "Wallet A",
    isEnabled: overrides.isEnabled ?? false,
    createdAt: overrides.createdAt ?? "2026-09-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-09-01T00:00:00.000Z",
    hosts: overrides.hosts ?? [],
    styles: overrides.styles ?? [],
    animals: overrides.animals ?? [],
    stitches: overrides.stitches ?? [],
    readiness: overrides.readiness ?? makeReadiness([makeProblem()]),
  };
}

/** Attribute rời (shop-wide), dùng làm nguồn checklist của `RelationChecklist`
 * và nguồn hàng của `PriceMatrixSection` (leathers). */
export function makeRelationAttribute(overrides: Partial<AttributeDto> = {}): AttributeDto {
  const dto: AttributeDto = {
    id: overrides.id ?? "attr-1",
    name: overrides.name ?? "Attr 1",
    slug: overrides.slug ?? "attr-1",
    isActive: overrides.isActive ?? true,
    sortOrder: overrides.sortOrder ?? 0,
    archivedAt: overrides.archivedAt ?? null,
    displayImage: overrides.displayImage !== undefined ? overrides.displayImage : null,
  };
  // `textureImage`/`colorHex` chỉ có ý nghĩa cho leathers/stitches (Task 6's
  // `SvgGridDrawer` cần `textureImage.url` để xem trước leather qua
  // `applyTexture`) — thêm THÔ, không suy luận `kind` (caller tự biết mình
  // đang dựng leather hay stitch, giống `makeAttribute` của attributeFixtures.ts).
  if (overrides.textureImage !== undefined) dto.textureImage = overrides.textureImage;
  if (overrides.colorHex !== undefined) dto.colorHex = overrides.colorHex;
  return dto;
}

/** Cột trạng thái variant trong một ô giá — `PriceMatrixSection`, Task 5. */
export function makePriceCellVariant(overrides: Partial<PriceCellVariantDto> = {}): PriceCellVariantDto {
  return {
    shopifyProductId: overrides.shopifyProductId ?? "999",
    shopifyVariantId: overrides.shopifyVariantId ?? "44920001",
    priceSnapshot: overrides.priceSnapshot !== undefined ? overrides.priceSnapshot : null,
    missing: overrides.missing ?? false,
    syncedAt: overrides.syncedAt !== undefined ? overrides.syncedAt : null,
  };
}

/** Một ô của ma trận giá style×leather / animal×leather — `PriceMatrixSection`, Task 5. */
export function makePriceCell(overrides: Partial<PriceCellDto> = {}): PriceCellDto {
  return {
    leatherId: overrides.leatherId ?? "leather-1",
    name: overrides.name ?? "Suede Brown",
    price: overrides.price !== undefined ? overrides.price : "80.00",
    isActive: overrides.isActive ?? true,
    sortOrder: overrides.sortOrder ?? 0,
    archived: overrides.archived ?? false,
    variant: overrides.variant !== undefined ? overrides.variant : null,
  };
}

/** Một ô của lưới SVG mockup style×animal — `SvgGridSection`/`SvgGridDrawer`, Task 6. */
export function makeStyleAnimalCell(overrides: Partial<StyleAnimalCellDto> = {}): StyleAnimalCellDto {
  return {
    animalId: overrides.animalId ?? "animal-1",
    name: overrides.name ?? "Alligator",
    svgAssetId: overrides.svgAssetId ?? "asset-svg-1",
    svgUrl: overrides.svgUrl ?? "https://cdn.test/mockup-1.svg",
    svgAssetArchived: overrides.svgAssetArchived ?? false,
    displayLabel: overrides.displayLabel !== undefined ? overrides.displayLabel : null,
    description: overrides.description !== undefined ? overrides.description : null,
    defaultStitchId: overrides.defaultStitchId !== undefined ? overrides.defaultStitchId : null,
    defaultStitchArchived: overrides.defaultStitchArchived ?? false,
    isActive: overrides.isActive ?? true,
    sortOrder: overrides.sortOrder ?? 0,
  };
}

/** SVG hợp lệ tối thiểu cho preview (Task 6) — đủ hai artwork target
 * (`body-artwork`, `animal-artwork`) cho `applyTexture` và root cho
 * `applyStitchColor`, KHÔNG cần thoả toàn bộ `REQUIRED_ELEMENTS` (đây là
 * preview hiển thị, không đi qua `validateSvgContract`). Thuộc tính XML viết
 * đầy đủ giá trị (`hidden=""` không phải `hidden` trần) — DOMParser của jsdom
 * (và trình duyệt) ném `parsererror` với boolean attribute XML kiểu HTML.
 */
export function makeMockupSvgText(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<image id="body-artwork" hidden="" visibility="hidden"/>` +
    `<image id="animal-artwork" hidden="" visibility="hidden"/>` +
    `<g id="stitches" style=""></g>` +
    `</svg>`
  );
}
