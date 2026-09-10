# P2a — Admin API (Attributes · Assets · Product config) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng toàn bộ API backend `/api/admin/*` mà tab **Attributes** và tab **Products** cần — CRUD bốn nhóm attribute, upload asset, cấu hình product (host, ma trận giá A/B, lưới SVG style × animal) — chạy và được test trên **Postgres thật**, chưa đụng Shopify Admin API và chưa có giao diện.

**Architecture:** Mọi route admin viết bằng `withAdminSession(adminApi(handler))`: `withAdminSession` (đã có từ P1b) lo xác thực, `adminApi` (mới) lo tra `Shop`, parse body bằng zod, và dịch lỗi Prisma thành HTTP. Logic nghiệp vụ nằm ở `src/lib/admin/`, route file chỉ vài dòng. Test route chạy trên Postgres thật trong Docker qua lệnh riêng `npm run test:db`; `npm test` giữ nguyên hermetic, không cần Docker.

**Tech Stack:** Next.js 14 App Router · Prisma 5 · PostgreSQL 16 (Docker, cho test) · zod 3 · Vitest

**Spec:** `docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md` (§7 schema, §8.1 admin API, §12 admin IA)

**Phase kế tiếp (không thuộc plan này):** P2b — bộ sinh variant qua `productSet` + sync. P2c — giao diện admin 2 tab + production queue.

## Global Constraints

