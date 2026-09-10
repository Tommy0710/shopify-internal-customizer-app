import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AssetKind } from "@prisma/client";

/**
 * Supabase Storage — đường ghi asset duy nhất của app.
 *
 * KHÔNG có hàm nào ở đây nhận bytes SVG do người dùng tải lên.
 *
 * `sanitizeSvgRoot(root)` chỉ nhìn thấy cây con của root; một comment đặt TRƯỚC
 * thẻ <svg> sống sót trong `root.ownerDocument` dù `root.outerHTML` đã sạch.
 * Nên hợp đồng là: caller parse, sanitize, rồi đưa `root.outerHTML` vào đây.
 * `uploadSanitizedSvg` ném lỗi với bất cứ chuỗi nào trông như bytes gốc.
 *
 * Đây cũng là lý do bỏ luồng signed-upload-url hai bước của spec §8.1: nó để
 * browser ghi thẳng bytes chưa lọc vào bucket. Xem ruling R2 trong plan P1b.
 */

/**
 * Vercel serverless request body cap ở 4.5MB; đặt giới hạn asset dưới đó để
 * còn chỗ cho phần còn lại của multipart/JSON request.
 */
export const MAX_ASSET_BYTES = 4 * 1024 * 1024;

/** Bucket mặc định — public-read, một bucket duy nhất cho cả 4 loại asset. */
export const DEFAULT_BUCKET = "assets";

export const SVG_MIME_TYPE = "image/svg+xml";

/**
 * Đuôi file suy ra từ mimeType, KHÔNG lấy trực tiếp từ input của caller — nếu
 * lấy từ caller, một attacker có thể gửi mimeType hợp lệ (image/webp) kèm
 * extension giả (".svg") để đổi content-type khi Storage phục vụ lại file.
 */
export const ALLOWED_BINARY_MIME_TYPES: Readonly<Record<string, string>> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
};

/** File bất biến theo checksum — cache dài hạn, "immutable" là an toàn. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface StoredAsset {
  storagePath: string;
  publicUrl: string;
  checksumSha256: string;
  byteSize: number;
  mimeType: string;
}

/**
 * Bề mặt tối thiểu của Supabase Storage mà module này cần. Khai riêng (thay
 * vì dùng thẳng `SupabaseClient`) để test tiêm một object giả ghi lại lời gọi
 * mà không cần dựng toàn bộ `SupabaseClient` thật — và để không test nào chạm
 * mạng. `SupabaseClient` thật thoả interface này một cách cấu trúc.
 */
export interface AssetStorageClient {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Uint8Array | string,
        options: { contentType: string; cacheControl: string; upsert: boolean },
      ): Promise<
        | { data: { path: string }; error: null }
        | { data: null; error: { message: string; statusCode?: string } }
      >;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
}

/**
 * `sha256Hex` — dùng để tính checksum nội dung (tên file trong bucket) và để
 * chốt danh tính "đã sanitize hay chưa" không liên quan gì tới hàm này; nó chỉ
 * là hash thuần.
 */
