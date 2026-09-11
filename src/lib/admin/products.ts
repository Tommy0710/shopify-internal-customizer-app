import { z } from "zod";
import type { NextRequest } from "next/server";
import { Prisma, type CustomizableProduct } from "@prisma/client";
import { db } from "@/lib/db";
import { conflict, notFound, parseJson, validationFailed, type FieldError } from "./http";
import type { AdminApiContext } from "./adminApi";
import { diffByKey, duplicateKeys } from "./diff";
import { formatPrice, priceSchema } from "./money";
import { productReadiness, type ReadinessProblem } from "./readiness";

/**
 * Nửa đầu tab Products (spec §12.2): tạo cấu hình product, gắn host (trang
 * Shopify), chọn style/animal/stitch nào tham gia. Ma trận giá và lưới SVG
 * (Style × Animal) là Task 6 — `ProductTreeDto` ở đây là hình cơ bản, Task 6
 * mở rộng thêm `styleLeathers`/`animalLeathers`/`svg` vào từng phần tử.
 */

type Tx = Prisma.TransactionClient;

// ── DTO ──────────────────────────────────────────────────────────────────

export interface ProductSummaryDto {
  id: string;
  name: string;
  isEnabled: boolean;
}

export interface ProductHostDto {
  id: string;
  shopifyProductId: string;
  shopifyProductGid: string;
  handleSnapshot: string | null;
  titleSnapshot: string | null;
  preselectStyleId: string | null;
  isPrimary: boolean;
  syncedAt: string | null;
}

export interface ProductRelationDto {
  id: string;
  isActive: boolean;
  sortOrder: number;
  name: string;
  [key: string]: unknown; // styleId | animalId | stitchId, tuỳ `kind`
}

// ── DTO của Task 6: ma trận giá, lưới SVG, cây đầy đủ ──────────────────────

/** P2b chưa tồn tại — `variant` luôn `null` cho tới khi variant sync ghi các cột này. */
export interface PriceCellVariantDto {
  shopifyProductId: string;
  shopifyVariantId: string;
  priceSnapshot: string | null;
  missing: boolean;
  syncedAt: string | null;
}

export interface PriceCellDto {
  leatherId: string;
  name: string;
  price: string | null;
  isActive: boolean;
  sortOrder: number;
  archived: boolean;
  variant: PriceCellVariantDto | null;
}