- **Mọi handler `/api/admin/*` viết đúng hình `export const <METHOD> = withAdminSession(adminApi(async (req, ctx) => …))`.** `tests/app/api/admin/route-guard.test.ts` từ chối mọi hình khác. Không sửa scanner để nới luật.
- **Mọi truy vấn phải scope theo shop.** Bảng attribute và `CustomizableProduct` có `shopId` — lọc trực tiếp. Bảng join (`ProductStyle`, `ProductStyleLeather`, `ProductAnimal`, `AnimalLeather`, `ProductStyleAnimal`, `ProductStitch`) **không** có `shopId` (spec §7 viết vậy): luôn tải `CustomizableProduct` theo `(id, shopId)` TRƯỚC, rồi mới chạm con của nó theo `productId`. Một id của shop khác phải trả **404**, không phải 403 — không xác nhận sự tồn tại.
- **Không bao giờ hard-delete attribute hay hàng cấu hình giá.** `DELETE` attribute = đặt `archivedAt`. `PUT` quan hệ: phần tử **vắng mặt** trong danh sách mong muốn → `isActive = false`, không xoá (spec §7.3; `Restrict` ở schema sẽ chặn xoá dù sao). Ngoại lệ duy nhất: `ProductHost` là bảng định tuyến không có con — vắng mặt thì xoá.
- **Tiền không bao giờ là float trong JSON admin.** Nhận giá dạng chuỗi hoặc số, chuẩn hoá về chuỗi 2 chữ số thập phân (`"80.00"`); trả về cũng dạng chuỗi. `Decimal` của Prisma KHÔNG được `JSON.stringify` thẳng (ra chuỗi không định dạng) — đổi tường minh.
- **Không lưu bytes SVG gốc.** Upload SVG đi qua `parseSvgFromText → sanitizeSvgRoot → validateSvgContract → uploadSanitizedSvg(root.outerHTML)`. Đường duy nhất vào bucket là `src/lib/storage/index.ts`.
- **Lỗi có một hình duy nhất.** Validation: `422 { errors: [{ field, code, message }] }` (cùng hình spec §8.2). Lỗi khác: `{ error: "<CODE>", message? }` với `404 NOT_FOUND`, `409 CONFLICT | IN_USE | SHOP_NOT_INSTALLED`, `413 PAYLOAD_TOO_LARGE`.
- **Test route bằng Postgres thật, không mock Prisma.** Mock DB chính là kiểu bẫy đã giấu một lỗi 100% ở P1a (124 test xanh trong khi production chết). Được phép thay thế đúng một ranh giới ngoài: client Supabase Storage.
- **`test:db` chỉ được chạy lên Postgres cục bộ.** Harness chạy `prisma db push --force-reset`; nó phải **từ chối** mọi URL có host khác `localhost`/`127.0.0.1`.
- Stage file bằng đường dẫn tường minh — **không bao giờ** `git add -A` / `git add .`.
- Comment và commit message tiếng Việt; identifier tiếng Anh. Mọi commit kết thúc bằng dòng `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Không gọi mạng tới Supabase, Shopify hay Vercel thật. Không chạy `prisma db push` lên DB thật.

## Rulings đã chốt trước khi bắt đầu

| # | Ruling | Lý do | Chi phí nếu sai |
|---|---|---|---|
| R1 | Ba cột `shopifyProductId`, `shopifyVariantId`, `shopifyVariantGid` trên `ProductStyleLeather` và `AnimalLeather` thành **nullable** | Lỗi thật của P1b: chúng đang bắt buộc, nên admin **không thể** tạo hàng giá trước khi generate variant — cột `priceInput` (P1b R6) thành vô dụng. Postgres cho nhiều NULL dưới `@@unique`, nên ràng buộc "một variant một cặp" vẫn giữ cho hàng đã có variant. DB chưa từng được push nên không có dữ liệu nào bị ảnh hưởng. | Một migration nhỏ |
| R2 | Test DB bằng Postgres 16 trong Docker, lệnh riêng `npm run test:db`; `npm test` không đổi | Đã thử: container lên trong vài giây, schema P1b áp vào sạch (18 bảng). `pglite-prisma-adapter` cần Prisma 7 — loại. Mock Prisma — loại (xem Global Constraints). | Máy không có Docker không chạy được `test:db`; `npm test` vẫn chạy |
| R3 | `adminApi(handler)` bọc **bên trong** `withAdminSession(...)` thay vì thay thế nó | Scanner guard khớp đúng `withAdminSession(`; giữ scanner nguyên vẹn thay vì nới luật cho một wrapper thứ hai | Mỗi route dài thêm vài ký tự |
| R4 | `PUT` quan hệ: vắng mặt → `isActive = false`, không xoá; `ProductHost` là ngoại lệ (xoá) | Spec §8.1 nói "server diff" nhưng không nói diff xoá hay tắt. Xoá bị `Restrict` chặn (con của `ProductStyle`), và vi phạm chính sách không-hard-delete. Tắt thì đảo ngược được, và giá đã gõ không mất. | Admin thấy hàng "inactive" tích tụ; UI lọc đi |
| R5 | Upload `SVG_MOCKUP` có bất kỳ `externalRefs` nào → **422 `EXTERNAL_REFERENCE`** | Hai mockup thật có 0 URL ngoài: texture được áp lúc runtime bởi `applyTexture`, không nằm sẵn trong master. URL ngoài trong master là rò rỉ (tracking pixel) hoặc sai quy trình. Kiểm trên fixture: không false positive. | Nới lại thành cảnh báo |
| R6 | Upload SVG không hợp lệ theo hợp đồng → **422 kèm báo cáo từng ID, KHÔNG lưu** | Spec §12.2: "upload SVG (validate ngay, báo cáo từng ID)". Lưu file hỏng rồi gắn vào lưới là để storefront render trắng. | — |
| R7 | Route attribute là **bốn thư mục tường minh** (`leathers/`, `stitches/`, `animals/`, `styles/`), mỗi file vài dòng gọi một factory dùng chung — không dùng segment động `[attribute]` | Segment động cạnh `products/` phụ thuộc thứ tự ưu tiên route của Next; file tường minh thì grep được và scanner thấy từng cái | 12 file mỏng thay vì 3 |
| R8 | Giá trả về admin dạng **chuỗi** `"80.00"` | Không có float nào trong đường tiền; tránh đúng bẫy `Decimal` → JSON đã ghi ở CLAUDE.md | UI parse chuỗi |

---

## Cấu trúc file

**Tạo mới**

| File | Trách nhiệm |
|---|---|
| `scripts/test-db.mjs` | Dựng Postgres trong Docker, `db push --force-reset`, chạy suite DB, luôn dọn container |
| `vitest.db.config.ts` | Config Vitest cho `tests-db/**`, tuần tự (một DB dùng chung) |
| `tests-db/helpers/db.ts` | `resetDb()` (TRUNCATE mọi bảng), `seedShop()`, `seedAsset()` |
| `tests/helpers/adminRequest.ts` | Mint session token, dựng `NextRequest` admin — dùng cho cả `tests/` và `tests-db/` |
| `src/lib/admin/http.ts` | `jsonError`, `validationError`, `parseJson` — hình lỗi duy nhất |
| `src/lib/admin/prismaErrors.ts` | Dịch `P2002`/`P2003`/`P2025` thành 409/409/404 |
| `src/lib/admin/adminApi.ts` | Wrapper: tra `Shop`, bắt lỗi Prisma, đưa `{ session, params, shop }` cho handler |
| `src/lib/admin/money.ts` | Chuẩn hoá giá ↔ chuỗi `"80.00"` |
| `src/lib/admin/assets.ts` | Upload asset: nhánh SVG (sanitize → validate → lưu) và nhánh ảnh |
| `src/lib/admin/assetStorage.ts` | Seam duy nhất lấy client Storage — test thay nó, không thay gì khác |
| `src/lib/admin/attributes.ts` | Factory CRUD dùng chung cho Leather / Stitch / Animal / Style |
| `src/lib/admin/products.ts` | Product config: tree, host, bảng quan hệ, ma trận giá, lưới SVG |
| `src/lib/admin/diff.ts` | `diffByKey()` thuần — nền của mọi `PUT` quan hệ |
| `src/app/api/admin/**/route.ts` | Route mỏng, mỗi file vài dòng |

**Sửa**

| File | Thay đổi |
|---|---|
| `prisma/schema.prisma` | R1: ba cột Shopify nullable trên hai bảng giá |
| `tests/prisma/schema.test.ts` | Khẳng định R1 |
| `package.json` | Script `test:db` |
| `CLAUDE.md`, spec §8.1 | Quy ước admin API, `test:db`, ngữ nghĩa `PUT` |

---

### Task 1: Harness Postgres thật + sửa schema bảng giá

Mọi task sau test route trên DB thật, nên harness đi trước. Task này cũng sửa lỗi schema R1, và dùng chính harness để chứng minh bản sửa đúng trên Postgres — thứ mà test văn bản của P1b không làm được.

**Files:**
- Create: `scripts/test-db.mjs`, `vitest.db.config.ts`, `tests-db/helpers/db.ts`, `tests-db/schema.db.test.ts`
- Modify: `prisma/schema.prisma`, `tests/prisma/schema.test.ts`, `package.json`

**Interfaces:**
- Produces: `npm run test:db [-- <vitest args>]`; `resetDb(): Promise<void>`; `seedShop(domain?: string): Promise<Shop>`; `seedAsset(shopId: string, kind: AssetKind, overrides?): Promise<Asset>`. Mọi task sau dùng chúng.

- [ ] **Step 1: Test văn bản cho R1 (hermetic, phải đỏ)**

Thêm vào `tests/prisma/schema.test.ts`:

```ts
  // R1 của P2a: admin lưu giá TRƯỚC khi generate variant (spec §12.2), nên hàng
  // giá phải tồn tại được khi chưa có variant Shopify nào.
  it.each(["ProductStyleLeather", "AnimalLeather"])(
    "%s cho phép hàng giá tồn tại trước khi có variant (cột Shopify nullable)",
    (model) => {
      const body = modelBody(model);
      for (const column of ["shopifyProductId", "shopifyVariantId", "shopifyVariantGid"]) {
        expect(body, `${model}.${column} phải nullable`).toMatch(new RegExp(`\\b${column}\\s+String\\?`));
      }
    },
  );
```

Run: `npx vitest run tests/prisma/schema.test.ts` — Expected: FAIL (2 test, cột đang là `String`).

- [ ] **Step 2: Sửa schema**

Trong `ProductStyleLeather` và `AnimalLeather`, đổi ba dòng thành `String?`, và thêm comment một lần ở `ProductStyleLeather`:

```prisma
  // Nullable: admin gõ và lưu giá (priceInput) TRƯỚC khi bấm Generate variants
  // (spec §12.2). Postgres cho nhiều NULL dưới @@unique, nên "một variant chỉ
  // thuộc một cặp" vẫn đúng cho mọi hàng ĐÃ có variant. Storefront chỉ đọc hàng
  // có shopifyVariantId khác NULL và variantMissing = false.
  shopifyProductId     String?
  shopifyVariantId     String?
  shopifyVariantGid    String?
```

```bash
npx prisma format && npx prisma validate && npx prisma generate
npx vitest run tests/prisma/schema.test.ts   # PASS
```

- [ ] **Step 3: Viết `scripts/test-db.mjs`**

```js
#!/usr/bin/env node
/**
 * Chạy suite test DB (`tests-db/**`) trên Postgres THẬT.
 *
 * Mặc định dựng một container `postgres:16-alpine` trên port trống, áp schema
 * bằng `prisma db push --force-reset`, chạy Vitest với `vitest.db.config.ts`,
 * rồi LUÔN dừng container — kể cả khi test đỏ hay bị Ctrl+C.
 *
 * Đặt `WK_TEST_DATABASE_URL` để dùng một Postgres có sẵn (CI) thay vì Docker.
 *
 * AN TOÀN: harness này chạy `--force-reset`, xoá sạch schema. Nó TỪ CHỐI mọi
 * URL có host khác localhost / 127.0.0.1 — không có cờ nào vượt qua được, vì
 * cái giá của một lần gõ nhầm URL Supabase production là toàn bộ dữ liệu.
 */
import { spawnSync } from "node:child_process";
import net from "node:net";

const IMAGE = "postgres:16-alpine";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function assertLocal(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`test-db: URL không hợp lệ: ${url}`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`test-db: TỪ CHỐI chạy --force-reset lên host "${host}". Chỉ localhost được phép.`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startContainer() {
  const port = await freePort();
  const name = `wk-test-pg-${process.pid}`;
  const status = run("docker", [
    "run", "-d", "--rm", "--name", name,
    "-e", "POSTGRES_PASSWORD=wk", "-e", "POSTGRES_DB=wk_test",
    "-p", `127.0.0.1:${port}:5432`, IMAGE,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  if (status !== 0) throw new Error("test-db: không dựng được container — Docker có đang chạy không?");

  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = spawnSync("docker", ["exec", name, "pg_isready", "-U", "postgres", "-d", "wk_test"], { stdio: "ignore" });
    if (ready.status === 0) {
      return { name, url: `postgresql://postgres:wk@127.0.0.1:${port}/wk_test` };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  spawnSync("docker", ["stop", name], { stdio: "ignore" });
  throw new Error("test-db: Postgres không sẵn sàng sau 30 giây");
}

let container = null;
function stopContainer() {
  if (container) {
    spawnSync("docker", ["stop", container.name], { stdio: "ignore" });
    container = null;
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopContainer();
    process.exit(130);
  });
}

let exitCode = 1;
try {
  let url = process.env.WK_TEST_DATABASE_URL;
  if (!url) {
    container = await startContainer();
    url = container.url;
  }
  assertLocal(url);

  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
  if (run("npx", ["prisma", "db", "push", "--force-reset", "--skip-generate"], { env }) !== 0) {
    throw new Error("test-db: prisma db push thất bại");
  }
  exitCode = run("npx", ["vitest", "run", "--config", "vitest.db.config.ts", ...process.argv.slice(2)], { env });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  stopContainer();
}
process.exit(exitCode);
```

Thêm vào `package.json` scripts: `"test:db": "node scripts/test-db.mjs"`.

- [ ] **Step 4: `vitest.db.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Suite chạm Postgres thật. Chạy qua `npm run test:db` — script đó đặt
 * DATABASE_URL trỏ vào container cục bộ. Chạy file tuần tự: mọi file dùng
 * chung một DB và mỗi test bắt đầu bằng `resetDb()`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests-db/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
```

- [ ] **Step 5: `tests-db/helpers/db.ts`**

```ts
import type { Asset, AssetKind, Shop } from "@prisma/client";
import { db } from "@/lib/db";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Xoá sạch dữ liệu giữa các test. Tự kiểm lại host dù `test-db.mjs` đã kiểm:
 * một ai đó chạy thẳng `vitest --config vitest.db.config.ts` với `.env` trỏ
 * Supabase thì hàm này là thứ duy nhất đứng giữa họ và việc mất dữ liệu.
 */
export async function resetDb(): Promise<void> {
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://invalid").hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`resetDb: TỪ CHỐI truncate DB ở host "${host}"`);
  }
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export const TEST_SHOP = "wildandking-demo.myshopify.com";

export function seedShop(shopDomain: string = TEST_SHOP): Promise<Shop> {
  return db.shop.create({ data: { shopDomain, accessToken: "test-access-token" } });
}

let assetCounter = 0;

/** Asset giả hợp lệ — checksum khác nhau mỗi lần để không đụng @@unique. */
export function seedAsset(shopId: string, kind: AssetKind, overrides: Partial<Asset> = {}): Promise<Asset> {
  assetCounter += 1;
  const checksum = assetCounter.toString(16).padStart(64, "0");
  const extension = kind === "SVG_MOCKUP" || kind === "DESIGN_SVG" ? "svg" : "webp";
  return db.asset.create({
    data: {
      shopId,
      kind,
      storagePath: `${kind.toLowerCase()}/${checksum}.${extension}`,
      publicUrl: `https://storage.test/wk-assets/${kind.toLowerCase()}/${checksum}.${extension}`,
      mimeType: extension === "svg" ? "image/svg+xml" : "image/webp",
      byteSize: 1024,
      checksumSha256: checksum,
      originalFilename: `seed.${extension}`,
      svgValidatedAt: kind === "SVG_MOCKUP" ? new Date() : null,
      ...overrides,
    },
  });
}
```

- [ ] **Step 6: Test DB đầu tiên — R1 đúng trên Postgres thật**

Tạo `tests-db/schema.db.test.ts`. Nó chứng minh hai điều mà test văn bản không chứng minh được:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb, seedAsset, seedShop } from "./helpers/db";

async function seedPriceGrid() {
  const shop = await seedShop();
  const display = await seedAsset(shop.id, "DISPLAY");
  const texture = await seedAsset(shop.id, "TEXTURE");
  const style = await db.style.create({ data: { shopId: shop.id, name: "Minimalist", slug: "minimalist", displayImageAssetId: display.id } });
  const [brown, beige] = await Promise.all(
    ["suede-brown", "suede-beige"].map((slug) =>
      db.leather.create({ data: { shopId: shop.id, name: slug, slug, displayImageAssetId: display.id, textureImageAssetId: texture.id } }),
    ),
  );
  const product = await db.customizableProduct.create({ data: { shopId: shop.id, name: "Card Holder" } });
  const productStyle = await db.productStyle.create({ data: { productId: product.id, styleId: style.id } });
  return { productStyle, brown, beige };
}

describe("schema trên Postgres thật", () => {
  beforeEach(resetDb);

  it("hàng giá tồn tại được khi chưa có variant Shopify (R1)", async () => {
    const { productStyle, brown } = await seedPriceGrid();
    const row = await db.productStyleLeather.create({
      data: { productStyleId: productStyle.id, leatherId: brown.id, priceInput: "80.00" },
    });
    expect(row.shopifyVariantId).toBeNull();
    expect(row.priceInput?.toFixed(2)).toBe("80.00");
  });

  it("nhiều hàng chưa có variant cùng tồn tại dưới @@unique([shopifyVariantId])", async () => {
    const { productStyle, brown, beige } = await seedPriceGrid();
    await db.productStyleLeather.create({ data: { productStyleId: productStyle.id, leatherId: brown.id } });
    await expect(
      db.productStyleLeather.create({ data: { productStyleId: productStyle.id, leatherId: beige.id } }),
    ).resolves.toBeDefined();
  });

  it("hai hàng KHÔNG được trỏ cùng một variant — ràng buộc vẫn giữ khi có giá trị", async () => {
    const { productStyle, brown, beige } = await seedPriceGrid();
    const variant = { shopifyProductId: "1", shopifyVariantId: "44928374652", shopifyVariantGid: "gid://shopify/ProductVariant/44928374652" };
    await db.productStyleLeather.create({ data: { productStyleId: productStyle.id, leatherId: brown.id, ...variant } });
    await expect(
      db.productStyleLeather.create({ data: { productStyleId: productStyle.id, leatherId: beige.id, ...variant } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
```

- [ ] **Step 7: Chứng minh harness có răng**

```bash
npm run test:db                                  # PASS, 3 test
docker ps --filter name=wk-test-pg -q            # rỗng — container đã dọn
WK_TEST_DATABASE_URL="postgresql://u:p@db.example.supabase.co:5432/postgres" npm run test:db
# PHẢI thoát mã khác 0 với thông báo TỪ CHỐI, và KHÔNG chạy prisma db push
```

Rồi tạm đổi schema về `String` (không `?`) ở một cột, chạy `npm run test:db`, xác nhận test đầu tiên ĐỎ trên Postgres, rồi khôi phục.

- [ ] **Step 8: Toàn bộ và commit**

```bash
npm test && npx tsc --noEmit && npm run test:db
git add scripts/test-db.mjs vitest.db.config.ts tests-db/helpers/db.ts tests-db/schema.db.test.ts \
        prisma/schema.prisma tests/prisma/schema.test.ts package.json
git commit -m "test(db): harness Postgres thật trong Docker; cột Shopify của bảng giá thành nullable

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Nền móng `adminApi` — hình lỗi, tra shop, dịch lỗi Prisma, tiền

Mọi route P2 dựng trên đúng bốn module này. Chúng quyết định hình lỗi mà UI P2c sẽ đọc, nên phải xong và được review trước khi có route nào.

**Files:**
- Create: `src/lib/admin/http.ts`, `src/lib/admin/prismaErrors.ts`, `src/lib/admin/adminApi.ts`, `src/lib/admin/money.ts`, `tests/helpers/adminRequest.ts`
- Test: `tests/lib/admin/http.test.ts`, `tests/lib/admin/prismaErrors.test.ts`, `tests/lib/admin/money.test.ts`, `tests-db/admin/adminApi.db.test.ts`

**Interfaces:**
- Consumes: `withAdminSession`, `AdminRouteParams` (`src/lib/auth/withAdminSession.ts`); `AdminSession` (`src/lib/auth/sessionToken.ts`); `db` (`src/lib/db.ts`).
- Produces (mọi task sau dùng):
  - `class AdminHttpError extends Error { status: number; body: Record<string, unknown> }`
  - `notFound(): never`, `conflict(code: string, extra?): never` — ném `AdminHttpError`
  - `jsonError(status, error, extra?): Response`
  - `parseJson<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>>` — ném 422
  - `adminApi<P>(handler: (req, ctx: AdminApiContext<P>) => Promise<Response>)`
  - `interface AdminApiContext<P> { session: AdminSession; params: P; shop: Shop }`
  - `priceSchema` (zod → chuỗi `"80.00"`), `formatPrice(value: Prisma.Decimal | null): string | null`
  - `useAdminEnv()`, `mintAdminToken(shop?, userId?)`, `adminRequest(url, init?)` trong `tests/helpers/adminRequest.ts`

- [ ] **Step 1: Test hermetic cho `http.ts`, `prismaErrors.ts`, `money.ts` (đỏ)**

`tests/lib/admin/http.test.ts` phải kiểm:
- `parseJson` với body JSON hợp lệ trả dữ liệu đã parse (khoá lạ bị strip).
- body không phải JSON → ném `AdminHttpError` status 422, body `{ errors: [{ field: "", code: "invalid_json", message }] }`.
- vi phạm schema → 422, mỗi issue thành `{ field: "a.b.0", code, message }` — `field` là `path.join(".")`.
- `jsonError(404, "NOT_FOUND")` → `Response` status 404, body `{ error: "NOT_FOUND" }`, content-type JSON.

`tests/lib/admin/prismaErrors.test.ts` dựng lỗi thật bằng
`new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: Prisma.prismaVersion.client, meta })` và kiểm:
- `P2002` với `meta.target = ["shopId", "slug"]` → 409 `{ error: "CONFLICT", fields: ["shopId", "slug"] }`
- `P2003` → 409 `{ error: "IN_USE" }`
- `P2025` → 404 `{ error: "NOT_FOUND" }`
- mã khác (ví dụ `P2034`) và lỗi không phải của Prisma → `toAdminResponse` trả `null` (để adminApi ném tiếp → 500)

`tests/lib/admin/money.test.ts`:
- chấp nhận `"80"`, `"80.5"`, `"80.50"`, `80`, `80.5`, `0` → `"80.00"`, `"80.50"`, `"80.50"`, `"80.00"`, `"80.50"`, `"0.00"`
- từ chối `"-1"`, `-1`, `"80.555"`, `80.555`, `"1e3"`, `"abc"`, `""`, `NaN`, `Infinity`, `"100000000.00"` (vượt `Decimal(10,2)`), `null`
- `0.1 + 0.2` (số) → từ chối: nó KHÔNG phải một số tiền có đúng 2 chữ số thập phân, và chấp nhận nó là âm thầm làm tròn tiền
- `formatPrice(new Prisma.Decimal("80"))` → `"80.00"`; `formatPrice(null)` → `null`

Run: `npx vitest run tests/lib/admin/` — Expected: FAIL (module chưa có).

- [ ] **Step 2: `src/lib/admin/http.ts`**

```ts
import { z } from "zod";

/**
 * Hình lỗi DUY NHẤT của admin API. UI P2c đọc đúng hai hình này:
 *   422 → { errors: [{ field, code, message }] }   (cùng hình spec §8.2)
 *   khác → { error: "<CODE>", ...extra }
 * Code nghiệp vụ ném `AdminHttpError`; `adminApi` bắt và trả nó. Không route nào
 * tự dựng `NextResponse.json({ error })` riêng — hai hình lỗi là hai hình, không hơn.
 */
export class AdminHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
    this.name = "AdminHttpError";
  }
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error, ...extra }, { status });
}

