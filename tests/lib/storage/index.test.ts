import { describe, expect, it, afterEach } from "vitest";
import type { AssetKind } from "@prisma/client";
import {
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

  it("trả về client khi cả hai biến hợp lệ — không chạm mạng", () => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
    expect(() => createStorageClient()).not.toThrow();
  });
});

describe("uploadBinaryAsset", () => {
  it("upload với contentType đúng, gọi client đã tiêm — không chạm mạng", async () => {
    const { client, calls } = createFakeClient();
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const result = await uploadBinaryAsset({
      kind: "TEXTURE" as AssetKind,
      bytes,
      mimeType: "image/webp",
      client,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].uploadOptions.contentType).toBe("image/webp");
    expect(calls[0].path).toBe(`texture/${sha256Hex(bytes)}.webp`);
    expect(result.mimeType).toBe("image/webp");
    expect(result.checksumSha256).toBe(sha256Hex(bytes));
    expect(result.byteSize).toBe(4);
    expect(result.storagePath).toBe(`texture/${sha256Hex(bytes)}.webp`);
  });

  it("từ chối mimeType ngoài allowlist", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadBinaryAsset({
        kind: "DISPLAY" as AssetKind,
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/gif",
        client,
      }),
    ).rejects.toThrow();
  });

  it("chấp nhận webp, png, jpeg", async () => {
    const { client } = createFakeClient();
    for (const mimeType of ["image/webp", "image/png", "image/jpeg"]) {
      await expect(
        uploadBinaryAsset({
          kind: "DISPLAY" as AssetKind,
          bytes: new Uint8Array([1, 2, 3]),
          mimeType,
          client,
        }),
      ).resolves.toBeDefined();
    }
  });

  it("từ chối file vượt MAX_ASSET_BYTES", async () => {
    const { client } = createFakeClient();
    const tooBig = new Uint8Array(MAX_ASSET_BYTES + 1);
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
    const exact = new Uint8Array(MAX_ASSET_BYTES);
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
      bytes: new Uint8Array([9, 9, 9]),
      mimeType: "image/png",
      client,
    });
    expect(result.publicUrl.startsWith(SUPABASE_URL)).toBe(true);
    expect(result.publicUrl).toContain(result.storagePath);
    expect(result.publicUrl).not.toContain(SERVICE_ROLE_KEY);
  });

  it("upload trùng nội dung (cùng path) được coi là thành công — upsert:true", async () => {
    const { client, calls } = createFakeClient();
    const bytes = new Uint8Array([5, 5, 5]);
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
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/webp",
        client,
      }),
    ).rejects.toThrow(/network is down/);
  });
});

describe("uploadSanitizedSvg", () => {
  const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>';

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
    // "dài" = bất biến thật sự, không phải vài giây/phút mặc định.
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    expect(maxAgeMatch).not.toBeNull();
    expect(Number(maxAgeMatch![1])).toBeGreaterThanOrEqual(60 * 60 * 24 * 30);
    expect(result.mimeType).toBe("image/svg+xml");
    expect(result.storagePath).toBe(`svg_mockup/${sha256Hex(CLEAN_SVG)}.svg`);
  });

  it("ném lỗi khi chuỗi chứa <script", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        client,
      }),
    ).rejects.toThrow();
  });

  it("ném lỗi khi chuỗi chứa onload=", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>',
        client,
      }),
    ).rejects.toThrow();
  });

  it("ném lỗi khi chuỗi chứa <!--", async () => {
    const { client } = createFakeClient();
    await expect(
      uploadSanitizedSvg({
        kind: "SVG_MOCKUP" as AssetKind,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><!-- comment --><rect/></svg>',
        client,
      }),
    ).rejects.toThrow();
  });

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
    const filler = "<!-- ".repeat(0) + " ".repeat(MAX_ASSET_BYTES);
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
});
