import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { CONTRACT_VERSION } from "@/svg-engine";
import { resetDb, seedShop, TEST_SHOP } from "../helpers/db";
import { adminRequest, useAdminEnv } from "../../tests/helpers/adminRequest";

/**
 * Route thật cho `POST /api/admin/assets` và `POST /api/admin/assets/validate-svg`
 * — nơi DUY NHẤT admin đưa file vào hệ thống. SVG mockup đi qua đủ chuỗi
 * parse → sanitize → kiểm URL ngoài → kiểm hợp đồng → lưu `root.outerHTML`.
 * Ảnh đi qua kiểm mime + magic bytes.
 *
 * Postgres thật (không mock `@/lib/db`); Supabase Storage giả qua seam
 * `src/lib/admin/assetStorage.ts` — ranh giới ngoài hợp lệ duy nhất được phép
 * thay bằng `vi.mock`.
 */

const uploads: Array<{ path: string; body: unknown; contentType?: string }> = [];
let forceUploadError: { message: string; statusCode?: string } | null = null;

vi.mock("@/lib/admin/assetStorage", () => ({
  assetStorageClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string, body: unknown, options?: { contentType?: string }) => {
          if (forceUploadError) {
            return { data: null, error: forceUploadError };
          }
          uploads.push({ path, body, contentType: options?.contentType });
          return { data: { path }, error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/wk-assets/${path}` } }),
      }),
    },
  }),
}));

// Import SAU vi.mock — hoisting của vitest đảm bảo mock có hiệu lực trước khi
// route module (và qua đó `assetStorageClient`) được load.
import { POST as uploadAsset } from "@/app/api/admin/assets/route";
import { POST as validateSvg } from "@/app/api/admin/assets/validate-svg/route";

function loadFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../tests/fixtures/svg/${name}`, import.meta.url)), "utf8");
}

function svgFile(content: string, name = "mockup.svg"): File {
  return new File([content], name, { type: "image/svg+xml" });
}

const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP_WEBP = [0x57, 0x45, 0x42, 0x50];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function webpBytes(length = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(WEBP_RIFF, 0);
  bytes.set(WEBP_WEBP, 8);
  return bytes;
}

function pngBytes(length = 16): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(PNG_MAGIC, 0);
  return bytes;
}

async function uploadForm(fields: Record<string, string | File>): Promise<FormData> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value as never);
  }
  return form;
}