export function validationFailed(errors: FieldError[]): never {
  throw new AdminHttpError(422, { errors });
}

export function notFound(): never {
  throw new AdminHttpError(404, { error: "NOT_FOUND" });
}

export function conflict(error: string, extra: Record<string, unknown> = {}): never {
  throw new AdminHttpError(409, { error, ...extra });
}

export function issuesToFieldErrors(issues: z.ZodIssue[]): FieldError[] {
  return issues.map((issue) => ({
    field: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

/** Đọc body JSON và parse bằng schema. Ném 422 — không bao giờ trả dữ liệu chưa parse. */
export async function parseJson<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    validationFailed([{ field: "", code: "invalid_json", message: "Body phải là JSON hợp lệ" }]);
  }
  const result = schema.safeParse(raw);
  if (!result.success) validationFailed(issuesToFieldErrors(result.error.issues));
  return result.data;
}
```

- [ ] **Step 3: `src/lib/admin/prismaErrors.ts`**

```ts
import { Prisma } from "@prisma/client";

/**
 * Dịch lỗi Prisma đã biết thành phản hồi HTTP. Trả null cho mọi thứ khác — lỗi
 * lạ phải nổi lên thành 500 và vào log, không được nuốt thành một 4xx lịch sự.
 */
export function toAdminResponse(error: unknown): Response | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  switch (error.code) {
    case "P2002": {
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
      return Response.json({ error: "CONFLICT", fields }, { status: 409 });
    }
    case "P2003":
      return Response.json({ error: "IN_USE" }, { status: 409 });
    case "P2025":
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    default:
      return null;
  }
}
```

- [ ] **Step 4: `src/lib/admin/money.ts`**

```ts
import { Prisma } from "@prisma/client";
import { z } from "zod";

/** Decimal(10,2): tối đa 8 chữ số phần nguyên. */
const MAX_CENTS = 9_999_999_999;
const PRICE_STRING = /^\d{1,8}(?:\.\d{1,2})?$/;

/**
 * Giá admin gửi lên: chuỗi hoặc số, không âm, tối đa 2 chữ số thập phân.
 * Chuẩn hoá về chuỗi "80.00" — tiền không bao giờ đi qua float trong đường ghi.
 * Số như `0.1 + 0.2` bị TỪ CHỐI chứ không làm tròn: làm tròn tiền âm thầm là
 * cách một cent biến mất.
 */
export const priceSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  let cents: number;
  if (typeof value === "number") {
    const scaled = value * 100;
    if (!Number.isFinite(value) || value < 0 || Math.abs(scaled - Math.round(scaled)) > 1e-6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Giá phải là số không âm, tối đa 2 chữ số thập phân" });
      return z.NEVER;
    }
    cents = Math.round(scaled);
  } else {
    if (!PRICE_STRING.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Giá phải có dạng 80 hoặc 80.50" });
      return z.NEVER;
    }
    const [whole, fraction = ""] = value.split(".");
    cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  }
  if (cents > MAX_CENTS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Giá vượt quá 99999999.99" });
    return z.NEVER;
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
});