export interface StyleAnimalCellDto {
  animalId: string;
  name: string;
  svgAssetId: string;
  svgUrl: string;
  displayLabel: string | null;
  description: string | null;
  defaultStitchId: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface StyleTreeDto {
  styleId: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  archived: boolean;
  leathers: PriceCellDto[];
  animals: StyleAnimalCellDto[];
}

export interface AnimalTreeDto {
  animalId: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  archived: boolean;
  leathers: PriceCellDto[];
}

export interface StitchTreeDto {
  stitchId: string;
  name: string;
  colorHex: string;
  isActive: boolean;
  sortOrder: number;
  archived: boolean;
}

/**
 * `GET /products/:id` — Task 5 dựng hình cơ bản (flat, bốn nhánh quan hệ
 * "phẳng"); Task 6 mở rộng thêm `createdAt`/`updatedAt` và làm giàu từng
 * phần tử quan hệ (`leathers`/`animals` lồng bên trong, `archived`), cộng
 * `readiness`. Không lồng dưới khoá `"product"` — giữ đúng quy ước phẳng đã
 * có từ Task 5 (`ProductSummaryDto`), tránh phá vỡ hợp đồng đã merge.
 */
export interface ProductTreeDto extends ProductSummaryDto {
  createdAt: string;
  updatedAt: string;
  hosts: ProductHostDto[];
  styles: StyleTreeDto[];
  animals: AnimalTreeDto[];
  stitches: StitchTreeDto[];
  readiness: { ready: boolean; problems: ReadinessProblem[] };
}

function toProductSummaryDto(row: CustomizableProduct): ProductSummaryDto {
  return { id: row.id, name: row.name, isEnabled: row.isEnabled };
}

function toHostDto(row: {
  id: string;
  shopifyProductId: string;
  shopifyProductGid: string;
  handleSnapshot: string | null;
  titleSnapshot: string | null;
  preselectStyleId: string | null;
  isPrimary: boolean;
  syncedAt: Date | null;
}): ProductHostDto {
  return {
    id: row.id,
    shopifyProductId: row.shopifyProductId,
    shopifyProductGid: row.shopifyProductGid,
    handleSnapshot: row.handleSnapshot,
    titleSnapshot: row.titleSnapshot,
    preselectStyleId: row.preselectStyleId,
    isPrimary: row.isPrimary,
    syncedAt: row.syncedAt ? row.syncedAt.toISOString() : null,
  };
}

// ── Task 6: row → DTO cho ma trận giá / lưới SVG / cây đầy đủ ─────────────

/** Có `shopifyVariantId` mới coi là "đã có variant" — P2b ghi các cột này, hôm nay luôn null. */
function toPriceCellVariantDto(row: {
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  variantPriceSnapshot: Prisma.Decimal | null;
  variantMissing: boolean;
  variantSyncedAt: Date | null;
}): PriceCellVariantDto | null {
  if (!row.shopifyVariantId) return null;
  return {
    shopifyProductId: row.shopifyProductId ?? "",
    shopifyVariantId: row.shopifyVariantId,
    priceSnapshot: formatPrice(row.variantPriceSnapshot),
    missing: row.variantMissing,
    syncedAt: row.variantSyncedAt ? row.variantSyncedAt.toISOString() : null,
  };
}

function toPriceCellDto(row: {
  leatherId: string;
  leather: { name: string; archivedAt: Date | null };
  priceInput: Prisma.Decimal | null;
  isActive: boolean;
  sortOrder: number;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  variantPriceSnapshot: Prisma.Decimal | null;
  variantMissing: boolean;
  variantSyncedAt: Date | null;
}): PriceCellDto {
  return {
    leatherId: row.leatherId,
    name: row.leather.name,
    price: formatPrice(row.priceInput),
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    archived: row.leather.archivedAt != null,
    variant: toPriceCellVariantDto(row),
  };
}

function toStyleAnimalCellDto(row: {
  animalId: string;
  animal: { name: string };
  svgAssetId: string;
  svgAsset: { publicUrl: string };
  displayLabel: string | null;
  description: string | null;
  defaultStitchId: string | null;
  isActive: boolean;
  sortOrder: number;
}): StyleAnimalCellDto {
  return {
    animalId: row.animalId,
    name: row.animal.name,
    svgAssetId: row.svgAssetId,
    svgUrl: row.svgAsset.publicUrl,
    displayLabel: row.displayLabel,
    description: row.description,
    defaultStitchId: row.defaultStitchId,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

function toStyleTreeDto(row: {
  styleId: string;
  style: { name: string; archivedAt: Date | null };
  isActive: boolean;
  sortOrder: number;
  styleLeathers: Parameters<typeof toPriceCellDto>[0][];
  styleAnimals: Parameters<typeof toStyleAnimalCellDto>[0][];
}): StyleTreeDto {
  return {
    styleId: row.styleId,
    name: row.style.name,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    archived: row.style.archivedAt != null,
    leathers: row.styleLeathers.map(toPriceCellDto),
    animals: row.styleAnimals.map(toStyleAnimalCellDto),
  };
}

function toAnimalTreeDto(row: {
  animalId: string;
  animal: { name: string; archivedAt: Date | null };
  isActive: boolean;
  sortOrder: number;
  animalLeathers: Parameters<typeof toPriceCellDto>[0][];
}): AnimalTreeDto {
  return {
    animalId: row.animalId,
    name: row.animal.name,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    archived: row.animal.archivedAt != null,
    leathers: row.animalLeathers.map(toPriceCellDto),
  };
}

function toStitchTreeDto(row: {
  stitchId: string;
  stitch: { name: string; colorHex: string; archivedAt: Date | null };
  isActive: boolean;
  sortOrder: number;
}): StitchTreeDto {
  return {
    stitchId: row.stitchId,
    name: row.stitch.name,
    colorHex: row.stitch.colorHex,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    archived: row.stitch.archivedAt != null,
  };
}

/**
 * Dựng cây đầy đủ bằng SỐ QUERY CỐ ĐỊNH: một `findMany` mỗi bảng quan hệ cấp
 * một (host/style/animal/stitch), lồng `include` cho các bảng con — Prisma
 * gộp include thành lời gọi theo BẢNG chứ không lặp theo hàng cha, nên số
 * lời gọi không phụ thuộc kích thước ma trận (10×10 hay 1×1 đều cùng một số
 * lời gọi). `tests-db/admin/product-matrices.db.test.ts` spy trực tiếp trên
 * các delegate để khẳng định điều này thay vì đọc log SQL của Prisma (client
 * hiện chỉ log "error", xem `src/lib/db.ts`).
 */
export async function buildProductTree(tx: Tx, product: CustomizableProduct): Promise<ProductTreeDto> {
  const [hosts, styles, animals, stitches] = await Promise.all([
    tx.productHost.findMany({
      where: { productId: product.id },
      orderBy: [{ isPrimary: "desc" }, { shopifyProductId: "asc" }],
    }),
    tx.productStyle.findMany({
      where: { productId: product.id },
      include: {
        style: true,
        styleLeathers: { include: { leather: true }, orderBy: { sortOrder: "asc" } },
        styleAnimals: { include: { animal: true, svgAsset: true }, orderBy: { sortOrder: "asc" } },
      },
      orderBy: { sortOrder: "asc" },
    }),
    tx.productAnimal.findMany({
      where: { productId: product.id },
      include: {
        animal: true,
        animalLeathers: { include: { leather: true }, orderBy: { sortOrder: "asc" } },
      },
      orderBy: { sortOrder: "asc" },
    }),
    tx.productStitch.findMany({
      where: { productId: product.id },
      include: { stitch: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const styleDtos = styles.map(toStyleTreeDto);
  const animalDtos = animals.map(toAnimalTreeDto);
  const stitchDtos = stitches.map(toStitchTreeDto);
  const readiness = productReadiness({ hosts, styles: styleDtos, animals: animalDtos, stitches: stitchDtos });

  return {
    ...toProductSummaryDto(product),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    hosts: hosts.map(toHostDto),
    styles: styleDtos,
    animals: animalDtos,
    stitches: stitchDtos,
    readiness,
  };
}

// ── loadProductForShop — MỌI handler có :id gọi hàm này ĐẦU TIÊN ──────────
// ProductStyle/ProductAnimal/ProductStitch không có cột shopId — id sai shop
// và id không tồn tại phải cho CÙNG một 404, không được phân biệt được từ
// response (không tiết lộ sự tồn tại của product thuộc shop khác).
export async function loadProductForShop(tx: Tx, shopId: string, productId: string): Promise<CustomizableProduct> {
  const product = await tx.customizableProduct.findFirst({ where: { id: productId, shopId } });
  if (!product) notFound();
  return product;
}

// ── Product: list / create / get / update ─────────────────────────────────

const createProductSchema = z.object({
  name: z.string().trim().min(1, "name là bắt buộc").max(120, "name tối đa 120 ký tự"),
});
const updateProductSchema = z.object({
  name: z.string().trim().min(1, "name là bắt buộc").max(120, "name tối đa 120 ký tự").optional(),
  isEnabled: z.boolean().optional(),
});

async function listHandler(_req: NextRequest, ctx: AdminApiContext): Promise<Response> {
  const rows = await db.customizableProduct.findMany({
    where: { shopId: ctx.shop.id, archivedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ items: rows.map(toProductSummaryDto) });
}

async function createHandler(req: NextRequest, ctx: AdminApiContext): Promise<Response> {
  const body = await parseJson(req, createProductSchema);
  const created = await db.customizableProduct.create({ data: { shopId: ctx.shop.id, name: body.name } });
  return Response.json(toProductSummaryDto(created), { status: 201 });
}

async function getHandler(_req: NextRequest, ctx: AdminApiContext<{ id: string }>): Promise<Response> {
  const product = await loadProductForShop(db, ctx.shop.id, ctx.params.id);
  const tree = await buildProductTree(db, product);
  return Response.json(tree);
}

/**
 * `isEnabled: true` bị chặn 409 nếu `readiness.ready` sai — phải dựng LẠI cây
 * (không tin `isEnabled` cũ trong DB) để readiness luôn được tính trên trạng
 * thái mới nhất. `isEnabled: false` (tắt khẩn cấp) không bao giờ bị chặn —
 * kiểm tra chỉ chạy khi request THỰC SỰ xin bật lên `true`.
 */
async function updateHandler(req: NextRequest, ctx: AdminApiContext<{ id: string }>): Promise<Response> {
  const body = await parseJson(req, updateProductSchema);
  const product = await loadProductForShop(db, ctx.shop.id, ctx.params.id);

  if (body.isEnabled === true) {
    const tree = await buildProductTree(db, product);
    if (!tree.readiness.ready) {
      conflict("NOT_READY", { problems: tree.readiness.problems });
    }
  }

  const updated = await db.customizableProduct.update({
    where: { id: product.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
    },
  });
  return Response.json(toProductSummaryDto(updated));
}

// ── Host — ★ ngoại lệ duy nhất của R4: vắng mặt = XOÁ, không phải vô hiệu ──

const hostItemSchema = z.object({
  shopifyProductId: z.string().regex(/^\d+$/, "shopifyProductId phải là chuỗi chữ số"),
  preselectStyleId: z.string().min(1).optional(),
  isPrimary: z.boolean(),
});
const hostListSchema = z.array(hostItemSchema);
type HostItem = z.infer<typeof hostItemSchema>;

interface HostRow {
  id: string;
  productId: string;
  shopifyProductId: string;
  preselectStyleId: string | null;
  isPrimary: boolean;
}

export async function putHosts(req: NextRequest, ctx: AdminApiContext<{ id: string }>): Promise<Response> {
  const desired = await parseJson(req, hostListSchema);

  const dupes = duplicateKeys(desired, (d) => d.shopifyProductId);
  if (dupes.length) {
    validationFailed(
      dupes.map((id) => ({
        field: "shopifyProductId",
        code: "duplicate",
        message: `shopifyProductId ${id} xuất hiện hơn một lần`,
      })),
    );
  }
  if (desired.filter((d) => d.isPrimary).length > 1) {
    validationFailed([{ field: "isPrimary", code: "multiple_primary", message: "chỉ được một host isPrimary" }]);
  }

  const rows = await db.$transaction(async (tx) => {
    const product = await loadProductForShop(tx, ctx.shop.id, ctx.params.id);

    // preselectStyleId phải là style có ProductStyle ACTIVE trong product này.
    const activeStyles = await tx.productStyle.findMany({
      where: { productId: product.id, isActive: true },
      select: { styleId: true },
    });
    const activeStyleIds = new Set(activeStyles.map((r) => r.styleId));
    const refErrors: FieldError[] = [];
    desired.forEach((d, index) => {
      if (d.preselectStyleId && !activeStyleIds.has(d.preselectStyleId)) {
        refErrors.push({
          field: `${index}.preselectStyleId`,
          code: "invalid_reference",
          message: "preselectStyleId không hợp lệ",
        });
      }
    });
    if (refErrors.length) validationFailed(refErrors);

    // Một trang Shopify chỉ thuộc một customizer (spec §7, ràng buộc ★) —
    // kiểm TRƯỚC khi ghi bất cứ gì, cho toàn bộ danh sách.
    for (const d of desired) {
      const takenBy = await tx.productHost.findFirst({
        where: { shopId: ctx.shop.id, shopifyProductId: d.shopifyProductId, productId: { not: product.id } },
      });
      if (takenBy) conflict("HOST_TAKEN", { shopifyProductId: d.shopifyProductId, productId: takenBy.productId });
    }

    const existing: HostRow[] = await tx.productHost.findMany({ where: { productId: product.id } });
    const { toCreate, toUpdate, missing } = diffByKey<HostItem, HostRow>(
      desired,
      existing,
      (d) => d.shopifyProductId,
      (e) => e.shopifyProductId,
    );

    for (const d of toCreate) {
      await tx.productHost.create({
        data: {
          shopId: ctx.shop.id,
          productId: product.id,
          shopifyProductId: d.shopifyProductId,
          shopifyProductGid: `gid://shopify/Product/${d.shopifyProductId}`,
          preselectStyleId: d.preselectStyleId ?? null,
          isPrimary: d.isPrimary,
        },
      });
    }
    for (const pair of toUpdate) {
      await tx.productHost.update({
        where: { id: pair.existing.id },
        data: { preselectStyleId: pair.desired.preselectStyleId ?? null, isPrimary: pair.desired.isPrimary },
      });
    }
    if (missing.length) {
      await tx.productHost.deleteMany({ where: { id: { in: missing.map((m) => m.id) } } });
    }

    return tx.productHost.findMany({
      where: { productId: product.id },
      orderBy: [{ isPrimary: "desc" }, { shopifyProductId: "asc" }],
    });
  });

  return Response.json(rows.map(toHostDto));
}

// ── Style / Animal / Stitch — cùng một khuôn, khác khoá ────────────────────
// R4: phần tử vắng mặt khỏi danh sách → isActive = false, hàng VẪN CÒN. Đưa
// lại một phần tử đã tắt → bật lại, tái dùng đúng hàng đó (diffByKey khớp
// theo khoá bất kể isActive hiện tại là gì, vì `existing` không lọc isActive).

type RelationKind = "style" | "animal" | "stitch";

const RELATION_KEY_FIELD: Record<RelationKind, string> = {
  style: "styleId",
  animal: "animalId",
  stitch: "stitchId",
};

interface RelationItem {
  isActive: boolean;
  sortOrder: number;
  [key: string]: unknown;
}

interface RelationRow {
  id: string;
  isActive: boolean;
  sortOrder: number;
  [key: string]: unknown;
}

function relationListSchema(keyField: string): z.ZodType<RelationItem[]> {
  return z.array(
    z.object({
      [keyField]: z.string().min(1, `${keyField} là bắt buộc`),
      isActive: z.boolean(),
      sortOrder: z.number().int().min(0),
    }),
  ) as unknown as z.ZodType<RelationItem[]>;
}

interface RelationDelegate {
  findMany(args: unknown): Prisma.PrismaPromise<RelationRow[]>;
  create(args: unknown): Prisma.PrismaPromise<RelationRow>;
  update(args: unknown): Prisma.PrismaPromise<RelationRow>;
  updateMany(args: unknown): Prisma.PrismaPromise<unknown>;
}

function relationDelegateFor(tx: Tx, kind: RelationKind): RelationDelegate {
  switch (kind) {
    case "style":
      return tx.productStyle as unknown as RelationDelegate;
    case "animal":
      return tx.productAnimal as unknown as RelationDelegate;
    case "stitch":
      return tx.productStitch as unknown as RelationDelegate;
  }
}

interface AttributeLookupDelegate {
  findMany(args: unknown): Prisma.PrismaPromise<Array<{ id: string }>>;
}

function attributeDelegateFor(tx: Tx, kind: RelationKind): AttributeLookupDelegate {
  switch (kind) {
    case "style":
      return tx.style as unknown as AttributeLookupDelegate;
    case "animal":
      return tx.animal as unknown as AttributeLookupDelegate;
    case "stitch":
      return tx.stitch as unknown as AttributeLookupDelegate;
  }
}

function toRelationDto(kind: RelationKind, keyField: string, row: RelationRow): ProductRelationDto {
  const attribute = row[kind] as { name: string };
  return {
    id: row.id,
    [keyField]: row[keyField],
    name: attribute.name,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

/**
 * id attribute phải thuộc shop này và chưa archived — kiểm MỘT LẦN cho toàn
 * bộ danh sách (một query) rồi báo lỗi theo VỊ TRÍ trong mảng, trước khi ghi
 * bất cứ gì: một phần tử cuối sai không được để lọt các phần tử trước đã ghi.
 */
async function assertRelationRefsValid(
  tx: Tx,
  kind: RelationKind,
  keyField: string,
  shopId: string,
  desired: RelationItem[],
): Promise<void> {
  const ids = desired.map((d) => d[keyField] as string);
  if (ids.length === 0) return;
  const rows = await attributeDelegateFor(tx, kind).findMany({
    where: { shopId, id: { in: ids }, archivedAt: null },
  });
  const validIds = new Set(rows.map((r) => r.id));
  const errors: FieldError[] = [];
  desired.forEach((d, index) => {
    if (!validIds.has(d[keyField] as string)) {
      errors.push({ field: `${index}.${keyField}`, code: "invalid_reference", message: `${keyField} không hợp lệ` });
    }
  });
  if (errors.length) validationFailed(errors);
}

async function putRelation(kind: RelationKind, req: NextRequest, ctx: AdminApiContext<{ id: string }>): Promise<Response> {
  const keyField = RELATION_KEY_FIELD[kind];
  const desired = await parseJson(req, relationListSchema(keyField));
  const keyOf = (d: RelationItem) => d[keyField] as string;

  const dupes = duplicateKeys(desired, keyOf);
  if (dupes.length) {
    validationFailed(dupes.map((id) => ({ field: keyField, code: "duplicate", message: `${keyField} ${id} xuất hiện hơn một lần` })));
  }

  const rows = await db.$transaction(async (tx) => {
    const product = await loadProductForShop(tx, ctx.shop.id, ctx.params.id);
    await assertRelationRefsValid(tx, kind, keyField, ctx.shop.id, desired);

    const delegate = relationDelegateFor(tx, kind);
    const existing = await delegate.findMany({ where: { productId: product.id } });
    const { toCreate, toUpdate, missing } = diffByKey<RelationItem, RelationRow>(desired, existing, keyOf, (e) => e[keyField] as string);

    for (const d of toCreate) {
      await delegate.create({ data: { productId: product.id, [keyField]: keyOf(d), isActive: d.isActive, sortOrder: d.sortOrder } });
    }
    for (const pair of toUpdate) {
      await delegate.update({ where: { id: pair.existing.id }, data: { isActive: pair.desired.isActive, sortOrder: pair.desired.sortOrder } });
    }
    if (missing.length) {
      await delegate.updateMany({ where: { id: { in: missing.map((m) => m.id) } }, data: { isActive: false } });
    }

    return delegate.findMany({ where: { productId: product.id }, include: { [kind]: true }, orderBy: { sortOrder: "asc" } });
  });

  return Response.json(rows.map((row) => toRelationDto(kind, keyField, row)));
}

// ── Ma trận giá A/B — style × leather, animal × leather ────────────────────
// R4 (như style/animal/stitch): vắng mặt khỏi danh sách → isActive=false,
// KHÔNG xoá. Khác với putRelation ở một điểm bắt buộc: update KHÔNG BAO GIỜ
// đụng `shopifyVariantId`/`shopifyVariantGid`/`variantPriceSnapshot`/
// `variantMissing` — các cột đó là của P2b (variant sync), route giá chỉ ghi
// `priceInput`/`isActive`/`sortOrder`.

type PriceMatrixKind = "styleLeather" | "animalLeather";

const priceCellItemSchema = z.object({
  leatherId: z.string().min(1, "leatherId là bắt buộc"),
  price: priceSchema.nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0),
});
const priceCellListSchema = z.array(priceCellItemSchema);
type PriceCellItem = z.infer<typeof priceCellItemSchema>;

interface PriceMatrixRow {
  id: string;
  leatherId: string;
  leather: { name: string; archivedAt: Date | null };
  priceInput: Prisma.Decimal | null;
  isActive: boolean;
  sortOrder: number;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  variantPriceSnapshot: Prisma.Decimal | null;
  variantMissing: boolean;
  variantSyncedAt: Date | null;
}

interface PriceMatrixDelegate {
  findMany(args: unknown): Prisma.PrismaPromise<PriceMatrixRow[]>;
  create(args: unknown): Prisma.PrismaPromise<PriceMatrixRow>;
  update(args: unknown): Prisma.PrismaPromise<PriceMatrixRow>;
  updateMany(args: unknown): Prisma.PrismaPromise<unknown>;
}

function priceMatrixDelegateFor(tx: Tx, kind: PriceMatrixKind): PriceMatrixDelegate {
  return kind === "styleLeather"
    ? (tx.productStyleLeather as unknown as PriceMatrixDelegate)
    : (tx.animalLeather as unknown as PriceMatrixDelegate);
}

/** leatherId phải thuộc shop này và chưa archived — cùng quy ước `assertRelationRefsValid`. */
async function assertLeatherRefsValid(tx: Tx, shopId: string, desired: PriceCellItem[]): Promise<void> {
  const ids = desired.map((d) => d.leatherId);
  if (ids.length === 0) return;
  const rows = await tx.leather.findMany({ where: { shopId, id: { in: ids }, archivedAt: null } });
  const validIds = new Set(rows.map((r) => r.id));
  const errors: FieldError[] = [];
  desired.forEach((d, index) => {
    if (!validIds.has(d.leatherId)) {
      errors.push({ field: `${index}.leatherId`, code: "invalid_reference", message: "leatherId không hợp lệ" });
    }
  });
  if (errors.length) validationFailed(errors);
}

async function putPriceMatrix(
  kind: PriceMatrixKind,
  req: NextRequest,
  ctx: AdminApiContext<{ id: string; styleId?: string; animalId?: string }>,
): Promise<Response> {
  const desired = await parseJson(req, priceCellListSchema);

  const dupes = duplicateKeys(desired, (d) => d.leatherId);
  if (dupes.length) {
    validationFailed(dupes.map((id) => ({ field: "leatherId", code: "duplicate", message: `leatherId ${id} xuất hiện hơn một lần` })));
  }

  const parentField = kind === "styleLeather" ? "productStyleId" : "productAnimalId";

  const rows = await db.$transaction(async (tx) => {
    const product = await loadProductForShop(tx, ctx.shop.id, ctx.params.id);

    let parentId: string;
    if (kind === "styleLeather") {
      const productStyle = await tx.productStyle.findFirst({ where: { productId: product.id, styleId: ctx.params.styleId } });
      if (!productStyle) notFound();
      parentId = productStyle.id;
    } else {
      const productAnimal = await tx.productAnimal.findFirst({ where: { productId: product.id, animalId: ctx.params.animalId } });
      if (!productAnimal) notFound();
      parentId = productAnimal.id;
    }

    await assertLeatherRefsValid(tx, ctx.shop.id, desired);

    const delegate = priceMatrixDelegateFor(tx, kind);
    const existing = await delegate.findMany({ where: { [parentField]: parentId } });
    const { toCreate, toUpdate, missing } = diffByKey<PriceCellItem, PriceMatrixRow>(
      desired,
      existing,
      (d) => d.leatherId,
      (e) => e.leatherId,
    );

    for (const d of toCreate) {
      await delegate.create({
        data: { [parentField]: parentId, leatherId: d.leatherId, priceInput: d.price, isActive: d.isActive, sortOrder: d.sortOrder },
      });
    }
    for (const pair of toUpdate) {
      // ★ Chỉ ba trường này — KHÔNG bao giờ đụng cột variant (P2b ghi riêng).
      await delegate.update({
        where: { id: pair.existing.id },
        data: { priceInput: pair.desired.price, isActive: pair.desired.isActive, sortOrder: pair.desired.sortOrder },
      });
    }
    if (missing.length) {
      await delegate.updateMany({ where: { id: { in: missing.map((m) => m.id) } }, data: { isActive: false } });
    }

    return delegate.findMany({ where: { [parentField]: parentId }, include: { leather: true }, orderBy: { sortOrder: "asc" } });
  });

  return Response.json(rows.map(toPriceCellDto));
}

// ── Lưới SVG mockup — style × animal ───────────────────────────────────────

const styleAnimalItemSchema = z.object({
  animalId: z.string().min(1, "animalId là bắt buộc"),
  svgAssetId: z.string().min(1, "svgAssetId là bắt buộc"),
  displayLabel: z.string().trim().max(200).nullish(),
  description: z.string().trim().max(2000).nullish(),
  defaultStitchId: z.string().min(1).nullish(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0),
});
const styleAnimalListSchema = z.array(styleAnimalItemSchema);
type StyleAnimalItem = z.infer<typeof styleAnimalItemSchema>;

async function putStyleAnimals(req: NextRequest, ctx: AdminApiContext<{ id: string; styleId: string }>): Promise<Response> {
  const desired = await parseJson(req, styleAnimalListSchema);

  const dupes = duplicateKeys(desired, (d) => d.animalId);
  if (dupes.length) {
    validationFailed(dupes.map((id) => ({ field: "animalId", code: "duplicate", message: `animalId ${id} xuất hiện hơn một lần` })));
  }

  const rows = await db.$transaction(async (tx) => {
    const product = await loadProductForShop(tx, ctx.shop.id, ctx.params.id);
    const productStyle = await tx.productStyle.findFirst({ where: { productId: product.id, styleId: ctx.params.styleId } });
    if (!productStyle) notFound();

    // Ba tham chiếu cần kiểm, mỗi loại MỘT query cho toàn bộ danh sách:
    // animalId phải có ProductAnimal trong product này; svgAssetId phải là
    // Asset shop này, kind SVG_MOCKUP, chưa archived, đã qua sanitize+validate
    // (svgValidatedAt khác null — Task 3); defaultStitchId (nếu có) phải có
    // ProductStitch trong product này.
    const animalIds = desired.map((d) => d.animalId);
    const productAnimals = animalIds.length
      ? await tx.productAnimal.findMany({ where: { productId: product.id, animalId: { in: animalIds } } })
      : [];
    const validAnimalIds = new Set(productAnimals.map((r) => r.animalId));

    const assetIds = desired.map((d) => d.svgAssetId);
    const assets = assetIds.length ? await tx.asset.findMany({ where: { shopId: ctx.shop.id, id: { in: assetIds } } }) : [];
    const assetById = new Map(assets.map((a) => [a.id, a]));

    const stitchIds = desired.map((d) => d.defaultStitchId).filter((id): id is string => !!id);
    const productStitches = stitchIds.length
      ? await tx.productStitch.findMany({ where: { productId: product.id, stitchId: { in: stitchIds } } })
      : [];
    const validStitchIds = new Set(productStitches.map((r) => r.stitchId));

    const errors: FieldError[] = [];
    desired.forEach((d, index) => {
      if (!validAnimalIds.has(d.animalId)) {
        errors.push({ field: `${index}.animalId`, code: "invalid_reference", message: "animalId không có trong product" });
      }
      const asset = assetById.get(d.svgAssetId);
      const validAsset = !!asset && asset.kind === "SVG_MOCKUP" && asset.archivedAt == null && asset.svgValidatedAt != null;
      if (!validAsset) {
        errors.push({ field: `${index}.svgAssetId`, code: "invalid_asset", message: "svgAssetId không hợp lệ" });
      }
      if (d.defaultStitchId && !validStitchIds.has(d.defaultStitchId)) {
        errors.push({ field: `${index}.defaultStitchId`, code: "invalid_reference", message: "defaultStitchId không có trong product" });
      }
    });
    if (errors.length) validationFailed(errors);

    const existing = await tx.productStyleAnimal.findMany({ where: { productStyleId: productStyle.id } });
    const { toCreate, toUpdate, missing } = diffByKey<StyleAnimalItem, { id: string; animalId: string }>(
      desired,
      existing,
      (d) => d.animalId,
      (e) => e.animalId,
    );

    for (const d of toCreate) {
      await tx.productStyleAnimal.create({
        data: {
          productStyleId: productStyle.id,
          animalId: d.animalId,
          svgAssetId: d.svgAssetId,
          displayLabel: d.displayLabel ?? null,
          description: d.description ?? null,
          defaultStitchId: d.defaultStitchId ?? null,
          isActive: d.isActive,
          sortOrder: d.sortOrder,
        },
      });
    }
    for (const pair of toUpdate) {
      await tx.productStyleAnimal.update({
        where: { id: pair.existing.id },
        data: {
          svgAssetId: pair.desired.svgAssetId,
          displayLabel: pair.desired.displayLabel ?? null,
          description: pair.desired.description ?? null,
          defaultStitchId: pair.desired.defaultStitchId ?? null,
          isActive: pair.desired.isActive,
          sortOrder: pair.desired.sortOrder,
        },
      });
    }
    if (missing.length) {
      await tx.productStyleAnimal.updateMany({ where: { id: { in: missing.map((m) => m.id) } }, data: { isActive: false } });
    }

    return tx.productStyleAnimal.findMany({
      where: { productStyleId: productStyle.id },
      include: { animal: true, svgAsset: true },
      orderBy: { sortOrder: "asc" },
    });
  });

  return Response.json(rows.map(toStyleAnimalCellDto));
}

// ── Export ──────────────────────────────────────────────────────────────

export const productHandlers = {
  list: listHandler,
  create: createHandler,
  get: getHandler,
  update: updateHandler,
  putHosts,
  putStyles: (req: NextRequest, ctx: AdminApiContext<{ id: string }>) => putRelation("style", req, ctx),
  putAnimals: (req: NextRequest, ctx: AdminApiContext<{ id: string }>) => putRelation("animal", req, ctx),
  putStitches: (req: NextRequest, ctx: AdminApiContext<{ id: string }>) => putRelation("stitch", req, ctx),
  putStyleLeathers: (req: NextRequest, ctx: AdminApiContext<{ id: string; styleId: string }>) =>
    putPriceMatrix("styleLeather", req, ctx),
  putAnimalLeathers: (req: NextRequest, ctx: AdminApiContext<{ id: string; animalId: string }>) =>
    putPriceMatrix("animalLeather", req, ctx),
  putStyleAnimals,
};
