import { z } from "zod";
import type { NextRequest } from "next/server";
import type { Asset, AssetKind } from "@prisma/client";
import { db } from "@/lib/db";
import { parseSvgFromText, SvgParseError } from "@/lib/svg/parseSvgNode";
import {
  sanitizeSvgRoot,
  validateSvgContract,
  type SanitizeReport,
  type ValidationReport,
} from "@/svg-engine";
import {
  AssetRejectedError,
  MAX_ASSET_BYTES,
  uploadBinaryAsset,
  uploadSanitizedSvg,
  type StoredAsset,
} from "@/lib/storage";
import { assetStorageClient } from "./assetStorage";
import { AdminHttpError, jsonError, validationFailed } from "./http";
import type { AdminApiContext } from "./adminApi";

/**
 * Loại asset admin được phép TỰ tải lên. `DESIGN_SVG` cố tình vắng mặt —
 * chỉ `bakeDesign` (server) sinh ra nó lúc chốt đơn; brief P2a cấm admin tự
 * tải file mạo danh design đã bake.
 */
export const ADMIN_UPLOAD_KINDS = ["SVG_MOCKUP", "TEXTURE", "DISPLAY"] as const;
export type AdminUploadKind = (typeof ADMIN_UPLOAD_KINDS)[number];

export interface AssetDto {
  id: string;
  kind: AssetKind;
  publicUrl: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  originalFilename: string;
  createdAt: string;
}

function payloadTooLarge(): never {
  throw new AdminHttpError(413, { error: "PAYLOAD_TOO_LARGE" });
}

function toAssetDto(asset: Asset): AssetDto {
  return {
    id: asset.id,
    kind: asset.kind,
    publicUrl: asset.publicUrl,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    originalFilename: asset.originalFilename,
    createdAt: asset.createdAt.toISOString(),
  };
}

/**
 * `viewBox` hợp đồng là `"minX minY W H"` (guide §2) — lấy W/H, làm tròn số
 * nguyên. Không parse được (thiếu, sai định dạng) → `null` cho cả hai, không
 * ném: đây chỉ là dữ liệu hiển thị phụ, không phải một điều kiện chặn upload.
 */
function dimensionsFromViewBox(viewBox: string | null): { width: number | null; height: number | null } {
  if (!viewBox) return { width: null, height: null };
  const parts = viewBox.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    return { width: null, height: null };
  }
  const [, , width, height] = parts;
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * Bước 2–5 của luồng SVG_MOCKUP: parse → sanitize → validate hợp đồng (TRÊN
 * cây đã sanitize — đo cái sẽ được lưu, không phải cái được gửi lên). Không
 * tự chuyển bất cứ kết quả nào (external ref, hợp đồng không hợp lệ) thành
 * lỗi HTTP — đó là quyết định của caller. Riêng `parseSvgFromText` vẫn ném
 * `SvgParseError` nguyên vẹn khi không parse được; đó là lỗi hình dạng khác
 * (file không phải SVG), không phải một "báo cáo" mà `validate-svg` cần trả
 * về 200.
 */
export function inspectSvg(text: string): {
  root: Element;
  sanitization: SanitizeReport;
  validation: ValidationReport;
} {
  const root = parseSvgFromText(text);
  const sanitization = sanitizeSvgRoot(root);
  const validation = validateSvgContract(root);
  return { root, sanitization, validation };
}

/** Tra `(shopId, kind, checksumSha256)`; có rồi thì un-archive nếu cần, chưa có thì tạo. */
async function upsertAssetRow(params: {
  shopId: string;
  userId: string;
  kind: AssetKind;
  stored: StoredAsset;
  width: number | null;
  height: number | null;
  originalFilename: string;
  svgValidatedAt?: Date | null;
  svgContractVer?: string | null;
}): Promise<{ asset: AssetDto; created: boolean }> {
  const existing = await db.asset.findUnique({
    where: {
      shopId_kind_checksumSha256: {
        shopId: params.shopId,
        kind: params.kind,
        checksumSha256: params.stored.checksumSha256,
      },
    },
  });

  if (existing) {
    const row = existing.archivedAt
      ? await db.asset.update({ where: { id: existing.id }, data: { archivedAt: null } })
      : existing;
    return { asset: toAssetDto(row), created: false };
  }

  const created = await db.asset.create({
    data: {
      shopId: params.shopId,
      kind: params.kind,
      storagePath: params.stored.storagePath,
      publicUrl: params.stored.publicUrl,
      mimeType: params.stored.mimeType,
      byteSize: params.stored.byteSize,
      checksumSha256: params.stored.checksumSha256,
      width: params.width,
      height: params.height,
      originalFilename: params.originalFilename,
      svgValidatedAt: params.svgValidatedAt ?? null,
      svgContractVer: params.svgContractVer ?? null,
      createdBy: params.userId,
    },
  });

  return { asset: toAssetDto(created), created: true };
}

