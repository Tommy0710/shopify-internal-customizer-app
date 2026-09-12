import { z } from "zod";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeHex } from "@/svg-engine";
import { slugify, SLUG_PATTERN } from "./slug";
import { conflict, notFound, parseJson, validationFailed } from "./http";
import type { AdminApiContext } from "./adminApi";

/**
 * Bốn nhóm attribute (spec §12.1) — chung một hình list + drawer ở UI, khác
 * field ở dưới. `kind` là khoá DUY NHẤT chọn delegate Prisma + cấu hình field
 * cho mọi hàm bên dưới.
 */
export type AttributeKind = "leathers" | "stitches" | "animals" | "styles";

export interface AttributeDto {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  archivedAt: string | null;
  displayImage: { assetId: string; url: string } | null;
  textureImage?: { assetId: string; url: string };
  colorHex?: string;
}

interface KindConfig {
  /** `displayImageAssetId` bắt buộc lúc `create`? (stitches: không). */
  displayRequired: boolean;
  /** Nhóm có `textureImageAssetId` không? Chỉ leathers. */
  hasTexture: boolean;
  /** Nhóm có `colorHex` không? Chỉ stitches. */
  hasColor: boolean;
}

const KIND_CONFIG: Record<AttributeKind, KindConfig> = {
  leathers: { displayRequired: true, hasTexture: true, hasColor: false },
  stitches: { displayRequired: false, hasTexture: false, hasColor: true },
  animals: { displayRequired: true, hasTexture: false, hasColor: false },
  styles: { displayRequired: true, hasTexture: false, hasColor: false },
};

/**
 * Bốn delegate Prisma (`db.leather`, `db.stitch`, `db.animal`, `db.style`) có
 * kiểu args KHÁC NHAU (Leather bắt buộc cả `displayImageAssetId` lẫn
 * `textureImageAssetId`; Stitch có `displayImageAssetId` tuỳ chọn + bắt buộc
 * `colorHex`; Animal/Style chỉ có `displayImageAssetId`) — không type Prisma
 * nào mô tả chung cả bốn cùng lúc. `AnyDelegate` + cast dưới đây là CHỖ DUY
 * NHẤT trong file này dùng `any`; mọi hàm public (`attributeHandlers`,
 * `AttributeDto`, …) vẫn khai kiểu tường minh, không có `any` nào rò ra khỏi
 * file. `update`/`updateMany` trả `Prisma.PrismaPromise` (không phải
 * `Promise` thường) để còn gộp được vào `db.$transaction([...])` ở
 * `reorderHandler`.
 */
interface AnyDelegate {
  findMany(args: unknown): Prisma.PrismaPromise<any[]>;
  findFirst(args: unknown): Prisma.PrismaPromise<any | null>;
  create(args: unknown): Prisma.PrismaPromise<any>;
  update(args: unknown): Prisma.PrismaPromise<any>;
  aggregate(args: unknown): Prisma.PrismaPromise<any>;
}

function delegateFor(kind: AttributeKind): AnyDelegate {
  switch (kind) {
    case "leathers":
      return db.leather as unknown as AnyDelegate;
    case "stitches":
      return db.stitch as unknown as AnyDelegate;
    case "animals":
      return db.animal as unknown as AnyDelegate;
    case "styles":
      return db.style as unknown as AnyDelegate;
  }
}

/** `include` cho mọi query trả DTO — một query có include, không N+1. */
function includeFor(kind: AttributeKind): Record<string, true> {
  return KIND_CONFIG[kind].hasTexture ? { displayImage: true, textureImage: true } : { displayImage: true };
}

function toDto(kind: AttributeKind, row: any): AttributeDto {
  const dto: AttributeDto = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt ? (row.archivedAt as Date).toISOString() : null,
    displayImage: row.displayImage ? { assetId: row.displayImage.id, url: row.displayImage.publicUrl } : null,
  };
  if (KIND_CONFIG[kind].hasTexture && row.textureImage) {
    dto.textureImage = { assetId: row.textureImage.id, url: row.textureImage.publicUrl };
  }
  if (KIND_CONFIG[kind].hasColor) {
    dto.colorHex = row.colorHex;
  }
  return dto;
}

// ── Validate asset tham chiếu ───────────────────────────────────────────
// Sai bất kỳ điều gì (không tồn tại, sai shop, sai kind, đã archived) đều trả
// đúng MỘT lỗi 422 invalid_asset — không có cách nào phân biệt "asset của shop
// khác" với "asset không tồn tại" từ response, đúng yêu cầu không tiết lộ.
async function validateAssetRef(params: {
  shopId: string;
  assetId: string;
  kind: "DISPLAY" | "TEXTURE";
  field: string;
}): Promise<void> {
  const asset = await db.asset.findFirst({
    where: { id: params.assetId, shopId: params.shopId, kind: params.kind, archivedAt: null },
  });
  if (!asset) {
    validationFailed([{ field: params.field, code: "invalid_asset", message: `${params.field} không hợp lệ` }]);
  }
}

