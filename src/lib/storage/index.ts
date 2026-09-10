import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AssetKind } from "@prisma/client";
import { parseSvgFromText } from "@/lib/svg/parseSvgNode";
import { sanitizeSvgRoot } from "@/svg-engine";

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
 * Ruling ban đầu cấm import sanitizer vào module này (giữ nó "chỉ ở tầng
 * caller"). Ruling đó được sửa lại sau review fix-round 1: import
 * `sanitizeSvgRoot` Ở ĐÂY, nhưng dùng như một VERIFIER chứ không phải một
 * transform — sanitize là idempotent, nên một chuỗi ĐÃ thật sự sanitize thì
 * chạy `sanitizeSvgRoot` lần hai luôn cho report rỗng. Nếu không rỗng, caller
 * quên sanitize (hoặc sanitize sai bản), và ta từ chối lưu — KHÔNG tự sửa
 * bằng cách upload bản re-serialize, vì làm vậy sẽ âm thầm che giấu bug ở
 * tầng caller thay vì buộc caller phải sửa. Bản thân verifier này không thay
 * được nhóm kiểm tra "bytes gốc" bên dưới: comment/PI/DOCTYPE trước thẻ
 * <svg> nằm ngoài root nên `sanitizeSvgRoot` (chỉ thấy subtree của root)
 * không bao giờ nhìn thấy chúng — đây vẫn là lý do duy nhất module này tồn
 * tại.
 *
 * Đây cũng là lý do bỏ luồng signed-upload-url hai bước của spec §8.1: nó để
 * browser ghi thẳng bytes chưa lọc vào bucket. Xem ruling R2 trong plan P1b.
 */

/**
 * Vercel serverless request body cap ở 4.5MB; đặt giới hạn asset dưới đó để
 * còn chỗ cho phần còn lại của multipart/JSON request.
 */
export const MAX_ASSET_BYTES = 4 * 1024 * 1024;

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
 * `sha256Hex` — dùng để tính checksum nội dung (tên file trong bucket). Chỉ
 * là hash thuần, không liên quan gì tới việc kiểm tra "đã sanitize hay chưa".
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
 * Đọc một biến môi trường bắt buộc, trim trước khi kiểm tra rỗng. Một biến
 * dán vào Vercel kèm xuống dòng hoặc khoảng trắng thừa (`" "`, `"\n"`) là
 * chuyện thật sẽ xảy ra, và nếu không trim thì nó qua được kiểm tra `!value`
 * — trông như đã cấu hình trong khi thực chất là rỗng. `context` chỉ để lời
 * lỗi nói rõ hàm nào đang đòi biến nào.
 */
function readRequiredEnv(name: string, context: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${context}: thiếu hoặc rỗng biến môi trường ${name}`);
  }
  return value;
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
  const url = readRequiredEnv("SUPABASE_URL", "createStorageClient");
  const serviceRoleKey = readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY", "createStorageClient");
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

/**
 * Bucket không hardcode: task kế tiếp ghi `SUPABASE_STORAGE_BUCKET` vào
 * `.env.example` và tạo đúng bucket đó trên Supabase. Nếu caller không tiêm
 * `bucket` tường minh (đường test), đọc biến môi trường — cùng luật
 * trim-rồi-ném-lỗi với `createStorageClient`.
 */
function resolveBucket(explicitBucket: string | undefined, context: string): string {
  if (explicitBucket !== undefined) return explicitBucket;
  return readRequiredEnv("SUPABASE_STORAGE_BUCKET", context);
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

// --- Magic bytes cho uploadBinaryAsset -------------------------------------
//
// Phòng thủ theo chiều sâu: không khai thác được gì hôm nay (không tầng nào
// inline TEXTURE/DISPLAY như markup), nhưng module này tự xưng là đường ghi
// DUY NHẤT vào bucket, nên "mimeType người gọi khai" và "bytes thật sự là gì"
// phải khớp nhau ngay tại đây, không phải ở một tầng đọc lại sau này.

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasPngMagic(bytes: Uint8Array): boolean {
  return PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

function hasJpegMagic(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasWebpMagic(bytes: Uint8Array): boolean {
  // "RIFF" ở byte 0-3, kích thước file ở byte 4-7 (bỏ qua), "WEBP" ở byte 8-11.
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

/**
 * Đọc ngoài giới hạn mảng trả `undefined`, không ném — nên file bị cắt cụt
 * (ít byte hơn magic number cần) tự nhiên khớp `false`, không cần nhánh xử lý
 * riêng cho "quá ngắn".
 */
const MAGIC_BYTE_CHECK: Readonly<Record<string, (bytes: Uint8Array) => boolean>> = {
  "image/png": hasPngMagic,
  "image/jpeg": hasJpegMagic,
  "image/webp": hasWebpMagic,
};

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

  const magicCheck = MAGIC_BYTE_CHECK[input.mimeType];
  if (!magicCheck || !magicCheck(input.bytes)) {
    throw new Error(
      `uploadBinaryAsset: bytes không khớp magic number của mimeType đã khai "${input.mimeType}" (file bị cắt cụt, sai định dạng, hay mimeType giả mạo)`,
    );
  }

  if (input.bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(
      `uploadBinaryAsset: file ${input.bytes.byteLength} byte vượt MAX_ASSET_BYTES (${MAX_ASSET_BYTES})`,
    );
  }

  const checksum = sha256Hex(input.bytes);
  const storagePath = storagePathFor(input.kind, checksum, extension);
  const bucket = resolveBucket(input.bucket, "uploadBinaryAsset");
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

/** `<svg` phải được theo sau bởi whitespace, `>`, hoặc `/` — không phải `<svgx…>`. */
const SVG_OPEN_TAG_RE = /^<svg(?=[\s/>])/i;

/**
 * Hàng rào "bytes gốc": phần duy nhất trong module này thấy được nội dung
 * NẰM NGOÀI root mà một parser sẽ tạo ra — XML prolog, DOCTYPE, comment hay
 * processing instruction đặt trước thẻ <svg> đều sống trong `ownerDocument`
 * của root, ngoài tầm nhìn của `sanitizeSvgRoot`. Đây là lý do module này
 * tồn tại: parse-rồi-verify (`assertGenuinelySanitized` bên dưới) KHÔNG bắt
 * được nhóm này.
 */
function assertNoRawSvgBytes(svg: string): void {
  const trimmed = svg.trim();
  if (!SVG_OPEN_TAG_RE.test(trimmed)) {
    throw new Error(
      "uploadSanitizedSvg: chuỗi không bắt đầu bằng thẻ <svg> hợp lệ sau khi trim — trông như bytes SVG gốc " +
        '(XML prolog, DOCTYPE, comment trước thẻ <svg>, hay một thẻ khác chỉ TRÙNG tiền tố như "<svgx…>"). ' +
        "Caller phải parse, gọi sanitizeSvgRoot(), rồi truyền root.outerHTML.",
    );
  }

  // Early exit rẻ tiền, KHÔNG phải hàng rào chính — hàng rào chính là
  // assertGenuinelySanitized() bên dưới, chạy sanitizeSvgRoot() thật trên
  // chính chuỗi này. Ba dòng dưới chỉ tránh phải parse+sanitize (đắt hơn) cho
  // những trường hợp lộ liễu; chúng KHÔNG bắt được `javascript:` href,
  // `<use href="data:…">`, SMIL (`<animate to="javascript:…">`,
  // `<set attributeName="onmouseover">`), `<foreignObject><iframe srcdoc>`,
  // hay `<style>@import` — verifier ở dưới mới bắt những cái đó, vì nó chạy
  // đúng sanitizer thật, đọc đúng allowlist thật.
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

/**
 * Hàng rào chính, và là hàng rào ĐẦY ĐỦ nhất trong hai hàng rào: parse chuỗi
 * rồi chạy `sanitizeSvgRoot` LẦN HAI, dùng như verifier chứ không phải
 * transform. Sanitize là idempotent — một chuỗi ĐÃ thật sự sanitize thì lần
 * chạy thứ hai luôn cho report rỗng (`removedElements`/`removedAttributes`
 * đều `[]`). Nếu không rỗng, caller quên sanitize (hoặc sanitize sai bản), và
 * ta từ chối lưu.
 *
 * KHÔNG re-serialize `root.outerHTML` rồi upload bản đó: hợp đồng của module
 * này là "caller sanitize", không phải "module này sanitize hộ". Tự sửa ở
 * đây sẽ âm thầm che giấu một caller có bug thay vì buộc caller sửa nó.
 *
 * `parseSvgFromText` tự ném `SvgParseError` nếu root không phải `<svg>` — để
 * nó tự bay lên, không bắt lại rồi viết lại logic đó.
 */
function assertGenuinelySanitized(svg: string): void {
  const root = parseSvgFromText(svg);
  const report = sanitizeSvgRoot(root);
  if (report.removedElements.length > 0 || report.removedAttributes.length > 0) {
    throw new Error(
      "uploadSanitizedSvg: chuỗi chưa qua sanitizeSvgRoot() — sanitize lần hai (chỉ để kiểm tra, không dùng để " +
        `lưu) vẫn gỡ ra elements=[${report.removedElements.join(", ")}] attributes=[${report.removedAttributes.join(", ")}]. ` +
        "Gọi sanitizeSvgRoot() trên chính root rồi mới truyền root.outerHTML vào đây.",
    );
  }
}

/** Cho SVG_MOCKUP / DESIGN_SVG — nhận `root.outerHTML` ĐÃ sanitize, không nhận bytes thô. */
export async function uploadSanitizedSvg(input: UploadSanitizedSvgInput): Promise<StoredAsset> {
  assertNoRawSvgBytes(input.svg);

  const byteSize = Buffer.byteLength(input.svg, "utf8");
  if (byteSize > MAX_ASSET_BYTES) {
    throw new Error(`uploadSanitizedSvg: SVG ${byteSize} byte vượt MAX_ASSET_BYTES (${MAX_ASSET_BYTES})`);
  }

  assertGenuinelySanitized(input.svg);

  const checksum = sha256Hex(input.svg);
  const storagePath = storagePathFor(input.kind, checksum, "svg");
  const bucket = resolveBucket(input.bucket, "uploadSanitizedSvg");
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
