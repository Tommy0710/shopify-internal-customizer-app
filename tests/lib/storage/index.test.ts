import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach } from "vitest";
import type { AssetKind } from "@prisma/client";
import { parseSvgFromText } from "@/lib/svg/parseSvgNode";
import { sanitizeSvgRoot } from "@/svg-engine";
import {
  AssetRejectedError,
  MAX_ASSET_BYTES,
  createStorageClient,
  sha256Hex,
  storagePathFor,
  uploadBinaryAsset,
  uploadSanitizedSvg,
  type AssetStorageClient,
} from "@/lib/storage";

const SUPABASE_URL = "https://fake-project.supabase.co";
const SERVICE_ROLE_KEY = "fake-service-role-key-do-not-leak-me";
const FAKE_BUCKET = "wk-assets-test";

// Toàn bộ test dùng chung một bucket lấy từ biến môi trường — đúng đường sản
// xuất (fix round 1, mục 4): không còn hằng số DEFAULT_BUCKET hardcode.
process.env.SUPABASE_STORAGE_BUCKET = FAKE_BUCKET;

/**
 * Client giả ghi lại lời gọi upload/getPublicUrl — test không bao giờ chạm
 * mạng. Tự dựng publicUrl giống hệt công thức thật của Supabase (url + bucket
 * + path) để test "publicUrl không chứa service-role key" có ý nghĩa.
 */