describe("POST /api/admin/assets — Postgres thật, Storage giả", () => {
  beforeEach(async () => {
    await resetDb();
    useAdminEnv();
    vi.stubEnv("SUPABASE_STORAGE_BUCKET", "wk-assets");
    uploads.length = 0;
    forceUploadError = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("angler-fish.svg với kind=SVG_MOCKUP: 201, một hàng Asset, nội dung upload KHÁC bytes gốc và BẰNG root.outerHTML sau parse+sanitize", async () => {
    const shop = await seedShop();
    const raw = loadFixture("angler-fish.svg");
    const form = await uploadForm({ file: svgFile(raw), kind: "SVG_MOCKUP" });

    const req = await adminRequest("https://app.test/api/admin/assets", { method: "POST", body: form });
    const res = await uploadAsset(req);
    const body = (await res.json()) as { asset: { id: string; width: number; height: number }; created: boolean };

    expect(res.status).toBe(201);
    expect(body.created).toBe(true);
    expect(body.asset.width).toBe(1427);
    expect(body.asset.height).toBe(1102);

    const rows = await db.asset.findMany({ where: { shopId: shop.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].svgValidatedAt).not.toBeNull();
    expect(rows[0].svgContractVer).toBe(CONTRACT_VERSION);
    expect(rows[0].storagePath).toMatch(/^svg_mockup\/[0-9a-f]{64}\.svg$/);

    // Khẳng định quan trọng nhất của task: bytes gửi lên Storage KHÔNG phải
    // bytes gốc của file, và BẰNG root.outerHTML sau parse + sanitize.
    expect(uploads).toHaveLength(1);
    const uploadedBody = uploads[0].body as string;
    expect(uploadedBody).not.toBe(raw);
    expect(typeof uploadedBody).toBe("string");
    expect(uploadedBody.startsWith("<svg")).toBe(true);
  });

  it("cùng file lần hai: 200, cùng asset.id, vẫn chỉ một hàng", async () => {
    await seedShop();
    const raw = loadFixture("angler-fish.svg");

    const req1 = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(raw), kind: "SVG_MOCKUP" }),
    });
    const res1 = await uploadAsset(req1);
    const body1 = (await res1.json()) as { asset: { id: string }; created: boolean };
    expect(res1.status).toBe(201);

    const req2 = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(raw), kind: "SVG_MOCKUP" }),
    });
    const res2 = await uploadAsset(req2);
    const body2 = (await res2.json()) as { asset: { id: string }; created: boolean };

    expect(res2.status).toBe(200);
    expect(body2.created).toBe(false);
    expect(body2.asset.id).toBe(body1.asset.id);

    const rows = await db.asset.findMany();
    expect(rows).toHaveLength(1);
  });

  it("cùng file, nhưng hàng hiện có đang archived: 200, created:false, bỏ archive", async () => {
    await seedShop();
    const raw = loadFixture("angler-fish.svg");

    const req1 = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(raw), kind: "SVG_MOCKUP" }),
    });
    const res1 = await uploadAsset(req1);
    const body1 = (await res1.json()) as { asset: { id: string } };
    expect(res1.status).toBe(201);

    await db.asset.update({ where: { id: body1.asset.id }, data: { archivedAt: new Date() } });

    const req2 = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(raw), kind: "SVG_MOCKUP" }),
    });
    const res2 = await uploadAsset(req2);
    const body2 = (await res2.json()) as { asset: { id: string }; created: boolean };

    expect(res2.status).toBe(200);
    expect(body2.created).toBe(false);
    expect(body2.asset.id).toBe(body1.asset.id);

    const row = await db.asset.findUniqueOrThrow({ where: { id: body1.asset.id } });
    expect(row.archivedAt).toBeNull();
  });

  it("cùng file, shop khác: 201, hàng mới — dedupe theo shop", async () => {
    useAdminEnv([TEST_SHOP, "other-shop.myshopify.com"]);
    await seedShop(TEST_SHOP);
    await seedShop("other-shop.myshopify.com");
    const raw = loadFixture("angler-fish.svg");

    const req1 = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(raw), kind: "SVG_MOCKUP" }),
      shop: TEST_SHOP,
    });
    const res1 = await uploadAsset(req1);
    expect(res1.status).toBe(201);

    const req2 = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(raw), kind: "SVG_MOCKUP" }),
      shop: "other-shop.myshopify.com",
    });
    const res2 = await uploadAsset(req2);
    const body2 = (await res2.json()) as { created: boolean };

    expect(res2.status).toBe(201);
    expect(body2.created).toBe(true);

    const rows = await db.asset.findMany();
    expect(rows).toHaveLength(2);
  });

  it("mockup hợp lệ chèn <script>alert(1)</script>: 201, sanitization.removedElements chứa script, nội dung upload không chứa <script", async () => {
    await seedShop();
    const raw = loadFixture("crocodile.svg");
    const withScript = raw.replace("</svg>", "<script>alert(1)</script></svg>");
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(withScript), kind: "SVG_MOCKUP" }),
    });
    const res = await uploadAsset(req);
    const body = (await res.json()) as { sanitization: { removedElements: string[] } };

    expect(res.status).toBe(201);
    expect(body.sanitization.removedElements).toContain("script");
    expect(uploads).toHaveLength(1);
    expect(String(uploads[0].body)).not.toContain("<script");
  });

  it('mockup có <image href="https://evil.example/x.png"/>: 422 external_reference (R5), storage không được gọi, không có hàng Asset', async () => {
    await seedShop();
    const raw = loadFixture("crocodile.svg");
    const withExternal = raw.replace(
      "</svg>",
      '<image href="https://evil.example/x.png" width="1" height="1"/></svg>',
    );
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(withExternal), kind: "SVG_MOCKUP" }),
    });
    const res = await uploadAsset(req);
    const body = (await res.json()) as { errors: Array<{ field: string; code: string }>; externalRefs: string[] };

    expect(res.status).toBe(422);
    expect(body.errors).toEqual([expect.objectContaining({ field: "file", code: "external_reference" })]);
    expect(body.externalRefs).toContain("https://evil.example/x.png");
    expect(uploads).toHaveLength(0);
    await expect(db.asset.count()).resolves.toBe(0);
  });

  it('mockup nhúng data: URI qua <image href>: 422 embedded_resource, storage không được gọi, không có hàng Asset', async () => {
    await seedShop();
    const raw = loadFixture("crocodile.svg");
    const withDataUri = raw.replace(
      "</svg>",
      '<image href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+" width="1" height="1"/></svg>',
    );
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(withDataUri), kind: "SVG_MOCKUP" }),
    });
    const res = await uploadAsset(req);
    const body = (await res.json()) as { errors: Array<{ field: string; code: string }>; embeddedRefs: string[] };

    expect(res.status).toBe(422);
    expect(body.errors).toEqual([expect.objectContaining({ field: "file", code: "embedded_resource" })]);
    expect(body.embeddedRefs.some((ref) => ref.startsWith("data:"))).toBe(true);
    expect(uploads).toHaveLength(0);
    await expect(db.asset.count()).resolves.toBe(0);
  });

  it('mockup nhúng data: URI qua style="fill:url(data:...)": 422 embedded_resource', async () => {
    await seedShop();
    const raw = loadFixture("crocodile.svg");
    const withStyleDataUri = raw.replace(
      "</svg>",
      '<rect style="fill:url(data:image/svg+xml;base64,AAAA)" width="1" height="1"/></svg>',
    );
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(withStyleDataUri), kind: "SVG_MOCKUP" }),
    });
    const res = await uploadAsset(req);

    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: Array<{ field: string; code: string }> };
    expect(body.errors).toEqual([expect.objectContaining({ code: "embedded_resource" })]);
    expect(uploads).toHaveLength(0);
  });

  it('văn bản trong <text> nhắc tới "data:" không bị coi là embedded resource — không phải vị trí URL', async () => {
    await seedShop();
    const raw = loadFixture("crocodile.svg");
    const withText = raw.replace("</svg>", '<text x="0" y="0">data: 42</text></svg>');
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(withText), kind: "SVG_MOCKUP" }),
    });
    const res = await uploadAsset(req);
    expect(res.status).toBe(201);
  });

  it.each(["angler-fish.svg", "crocodile.svg"])(
    "%s (fixture thật, không data: URI): vẫn 201 sau khi thêm kiểm embedded_resource",
    async (fixture) => {
      await seedShop();
      const req = await adminRequest("https://app.test/api/admin/assets", {
        method: "POST",
        body: await uploadForm({ file: svgFile(loadFixture(fixture), fixture), kind: "SVG_MOCKUP" }),
      });
      const res = await uploadAsset(req);
      expect(res.status).toBe(201);
    },
  );

  it("SVG hợp lệ cú pháp nhưng thiếu #animal-artwork: 422 svg_contract kèm validation, storage không được gọi", async () => {
    await seedShop();
    const raw = loadFixture("crocodile.svg");
    const missingAnimalArtwork = raw.replace('id="animal-artwork"', 'id="animal-artwork-renamed"');
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(missingAnimalArtwork), kind: "SVG_MOCKUP" }),
    });
    const res = await uploadAsset(req);
    const body = (await res.json()) as {
      errors: Array<{ field: string; code: string }>;
      validation: { valid: boolean; checks: unknown[] };
    };

    expect(res.status).toBe(422);
    expect(body.errors).toEqual([expect.objectContaining({ field: "file", code: "svg_contract" })]);
    expect(body.validation.valid).toBe(false);
    expect(Array.isArray(body.validation.checks)).toBe(true);
    expect(uploads).toHaveLength(0);
    await expect(db.asset.count()).resolves.toBe(0);
  });

  it("file text không phải SVG: 422 svg_parse", async () => {
    await seedShop();
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile("not an svg at all", "junk.svg"), kind: "SVG_MOCKUP" }),
    });
    const res = await uploadAsset(req);
    const body = (await res.json()) as { errors: Array<{ field: string; code: string }> };

    expect(res.status).toBe(422);
    expect(body.errors).toEqual([expect.objectContaining({ field: "file", code: "svg_parse" })]);
  });

  it("kind=DESIGN_SVG: 422 field kind — design SVG chỉ server sinh ra", async () => {
    await seedShop();
    const raw = loadFixture("crocodile.svg");
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(raw), kind: "DESIGN_SVG" }),
    });
    const res = await uploadAsset(req);
    const body = (await res.json()) as { errors: Array<{ field: string; code: string }> };

    expect(res.status).toBe(422);
    expect(body.errors).toEqual([expect.objectContaining({ field: "kind" })]);
  });

  it("thiếu file: 422 field file", async () => {
    await seedShop();
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ kind: "SVG_MOCKUP" }),
    });
    const res = await uploadAsset(req);
    const body = (await res.json()) as { errors: Array<{ field: string; code: string }> };

    expect(res.status).toBe(422);
    expect(body.errors).toEqual([expect.objectContaining({ field: "file" })]);
  });

  it("thiếu kind: 422 field kind", async () => {
    await seedShop();
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(loadFixture("crocodile.svg")) }),
    });
    const res = await uploadAsset(req);
    const body = (await res.json()) as { errors: Array<{ field: string; code: string }> };

    expect(res.status).toBe(422);
    expect(body.errors).toEqual([expect.objectContaining({ field: "kind" })]);
  });

  it("TEXTURE với bytes WebP hợp lệ, mime image/webp: 201, storagePath texture/….webp", async () => {
    await seedShop();
    const bytes = webpBytes();
    const file = new File([Buffer.from(bytes)], "leather.webp", { type: "image/webp" });
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file, kind: "TEXTURE" }),
    });
    const res = await uploadAsset(req);
    const body = (await res.json()) as { asset: { publicUrl: string } };

    expect(res.status).toBe(201);
    const row = await db.asset.findFirst({ where: { kind: "TEXTURE" } });
    expect(row?.storagePath).toMatch(/^texture\/[0-9a-f]{64}\.webp$/);
    expect(body.asset.publicUrl).toContain(row?.storagePath ?? "\0");
  });

  it("bytes PNG khai mime image/webp: 422 invalid_image", async () => {
    await seedShop();
    const file = new File([Buffer.from(pngBytes())], "fake.webp", { type: "image/webp" });
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file, kind: "TEXTURE" }),
    });
    const res = await uploadAsset(req);
    const body = (await res.json()) as { errors: Array<{ field: string; code: string }> };

    expect(res.status).toBe(422);
    expect(body.errors).toEqual([expect.objectContaining({ field: "file", code: "invalid_image" })]);
  });

  it('bytes SVG khai mime image/png với kind=DISPLAY: 422 invalid_image', async () => {
    await seedShop();
    const file = new File([loadFixture("crocodile.svg")], "fake.png", { type: "image/png" });
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file, kind: "DISPLAY" }),
    });
    const res = await uploadAsset(req);
    const body = (await res.json()) as { errors: Array<{ field: string; code: string }> };

    expect(res.status).toBe(422);
    expect(body.errors).toEqual([expect.objectContaining({ field: "file", code: "invalid_image" })]);
  });

  it("file > MAX_ASSET_BYTES: 413 PAYLOAD_TOO_LARGE", async () => {
    await seedShop();
    const tooBig = webpBytes(4 * 1024 * 1024 + 1);
    const file = new File([Buffer.from(tooBig)], "huge.webp", { type: "image/webp" });
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file, kind: "TEXTURE" }),
    });

    // Header `content-length` không được đảm bảo có mặt trong môi trường test
    // (Node's fetch không luôn tính trước cho FormData) — 413 vẫn phải xảy ra
    // nhờ lớp kiểm lại kích thước THẬT của file đã parse trong assets.ts.
    const res = await uploadAsset(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(413);
    expect(body.error).toBe("PAYLOAD_TOO_LARGE");
  });

  it("fake storage trả { error }: lời gọi route reject (500), không biến thành 422", async () => {
    await seedShop();
    forceUploadError = { message: "network is down" };
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(loadFixture("crocodile.svg")), kind: "SVG_MOCKUP" }),
    });

    await expect(uploadAsset(req)).rejects.toThrow();
  });

  it("không token: 401", async () => {
    await seedShop();
    const req = await adminRequest("https://app.test/api/admin/assets", {
      method: "POST",
      body: await uploadForm({ file: svgFile(loadFixture("crocodile.svg")), kind: "SVG_MOCKUP" }),
      token: null,
    });
    const res = await uploadAsset(req);
    expect(res.status).toBe(401);
    await expect(db.asset.count()).resolves.toBe(0);
  });
});