function validateColorHex(raw: string): string {
  const normalized = normalizeHex(raw);
  if (!normalized) {
    validationFailed([{ field: "colorHex", code: "invalid_hex", message: "colorHex phải là mã hex hợp lệ" }]);
  }
  return normalized;
}

function validateSlugOrFail(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    validationFailed([{ field: "slug", code: "invalid_slug", message: "slug không hợp lệ" }]);
  }
}

async function nextSortOrder(kind: AttributeKind, shopId: string): Promise<number> {
  const result = await delegateFor(kind).aggregate({ where: { shopId }, _max: { sortOrder: true } });
  const max = (result as { _max: { sortOrder: number | null } })._max.sortOrder;
  return max === null || max === undefined ? 0 : max + 1;
}

// ── Zod: base dùng chung, mở rộng theo nhóm ─────────────────────────────
const baseFields = {
  name: z.string().trim().min(1, "name là bắt buộc").max(80, "name tối đa 80 ký tự"),
  slug: z.string().regex(SLUG_PATTERN, "slug không hợp lệ").optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
};

const CREATE_SCHEMAS: Record<AttributeKind, z.ZodTypeAny> = {
  leathers: z.object({
    ...baseFields,
    displayImageAssetId: z.string().min(1, "displayImageAssetId là bắt buộc"),
    textureImageAssetId: z.string().min(1, "textureImageAssetId là bắt buộc"),
  }),
  stitches: z.object({
    ...baseFields,
    displayImageAssetId: z.string().min(1).optional(),
    colorHex: z.string().min(1, "colorHex là bắt buộc"),
  }),
  animals: z.object({
    ...baseFields,
    displayImageAssetId: z.string().min(1, "displayImageAssetId là bắt buộc"),
  }),
  styles: z.object({
    ...baseFields,
    displayImageAssetId: z.string().min(1, "displayImageAssetId là bắt buộc"),
  }),
};

const patchBaseFields = {
  name: z.string().trim().min(1).max(80).optional(),
  slug: z.string().regex(SLUG_PATTERN, "slug không hợp lệ").optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  archived: z.boolean().optional(),
};

const PATCH_SCHEMAS: Record<AttributeKind, z.ZodTypeAny> = {
  leathers: z.object({
    ...patchBaseFields,
    displayImageAssetId: z.string().min(1).optional(),
    textureImageAssetId: z.string().min(1).optional(),
  }),
  stitches: z.object({
    ...patchBaseFields,
    displayImageAssetId: z.string().min(1).optional(),
    colorHex: z.string().min(1).optional(),
  }),
  animals: z.object({
    ...patchBaseFields,
    displayImageAssetId: z.string().min(1).optional(),
  }),
  styles: z.object({
    ...patchBaseFields,
    displayImageAssetId: z.string().min(1).optional(),
  }),
};

const REORDER_SCHEMA = z.object({ orderedIds: z.array(z.string().min(1)) });

// ── Handlers ─────────────────────────────────────────────────────────────