/** Decimal Prisma → "80.00". Không bao giờ JSON.stringify thẳng một Decimal. */
export function formatPrice(value: Prisma.Decimal | null | undefined): string | null {
  return value == null ? null : value.toFixed(2);
}
```

Run: `npx vitest run tests/lib/admin/` — Expected: PASS.

- [ ] **Step 5: `src/lib/admin/adminApi.ts`**

```ts
import type { Shop } from "@prisma/client";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type { AdminRouteParams } from "@/lib/auth/withAdminSession";
import type { AdminSession } from "@/lib/auth/sessionToken";
import { AdminHttpError } from "./http";
import { toAdminResponse } from "./prismaErrors";

export interface AdminApiContext<P extends AdminRouteParams = AdminRouteParams> {
  session: AdminSession;
  params: P;
  shop: Shop;
}

/**
 * Lớp thứ hai của mọi route admin, luôn nằm BÊN TRONG `withAdminSession`:
 *
 *   export const GET = withAdminSession(adminApi(async (req, { shop, params }) => …));
 *
 * `withAdminSession` đã xác thực token. Lớp này:
 *  1. tra `Shop` theo `session.shopDomain` (không phân biệt hoa thường) — shop
 *     chưa cài hoặc đã gỡ → 409 SHOP_NOT_INSTALLED;
 *  2. bắt `AdminHttpError` (404/409/422 do code nghiệp vụ ném) và lỗi Prisma đã
 *     biết, trả đúng hình lỗi của `./http`;
 *  3. để mọi lỗi khác nổi lên — Next trả 500 và lỗi vào log.
 */
export function adminApi<P extends AdminRouteParams = AdminRouteParams>(
  handler: (req: NextRequest, ctx: AdminApiContext<P>) => Promise<Response>,
): (req: NextRequest, ctx: { session: AdminSession; params: P }) => Promise<Response> {
  return async (req, { session, params }) => {
    try {
      const shop = await db.shop.findFirst({
        where: { shopDomain: { equals: session.shopDomain, mode: "insensitive" }, installed: true },
      });
      if (!shop) {
        return Response.json({ error: "SHOP_NOT_INSTALLED" }, { status: 409 });
      }
      return await handler(req, { session, params, shop });
    } catch (error) {
      if (error instanceof AdminHttpError) {
        return Response.json(error.body, { status: error.status });
      }
      const mapped = toAdminResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  };
}
```

- [ ] **Step 6: `tests/helpers/adminRequest.ts`**

```ts
import { vi } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";

export const ADMIN_API_KEY = "21102b2e2138173c5ab87e5ad38ef1e4";
export const ADMIN_API_SECRET = "test_secret_that_is_long_enough_for_hs256";
export const ADMIN_SHOP = "wildandking-demo.myshopify.com";

/** Env tối thiểu để `withAdminSession` chấp nhận token do `mintAdminToken` ký. */
export function useAdminEnv(allowedShops: string[] = [ADMIN_SHOP]): void {
  vi.stubEnv("SHOPIFY_API_KEY", ADMIN_API_KEY);
  vi.stubEnv("SHOPIFY_API_SECRET", ADMIN_API_SECRET);
  vi.stubEnv("WK_ALLOWED_SHOPS", allowedShops.join(","));
}

export async function mintAdminToken(shop: string = ADMIN_SHOP, userId = "42"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: ADMIN_API_KEY, sub: userId, nbf: now - 10 })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(now + 60)
    .sign(new TextEncoder().encode(ADMIN_API_SECRET));
}

export interface AdminRequestInit {
  method?: string;
  /** Object → JSON. FormData → multipart. */
  body?: unknown;
  shop?: string;
  /** `null` = không gửi Authorization. */
  token?: string | null;
}