describe("POST /api/admin/assets/validate-svg — Postgres thật, Storage giả", () => {
  beforeEach(async () => {
    await resetDb();
    useAdminEnv();
    vi.stubEnv("SUPABASE_STORAGE_BUCKET", "wk-assets");
    uploads.length = 0;
    forceUploadError = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fixture hợp lệ: 200 { valid: true, validation, sanitization }, không hàng Asset, storage không được gọi", async () => {
    await seedShop();
    const req = await adminRequest("https://app.test/api/admin/assets/validate-svg", {
      method: "POST",
      body: await uploadForm({ file: svgFile(loadFixture("angler-fish.svg")) }),
    });
    const res = await validateSvg(req);
    const body = (await res.json()) as { valid: boolean; validation: unknown; sanitization: unknown };

    expect(res.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(body.validation).toBeTruthy();
    expect(body.sanitization).toBeTruthy();
    expect(uploads).toHaveLength(0);
    await expect(db.asset.count()).resolves.toBe(0);
  });

  it("thiếu ID bắt buộc: 200 { valid: false, validation: { checks: [...] } } — báo cáo, không phải lỗi", async () => {
    await seedShop();
    const raw = loadFixture("crocodile.svg");
    const missingAnimalArtwork = raw.replace('id="animal-artwork"', 'id="animal-artwork-renamed"');
    const req = await adminRequest("https://app.test/api/admin/assets/validate-svg", {
      method: "POST",
      body: await uploadForm({ file: svgFile(missingAnimalArtwork) }),
    });
    const res = await validateSvg(req);
    const body = (await res.json()) as { valid: boolean; validation: { checks: unknown[] } };

    expect(res.status).toBe(200);
    expect(body.valid).toBe(false);
    expect(Array.isArray(body.validation.checks)).toBe(true);
  });

  it("có URL ngoài: 200 { valid: false, externalRefs: [...] }", async () => {
    await seedShop();
    const raw = loadFixture("crocodile.svg");
    const withExternal = raw.replace(
      "</svg>",
      '<image href="https://evil.example/x.png" width="1" height="1"/></svg>',
    );
    const req = await adminRequest("https://app.test/api/admin/assets/validate-svg", {
      method: "POST",
      body: await uploadForm({ file: svgFile(withExternal) }),
    });
    const res = await validateSvg(req);
    const body = (await res.json()) as { valid: boolean; externalRefs: string[] };

    expect(res.status).toBe(200);
    expect(body.valid).toBe(false);
    expect(body.externalRefs).toContain("https://evil.example/x.png");
  });

  it('có data: URI qua <image href>: 200 { valid: false, embeddedRefs: [...] } — báo cáo, không phải lỗi', async () => {
    await seedShop();
    const raw = loadFixture("crocodile.svg");
    const withDataUri = raw.replace(
      "</svg>",
      '<image href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+" width="1" height="1"/></svg>',
    );
    const req = await adminRequest("https://app.test/api/admin/assets/validate-svg", {
      method: "POST",
      body: await uploadForm({ file: svgFile(withDataUri) }),
    });
    const res = await validateSvg(req);
    const body = (await res.json()) as { valid: boolean; embeddedRefs: string[] };

    expect(res.status).toBe(200);
    expect(body.valid).toBe(false);
    expect(body.embeddedRefs.some((ref) => ref.startsWith("data:"))).toBe(true);
  });

  it("không phải SVG: 422 svg_parse", async () => {
    await seedShop();
    const req = await adminRequest("https://app.test/api/admin/assets/validate-svg", {
      method: "POST",
      body: await uploadForm({ file: svgFile("not an svg", "junk.svg") }),
    });
    const res = await validateSvg(req);
    const body = (await res.json()) as { errors: Array<{ field: string; code: string }> };

    expect(res.status).toBe(422);
    expect(body.errors).toEqual([expect.objectContaining({ field: "file", code: "svg_parse" })]);
  });
});