function createFakeClient(options: { failWith?: { message: string; statusCode?: string } } = {}) {
  const calls: Array<{
    bucket: string;
    path: string;
    body: Uint8Array | string;
    uploadOptions: { contentType?: string; cacheControl?: string; upsert?: boolean };
  }> = [];

  const client: AssetStorageClient = {
    storage: {
      from(bucket: string) {
        return {
          async upload(
            path: string,
            body: Uint8Array | string,
            uploadOptions: { contentType?: string; cacheControl?: string; upsert?: boolean } = {},
          ) {
            calls.push({ bucket, path, body, uploadOptions });
            if (options.failWith) {
              return { data: null, error: options.failWith };
            }
            return { data: { path }, error: null };
          },
          getPublicUrl(path: string) {
            return {
              data: {
                publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`,
              },
            };
          },
        };
      },
    },
  };

  return { client, calls };
}

// --- Helpers cho magic bytes nhị phân giả -----------------------------------

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP_WEBP = [0x57, 0x45, 0x42, 0x50];

function pngBytes(length = 16): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(PNG_MAGIC, 0);
  return bytes;
}
function jpegBytes(length = 16): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(JPEG_MAGIC, 0);
  return bytes;
}
function webpBytes(length = 16): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(WEBP_RIFF, 0);
  bytes.set(WEBP_WEBP, 8);
  return bytes;
}

// --- Fixtures SVG thật -------------------------------------------------------

function loadFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/svg/${name}`, import.meta.url)), "utf8");
}

/** Mô phỏng đúng việc caller (P2) phải làm: parse, sanitize, lấy outerHTML. */
function sanitizedOuterHtml(rawSvg: string): string {
  const root = parseSvgFromText(rawSvg);
  sanitizeSvgRoot(root);
  return root.outerHTML;
}

describe("sha256Hex", () => {
  it("khớp giá trị SHA-256 đã biết", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("nhận Uint8Array", () => {
    const bytes = new TextEncoder().encode("abc");
    expect(sha256Hex(bytes)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("storagePathFor", () => {
  it("thư mục theo kind viết thường, tên file là checksum", () => {
    expect(storagePathFor("TEXTURE" as AssetKind, "ab12cd", "webp")).toBe(
      "texture/ab12cd.webp",
    );
  });

  it("áp dụng cho cả bốn AssetKind", () => {
    expect(storagePathFor("SVG_MOCKUP" as AssetKind, "abc", "svg")).toBe("svg_mockup/abc.svg");
    expect(storagePathFor("DISPLAY" as AssetKind, "abc", "png")).toBe("display/abc.png");
    expect(storagePathFor("DESIGN_SVG" as AssetKind, "abc", "svg")).toBe("design_svg/abc.svg");
  });
});

describe("createStorageClient", () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it("ném lỗi khi thiếu SUPABASE_URL", () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
    expect(() => createStorageClient()).toThrow();
  });

  it("ném lỗi khi SUPABASE_URL rỗng", () => {
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
    expect(() => createStorageClient()).toThrow();
  });

  it("ném lỗi khi SUPABASE_URL chỉ có khoảng trắng", () => {
    process.env.SUPABASE_URL = "   ";
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
    expect(() => createStorageClient()).toThrow();
  });

  it("ném lỗi khi thiếu SUPABASE_SERVICE_ROLE_KEY", () => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => createStorageClient()).toThrow();
  });

  it("ném lỗi khi SUPABASE_SERVICE_ROLE_KEY rỗng", () => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";
    expect(() => createStorageClient()).toThrow();
  });

  it("ném lỗi khi SUPABASE_SERVICE_ROLE_KEY chỉ có khoảng trắng — regression: từng tạo client trông như hoạt động", () => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = " ";
    expect(() => createStorageClient()).toThrow();
  });

  it("ném lỗi khi SUPABASE_SERVICE_ROLE_KEY chỉ có một dòng trắng (\\n dán từ Vercel)", () => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "\n";
    expect(() => createStorageClient()).toThrow();
  });

  it("trả về client khi cả hai biến hợp lệ — không chạm mạng", () => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
    expect(() => createStorageClient()).not.toThrow();
  });
});

describe("bucket lấy từ SUPABASE_STORAGE_BUCKET", () => {
  const originalBucket = process.env.SUPABASE_STORAGE_BUCKET;

  afterEach(() => {
    if (originalBucket === undefined) delete process.env.SUPABASE_STORAGE_BUCKET;
    else process.env.SUPABASE_STORAGE_BUCKET = originalBucket;
  });

  it("dùng bucket tiêm tường minh, không đọc biến môi trường", async () => {
    delete process.env.SUPABASE_STORAGE_BUCKET;
    const { client, calls } = createFakeClient();
    await uploadBinaryAsset({
      kind: "TEXTURE" as AssetKind,
      bytes: pngBytes(),
      mimeType: "image/png",
      bucket: "explicit-bucket",
      client,
    });
    expect(calls[0].bucket).toBe("explicit-bucket");
  });

  it("ném lỗi khi không có bucket tiêm và thiếu SUPABASE_STORAGE_BUCKET", async () => {
    delete process.env.SUPABASE_STORAGE_BUCKET;
    const { client } = createFakeClient();
    await expect(
      uploadBinaryAsset({
        kind: "TEXTURE" as AssetKind,
        bytes: pngBytes(),
        mimeType: "image/png",
        client,
      }),
    ).rejects.toThrow();
  });

  it("ném lỗi khi SUPABASE_STORAGE_BUCKET chỉ có khoảng trắng", async () => {
    process.env.SUPABASE_STORAGE_BUCKET = "   ";
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: sanitizedOuterHtml(loadFixture("crocodile.svg")),
        client,
      }),
    ).rejects.toThrow();
  });

  it("dùng SUPABASE_STORAGE_BUCKET (trim) khi không tiêm bucket tường minh", async () => {
    process.env.SUPABASE_STORAGE_BUCKET = `  ${FAKE_BUCKET}  `;
    const { client, calls } = createFakeClient();
    await uploadBinaryAsset({
      kind: "TEXTURE" as AssetKind,
      bytes: pngBytes(),
      mimeType: "image/png",
      client,
    });
    expect(calls[0].bucket).toBe(FAKE_BUCKET);
  });
});