export async function adminRequest(url: string, init: AdminRequestInit = {}): Promise<NextRequest> {
  const headers = new Headers();
  const token = init.token === undefined ? await mintAdminToken(init.shop) : init.token;
  if (token) headers.set("authorization", `Bearer ${token}`);
  let body: BodyInit | undefined;
  if (init.body instanceof FormData) {
    body = init.body;
  } else if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  return new NextRequest(new URL(url, "https://app.test"), { method: init.method ?? "GET", headers, body });
}
```

- [ ] **Step 7: Test DB cho `adminApi` (đỏ trước khi có Step 5 là không thể — viết rồi chạy)**

`tests-db/admin/adminApi.db.test.ts` dựng một route tại chỗ bằng `withAdminSession(adminApi(...))` và kiểm, trên DB thật:
- shop đã cài → handler nhận đúng `shop.id`, `session.userId === "42"`, `params` được chuyển tiếp
- `shopDomain` lưu khác hoa thường với token (`WildAndKing-Demo.myshopify.com`) → vẫn tìm thấy
- shop có trong allowlist nhưng không có hàng `Shop` → 409 `SHOP_NOT_INSTALLED`, handler **không** chạy (spy)
- shop có hàng nhưng `installed: false` → 409 `SHOP_NOT_INSTALLED`
- handler ném `notFound()` → 404 `{ error: "NOT_FOUND" }`
- handler tạo hai `Leather` trùng `(shopId, slug)` → 409 `{ error: "CONFLICT", fields: [...] }` — lỗi P2002 **thật** từ Postgres, không phải dựng tay
- handler ném `new Error("boom")` → lời gọi route **reject** (không bị nuốt thành 4xx)
- không có token → 401 và không chạm DB

Mỗi test bắt đầu bằng `resetDb()` và `useAdminEnv()`; `afterEach(() => vi.unstubAllEnvs())`.

- [ ] **Step 8: Toàn bộ và commit**

```bash
npm test && npx tsc --noEmit && npm run test:db
git add src/lib/admin/http.ts src/lib/admin/prismaErrors.ts src/lib/admin/adminApi.ts src/lib/admin/money.ts \
        tests/helpers/adminRequest.ts tests/lib/admin/*.test.ts tests-db/admin/adminApi.db.test.ts
git commit -m "feat(admin): nền móng adminApi — tra shop, một hình lỗi, dịch lỗi Prisma, tiền dạng chuỗi

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Upload asset — `POST /api/admin/assets` và `POST /api/admin/assets/validate-svg`

Đường duy nhất để admin đưa file vào hệ thống. SVG mockup đi qua đủ chuỗi parse → sanitize → kiểm URL ngoài → kiểm hợp đồng → lưu `root.outerHTML`. Ảnh đi qua kiểm mime + magic bytes.

**Files:**
- Create: `src/lib/admin/assetStorage.ts`, `src/lib/admin/assets.ts`, `src/app/api/admin/assets/route.ts`, `src/app/api/admin/assets/validate-svg/route.ts`
- Modify: `src/lib/storage/index.ts` (thêm `AssetRejectedError`)
- Test: `tests/lib/storage/index.test.ts` (bổ sung), `tests-db/admin/assets.db.test.ts`

**Interfaces:**
- Consumes: `parseSvgFromText`, `SvgParseError` (`src/lib/svg/parseSvgNode.ts`); `sanitizeSvgRoot`, `validateSvgContract`, `SanitizeReport`, `ValidationReport` (`@/svg-engine`); `uploadSanitizedSvg`, `uploadBinaryAsset`, `MAX_ASSET_BYTES`, `AssetStorageClient` (`@/lib/storage`); `adminApi`, `AdminHttpError`, `validationFailed` (Task 2).
- Produces:
  - `class AssetRejectedError extends Error` trong `@/lib/storage`
  - `assetStorageClient(): AssetStorageClient` — **seam duy nhất** test được phép thay (`vi.mock("@/lib/admin/assetStorage", …)`)
  - `ADMIN_UPLOAD_KINDS = ["SVG_MOCKUP", "TEXTURE", "DISPLAY"] as const`
  - `inspectSvg(text: string): { root: Element; sanitization: SanitizeReport; validation: ValidationReport }`
  - `createAssetFromUpload(input: { shopId: string; userId: string; kind: AdminUploadKind; file: File }): Promise<{ asset: AssetDto; created: boolean; validation?: ValidationReport; sanitization?: SanitizeReport }>`
  - `interface AssetDto { id: string; kind: AssetKind; publicUrl: string; mimeType: string; byteSize: number; width: number | null; height: number | null; originalFilename: string; createdAt: string }`

- [ ] **Step 1: Tách lỗi input khỏi lỗi hạ tầng trong module storage**

Hiện `uploadSanitizedSvg`/`uploadBinaryAsset` ném `Error` chung cho MỌI thứ — file quá lớn, mime sai, magic bytes lệch, SVG chưa sanitize, và cả Supabase trả lỗi mạng. Route không phân biệt được "file hỏng → 422" với "Storage sập → 500"; nhầm theo chiều nào cũng tệ (sập mà báo "file của bạn hỏng", hoặc file hỏng mà báo 500).

Thêm `export class AssetRejectedError extends Error` và ném nó cho **mọi** từ chối do input (kích thước, mime, magic bytes, raw bytes, chưa sanitize, không round-trip). Lỗi từ client Storage giữ nguyên `Error`. Test trong `tests/lib/storage/index.test.ts`: mỗi loại từ chối hiện có là `instanceof AssetRejectedError`; lỗi từ fake client (`upload` trả `{ error }`) thì **không** phải.

- [ ] **Step 2: `src/lib/admin/assetStorage.ts`**

```ts
import { createStorageClient, type AssetStorageClient } from "@/lib/storage";

/**
 * Seam DUY NHẤT giữa admin API và Supabase Storage. Test DB thay module này
 * bằng `vi.mock` — Storage là ranh giới ngoài hợp lệ để giả; Postgres thì không.
 */
