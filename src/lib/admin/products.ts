import { z } from "zod";
import type { NextRequest } from "next/server";
import { Prisma, type CustomizableProduct } from "@prisma/client";
import { db } from "@/lib/db";
import { conflict, notFound, parseJson, validationFailed, type FieldError } from "./http";
import type { AdminApiContext } from "./adminApi";
import { diffByKey, duplicateKeys } from "./diff";

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

export interface ProductTreeDto extends ProductSummaryDto {
  hosts: ProductHostDto[];
  styles: ProductRelationDto[];
  animals: ProductRelationDto[];
  stitches: ProductRelationDto[];
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
  const [hosts, styles, animals, stitches] = await Promise.all([
    db.productHost.findMany({ where: { productId: product.id }, orderBy: [{ isPrimary: "desc" }, { shopifyProductId: "asc" }] }),
    db.productStyle.findMany({ where: { productId: product.id }, include: { style: true }, orderBy: { sortOrder: "asc" } }),
    db.productAnimal.findMany({ where: { productId: product.id }, include: { animal: true }, orderBy: { sortOrder: "asc" } }),
    db.productStitch.findMany({ where: { productId: product.id }, include: { stitch: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const tree: ProductTreeDto = {
    ...toProductSummaryDto(product),
    hosts: hosts.map(toHostDto),
    styles: styles.map((row) => toRelationDto("style", "styleId", row)),
    animals: animals.map((row) => toRelationDto("animal", "animalId", row)),
    stitches: stitches.map((row) => toRelationDto("stitch", "stitchId", row)),
  };
  return Response.json(tree);
}

async function updateHandler(req: NextRequest, ctx: AdminApiContext<{ id: string }>): Promise<Response> {
  const body = await parseJson(req, updateProductSchema);
  const product = await loadProductForShop(db, ctx.shop.id, ctx.params.id);
  const updated = await db.customizableProduct.update({
    where: { id: product.id },
    data: { ...(body.name !== undefined ? { name: body.name } : {}) },
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
};