describe("uploadBinaryAsset", () => {
  it("upload với contentType đúng, gọi client đã tiêm — không chạm mạng", async () => {
    const { client, calls } = createFakeClient();
    const bytes = pngBytes();

    const result = await uploadBinaryAsset({
      kind: "TEXTURE" as AssetKind,
      bytes,
      mimeType: "image/png",
      client,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].uploadOptions.contentType).toBe("image/png");
    expect(calls[0].bucket).toBe(FAKE_BUCKET);
    expect(calls[0].path).toBe(`texture/${sha256Hex(bytes)}.png`);
    expect(result.mimeType).toBe("image/png");
    expect(result.checksumSha256).toBe(sha256Hex(bytes));
    expect(result.byteSize).toBe(bytes.byteLength);
    expect(result.storagePath).toBe(`texture/${sha256Hex(bytes)}.png`);
  });

  it("từ chối mimeType ngoài allowlist", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadBinaryAsset({
        kind: "DISPLAY" as AssetKind,
        bytes: pngBytes(),
        mimeType: "image/gif",
        client,
      }),
    ).rejects.toThrow();
  });

  it("chấp nhận webp, png, jpeg với magic bytes đúng", async () => {
    const { client } = createFakeClient();
    const cases: Array<[string, Uint8Array]> = [
      ["image/webp", webpBytes()],
      ["image/png", pngBytes()],
      ["image/jpeg", jpegBytes()],
    ];
    for (const [mimeType, bytes] of cases) {
      await expect(
        uploadBinaryAsset({ kind: "DISPLAY" as AssetKind, bytes, mimeType, client }),
      ).resolves.toBeDefined();
    }
  });

  it("từ chối bytes không khớp magic number của mimeType đã khai (SVG giả danh PNG)", async () => {
    const { client } = createFakeClient();
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await expect(
      uploadBinaryAsset({
        kind: "TEXTURE" as AssetKind,
        bytes: svgBytes,
        mimeType: "image/png",
        client,
      }),
    ).rejects.toThrow(/magic number/);
  });

  it("từ chối file bị cắt cụt (không đủ byte để khớp magic number)", async () => {
    const { client } = createFakeClient();
    const truncated = new Uint8Array([0x89, 0x50]); // hai byte đầu của PNG, thiếu phần còn lại
    await expect(
      uploadBinaryAsset({
        kind: "TEXTURE" as AssetKind,
        bytes: truncated,
        mimeType: "image/png",
        client,
      }),
    ).rejects.toThrow(/magic number/);
  });

  it("từ chối file vượt MAX_ASSET_BYTES", async () => {
    const { client } = createFakeClient();
    const tooBig = webpBytes(MAX_ASSET_BYTES + 1);
    await expect(
      uploadBinaryAsset({
        kind: "TEXTURE" as AssetKind,
        bytes: tooBig,
        mimeType: "image/webp",
        client,
      }),
    ).rejects.toThrow();
  });

  it("chấp nhận file đúng bằng MAX_ASSET_BYTES", async () => {
    const { client } = createFakeClient();
    const exact = webpBytes(MAX_ASSET_BYTES);
    await expect(
      uploadBinaryAsset({
        kind: "TEXTURE" as AssetKind,
        bytes: exact,
        mimeType: "image/webp",
        client,
      }),
    ).resolves.toBeDefined();
  });

  it("publicUrl dựng từ SUPABASE_URL + bucket + path, không bao giờ chứa service-role key", async () => {
    const { client } = createFakeClient();
    const result = await uploadBinaryAsset({
      kind: "TEXTURE" as AssetKind,
      bytes: pngBytes(),
      mimeType: "image/png",
      client,
    });
    expect(result.publicUrl.startsWith(SUPABASE_URL)).toBe(true);
    expect(result.publicUrl).toContain(result.storagePath);
    expect(result.publicUrl).not.toContain(SERVICE_ROLE_KEY);
  });

  it("upload trùng nội dung (cùng path) được coi là thành công — upsert:true", async () => {
    const { client, calls } = createFakeClient();
    const bytes = webpBytes();
    const input = { kind: "TEXTURE" as AssetKind, bytes, mimeType: "image/webp" as const, client };

    const first = await uploadBinaryAsset(input);
    const second = await uploadBinaryAsset(input);

    expect(first.storagePath).toBe(second.storagePath);
    expect(calls).toHaveLength(2);
    expect(calls[0].uploadOptions.upsert).toBe(true);
    expect(calls[1].uploadOptions.upsert).toBe(true);
  });

  it("ném lỗi khi Supabase Storage trả lỗi khác 'trùng nội dung'", async () => {
    const { client } = createFakeClient({ failWith: { message: "network is down" } });
    await expect(
      uploadBinaryAsset({
        kind: "TEXTURE" as AssetKind,
        bytes: webpBytes(),
        mimeType: "image/webp",
        client,
      }),
    ).rejects.toThrow(/network is down/);
  });
});