export function assetStorageClient(): AssetStorageClient {
  return createStorageClient();
}
```

- [ ] **Step 3: Viết test DB (đỏ)**

`tests-db/admin/assets.db.test.ts`. Đầu file:

```ts
const uploads: Array<{ path: string; body: unknown; contentType?: string }> = [];
vi.mock("@/lib/admin/assetStorage", () => ({
  assetStorageClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string, body: unknown, options?: { contentType?: string }) => {
          uploads.push({ path, body, contentType: options?.contentType });
          return { data: { path }, error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/wk-assets/${path}` } }),
      }),
    },
  }),
}));
```

Đặt `vi.stubEnv("SUPABASE_STORAGE_BUCKET", "wk-assets")` trong `beforeEach`. Gọi route thật: `import { POST } from "@/app/api/admin/assets/route"`, gửi `FormData` với `file` (`new File([bytes], name, { type })`) và `kind`.

Các ca phải có:

| Ca | Kỳ vọng |
|---|---|
| `angler-fish.svg` với `kind=SVG_MOCKUP` | 201; một hàng `Asset` với `svgValidatedAt` khác null, `svgContractVer` = contract version, `storagePath` khớp `^svg_mockup/[0-9a-f]{64}\.svg$`, `width`/`height` lấy từ viewBox `1427 × 1102`; **nội dung được upload KHÁC bytes gốc của file và BẰNG `root.outerHTML` sau parse + sanitize** — đây là khẳng định quan trọng nhất của task |
| cùng file đó lần hai | 200, **cùng** `asset.id`, vẫn chỉ một hàng |
| cùng file, shop khác | 201, hàng mới — dedupe theo shop |
| mockup hợp lệ có chèn `<script>alert(1)</script>` | 201; `sanitization.removedElements` chứa `script`; nội dung upload không chứa `<script` |
| mockup có `<image href="https://evil.example/x.png"/>` | 422 `{ errors: [{ field: "file", code: "external_reference" }], externalRefs: [...] }` (R5); **storage không được gọi**; không có hàng `Asset` |
| SVG hợp lệ về cú pháp nhưng thiếu `#animal-artwork` | 422 `{ errors: [{ field: "file", code: "svg_contract" }], validation: { valid: false, checks: [...] } }`; storage không được gọi |
| file text không phải SVG | 422 `code: "svg_parse"` |
| `kind=DESIGN_SVG` | 422 `field: "kind"` — design SVG chỉ server sinh ra |
| thiếu `file` / thiếu `kind` | 422 đúng `field` |
| `TEXTURE` với bytes WebP hợp lệ (`RIFF????WEBP…`) mime `image/webp` | 201, `storagePath` `^texture/…\.webp$` |
| bytes PNG khai `image/webp` | 422 `code: "invalid_image"` |
| bytes SVG khai `image/png` với `kind=DISPLAY` | 422 `code: "invalid_image"` |
| file > `MAX_ASSET_BYTES` | 413 `{ error: "PAYLOAD_TOO_LARGE" }`, không đọc hết body vào bộ nhớ nếu có `content-length` |
| fake storage trả `{ error }` | lời gọi route **reject** (500) — không được biến thành 422 |
| không token | 401 |

Và `validate-svg`:

| Ca | Kỳ vọng |
|---|---|
| fixture hợp lệ | 200 `{ valid: true, validation, sanitization }`; không hàng `Asset`; storage không được gọi |
| thiếu ID | 200 `{ valid: false, validation: { checks: [...] } }` — đây là báo cáo, không phải lỗi |
| có URL ngoài | 200 `{ valid: false, externalRefs: [...] }` |
| không phải SVG | 422 `svg_parse` |

- [ ] **Step 4: `src/lib/admin/assets.ts`**

Luồng `SVG_MOCKUP`, đúng thứ tự này — thứ tự là một phần của hợp đồng:
1. kích thước ≤ `MAX_ASSET_BYTES`, nếu không → 413
2. `text = await file.text()` → `parseSvgFromText(text)`; `SvgParseError` → 422 `svg_parse`
3. `sanitization = sanitizeSvgRoot(root)`
4. `sanitization.externalRefs.length > 0` → 422 `external_reference` (R5)
5. `validation = validateSvgContract(root)` **sau** sanitize (đo cái sẽ được lưu, không phải cái được gửi lên); `!valid` → 422 `svg_contract` kèm `validation`
6. `uploadSanitizedSvg({ kind, svg: root.outerHTML, client: assetStorageClient() })`
7. tìm `Asset` theo `(shopId, kind, checksumSha256)`: có rồi → trả nó, `created: false` (nếu đang archived thì bỏ archive); chưa có → tạo, `created: true`, `createdBy = userId`

`width`/`height` lấy từ `validation.viewBox` (`"0 0 W H"`), làm tròn số nguyên; không parse được thì `null`.

Nhánh ảnh: `bytes = new Uint8Array(await file.arrayBuffer())` → `uploadBinaryAsset({ kind, bytes, mimeType: file.type, client })` → cùng bước 7. `AssetRejectedError` → 422 `invalid_image`. Lỗi khác ném tiếp.

`inspectSvg` là bước 2–5 không ném, dùng chung cho `validate-svg`.

- [ ] **Step 5: Route**

```ts
// src/app/api/admin/assets/route.ts
import { withAdminSession } from "@/lib/auth/withAdminSession";
import { adminApi } from "@/lib/admin/adminApi";
import { handleAssetUpload } from "@/lib/admin/assets";

export const dynamic = "force-dynamic";

export const POST = withAdminSession(adminApi(handleAssetUpload));
```

`handleAssetUpload(req, { shop, session })` đọc `content-length` trước (413 sớm), rồi `await req.formData()`, validate `kind` bằng `z.enum(ADMIN_UPLOAD_KINDS)`, gọi `createAssetFromUpload`, trả `201` hoặc `200` theo `created`. `validate-svg/route.ts` cùng hình, gọi `handleValidateSvg`.

- [ ] **Step 6: Toàn bộ và commit**

```bash
npm test && npx tsc --noEmit && npm run test:db
git add src/lib/storage/index.ts src/lib/admin/assetStorage.ts src/lib/admin/assets.ts \
        src/app/api/admin/assets/route.ts src/app/api/admin/assets/validate-svg/route.ts \
        tests/lib/storage/index.test.ts tests-db/admin/assets.db.test.ts
git commit -m "feat(admin): upload asset — SVG qua sanitize và kiểm hợp đồng, ảnh qua magic bytes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Attributes — CRUD bốn nhóm

Tab Attributes (spec §12.1): Leathers · Stitches · Animals · Styles, chung một hình list + drawer, khác nhau ở field. Không đụng Shopify.

**Files:**
- Create: `src/lib/admin/attributes.ts`, `src/lib/admin/slug.ts`
- Create (R7, 12 file mỏng): `src/app/api/admin/{leathers,stitches,animals,styles}/route.ts`, `…/[id]/route.ts`, `…/reorder/route.ts`
- Test: `tests/lib/admin/slug.test.ts`, `tests-db/admin/attributes.db.test.ts`

**Interfaces:**
- Consumes: `adminApi`, `parseJson`, `notFound`, `validationFailed`, `conflict` (Task 2); `normalizeHex` (`@/svg-engine`).
- Produces:
  - `type AttributeKind = "leathers" | "stitches" | "animals" | "styles"`
  - `attributeHandlers(kind): { list, create, update, archive, reorder }` — mỗi cái là handler cho `adminApi`
  - `slugify(name: string): string`
  - `interface AttributeDto { id; name; slug; isActive; sortOrder; archivedAt: string | null; displayImage: { assetId: string; url: string } | null; textureImage?: { assetId; url }; colorHex?: string }`

**Field theo nhóm** (spec §12.1):

| | `displayImageAssetId` | `textureImageAssetId` | `colorHex` |
|---|---|---|---|
| leathers | bắt buộc, `DISPLAY` | bắt buộc, `TEXTURE` | — |
| stitches | tuỳ chọn, `DISPLAY` | — | bắt buộc, chuẩn hoá qua `normalizeHex` → `#RRGGBB` |
| animals | bắt buộc, `DISPLAY` | — | — |
| styles | bắt buộc, `DISPLAY` | — | — |

Chung: `name` 1–80 ký tự (trim), `slug` tuỳ chọn (mặc định `slugify(name)`, phải khớp `^[a-z0-9]+(?:-[a-z0-9]+)*$`), `isActive` (mặc định `true`), `sortOrder` (mặc định `max + 1` của shop cho nhóm đó).

**Hành vi endpoint:**

| Endpoint | Hành vi |
|---|---|
| `GET /api/admin/<kind>?includeArchived=true` | Chỉ của shop; mặc định bỏ hàng archived; sắp theo `sortOrder`, rồi `name`. URL ảnh lấy từ `Asset.publicUrl` (một query có `include`, không N+1). |
| `POST /api/admin/<kind>` | 201 + DTO. Asset tham chiếu phải thuộc **shop này**, đúng `kind`, chưa archived — sai bất kỳ điều gì → 422 `{ field: "displayImageAssetId", code: "invalid_asset" }` (asset của shop khác cũng trả đúng lỗi này, không tiết lộ nó tồn tại). Trùng slug → 409 `CONFLICT` (từ P2002 thật). |
| `PATCH /api/admin/<kind>/:id` | Cập nhật một phần. `{ archived: false }` = khôi phục hàng đã archived. Id của shop khác → 404. |
| `DELETE /api/admin/<kind>/:id` | Đặt `archivedAt = now()` — **không** xoá. Idempotent: archive lần hai trả 200 với cùng `archivedAt`. |
| `POST /api/admin/<kind>/reorder` `{ orderedIds }` | `orderedIds` phải bằng **đúng tập** id chưa archived của shop cho nhóm đó — không thiếu, không thừa, không trùng. Lệch → 409 `{ error: "STALE_ORDER" }`: UI đang cầm danh sách cũ, và sắp xếp một phần là cách hai admin ghi đè nhau. Ghi `sortOrder = index` trong **một transaction**. |

Mỗi route file có đúng hình:

```ts
import { withAdminSession } from "@/lib/auth/withAdminSession";
import { adminApi } from "@/lib/admin/adminApi";
import { attributeHandlers } from "@/lib/admin/attributes";

export const dynamic = "force-dynamic";

const handlers = attributeHandlers("leathers");

export const GET = withAdminSession(adminApi(handlers.list));
export const POST = withAdminSession(adminApi(handlers.create));
```

Route `[id]`: **không** viết tham số kiểu cho `withAdminSession` — `withAdminSession<{ id: string }>(` có dấu `<` giữa tên và `(`, và scanner guard (khớp đúng `withAdminSession(`) sẽ đỏ trên code đúng. Để kiểu tự suy ra: handler đã khai `AdminApiContext<{ id: string }>`, nên `withAdminSession(adminApi(handlers.update))` suy ra `P = { id: string }` xuyên qua cả hai lớp. Nếu cần tường minh, đặt nó ở `adminApi<{ id: string }>(…)`, không bao giờ ở `withAdminSession`.

**Về kiểu dữ liệu:** bốn delegate Prisma (`db.leather`, …) có kiểu args khác nhau. Không được để `any` rò ra ngoài `attributes.ts`; nếu cần một cast để dùng chung code, chỉ **một** cast, có comment giải thích, và `tsc --noEmit` sạch.

- [ ] **Step 1: `slugify` + test hermetic (đỏ → xanh)**

`"Suede Brown"` → `"suede-brown"`; `"  Togo  Brown!! "` → `"togo-brown"`; `"Da Bò Việt"` → `"da-bo-viet"` (bỏ dấu qua `normalize("NFD")`); `"Đà Nẵng"` → `"da-nang"` (`đ` không tách được bằng NFD — xử lý riêng); chuỗi chỉ có ký tự đặc biệt → `""` (và `create` khi đó 422 `field: "slug"`).

- [ ] **Step 2: Test DB (đỏ)**

`tests-db/admin/attributes.db.test.ts`, gọi **route thật** (import từ `@/app/api/admin/leathers/route` v.v.):
- đầy đủ vòng đời trên `leathers`: create → list → patch → archive (biến khỏi list mặc định, vẫn có với `includeArchived=true`) → archive lần hai (idempotent) → restore
- `create` thiếu `textureImageAssetId` → 422 đúng `field`; asset `TEXTURE` đưa vào chỗ `DISPLAY` → 422 `invalid_asset`; asset của shop B → 422 `invalid_asset`
- slug trùng → 409 `CONFLICT`; cùng slug ở **shop khác** → 201
- `stitches`: `colorHex: "e7c337"` → lưu `#E7C337`; `"red"` → 422; `displayImageAssetId` bỏ trống → 201
- reorder: đúng tập → 200 và `sortOrder` theo thứ tự; thiếu một id / thừa một id / id của shop B / trùng id → 409 `STALE_ORDER`; hàng archived không bắt buộc có trong `orderedIds`
- cô lập shop: token shop B `PATCH`/`DELETE` leather của shop A → 404, và hàng của A **không đổi** (đọc lại từ DB)
- bảng dữ liệu cho cả bốn nhóm: create hợp lệ tối thiểu → 201, `GET` thấy nó
- mọi route trả 401 khi không token

- [ ] **Step 3: Viết `attributes.ts`, `slug.ts`, 12 route; chạy tới xanh**

- [ ] **Step 4: Scanner guard phải thấy cả 12 file**

```bash
npx vitest run tests/app/api/admin/route-guard.test.ts --reporter=verbose | grep -c "withAdminSession"
```
Kỳ vọng ≥ 12 dòng test (mỗi file route admin một dòng). Ít hơn nghĩa là có file scanner không thấy — điều tra, đừng bỏ qua.

- [ ] **Step 5: Toàn bộ và commit**

```bash
npm test && npx tsc --noEmit && npm run test:db
git add src/lib/admin/attributes.ts src/lib/admin/slug.ts src/app/api/admin/leathers src/app/api/admin/stitches \
        src/app/api/admin/animals src/app/api/admin/styles tests/lib/admin/slug.test.ts tests-db/admin/attributes.db.test.ts
git commit -m "feat(admin): CRUD bốn nhóm attribute — archive thay vì xoá, reorder đúng tập

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Products — danh sách, tạo, host, và ba bảng quan hệ

Nửa đầu tab Products (spec §12.2): tạo cấu hình product, gắn nó vào trang Shopify (host), chọn style / animal / stitch nào tham gia. Ma trận giá và lưới SVG là Task 6.

**Files:**
- Create: `src/lib/admin/diff.ts`, `src/lib/admin/products.ts`
- Create: `src/app/api/admin/products/route.ts`, `src/app/api/admin/products/[id]/route.ts`, `src/app/api/admin/products/[id]/{hosts,styles,animals,stitches}/route.ts`
- Test: `tests/lib/admin/diff.test.ts`, `tests-db/admin/products.db.test.ts`

**Interfaces:**
- Consumes: Task 2 toàn bộ; `AttributeDto` shape (Task 4) cho tên attribute trong cây.
- Produces:
  - `diffByKey<D, E>(desired: readonly D[], existing: readonly E[], keyOfDesired: (d: D) => string, keyOfExisting: (e: E) => string): { toCreate: D[]; toUpdate: Array<{ desired: D; existing: E }>; missing: E[] }`
  - `duplicateKeys<T>(items: readonly T[], key: (t: T) => string): string[]`
  - `loadProductForShop(tx, shopId, productId): Promise<CustomizableProduct>` — ném `notFound()` nếu không thuộc shop. **Mọi** handler có `:id` gọi nó ĐẦU TIÊN.
  - `productHandlers: { list, create, get, update, putHosts, putStyles, putAnimals, putStitches }`
  - `interface ProductTreeDto` — Task 6 mở rộng

- [ ] **Step 1: `diffByKey` + `duplicateKeys`, test hermetic (đỏ → xanh)**

Kiểm: danh sách rỗng hai phía; chỉ tạo; chỉ thiếu; cập nhật giữ đúng cặp `desired`/`existing`; thứ tự `toCreate` giữ thứ tự của `desired`; `duplicateKeys` trả mỗi khoá trùng **một lần**.

- [ ] **Step 2: Test DB (đỏ)**

`tests-db/admin/products.db.test.ts`, gọi route thật:

**Product**
- `POST /products { name }` → 201 `{ id, name, isEnabled: false }`; `name` rỗng → 422
- `GET /products` chỉ thấy product của shop mình, bỏ archived
- `GET /products/:id` của shop khác → 404; id không tồn tại → 404 — **cùng một phản hồi**
- `PATCH { name }` → 200. (`isEnabled: true` thuộc Task 6 — nó cần kiểm readiness.)

**Host** — `PUT /products/:id/hosts [{ shopifyProductId, preselectStyleId?, isPrimary }]`
- tạo mới: `shopifyProductGid` = `gid://shopify/Product/<id>`; `handleSnapshot`/`titleSnapshot` = null (P2b điền từ Shopify)
- `shopifyProductId` không phải chuỗi chữ số → 422
- host đã gắn với **product khác cùng shop** → 409 `{ error: "HOST_TAKEN", shopifyProductId, productId }`: một trang Shopify chỉ thuộc một customizer (spec §7, ràng buộc ★)
- cùng `shopifyProductId` ở **shop khác** → được (unique là theo shop)
- `preselectStyleId` phải là style có `ProductStyle` **active** trong product này → nếu không, 422
- hai host `isPrimary: true` → 422
- host vắng mặt khỏi danh sách → **bị xoá** (ngoại lệ duy nhất của R4: `ProductHost` không có con)
- `shopifyProductId` trùng trong chính request → 422

**Style / Animal / Stitch** — `PUT /products/:id/styles [{ styleId, isActive, sortOrder }]` (animals, stitches cùng hình)
- id attribute phải của shop, chưa archived → nếu không, 422 `{ field: "0.styleId", code: "invalid_reference" }` (field theo vị trí trong mảng)
- phần tử vắng mặt → `isActive = false`, hàng **vẫn còn** (R4) — đọc lại DB để khẳng định
- đưa lại một phần tử đã tắt → bật lại, **cùng** id hàng (không tạo hàng mới)
- trùng `styleId` trong request → 422
- mọi thay đổi của một `PUT` nằm trong **một transaction**: làm một phần tử cuối không hợp lệ và khẳng định các phần tử trước **không** được ghi
- phản hồi là danh sách sau cập nhật, sắp theo `sortOrder`, kèm tên attribute

- [ ] **Step 3: Viết `diff.ts`, `products.ts`, route; chạy tới xanh**

Mọi `PUT` theo đúng khuôn này:

```ts
export async function putStyles(req: NextRequest, { shop, params }: AdminApiContext<{ id: string }>) {
  const desired = await parseJson(req, relationListSchema("styleId"));
  const dupes = duplicateKeys(desired, (d) => d.styleId);
  if (dupes.length) validationFailed(dupes.map((id) => ({ field: "styleId", code: "duplicate", message: `styleId ${id} xuất hiện hơn một lần` })));

  const rows = await db.$transaction(async (tx) => {
    const product = await loadProductForShop(tx, shop.id, params.id);   // 404 trước mọi thứ
    await assertAttributesBelongToShop(tx, "style", shop.id, desired.map((d) => d.styleId));
    const existing = await tx.productStyle.findMany({ where: { productId: product.id } });
    const { toCreate, toUpdate, missing } = diffByKey(desired, existing, (d) => d.styleId, (e) => e.styleId);
    // create toCreate · update toUpdate (isActive, sortOrder) · missing → isActive = false
    return tx.productStyle.findMany({ where: { productId: product.id }, include: { style: true }, orderBy: { sortOrder: "asc" } });
  });
  return Response.json(rows.map(toProductStyleDto));
}
```

- [ ] **Step 4: Toàn bộ và commit**

```bash
npm test && npx tsc --noEmit && npm run test:db
git add src/lib/admin/diff.ts src/lib/admin/products.ts src/app/api/admin/products \
        tests/lib/admin/diff.test.ts tests-db/admin/products.db.test.ts
git commit -m "feat(admin): product config — host, style/animal/stitch bằng PUT diff trong transaction

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Ma trận giá A/B, lưới SVG, cây đầy đủ, và readiness

Nửa sau tab Products: nhập giá cho từng cặp (style × body leather, animal × animal leather), gắn SVG mockup cho từng ô style × animal, và trả toàn bộ cấu hình trong một cây cho UI. `readiness` trả lời câu hỏi "bật product này lên storefront được chưa, và nếu chưa thì thiếu gì" — UI hiện nó, và `PATCH isEnabled: true` từ chối khi chưa sẵn sàng.

**Files:**
- Create: `src/lib/admin/readiness.ts`
- Modify: `src/lib/admin/products.ts`
- Create: `src/app/api/admin/products/[id]/styles/[styleId]/leathers/route.ts`, `…/styles/[styleId]/animals/route.ts`, `…/animals/[animalId]/leathers/route.ts`
- Test: `tests/lib/admin/readiness.test.ts`, `tests-db/admin/product-matrices.db.test.ts`

**Interfaces:**
- Consumes: Task 2 (`priceSchema`, `formatPrice`), Task 5 (`loadProductForShop`, `diffByKey`, `ProductTreeDto`).
- Produces:
  - `productReadiness(tree: ProductTreeDto): { ready: boolean; problems: ReadinessProblem[] }` — **thuần**, không chạm DB
  - `interface ReadinessProblem { code: ReadinessCode; message: string; path: string[] }`
  - `type ReadinessCode = "NO_HOST" | "NO_ACTIVE_STYLE" | "NO_ACTIVE_ANIMAL" | "NO_ACTIVE_STITCH" | "STYLE_WITHOUT_LEATHER" | "ANIMAL_WITHOUT_LEATHER" | "MISSING_PRICE" | "MISSING_VARIANT" | "VARIANT_MISSING" | "MISSING_SVG" | "ARCHIVED_ATTRIBUTE"`
  - `GET /products/:id` trả cây đầy đủ (bên dưới) — P2b và P2c đọc đúng hình này

**Hình cây** (`GET /api/admin/products/:id`):

```jsonc
{
  "product": { "id", "name", "isEnabled", "createdAt", "updatedAt" },
  "hosts": [{ "shopifyProductId", "shopifyProductGid", "preselectStyleId", "isPrimary", "handleSnapshot", "titleSnapshot", "syncedAt" }],
  "styles": [{
    "styleId", "name", "isActive", "sortOrder", "archived",
    "leathers": [{ "leatherId", "name", "price": "80.00" | null, "isActive", "sortOrder", "archived",
                   "variant": null | { "shopifyProductId", "shopifyVariantId", "priceSnapshot": "80.00" | null, "missing", "syncedAt" } }],
    "animals":  [{ "animalId", "name", "svgAssetId", "svgUrl", "displayLabel", "description", "defaultStitchId", "isActive", "sortOrder" }]
  }],
  "animals":  [{ "animalId", "name", "isActive", "sortOrder", "archived", "leathers": [ /* cùng hình ô giá */ ] }],
  "stitches": [{ "stitchId", "name", "colorHex", "isActive", "sortOrder", "archived" }],
  "readiness": { "ready": false, "problems": [{ "code": "MISSING_VARIANT", "message": "…", "path": ["styles", "<styleId>", "leathers", "<leatherId>"] }] }
}
```

Giá luôn là chuỗi hoặc `null` (R8). Cây dựng bằng **số query cố định**, không N+1 — test DB đếm được bằng cách bật log query của Prisma hoặc so thời gian với product có 10 × 10 ô; ưu tiên khẳng định số lời gọi `findMany` qua một spy trên `db` nếu làm được sạch, không thì bỏ khẳng định này và ghi lý do trong report.

**Readiness** — chỉ xét phần tử **active**. Một product sẵn sàng khi: ≥1 host; ≥1 style active, mỗi style active có ≥1 ô leather active; ≥1 animal active, mỗi animal active có ≥1 ô leather active; ≥1 stitch active; mỗi ô giá active có `price`, có `variant`, và `variant.missing = false`; mỗi cặp (style active × animal active) có một ô SVG active; không phần tử active nào trỏ tới attribute đã archived.

Trước P2b, `MISSING_VARIANT` sẽ luôn chặn — đó là hành vi đúng: chưa có variant thì chưa bán được.

- [ ] **Step 1: `productReadiness` + test hermetic (đỏ → xanh)**

Dựng cây bằng một builder trong test (không DB). Mỗi `ReadinessCode` có ít nhất một test sinh ra đúng nó với đúng `path`; một cây đầy đủ trả `ready: true, problems: []`; phần tử `isActive: false` không bao giờ sinh problem.

- [ ] **Step 2: Test DB (đỏ)**

`tests-db/admin/product-matrices.db.test.ts`:

**Ma trận A** — `PUT /products/:id/styles/:styleId/leathers [{ leatherId, price, isActive, sortOrder }]`
- `:styleId` là id **Style** (attribute), không phải id `ProductStyle`; style không có trong product → 404
- lưu `priceInput`; đọc lại DB là `Decimal` đúng giá trị; phản hồi là chuỗi `"80.00"`
- `price: 80.555` → 422 `field: "0.price"`; `price: null` → được (ô chưa định giá)
- **không** chạm `shopifyVariantId` / `variantPriceSnapshot` — seed một ô đã có variant rồi đổi giá, khẳng định hai cột đó giữ nguyên
- vắng mặt → `isActive = false`; đưa lại → cùng id hàng
- leather archived hoặc của shop khác → 422 `invalid_reference`

**Ma trận B** — `PUT /products/:id/animals/:animalId/leathers` — cùng các ca, trên `AnimalLeather`.

**Lưới SVG** — `PUT /products/:id/styles/:styleId/animals [{ animalId, svgAssetId, displayLabel?, description?, defaultStitchId?, isActive, sortOrder }]`
- `animalId` phải có `ProductAnimal` trong product → nếu không, 422
- `svgAssetId` phải là `Asset` của shop, `kind = SVG_MOCKUP`, chưa archived, `svgValidatedAt` khác null → nếu không, 422 `invalid_asset` (asset `DISPLAY` đưa vào đây → 422)
- `defaultStitchId` phải có `ProductStitch` trong product → nếu không, 422
- vắng mặt → `isActive = false`

**Cây và bật product**
- `GET /products/:id` trên một product dựng đủ qua các `PUT` trả đúng hình ở trên; giá là chuỗi; `readiness.problems` chứa `MISSING_VARIANT` cho mọi ô
- seed variant trực tiếp vào DB cho mọi ô (giả lập P2b) → `readiness.ready === true`
- `PATCH { isEnabled: true }` khi chưa sẵn sàng → 409 `{ error: "NOT_READY", problems: [...] }`, `isEnabled` trong DB **vẫn false**; khi sẵn sàng → 200
- `PATCH { isEnabled: false }` luôn được, không kiểm readiness (tắt khẩn cấp phải luôn đi được)

- [ ] **Step 3: Viết code; chạy tới xanh**

- [ ] **Step 4: Toàn bộ và commit**

```bash
npm test && npx tsc --noEmit && npm run test:db
git add src/lib/admin/readiness.ts src/lib/admin/products.ts src/app/api/admin/products \
        tests/lib/admin/readiness.test.ts tests-db/admin/product-matrices.db.test.ts
git commit -m "feat(admin): ma trận giá A/B, lưới SVG, cây product và kiểm readiness khi bật

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Tài liệu — quy ước admin API và `test:db`

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md` (§8.1)

- [ ] **Step 1: `CLAUDE.md`**

Thêm, ngắn gọn, vào mục kiến trúc:
- **Hình route admin:** `export const GET = withAdminSession(adminApi(handler))`. `adminApi` tra `Shop`, bắt `AdminHttpError` và lỗi Prisma. Logic ở `src/lib/admin/`, route file vài dòng.
- **Hai hình lỗi**, và nơi định nghĩa chúng (`src/lib/admin/http.ts`).
- **Scope shop:** bảng join không có `shopId` → luôn `loadProductForShop` trước. Id của shop khác trả 404.
- **`PUT` quan hệ:** vắng mặt = tắt, không xoá; `ProductHost` là ngoại lệ.
- **Tiền trong admin JSON là chuỗi `"80.00"`** — `priceSchema` / `formatPrice`.
- **Test:** `npm test` hermetic; `npm run test:db` cần Docker, chạy Postgres thật, và **từ chối** mọi host không phải localhost. Không mock Prisma; ranh giới duy nhất được giả là `src/lib/admin/assetStorage.ts`.

Cập nhật mục lệnh thường dùng với `npm run test:db`.

- [ ] **Step 2: Spec §8.1**

Sửa khối endpoint cho khớp code thật và ghi các ngữ nghĩa spec đang bỏ ngỏ: `PUT` vắng mặt = tắt (R4); reorder đòi đúng tập (409 `STALE_ORDER`); `DELETE` attribute = archive, khôi phục bằng `PATCH { archived: false }`; `PATCH isEnabled: true` kiểm readiness (409 `NOT_READY`); upload SVG từ chối URL ngoài (R5) và từ chối file không hợp lệ hợp đồng mà không lưu (R6); ví dụ `validate-svg` dùng `removedElements` / `removedAttributes` / `externalRefs` (tên thật của `SanitizeReport`), thay cho `removedScripts` / `removedEventHandlers` đang có trong spec.

- [ ] **Step 3: `README.md`** — thêm `npm run test:db` vào mục lệnh, một câu về yêu cầu Docker.

- [ ] **Step 4: Commit**

```bash
npm test && npx tsc --noEmit
git add CLAUDE.md README.md docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md
git commit -m "docs: quy ước admin API, test:db, và ngữ nghĩa PUT/reorder/readiness trong spec

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage — §8.1 admin API:**

| Endpoint spec | Task |
|---|---|
| Attributes × 4: GET/POST/PATCH/DELETE/reorder | 4 |
| `POST /assets/upload-url` + `/commit` | Đã thay bằng `POST /assets` ở P1b (ruling R2 của P1b) → 3 |
| `POST /assets/validate-svg` | 3 |
| `GET/POST /products`, `GET/PATCH /products/:id` | 5 (+ `isEnabled` ở 6) |
| `PUT /products/:id/{hosts,styles,animals,stitches}` | 5 |
| `PUT …/styles/:styleId/leathers`, `…/animals/:animalId/leathers`, `…/styles/:styleId/animals` | 6 |
| `GET /shopify/products`, `/variants/{preview,generate,sync}` | **P2b** — cần Shopify Admin API |
| `GET /designs`, `PATCH /order-lines/:id` (production queue) | **P2c** — cần dữ liệu đơn hàng từ webhook P4 để có ý nghĩa |

**Rủi ro đã biết:**
1. `test:db` cần Docker. Máy không có Docker vẫn chạy `npm test`, nhưng mọi test route nằm ở `test:db` — CI cần một service Postgres (`WK_TEST_DATABASE_URL`).
2. Readiness trước P2b luôn báo `MISSING_VARIANT`, nên chưa product nào bật được qua API. Đúng ý: chưa có variant thì chưa bán được.
3. Tên attribute trong cây là tên hiện tại, không phải tên lúc cấu hình — đúng cho admin; đơn hàng dùng snapshot riêng (spec §7.1).

## Execution Handoff

Plan lưu ở `docs/superpowers/plans/2026-09-10-p2a-admin-api.md`.