async function createSvgAsset(input: {
  shopId: string;
  userId: string;
  file: File;
}): Promise<{ asset: AssetDto; created: boolean; validation: ValidationReport; sanitization: SanitizeReport }> {
  if (input.file.size > MAX_ASSET_BYTES) payloadTooLarge();

  const text = await input.file.text();
  let inspection: ReturnType<typeof inspectSvg>;
  try {
    inspection = inspectSvg(text);
  } catch (error) {
    if (error instanceof SvgParseError) {
      validationFailed([{ field: "file", code: "svg_parse", message: error.message }]);
    }
    throw error;
  }
  const { root, sanitization, validation } = inspection;

  // R5: URL ngoài không tự bị gỡ (texture da hợp lệ chính là URL ngoài), nhưng
  // admin upload một MOCKUP thì không có lý do hợp lệ nào để nó tham chiếu ra
  // ngoài — từ chối trước khi chạm tới kiểm hợp đồng hay Storage.
  if (sanitization.externalRefs.length > 0) {
    throw new AdminHttpError(422, {
      errors: [
        {
          field: "file",
          code: "external_reference",
          message: "SVG tham chiếu tài nguyên ngoài — không được phép cho mockup",
        },
      ],
      externalRefs: sanitization.externalRefs,
    });
  }

  // Validate SAU sanitize: đo đúng cái sẽ được lưu, không phải cái được gửi lên.
  if (!validation.valid) {
    throw new AdminHttpError(422, {
      errors: [{ field: "file", code: "svg_contract", message: "SVG không thoả hợp đồng customizer" }],
      validation,
    });
  }

  const svg = root.outerHTML;
  const stored = await uploadSanitizedSvg({ kind: "SVG_MOCKUP", svg, client: assetStorageClient() });
  const { width, height } = dimensionsFromViewBox(validation.viewBox);

  const result = await upsertAssetRow({
    shopId: input.shopId,
    userId: input.userId,
    kind: "SVG_MOCKUP",
    stored,
    width,
    height,
    originalFilename: input.file.name,
    svgValidatedAt: new Date(),
    svgContractVer: validation.contractVersion,
  });

  return { ...result, validation, sanitization };
}

async function createBinaryAsset(input: {
  shopId: string;
  userId: string;
  kind: Exclude<AdminUploadKind, "SVG_MOCKUP">;
  file: File;
}): Promise<{ asset: AssetDto; created: boolean }> {
  if (input.file.size > MAX_ASSET_BYTES) payloadTooLarge();

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  let stored: StoredAsset;
  try {
    stored = await uploadBinaryAsset({
      kind: input.kind,
      bytes,
      mimeType: input.file.type,
      client: assetStorageClient(),
    });
  } catch (error) {
    if (error instanceof AssetRejectedError) {
      validationFailed([{ field: "file", code: "invalid_image", message: error.message }]);
    }
    throw error;
  }

  return upsertAssetRow({
    shopId: input.shopId,
    userId: input.userId,
    kind: input.kind,
    stored,
    width: null,
    height: null,
    originalFilename: input.file.name,
  });
}

export async function createAssetFromUpload(input: {
  shopId: string;
  userId: string;
  kind: AdminUploadKind;
  file: File;
}): Promise<{ asset: AssetDto; created: boolean; validation?: ValidationReport; sanitization?: SanitizeReport }> {
  if (input.kind === "SVG_MOCKUP") {
    return createSvgAsset({ shopId: input.shopId, userId: input.userId, file: input.file });
  }
  return createBinaryAsset({ shopId: input.shopId, userId: input.userId, kind: input.kind, file: input.file });
}

// --- Đọc content-length TRƯỚC khi đọc body — tránh nạp hết một file khổng lồ
// vào bộ nhớ khi header đã đủ để từ chối sớm. Client có thể thiếu hoặc nói dối
// header này, nên `createAssetFromUpload`/`createSvgAsset`/`createBinaryAsset`
// còn kiểm lại kích thước THẬT của file đã parse ở trên. -----------------------

function rejectIfContentLengthTooLarge(req: NextRequest): Response | null {
  const contentLength = req.headers.get("content-length");
  if (contentLength === null) return null;
  const declared = Number(contentLength);
  if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES) {
    return jsonError(413, "PAYLOAD_TOO_LARGE");
  }
  return null;
}

function readFileField(formData: FormData): File {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    validationFailed([{ field: "file", code: "required", message: "file là bắt buộc" }]);
  }
  return file;
}

export async function handleAssetUpload(req: NextRequest, ctx: AdminApiContext): Promise<Response> {
  const tooLarge = rejectIfContentLengthTooLarge(req);
  if (tooLarge) return tooLarge;

  const formData = await req.formData();
  const file = readFileField(formData);

  const kindResult = z.enum(ADMIN_UPLOAD_KINDS).safeParse(formData.get("kind"));
  if (!kindResult.success) {
    validationFailed([
      {
        field: "kind",
        code: "invalid_enum_value",
        message: `kind phải là một trong: ${ADMIN_UPLOAD_KINDS.join(", ")}`,
      },
    ]);
  }

  const { asset, created, validation, sanitization } = await createAssetFromUpload({
    shopId: ctx.shop.id,
    userId: ctx.session.userId,
    kind: kindResult.data,
    file,
  });

  return Response.json({ asset, created, validation, sanitization }, { status: created ? 201 : 200 });
}

export async function handleValidateSvg(req: NextRequest, _ctx: AdminApiContext): Promise<Response> {
  const tooLarge = rejectIfContentLengthTooLarge(req);
  if (tooLarge) return tooLarge;

  const formData = await req.formData();
  const file = readFileField(formData);

  if (file.size > MAX_ASSET_BYTES) {
    return jsonError(413, "PAYLOAD_TOO_LARGE");
  }

  const text = await file.text();
  let inspection: ReturnType<typeof inspectSvg>;
  try {
    inspection = inspectSvg(text);
  } catch (error) {
    if (error instanceof SvgParseError) {
      validationFailed([{ field: "file", code: "svg_parse", message: error.message }]);
    }
    throw error;
  }

  const { sanitization, validation } = inspection;
  const valid = validation.valid && sanitization.externalRefs.length === 0;

  return Response.json({ valid, validation, sanitization, externalRefs: sanitization.externalRefs });
}