describe("uploadSanitizedSvg", () => {
  // Dạng CHUẨN — đúng như `root.outerHTML` của linkedom sinh ra (`<path … />`
  // có dấu cách trước `/>`). Từ fix nội-dung-sau-</svg>, module chỉ nhận chuỗi
  // mà parse lại cho ra đúng chính nó, nên test phải dùng dạng caller thật sẽ
  // đưa vào, không phải một chuỗi gõ tay "trông giống".
  const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z" /></svg>';

  it("upload với contentType image/svg+xml và cacheControl dài (bất biến theo checksum)", async () => {
    const { client, calls } = createFakeClient();
    const result = await uploadSanitizedSvg({
      kind: "SVG_MOCKUP" as AssetKind,
      svg: CLEAN_SVG,
      client,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].uploadOptions.contentType).toBe("image/svg+xml");
    const cacheControl = calls[0].uploadOptions.cacheControl ?? "";
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    expect(maxAgeMatch).not.toBeNull();
    expect(Number(maxAgeMatch![1])).toBeGreaterThanOrEqual(60 * 60 * 24 * 30);
    expect(result.mimeType).toBe("image/svg+xml");
    expect(result.storagePath).toBe(`svg_mockup/${sha256Hex(CLEAN_SVG)}.svg`);
  });

  // --- Nhóm "bytes gốc": prolog/DOCTYPE/comment trước <svg>, và biên thẻ mở ---

  it("ném lỗi khi chuỗi không bắt đầu bằng <svg sau khi trim — XML prolog", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
        client,
      }),
    ).rejects.toThrow();
  });

  it("ném lỗi khi chuỗi không bắt đầu bằng <svg sau khi trim — DOCTYPE", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
        client,
      }),
    ).rejects.toThrow();
  });

  it("ném lỗi khi chuỗi không bắt đầu bằng <svg sau khi trim — comment trước thẻ svg", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<!-- injected --><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
        client,
      }),
    ).rejects.toThrow();
  });

  it("ném lỗi khi thẻ mở chỉ TRÙNG tiền tố <svg (không có biên thẻ) — <svgx…>", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svgxFoo xmlns="http://www.w3.org/2000/svg"><rect/></svgxFoo>',
        client,
      }),
    ).rejects.toThrow();
  });

  it("chấp nhận <svg /> không thuộc tính, <svg xmlns=…>, và <svg … /> tự đóng (dạng chuẩn của outerHTML)", async () => {
    const { client: client1 } = createFakeClient();
    await expect(
      uploadSanitizedSvg({ kind: "SVG_MOCKUP" as AssetKind, svg: "<svg />", client: client1 }),
    ).resolves.toBeDefined();

    const { client: client2 } = createFakeClient();
    await expect(
      uploadSanitizedSvg({ kind: "SVG_MOCKUP" as AssetKind, svg: CLEAN_SVG, client: client2 }),
    ).resolves.toBeDefined();

    const { client: client3 } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" />',
        client: client3,
      }),
    ).resolves.toBeDefined();
  });

  it("chấp nhận khoảng trắng bao quanh <svg hợp lệ (chỉ trim, không đổi hành vi)", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: `\n  ${CLEAN_SVG}  \n`,
        client,
      }),
    ).resolves.toBeDefined();
  });

  it("từ chối SVG vượt MAX_ASSET_BYTES", async () => {
    const { client } = createFakeClient();
    const filler = " ".repeat(MAX_ASSET_BYTES);
    const huge = `<svg xmlns="http://www.w3.org/2000/svg">${filler}</svg>`;
    await expect(
      uploadSanitizedSvg({
        kind: "DESIGN_SVG" as AssetKind,
        svg: huge,
        client,
      }),
    ).rejects.toThrow();
  });

  it("publicUrl không bao giờ chứa service-role key", async () => {
    const { client } = createFakeClient();
    const result = await uploadSanitizedSvg({
      kind: "DESIGN_SVG" as AssetKind,
      svg: CLEAN_SVG,
      client,
    });
    expect(result.publicUrl).not.toContain(SERVICE_ROLE_KEY);
    expect(result.publicUrl.startsWith(SUPABASE_URL)).toBe(true);
  });

  // --- Early-exit rẻ tiền: script / on*= / comment ----------------------------
  // Giữ như "cheap early exit" (không phải hàng rào chính) — verifier bên dưới
  // đã đủ để bắt những trường hợp này, nhưng chúng rẻ hơn parse+sanitize.

  it("ném lỗi khi chuỗi chứa <script (early exit)", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        client,
      }),
    ).rejects.toThrow();
  });

  it("ném lỗi khi chuỗi chứa onload= (early exit)", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>',
        client,
      }),
    ).rejects.toThrow();
  });

  it("ném lỗi khi chuỗi chứa <!-- bên trong (early exit)", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><!-- comment --><rect/></svg>',
        client,
      }),
    ).rejects.toThrow();
  });

  // --- Verifier chính: sanitize lần hai, không phải regex ---------------------
  // Bốn payload dưới đây đều lọt qua ba regex early-exit ở trên (không có
  // <script>, không có on*=, không có <!--) — chúng CHỈ bị bắt vì
  // assertGenuinelySanitized() chạy sanitizeSvgRoot() thật lần thứ hai.

  it("verifier bắt javascript: href mà regex net bỏ lọt", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>',
        client,
      }),
    ).rejects.toThrow(/chưa qua sanitizeSvgRoot/);
  });

  it("verifier bắt <animate … to=\"javascript:…\"> mà regex net bỏ lọt", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"><animate attributeName="href" to="javascript:alert(1)"/></rect></svg>',
        client,
      }),
    ).rejects.toThrow(/chưa qua sanitizeSvgRoot/);
  });

  it("verifier bắt <foreignObject><iframe srcdoc> mà regex net bỏ lọt", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe srcdoc="hi"></iframe></foreignObject></svg>',
        client,
      }),
    ).rejects.toThrow(/chưa qua sanitizeSvgRoot/);
  });

  it("verifier bắt <style>@import mà regex net bỏ lọt", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/x.css);</style></svg>',
        client,
      }),
    ).rejects.toThrow(/chưa qua sanitizeSvgRoot/);
  });

  it("verifier bắt xlink:href javascript: và <use href=\"data:…\">", async () => {
    const { client: client1 } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>',
        client: client1,
      }),
    ).rejects.toThrow(/chưa qua sanitizeSvgRoot/);

    const { client: client2 } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><use href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E"/></svg>',
        client: client2,
      }),
    ).rejects.toThrow(/chưa qua sanitizeSvgRoot/);
  });

  // --- Nội dung SAU </svg>: lọt cả hai lưới cũ ---------------------------------
  // Kiểm raw-bytes chỉ nhìn phần ĐẦU chuỗi; verifier chỉ thấy cây con của root.
  // Parser bỏ qua mọi thứ sau thẻ đóng của root, nên sanitize lần hai không bao
  // giờ thấy phần đuôi — nhưng chuỗi được upload NGUYÊN VĂN, kể cả phần đuôi.
  // Hàng rào: parse lại phải ra đúng chính chuỗi đó (`root.outerHTML` là hợp đồng).

  const HEAD = '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>';

  it.each([
    ["<iframe> javascript:", `${HEAD}<iframe src="javascript:alert(1)">`],
    ["<a href=\"javascript:\">", `${HEAD}<a href="javascript:alert(1)">x</a>`],
    ["<style>", `${HEAD}<style>@import url(https://evil.example/x.css);</style>`],
    ["<meta http-equiv=refresh>", `${HEAD}<meta http-equiv="refresh" content="0;url=https://evil.example">`],
    ["processing instruction", `${HEAD}<?xml-stylesheet href="https://evil.example/x.css"?>`],
    ["thẻ <svg> anh em thứ hai", `${HEAD}<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect /></a></svg>`],
  ])("từ chối nội dung sau </svg>: %s", async (_label, svg) => {
    const { client, calls } = createFakeClient();
    await expect(
      uploadSanitizedSvg({ kind: "SVG_MOCKUP" as AssetKind, svg, client }),
    ).rejects.toThrow(/không khớp root\.outerHTML/);
    expect(calls).toHaveLength(0);
  });

  it("từ chối chuỗi gõ tay không phải dạng chuẩn của root.outerHTML (<svg></svg> thay vì <svg />)", async () => {
    const { client, calls } = createFakeClient();
    await expect(
      uploadSanitizedSvg({ kind: "SVG_MOCKUP" as AssetKind, svg: "<svg></svg>", client }),
    ).rejects.toThrow(/không khớp root\.outerHTML/);
    expect(calls).toHaveLength(0);
  });

  it.each(["crocodile.svg", "angler-fish.svg"])(
    "fixture %s: root.outerHTML sau parse+sanitize round-trip đúng từng byte (serialize idempotent)",
    (name) => {
      const outerHtml = sanitizedOuterHtml(loadFixture(name));
      expect(parseSvgFromText(outerHtml).outerHTML).toBe(outerHtml);
    },
  );

  // --- Hai fixture thật của dự án: đặc tả của "input hợp lệ trông như thế nào" ---

  it.each(["crocodile.svg", "angler-fish.svg"])(
    "fixture %s: sau parse+sanitize thật, upload thành công qua verifier",
    async (name) => {
      const outerHtml = sanitizedOuterHtml(loadFixture(name));
      const { client, calls } = createFakeClient();

      const result = await uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: outerHtml,
        client,
      });

      expect(calls).toHaveLength(1);
      expect(result.storagePath).toBe(`svg_mockup/${sha256Hex(outerHtml)}.svg`);
      expect(result.mimeType).toBe("image/svg+xml");
    },
  );
});