export function sha256Hex(input: Uint8Array | string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * `<kind viết thường>/<checksum>.<extension>`. Tên file LÀ checksum nội dung
 * — đây là thứ làm `@@unique([shopId, kind, checksumSha256])` tự dedupe: cùng
 * nội dung luôn ra cùng path, ghi lại chỉ là ghi đè lên chính nó.
 */
export function storagePathFor(kind: AssetKind, checksum: string, extension: string): string {
  return `${kind.toLowerCase()}/${checksum}.${extension}`;
}

/**
 * Dựng Supabase client dùng service-role key. Ném lỗi NGAY nếu thiếu cấu
 * hình — bài học từ `verifySessionToken` ở P0: một secret rỗng là một khoá
 * HMAC hợp lệ (dài 0) nên "chấp nhận rỗng" âm thầm biến thành "chấp nhận bất
 * kỳ ai", còn ở đây một base URL rỗng sẽ tạo ra client trông như hoạt động
 * nhưng gọi gì cũng lỗi mạng khó hiểu. Cấu hình rỗng phải ồn ào ngay lúc khởi
 * tạo, không phải lúc request đầu tiên thất bại.
 */
export function createStorageClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error("createStorageClient: thiếu biến môi trường SUPABASE_URL");
  }
  if (!serviceRoleKey) {
    throw new Error("createStorageClient: thiếu biến môi trường SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

async function finishUpload(
  client: AssetStorageClient,
  bucket: string,
  storagePath: string,
  body: Uint8Array | string,
  contentType: string,
  callerLabel: string,
): Promise<string> {
  const { error } = await client.storage.from(bucket).upload(storagePath, body, {
    contentType,
    cacheControl: IMMUTABLE_CACHE_CONTROL,
    // Path = checksum nội dung, nên hai upload cùng path CHỈ có thể xảy ra khi
    // bytes giống hệt nhau — ghi đè (upsert) lúc đó là ghi đè bằng chính nó.
    // Coi upload trùng là thành công (không phải lỗi 409 "Duplicate") đúng
    // với ngữ nghĩa nội dung-định-địa-chỉ: idempotent theo thiết kế, không
    // phải một race condition cần xử lý.
    upsert: true,
  });
  if (error) {
    throw new Error(`${callerLabel}: Supabase Storage lỗi khi upload "${storagePath}": ${error.message}`);
  }

  const { data } = client.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

export interface UploadBinaryAssetInput {
  kind: AssetKind;
  bytes: Uint8Array;
  mimeType: string;
  bucket?: string;
  client?: AssetStorageClient;
}

/** Cho TEXTURE / DISPLAY — ảnh nhị phân, không phải SVG. */
export async function uploadBinaryAsset(input: UploadBinaryAssetInput): Promise<StoredAsset> {
  const extension = ALLOWED_BINARY_MIME_TYPES[input.mimeType];
  if (!extension) {
    throw new Error(
      `uploadBinaryAsset: mimeType "${input.mimeType}" không nằm trong allowlist (${Object.keys(ALLOWED_BINARY_MIME_TYPES).join(", ")})`,
    );
  }
  if (input.bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(
      `uploadBinaryAsset: file ${input.bytes.byteLength} byte vượt MAX_ASSET_BYTES (${MAX_ASSET_BYTES})`,
    );
  }

  const checksum = sha256Hex(input.bytes);
  const storagePath = storagePathFor(input.kind, checksum, extension);
  const bucket = input.bucket ?? DEFAULT_BUCKET;
  const client = input.client ?? createStorageClient();

  const publicUrl = await finishUpload(
    client,
    bucket,
    storagePath,
    input.bytes,
    input.mimeType,
    "uploadBinaryAsset",
  );

  return {
    storagePath,
    publicUrl,
    checksumSha256: checksum,
    byteSize: input.bytes.byteLength,
    mimeType: input.mimeType,
  };
}

export interface UploadSanitizedSvgInput {
  kind: AssetKind;
  svg: string;
  bucket?: string;
  client?: AssetStorageClient;
}

/**
 * Chốt cửa của Global Constraint đầu tiên: truyền bytes SVG gốc vào đây sẽ
 * ném lỗi, không âm thầm lưu. Xem ghi chú đầu file.
 */
function assertLooksLikeSanitizedSvg(svg: string): void {
  const trimmed = svg.trim();
  if (!trimmed.toLowerCase().startsWith("<svg")) {
    throw new Error(
      "uploadSanitizedSvg: chuỗi không bắt đầu bằng <svg sau khi trim — trông như bytes SVG gốc " +
        "(XML prolog, DOCTYPE, hay comment trước thẻ <svg> đều bị chặn ở đây). " +
        "Caller phải parse, gọi sanitizeSvgRoot(), rồi truyền root.outerHTML.",
    );
  }

  // Ba kiểm tra dưới đây CỐ TÌNH thừa so với sanitizeSvgRoot() — chúng không
  // thay thế sanitizer, chỉ bắt trường hợp caller quên gọi nó.
  if (svg.includes("<!--")) {
    throw new Error("uploadSanitizedSvg: chuỗi chứa comment <!-- — gọi sanitizeSvgRoot() trước khi lưu");
  }
  if (/<script/i.test(svg)) {
    throw new Error("uploadSanitizedSvg: chuỗi chứa <script — gọi sanitizeSvgRoot() trước khi lưu");
  }
  if (/\bon[a-z]+\s*=/i.test(svg)) {
    throw new Error(
      "uploadSanitizedSvg: chuỗi chứa thuộc tính on*= (event handler) — gọi sanitizeSvgRoot() trước khi lưu",
    );
  }
}

/** Cho SVG_MOCKUP / DESIGN_SVG — nhận `root.outerHTML` ĐÃ sanitize, không nhận bytes thô. */
export async function uploadSanitizedSvg(input: UploadSanitizedSvgInput): Promise<StoredAsset> {
  assertLooksLikeSanitizedSvg(input.svg);

  const byteSize = Buffer.byteLength(input.svg, "utf8");
  if (byteSize > MAX_ASSET_BYTES) {
    throw new Error(`uploadSanitizedSvg: SVG ${byteSize} byte vượt MAX_ASSET_BYTES (${MAX_ASSET_BYTES})`);
  }

  const checksum = sha256Hex(input.svg);
  const storagePath = storagePathFor(input.kind, checksum, "svg");
  const bucket = input.bucket ?? DEFAULT_BUCKET;
  const client = input.client ?? createStorageClient();

  const publicUrl = await finishUpload(
    client,
    bucket,
    storagePath,
    input.svg,
    SVG_MIME_TYPE,
    "uploadSanitizedSvg",
  );

  return {
    storagePath,
    publicUrl,
    checksumSha256: checksum,
    byteSize,
    mimeType: SVG_MIME_TYPE,
  };
}
