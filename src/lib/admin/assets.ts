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
// Deep import CÓ CHỦ ĐÍCH, không qua barrel `@/svg-engine` — cùng tiền lệ với
// `src/lib/svg/parseSvgNode.ts` (import `SVG_NAMESPACE` từ `@/svg-engine/contract`).
// `extractUrlReferences`/`HREF_ATTRIBUTES` là logic "đọc URL ở đâu trong một
// SVG" đã được kiểm chứng kỹ (dùng chung bởi cả sanitize.ts lẫn validate.ts) —
// KHÔNG viết lại một bản regex riêng ở đây, viết lại là cách con bug
// case-sensitive/không-cho-khoảng-trắng mà chính policy.ts đã từng vá quay
// lại. Quyết định "master mockup không được nhúng data: URI" là quyết định
// riêng của ENDPOINT này (fix round 1, security review) — không phải của
// engine, nên không đụng vào `policy.ts`.
import { HREF_ATTRIBUTES, extractUrlReferences, normalizeUrlForSchemeCheck } from "@/svg-engine/policy";
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
 * Tham chiếu `data:` (mọi subtype) trong CÂY ĐÃ SANITIZE — cả ở vị trí href
 * lẫn trong `url(...)` của `style` và thuộc tính trình bày. Đi cùng đường quét
 * `urlValuesOf` mà `validate.ts` dùng nội bộ: `HREF_ATTRIBUTES` cho giá trị
 * trực tiếp, `extractUrlReferences` (định nghĩa `url()` DUY NHẤT) cho mọi
 * thuộc tính khác — không viết một bản regex riêng ở đây.
 *
 * Policy P1a (`policy.ts`) CỐ Ý cho `data:image/*` qua sanitize — texture hợp
 * lệ đôi khi tới dưới dạng đó. Nhưng đây là MASTER MOCKUP (endpoint này), và
 * nó không có lý do hợp lệ nào để nhúng ảnh: texture được `applyTexture` gắn
 * lúc RUNTIME, hai fixture thật (angler-fish, crocodile) có 0 data: URI.
 * SVG-as-image bị trình duyệt sandbox nên nhiều khả năng vô hại — nhưng
 * "nhiều khả năng" không đủ ở ranh giới lưu trữ, nên endpoint này từ chối
 * thẳng thay vì tin vào sandbox của mọi trình duyệt tương lai. Quyết định
 * RIÊNG của endpoint này (fix round 1, security review) — không sửa
 * `policy.ts`, caller khác của engine giữ nguyên hành vi.
 */
function findEmbeddedResourceRefs(root: Element): string[] {
  const refs: string[] = [];
  const elements: Element[] = [root, ...(Array.from(root.querySelectorAll("*")) as Element[])];
  for (const element of elements) {
    for (const attribute of element.getAttributeNames()) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;
      const candidates = HREF_ATTRIBUTES.includes(attribute) ? [value] : extractUrlReferences(value);
      for (const candidate of candidates) {
        if (/^data:/i.test(normalizeUrlForSchemeCheck(candidate))) refs.push(candidate);
      }
    }
  }
  return refs;
}

/**
 * Chuẩn hoá tên file TRƯỚC khi lưu. Đây là chuỗi tấn công DUY NHẤT của luồng
 * upload không đi qua sanitizer SVG — filename không phải nội dung SVG. Không
 * khai thác được hôm nay (chưa UI nào render nó), nhưng thư viện asset P2c sẽ
 * hiển thị nó, nên chuẩn hoá ngay lúc ghi thay vì hoãn tới lúc render.
 *
 * Chỉ giữ basename (bỏ mọi thành phần path); bỏ ký tự điều khiển C0/C1/DEL;
 * bỏ ký tự đảo hướng bidi (dùng để giả đuôi file — "cv‮gpj.exe" đảo hướng hiện
 * thành "cv...exe.jpg" khi đọc từ trái sang phải); NFC-normalize; cắt 255 ký
 * tự; rỗng sau khi lọc thì trả "upload".
 */
export function sanitizeOriginalFilename(name: string): string {
  const basename = name.split(/[/\\]/).pop() ?? "";
  const stripped = basename
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .normalize("NFC")
    .trim();
  const truncated = stripped.slice(0, 255);
  return truncated === "" ? "upload" : truncated;
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

  const embeddedRefs = findEmbeddedResourceRefs(root);
  if (embeddedRefs.length > 0) {
    throw new AdminHttpError(422, {
      errors: [
        {
          field: "file",
          code: "embedded_resource",
          message: "SVG nhúng tài nguyên data: URI — không được phép cho mockup master",
        },
      ],
      embeddedRefs,
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
    originalFilename: sanitizeOriginalFilename(input.file.name),
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
    originalFilename: sanitizeOriginalFilename(input.file.name),
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

// --- content-length là ĐƯỜNG NHANH cho client trung thực, KHÔNG phải trần bộ
// nhớ: client tự khai header này, nên có thể thiếu hoặc nói dối nó (đã xác
// minh — `content-length: 10` kèm body ~4MB vẫn được `req.formData()` đọc hết
// vào bộ nhớ trước khi kiểm tiếp chạy). Kiểm THẬT là `file.size` sau khi parse
// (`createAssetFromUpload`/`createSvgAsset`/`createBinaryAsset`), và trần bộ
// nhớ thật sự nằm ở giới hạn body của nền tảng (4.5MB trên Vercel serverless).
// -----------------------------------------------------------------------------

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

  const { root, sanitization, validation } = inspection;
  const embeddedRefs = findEmbeddedResourceRefs(root);
  const valid = validation.valid && sanitization.externalRefs.length === 0 && embeddedRefs.length === 0;

  return Response.json({
    valid,
    validation,
    sanitization,
    externalRefs: sanitization.externalRefs,
    embeddedRefs,
  });
}