// --- AssetRejectedError: từ chối do INPUT phải phân biệt được với lỗi hạ tầng ---
//
// Route tầng trên (`src/lib/admin/assets.ts`) dùng `instanceof AssetRejectedError`
// để quyết định 422 (file hỏng) hay để lỗi nổi lên thành 500 (Storage sập).
// Mọi từ chối do input liệt trong brief Step 1 phải là AssetRejectedError; lỗi
// từ chính client Storage (upload trả `{ error }`) phải KHÔNG phải.

describe("AssetRejectedError — phân biệt từ chối do input với lỗi hạ tầng", () => {
  it("uploadBinaryAsset: mimeType ngoài allowlist", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadBinaryAsset({ kind: "DISPLAY" as AssetKind, bytes: pngBytes(), mimeType: "image/gif", client }),
    ).rejects.toBeInstanceOf(AssetRejectedError);
  });

  it("uploadBinaryAsset: magic bytes không khớp mimeType đã khai", async () => {
    const { client } = createFakeClient();
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await expect(
      uploadBinaryAsset({ kind: "TEXTURE" as AssetKind, bytes: svgBytes, mimeType: "image/png", client }),
    ).rejects.toBeInstanceOf(AssetRejectedError);
  });

  it("uploadBinaryAsset: file bị cắt cụt", async () => {
    const { client } = createFakeClient();
    const truncated = new Uint8Array([0x89, 0x50]);
    await expect(
      uploadBinaryAsset({ kind: "TEXTURE" as AssetKind, bytes: truncated, mimeType: "image/png", client }),
    ).rejects.toBeInstanceOf(AssetRejectedError);
  });

  it("uploadBinaryAsset: vượt MAX_ASSET_BYTES", async () => {
    const { client } = createFakeClient();
    const tooBig = webpBytes(MAX_ASSET_BYTES + 1);
    await expect(
      uploadBinaryAsset({ kind: "TEXTURE" as AssetKind, bytes: tooBig, mimeType: "image/webp", client }),
    ).rejects.toBeInstanceOf(AssetRejectedError);
  });

  it("uploadSanitizedSvg: bytes gốc — XML prolog trước <svg>", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
        client,
      }),
    ).rejects.toBeInstanceOf(AssetRejectedError);
  });

  it("uploadSanitizedSvg: chưa qua sanitizeSvgRoot (javascript: href)", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>',
        client,
      }),
    ).rejects.toBeInstanceOf(AssetRejectedError);
  });

  it("uploadSanitizedSvg: không round-trip (nội dung sau </svg>)", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg><iframe src="javascript:alert(1)">',
        client,
      }),
    ).rejects.toBeInstanceOf(AssetRejectedError);
  });

  it("uploadSanitizedSvg: vượt MAX_ASSET_BYTES", async () => {
    const { client } = createFakeClient();
    const filler = " ".repeat(MAX_ASSET_BYTES);
    const huge = `<svg xmlns="http://www.w3.org/2000/svg">${filler}</svg>`;
    await expect(
      uploadSanitizedSvg({ kind: "SVG_MOCKUP" as AssetKind, svg: huge, client }),
    ).rejects.toBeInstanceOf(AssetRejectedError);
  });

  it("lỗi từ client Storage thật (upload trả { error }) KHÔNG phải AssetRejectedError — của uploadBinaryAsset", async () => {
    const { client } = createFakeClient({ failWith: { message: "network is down" } });
    await expect(
      uploadBinaryAsset({ kind: "TEXTURE" as AssetKind, bytes: webpBytes(), mimeType: "image/webp", client }),
    ).rejects.not.toBeInstanceOf(AssetRejectedError);
  });

  it("lỗi từ client Storage thật (upload trả { error }) KHÔNG phải AssetRejectedError — của uploadSanitizedSvg", async () => {
    const { client } = createFakeClient({ failWith: { message: "network is down" } });
    const cleanSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z" /></svg>';
    await expect(
      uploadSanitizedSvg({ kind: "SVG_MOCKUP" as AssetKind, svg: cleanSvg, client }),
    ).rejects.not.toBeInstanceOf(AssetRejectedError);
  });
});