async function listHandler(kind: AttributeKind, req: NextRequest, ctx: AdminApiContext): Promise<Response> {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "true";
  const rows = await delegateFor(kind).findMany({
    where: { shopId: ctx.shop.id, ...(includeArchived ? {} : { archivedAt: null }) },
    include: includeFor(kind),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return Response.json({ items: rows.map((row) => toDto(kind, row)) });
}

async function createHandler(kind: AttributeKind, req: NextRequest, ctx: AdminApiContext): Promise<Response> {
  const body = await parseJson(req, CREATE_SCHEMAS[kind]);
  const config = KIND_CONFIG[kind];

  const slug = body.slug ?? slugify(body.name);
  validateSlugOrFail(slug);

  if (body.displayImageAssetId) {
    await validateAssetRef({ shopId: ctx.shop.id, assetId: body.displayImageAssetId, kind: "DISPLAY", field: "displayImageAssetId" });
  }
  if (config.hasTexture) {
    await validateAssetRef({ shopId: ctx.shop.id, assetId: body.textureImageAssetId, kind: "TEXTURE", field: "textureImageAssetId" });
  }

  const colorHex = config.hasColor ? validateColorHex(body.colorHex) : undefined;
  const sortOrder = body.sortOrder ?? (await nextSortOrder(kind, ctx.shop.id));

  const data: Record<string, unknown> = {
    shopId: ctx.shop.id,
    name: body.name,
    slug,
    isActive: body.isActive ?? true,
    sortOrder,
  };
  if (body.displayImageAssetId !== undefined) data.displayImageAssetId = body.displayImageAssetId;
  if (config.hasTexture) data.textureImageAssetId = body.textureImageAssetId;
  if (config.hasColor) data.colorHex = colorHex;

  const created = await delegateFor(kind).create({ data, include: includeFor(kind) });
  return Response.json(toDto(kind, created), { status: 201 });
}

async function updateHandler(
  kind: AttributeKind,
  req: NextRequest,
  ctx: AdminApiContext<{ id: string }>,
): Promise<Response> {
  const id = ctx.params.id;
  const body = await parseJson(req, PATCH_SCHEMAS[kind]);
  const config = KIND_CONFIG[kind];

  const delegate = delegateFor(kind);
  const existing = await delegate.findFirst({ where: { id, shopId: ctx.shop.id } });
  if (!existing) notFound();

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.slug !== undefined) {
    validateSlugOrFail(body.slug);
    data.slug = body.slug;
  }
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
  if (body.displayImageAssetId !== undefined) {
    await validateAssetRef({ shopId: ctx.shop.id, assetId: body.displayImageAssetId, kind: "DISPLAY", field: "displayImageAssetId" });
    data.displayImageAssetId = body.displayImageAssetId;
  }
  if (config.hasTexture && body.textureImageAssetId !== undefined) {
    await validateAssetRef({ shopId: ctx.shop.id, assetId: body.textureImageAssetId, kind: "TEXTURE", field: "textureImageAssetId" });
    data.textureImageAssetId = body.textureImageAssetId;
  }
  if (config.hasColor && body.colorHex !== undefined) {
    data.colorHex = validateColorHex(body.colorHex);
  }
  if (body.archived !== undefined) {
    data.archivedAt = body.archived ? (existing.archivedAt ?? new Date()) : null;
  }

  const updated = await delegate.update({ where: { id }, data, include: includeFor(kind) });
  return Response.json(toDto(kind, updated));
}

async function archiveHandler(
  kind: AttributeKind,
  _req: NextRequest,
  ctx: AdminApiContext<{ id: string }>,
): Promise<Response> {
  const id = ctx.params.id;
  const delegate = delegateFor(kind);
  const existing = await delegate.findFirst({ where: { id, shopId: ctx.shop.id } });
  if (!existing) notFound();

  // Idempotent: nếu đã archived, ghi lại CÙNG archivedAt thay vì now() — lần
  // gọi archive thứ hai phải trả đúng thời điểm archive lần đầu.
  const archivedAt = existing.archivedAt ?? new Date();
  const updated = await delegate.update({ where: { id }, data: { archivedAt }, include: includeFor(kind) });
  return Response.json(toDto(kind, updated));
}

async function reorderHandler(kind: AttributeKind, req: NextRequest, ctx: AdminApiContext): Promise<Response> {
  const body = await parseJson(req, REORDER_SCHEMA);
  const delegate = delegateFor(kind);

  const activeRows: Array<{ id: string }> = await delegate.findMany({
    where: { shopId: ctx.shop.id, archivedAt: null },
    select: { id: true },
  });
  const activeIds = new Set(activeRows.map((row) => row.id));
  const providedIds = body.orderedIds as string[];
  const providedSet = new Set(providedIds);

  const hasDuplicates = providedSet.size !== providedIds.length;
  const setsMatch =
    !hasDuplicates && activeIds.size === providedSet.size && [...activeIds].every((id) => providedSet.has(id));

  if (!setsMatch) {
    // Lệch tập — thiếu, thừa, hoặc trùng — đều là 409 STALE_ORDER: UI đang
    // cầm danh sách cũ, và không cố đoán ý người dùng muốn gì với phần lệch.
    conflict("STALE_ORDER");
  }

  await db.$transaction(providedIds.map((id, index) => delegate.update({ where: { id }, data: { sortOrder: index } })));
  return Response.json({ ok: true });
}

export function attributeHandlers(kind: AttributeKind): {
  list: (req: NextRequest, ctx: AdminApiContext) => Promise<Response>;
  create: (req: NextRequest, ctx: AdminApiContext) => Promise<Response>;
  update: (req: NextRequest, ctx: AdminApiContext<{ id: string }>) => Promise<Response>;
  archive: (req: NextRequest, ctx: AdminApiContext<{ id: string }>) => Promise<Response>;
  reorder: (req: NextRequest, ctx: AdminApiContext) => Promise<Response>;
} {
  return {
    list: (req, ctx) => listHandler(kind, req, ctx),
    create: (req, ctx) => createHandler(kind, req, ctx),
    update: (req, ctx) => updateHandler(kind, req, ctx),
    archive: (req, ctx) => archiveHandler(kind, req, ctx),
    reorder: (req, ctx) => reorderHandler(kind, req, ctx),
  };
}
