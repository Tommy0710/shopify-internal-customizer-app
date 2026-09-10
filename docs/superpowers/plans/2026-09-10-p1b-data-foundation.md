# P1b — Nền tảng dữ liệu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay schema Prisma cũ bằng schema §7 của spec, dựng `src/shared/` (zod) làm hợp đồng dùng chung giữa server và storefront bundle, nối Supabase Storage, và chốt **một** Shopify API version duy nhất — để P2 (admin) và P3 (storefront) có nền tảng ổn định để dựng lên.

**Architecture:** Bốn nhóm việc độc lập nhau, xếp theo thứ tự "gỡ phụ thuộc trước, dựng cái mới sau". Dọn code chết chạy trên schema cũ (Task 2) phải xong trước khi thay schema (Task 3), nếu không mọi route hiện có sẽ vỡ compile cùng lúc. `src/shared/` là code thuần TypeScript + zod, **không import framework**, vì P3 sẽ bundle nó vào theme extension bằng esbuild. Supabase Storage đi qua service-role key ở server; không có đường nào cho browser ghi thẳng.

**Tech Stack:** Prisma 5 · PostgreSQL (Supabase) · zod 3 · `@supabase/supabase-js` 2 · `@shopify/shopify-api` 14 · Vitest · Next.js 14 App Router

**Spec:** `docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md`

## Global Constraints

- **Không bao giờ lưu bytes SVG gốc do người dùng tải lên.** Chỉ lưu `root.outerHTML` sau khi `sanitizeSvgRoot()` chạy. Comment đặt **trước** thẻ `<svg>` sống sót trong `ownerDocument` dù `root.outerHTML` đã sạch — lưu bytes gốc là bypass toàn bộ sanitizer. (Spec §15b)
- **`src/shared/` phải thuần.** Không `next`, `react`, `@prisma/client`, `linkedom`, `process.env`, không module `node:*`. P3 bundle thư mục này vào storefront bằng esbuild. Có test hàng rào giống `tests/svg-engine/index.test.ts`.
- **Một API version duy nhất, khai ở một hằng số.** `shopify.app.toml`, client `shopifyApi()`, và mọi URL GraphQL đều đọc từ đó. (Spec §4.5)
- **Mọi bảng nghiệp vụ mang `shopId`.** Sẵn sàng multi-shop dù hiện chỉ một shop.
- **`CustomDesign.*Id` và `CustomDesignSelection.attributeId` là soft reference, KHÔNG có FK.** Mọi tham chiếu cấu hình khác (`Leather.displayImageAssetId`, `ProductStyleLeather.leatherId`, `ProductStyleAnimal.svgAssetId`…) phải khai `@relation` thật. (Spec §7)
- **`isActive` và `archivedAt` là hai khái niệm khác nhau**, cùng tồn tại. Attribute không bao giờ hard-delete. (Spec §7.3)
- **Route API mới cần tính động phải khai `export const dynamic = "force-dynamic"`.**
- **Dữ liệu Supabase hiện tại là seed demo, cắt sạch.** Không cần migration bảo toàn dữ liệu; dùng `prisma db push`.
- Ngôn ngữ comment và commit message: tiếng Việt, khớp với phần còn lại của repo.

## Rulings đã chốt trước khi bắt đầu

Bốn quyết định dưới đây đã được cân nhắc và chốt; implementer **không** cần hỏi lại, và reviewer **không** coi chúng là defect.

| # | Ruling | Lý do | Chi phí nếu sai |
|---|---|---|---|
| R1 | Pin **`2026-07`**, nâng `@shopify/shopify-api` lên `^14.0.1` | Hôm nay là 2026-09; `2026-10` mà `shopify.app.toml` đang khai là **release candidate**, chưa stable. Thư viện v11 đang cài chỉ biết tới `2025-10` nên không khai nổi `2026-07`. Thư viện hiện **không có usage nào** trong `src/` → nâng major gần như không rủi ro. | Đổi một hằng số + một dòng toml |
| R2 | Bỏ luồng `upload-url` + `commit` hai bước của spec §8.1; thay bằng **một endpoint server-side nhận file** | Signed URL cho browser ghi thẳng vào Storage = bytes gốc chưa sanitize nằm trong bucket, vi phạm Global Constraint đầu tiên. File ở đây nhỏ (SVG mockup, texture, display image) nên đi qua serverless dư sức. | Viết lại một endpoint ở P2 |
| R3 | **Xoá** `packages/shared-types/` ngay ở P1b thay vì đợi P5 | Zero importer trong toàn repo — thuần code chết. Giữ lại chỉ tạo nhầm lẫn khi `src/shared/` xuất hiện cạnh nó. | `git revert` |
| R4 | **Không thêm dependency `nanoid`.** Sinh id bằng `node:crypto` trong `src/lib/ids.ts` | nanoid v5 ESM-only, gây phiền với vitest/next. Alphabet + rejection sampling ~20 dòng, test được đầy đủ. Quan trọng hơn: `src/shared/` chỉ giữ **validator** định dạng; **sinh** id là việc server-side. | Thêm dep sau, đổi 2 hàm |

---

## Cấu trúc file

**Tạo mới**

| File | Trách nhiệm |
|---|---|
| `src/lib/shopify/apiVersion.ts` | Hằng số `SHOPIFY_API_VERSION` + helper dựng URL GraphQL. Nguồn sự thật duy nhất. |
| `src/lib/shopify/client.ts` | Cấu hình `shopifyApi()` (chuyển từ `src/lib/shopify.ts`) |
| `src/shared/lineItemProperties.ts` | Hằng tên property, zod schema, builder + parser cho hai dòng giỏ |
| `src/shared/ids.ts` | Zod validator định dạng `designId` / `shareToken` (chỉ validate, không sinh) |
| `src/shared/customizerConfig.ts` | Zod cho payload `GET /apps/customizer/config` (spec §8.2) |
| `src/shared/designRequest.ts` | Zod cho req/res `POST /apps/customizer/designs` + bảng mã lỗi |
| `src/shared/index.ts` | Barrel export — bề mặt công khai của `src/shared` |
| `src/lib/ids.ts` | **Sinh** id server-side bằng `node:crypto` |
| `src/lib/storage/index.ts` | Client Supabase Storage service-role + `uploadAsset` / `uploadSanitizedSvg` / `sha256Hex` |
| `docs/runbooks/supabase-storage.md` | Tạo bucket, policy, CORS — việc con người phải làm một lần |

**Sửa**

| File | Thay đổi |
|---|---|
| `prisma/schema.prisma` | Thay toàn bộ bằng schema §7 |
| `shopify.app.toml:20` | `api_version` → hằng số đã chốt |
| `package.json` | `@shopify/shopify-api` ^14 · thêm `zod`, `@supabase/supabase-js` |
| `src/app/page.tsx` | Thay bằng shell tạm; P2 dựng admin 2 tab thật |
| `src/app/api/auth/callback/route.ts` | Port sang field `Shop` mới |
| `src/app/api/webhooks/app-uninstalled/route.ts` | Port sang field `Shop` mới |
| `src/app/api/webhooks/orders-create/route.ts` | Rút còn HMAC + 200; nghiệp vụ chuyển sang P4 |
| `tests/app/api/admin/route-guard.test.ts` | Viết lại thành bộ quét filesystem |
| `scripts/bundle-extension.mjs` | Thêm alias `@` → `src` để P3 import được `src/shared` |
| `.env.example`, `CLAUDE.md`, spec §8.1 | Ghi nhận biến mới và ruling R2 |

**Xoá** (đều là code chạy trên schema cũ, không có consumer sống)

```
packages/                                   src/lib/pricing/
src/app/admin/                              src/app/api/admin/products/
src/app/api/admin/orders/                   src/app/api/cart/
src/app/api/proxy/customizer-config/        src/app/api/proxy/save-design/
src/lib/shopify.ts                          tests/app/api/cart/validate-guard.test.ts
```

---

### Task 1: Chốt một Shopify API version

Spec §4.5 ghi đây là nợ kỹ thuật phải trả trong P1: version đang lệch ba chỗ. Task này chốt một hằng số và **dựng test chống lệch lại** — phần quan trọng hơn cả việc sửa giá trị.

**Files:**
- Create: `src/lib/shopify/apiVersion.ts`
- Create: `src/lib/shopify/client.ts`
- Delete: `src/lib/shopify.ts`
- Modify: `shopify.app.toml:20`
- Modify: `package.json` (dependency `@shopify/shopify-api`)
- Test: `tests/lib/shopify/apiVersion.test.ts`

**Interfaces:**
- Produces: `SHOPIFY_API_VERSION: "2026-07"`, `adminGraphqlUrl(shop: string): string`, `shopify` (instance `shopifyApi()`). Task sau và P2 dùng `adminGraphqlUrl` chứ không tự nối URL.

- [ ] **Step 1: Nâng thư viện**

```bash
npm install @shopify/shopify-api@^14.0.1
```

Kiểm chứng enum có giá trị cần dùng:

```bash
node -e "const {ApiVersion}=require('@shopify/shopify-api'); console.log(ApiVersion.July26)"
```
Kỳ vọng in ra `2026-07`. Nếu không, **dừng và báo cáo** — ruling R1 dựa trên giá trị này.

- [ ] **Step 2: Viết test thất bại**

Tạo `tests/lib/shopify/apiVersion.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ApiVersion } from "@shopify/shopify-api";
import { SHOPIFY_API_VERSION, adminGraphqlUrl } from "@/lib/shopify/apiVersion";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

function sourceFiles(dir: string, acc: Array<[string, string]> = []): Array<[string, string]> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      sourceFiles(`${full}/`, acc);
      continue;
    }
    if (!/\.(ts|tsx|mjs)$/.test(entry.name)) continue;
    acc.push([full.slice(REPO.length), readFileSync(full, "utf8")]);
  }
  return acc;
}

describe("Shopify API version", () => {
  it("có định dạng YYYY-MM", () => {
    expect(SHOPIFY_API_VERSION).toMatch(/^\d{4}-(01|04|07|10)$/);
  });

  it("là một giá trị thư viện đang cài thật sự biết", () => {
    expect(Object.values(ApiVersion)).toContain(SHOPIFY_API_VERSION);
  });

  it("khớp với api_version trong shopify.app.toml", () => {
    const toml = readFileSync(`${REPO}shopify.app.toml`, "utf8");
    const match = toml.match(/^\s*api_version\s*=\s*"([^"]+)"/m);
    expect(match?.[1]).toBe(SHOPIFY_API_VERSION);
  });

  it("dựng URL Admin GraphQL từ chính hằng số đó", () => {
    expect(adminGraphqlUrl("demo.myshopify.com")).toBe(
      `https://demo.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    );
  });

  // Đây là test đáng giá nhất của task: nó chống việc version lệch lại lần nữa.
  it("không có file nguồn nào hardcode version ngoài apiVersion.ts", () => {
    const offenders = sourceFiles(`${REPO}src/`)
      .filter(([path]) => path !== "src/lib/shopify/apiVersion.ts")
      .filter(([, body]) => /\/admin\/api\/\d{4}-\d{2}/.test(body) || /ApiVersion\.[A-Za-z]+\d\d/.test(body))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận nó đỏ**

Run: `npx vitest run tests/lib/shopify/apiVersion.test.ts`
Expected: FAIL — `Cannot find module '@/lib/shopify/apiVersion'`

- [ ] **Step 4: Viết `src/lib/shopify/apiVersion.ts`**

```ts
import { ApiVersion } from "@shopify/shopify-api";

/**
 * NGUỒN SỰ THẬT DUY NHẤT cho Shopify API version.
 *
 * Trước P1b, con số này lệch ở ba nơi (`shopify.app.toml` = 2026-10,
 * client = 2024-10, URL GraphQL hardcode 2024-10). `tests/lib/shopify/
 * apiVersion.test.ts` giữ cho ba nơi đó không lệch lại được.
 *
 * Đang chọn 2026-07 chứ không phải 2026-10 vì tại thời điểm chốt, 2026-10
 * mới là release candidate. Nâng version = đổi đúng dòng này rồi chạy
 * `npm run shopify:deploy` để đăng ký lại webhook theo version mới.
 */
export const SHOPIFY_API_VERSION: ApiVersion = ApiVersion.July26;

/** URL Admin GraphQL của một shop, luôn theo version đã chốt. */
export function adminGraphqlUrl(shop: string): string {
  return `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
}
```

- [ ] **Step 5: Chuyển `src/lib/shopify.ts` → `src/lib/shopify/client.ts`**

```ts
import "@shopify/shopify-api/adapters/node";
import { LogSeverity, shopifyApi } from "@shopify/shopify-api";
import { SHOPIFY_API_VERSION, adminGraphqlUrl } from "./apiVersion";

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY || "local_dev_key",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "local_dev_secret",
  scopes: (process.env.SCOPES || "read_products,write_products,read_orders,write_orders").split(","),
  hostName: (process.env.SHOPIFY_APP_URL || "http://localhost:3000").replace(/^https?:\/\//, ""),
  apiVersion: SHOPIFY_API_VERSION,
  isEmbeddedApp: true,
  logger: {
    level: process.env.NODE_ENV === "development" ? LogSeverity.Info : LogSeverity.Error,
  },
});

/** Gọi Admin GraphQL. Ném lỗi khi HTTP không 2xx; caller tự xử lý `errors[]` trong body. */
export async function executeShopifyGraphQL(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
) {
  const response = await fetch(adminGraphqlUrl(shop), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Shopify GraphQL Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
```

Rồi `git rm src/lib/shopify.ts`.

- [ ] **Step 6: Sửa `shopify.app.toml`**

Dòng 20, trong block `[webhooks]`:
```toml
api_version = "2026-07"
```

- [ ] **Step 7: Chạy lại test và toàn bộ suite**

Run: `npx vitest run tests/lib/shopify/apiVersion.test.ts && npm test && npx tsc --noEmit`
Expected: tất cả PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(shopify): chốt một API version duy nhất (2026-07)"
```

---

### Task 2: Dọn code chạy trên schema cũ

Mười file đang gọi `db.productConfig` / `db.design` / `db.productionJob`. Thay schema mà chưa dọn thì cả mười vỡ compile cùng lúc và Task 3 biến thành một cuộc sửa lỗi mù. Task này gỡ chúng trước.

**Tất cả đều là code chết:** widget storefront hiện dùng mảng hardcode và chưa từng chạy trên theme thật, product Shopify thật chưa tồn tại, dữ liệu Supabase là seed demo đã thống nhất cắt sạch. Không có consumer sống nào mất đi.

Task này cũng nâng cấp bộ test guard `/api/admin/*` từ "kiểm hai route đã biết tên" thành "quét mọi route trong thư mục" — cần thiết vì P2 sẽ thêm ~30 route và không ai nhớ cập nhật một danh sách viết tay.

**Files:**
- Delete: `packages/`, `src/lib/pricing/`, `src/app/admin/`, `src/app/api/admin/products/`, `src/app/api/admin/orders/`, `src/app/api/cart/`, `src/app/api/proxy/customizer-config/`, `src/app/api/proxy/save-design/`, `tests/app/api/cart/validate-guard.test.ts`
- Modify: `src/app/page.tsx` (thay bằng shell tạm)
- Modify: `src/app/api/webhooks/orders-create/route.ts` (rút còn HMAC + 200)
- Test: `tests/app/api/admin/route-guard.test.ts` (viết lại)

**Interfaces:**
- Consumes: `requireAdminSession` từ `src/lib/auth/requireAdminSession.ts` (P0), `verifyShopifyWebhook` + `hmacBypassEnabled` từ `src/lib/hmac.ts` (P0).
- Produces: không có API mới. Sau task này `src/app/api/` chỉ còn `auth/`, `auth/callback/`, `webhooks/orders-create/`, `webhooks/app-uninstalled/`.

- [ ] **Step 1: Viết lại test guard trước khi xoá route**

Thay toàn bộ `tests/app/api/admin/route-guard.test.ts` bằng:

```ts
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard `/api/admin/*` là prologue chép tay ở đầu mỗi handler — không có gì ở
 * tầng type hay lint ép nó phải có mặt. Bản trước kiểm hai route gọi đích danh;
 * P2 sẽ thêm khoảng 30 route nữa và một danh sách viết tay chắc chắn lạc hậu.
 *
 * Bản này quét thư mục. Giới hạn đã biết: nó đếm lời gọi chứ không phân tích cú
 * pháp, nên một file có 2 handler và 2 lời gọi `requireAdminSession` nằm cả trong
 * một handler sẽ lọt. Đổi lại nó bắt được đúng lỗi hay xảy ra nhất — thêm handler
 * mới mà quên guard — và không bao giờ lạc hậu.
 */

const ADMIN_API = fileURLToPath(new URL("../../../../src/app/api/admin/", import.meta.url));
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function routeFiles(dir: string, prefix = ""): Array<[string, string]> {
  if (!existsSync(dir)) return [];
  const found: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...routeFiles(`${dir}${entry.name}/`, `${prefix}${entry.name}/`));
      continue;
    }
    if (entry.name !== "route.ts") continue;
    found.push([`${prefix}${entry.name}`, readFileSync(dir + entry.name, "utf8")]);
  }
  return found;
}

/** Đếm handler HTTP được export trong một file route. */
export function exportedHandlers(source: string): string[] {
  return HTTP_METHODS.filter((method) =>
    new RegExp(`export\\s+(?:async\\s+)?(?:function\\s+${method}\\b|const\\s+${method}\\s*[:=])`).test(source),
  );
}

/**
 * Số lời GỌI `requireAdminSession(` trong một file route.
 *
 * Dòng `import { requireAdminSession } from "…"` KHÔNG được đếm: trong đó tên hàm
 * theo sau là ` }` và `"`, không phải `(`. Nên con số trả về đã là số lời gọi
 * thật — đừng trừ đi 1 ở nơi dùng.
 */
export function guardCallCount(source: string): number {
  return (source.match(/requireAdminSession\s*\(/g) ?? []).length;
}

describe("bộ dò guard", () => {
  // Kiểm soát âm: nếu bộ dò hỏng, cả bộ quét bên dưới xanh một cách vô nghĩa.
  it("nhận ra handler thiếu guard", () => {
    const source = `
      import { requireAdminSession } from "@/lib/auth/requireAdminSession";
      export async function GET(req: Request) { const s = await requireAdminSession(req); return Response.json({}); }
      export async function POST(req: Request) { return Response.json({}); }
    `;
    expect(exportedHandlers(source)).toEqual(["GET", "POST"]);
    // Hai handler nhưng chỉ một lời gọi guard — POST bị hở.
    expect(guardCallCount(source)).toBe(1);
    expect(guardCallCount(source)).toBeLessThan(exportedHandlers(source).length);
  });

  it("nhận ra cả handler khai bằng const", () => {
    expect(exportedHandlers(`export const PATCH = async (req: Request) => {};`)).toEqual(["PATCH"]);
  });
});

describe("/api/admin/* session guard", () => {
  const files = routeFiles(ADMIN_API);

  it.each(files.length ? files : [["(chưa có route admin nào)", ""]])(
    "%s gọi requireAdminSession trong mọi handler",
    (name, source) => {
      const handlers = exportedHandlers(source);
      if (handlers.length === 0) return;
      expect(
        source,
        `${name}: phải import requireAdminSession`,
      ).toContain('from "@/lib/auth/requireAdminSession"');
      expect(
        guardCallCount(source),
        `${name}: ${handlers.length} handler (${handlers.join(", ")}) nhưng chỉ ${guardCallCount(source)} lời gọi guard`,
      ).toBeGreaterThanOrEqual(handlers.length);
    },
  );
});
```

- [ ] **Step 2: Chạy test — phải XANH với các route hiện tại**

Run: `npx vitest run tests/app/api/admin/route-guard.test.ts`
Expected: PASS. Hai route admin hiện có đều đã có guard từ P0, nên bộ quét mới phải công nhận chúng. Nếu đỏ, bộ dò sai — sửa bộ dò, **đừng** sửa route.

- [ ] **Step 3: Xoá code chết**

```bash
git rm -r packages src/lib/pricing src/app/admin \
         src/app/api/admin/products src/app/api/admin/orders \
         src/app/api/cart src/app/api/proxy/customizer-config \
         src/app/api/proxy/save-design \
         tests/app/api/cart/validate-guard.test.ts
```

- [ ] **Step 4: Rút `webhooks/orders-create` còn phần xác thực**

`shopify.app.toml` vẫn đăng ký topic `orders/create` + `orders/paid` tới URI này. Xoá route = khai báo nói dối và Shopify nhận 404. Giữ route, bỏ nghiệp vụ (P4 dựng lại đầy đủ với idempotency hai lớp).

Thay toàn bộ `src/app/api/webhooks/orders-create/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook, hmacBypassEnabled } from "@/lib/hmac";

export const dynamic = "force-dynamic";

/**
 * Nhận và xác thực webhook đơn hàng.
 *
 * P1b rút route này còn phần xác thực: nghiệp vụ cũ chạy trên schema đã bị thay.
 * P4 dựng lại đầy đủ — idempotency hai lớp (`WebhookEvent` + `OrderLineDesign`),
 * đối soát nhóm dòng MAIN/ADDON, tạo bản ghi sản xuất. Xem spec §11.
 *
 * Trả 200 cho mọi payload hợp lệ: Shopify retry khi nhận non-2xx, và ở giai đoạn
 * này không có gì để retry cho thành công.
 */
export async function POST(req: NextRequest) {
  // BẮT BUỘC đọc raw body trước mọi thứ: `req.json()` rồi `JSON.stringify` lại
  // sẽ đổi byte và HMAC sai.
  const rawBody = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");

  if (!hmacBypassEnabled() && !verifyShopifyWebhook(rawBody, hmacHeader)) {
    return NextResponse.json({ error: "INVALID_HMAC" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
```

Đọc `src/lib/hmac.ts` để lấy **đúng** chữ ký của `verifyShopifyWebhook` và `hmacBypassEnabled` trước khi viết — hai hàm này do P0 định nghĩa và đoạn trên là minh hoạ, không phải hợp đồng.

- [ ] **Step 5: Thay `src/app/page.tsx` bằng shell tạm**

File hiện tại import `./admin/products/page` và `./admin/orders/page` — vừa bị xoá. P2 dựng admin 2 tab thật ở đây.

```tsx
export const dynamic = "force-dynamic";

/**
 * Admin nhúng (iframe trong Shopify Admin). CSP `frame-ancestors` cho route này
 * được khai ở `next.config.mjs` — thiếu là trắng trang.
 *
 * P1b để trống có chủ ý: admin cũ chạy trên schema đã bị thay, admin mới thuộc P2.
 */
export default function EmbeddedAdminPage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Wild &amp; King Customizer</h1>
      <p style={{ color: "#6b7280", marginTop: "0.75rem" }}>
        Nền tảng dữ liệu đã sẵn sàng. Giao diện quản trị hai tab (Attributes ·
        Products) sẽ có ở giai đoạn P2.
      </p>
    </main>
  );
}
```

- [ ] **Step 6: Xác nhận không còn tham chiếu treo**

```bash
grep -rn "shared-types\|pricingEngine\|api/admin/products\|api/admin/orders\|api/cart/validate\|save-design\|customizer-config" src/ tests/ scripts/ *.mjs *.json 2>/dev/null | grep -v node_modules
```

Kỳ vọng: chỉ còn khớp trong `src/storefront-customizer/` (widget cũ, P5 mới xoá) và `extensions/…/customizer-bundle.js` (artifact đã build). Bất kỳ khớp nào khác trong `src/app/` hay `src/lib/` là tham chiếu treo — sửa.

- [ ] **Step 7: Chạy toàn bộ**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: tất cả PASS. Số test giảm so với trước (bộ `validate-guard` đã xoá) — đó là điều mong đợi.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: gỡ code chạy trên schema cũ, quét guard admin bằng filesystem"
```

---

### Task 3: Schema Prisma mới

Thay toàn bộ `prisma/schema.prisma` bằng schema §7 của spec. Dữ liệu hiện tại là seed demo, cắt sạch — dùng `prisma db push`, không tạo migration.

**Hai ruling bổ sung cho task này:**

| # | Ruling | Lý do |
|---|---|---|
| R5 | Cụm bất biến — `CustomDesign`, `CustomDesignSelection`, `OrderLineDesign`, `WebhookEvent` — **không mang khoá ngoại nào cả**, kể cả `shopId`. Mọi bảng cấu hình khác khai `@relation` thật, gồm cả quan hệ về `Shop`. | Spec §7 nói `CustomDesign.*Id` là soft reference để "archive hoặc xoá attribute không bao giờ phá được đơn cũ". Áp dụng nửa vời — FK cho `shopId` nhưng không cho `styleId` — vẫn để lại đúng một đường phá đơn cũ. Snapshot là nguồn sự thật cho đơn đã đặt; đơn đã đặt không nên phụ thuộc vào bất cứ bảng nào còn sống. |
| R6 | Thêm cột **`priceInput Decimal? @db.Decimal(10,2)`** vào `ProductStyleLeather` và `AnimalLeather` — schema §7 thiếu nó. | §12.2 cho admin gõ giá vào lưới rồi **bấm Save**, sau đó mới bấm `Generate variants`. Không có cột này thì giá đã gõ không sống qua một lần tải lại trang. `variantPriceSnapshot` là giá **đọc ngược từ Shopify** — hai cột khác nhau, và chúng lệch nhau chính là tín hiệu "cần generate/sync" mà §8.1 cần báo cáo. |

**Files:**
- Modify: `prisma/schema.prisma` (thay toàn bộ)
- Modify: `src/app/api/auth/callback/route.ts` (port sang field `Shop` mới)
- Modify: `src/app/api/webhooks/app-uninstalled/route.ts` (port sang field `Shop` mới)
- Test: `tests/prisma/schema.test.ts`

**Interfaces:**
- Produces: model `Shop` với `shopDomain` (trước là `shop`), `installedAt`, `uninstalledAt`. Mọi task sau và P2–P4 đọc model từ `@prisma/client`.

- [ ] **Step 1: Viết test thất bại**

Test chạy offline — không kết nối DB. Nó kiểm hai thứ: văn bản schema mang đủ ràng buộc spec đòi, và client sinh ra thật sự có các model đó.

Tạo `tests/prisma/schema.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

const SCHEMA = readFileSync(
  fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)),
  "utf8",
);

/** Lấy phần thân của một `model X { … }`. */
function modelBody(name: string): string {
  const match = SCHEMA.match(new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Không tìm thấy model ${name}`);
  return match[1];
}

const EXPECTED_MODELS = [
  "Shop", "Asset", "Leather", "Stitch", "Animal", "Style",
  "CustomizableProduct", "ProductHost", "ProductStyle", "ProductStyleLeather",
  "ProductAnimal", "AnimalLeather", "ProductStyleAnimal", "ProductStitch",
  "CustomDesign", "CustomDesignSelection", "OrderLineDesign", "WebhookEvent",
] as const;

const EXPECTED_ENUMS = {
  AssetKind: ["SVG_MOCKUP", "TEXTURE", "DISPLAY", "DESIGN_SVG"],
  DesignStatus: ["DRAFT", "ORDERED", "CANCELLED"],
  LineRole: ["MAIN", "ADDON"],
  ProductionStatus: ["NEW", "IN_PRODUCTION", "QC", "SHIPPED", "ON_HOLD"],
  AttributeType: ["STYLE", "BODY_LEATHER", "ANIMAL", "ANIMAL_LEATHER", "STITCH"],
} as const;

describe("prisma schema", () => {
  it("khai đủ mọi model spec §7 đòi", () => {
    for (const model of EXPECTED_MODELS) {
      expect(SCHEMA, `thiếu model ${model}`).toMatch(new RegExp(`model\\s+${model}\\s*\\{`));
    }
  });

  it("không còn model nào của schema cũ", () => {
    for (const gone of ["ProductConfig", "OptionGroup", "OptionValue", "CompatibilityRule", "PriceRule", "Design", "DesignSelection", "ProductionJob"]) {
      expect(SCHEMA, `model cũ ${gone} vẫn còn`).not.toMatch(new RegExp(`model\\s+${gone}\\s*\\{`));
    }
  });

  it("khai đủ enum với đủ giá trị", () => {
    for (const [name, values] of Object.entries(EXPECTED_ENUMS)) {
      const body = SCHEMA.match(new RegExp(`enum\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
      expect(body, `thiếu enum ${name}`).toBeDefined();
      for (const value of values) {
        expect(body, `enum ${name} thiếu ${value}`).toMatch(new RegExp(`\\b${value}\\b`));
      }
    }
  });

  // Spec §7.2 — mỗi ràng buộc chống một cách hỏng dữ liệu cụ thể.
  it.each([
    ["Asset", "@@unique([shopId, kind, checksumSha256])"],
    ["ProductStyleLeather", "@@unique([shopifyVariantId])"],
    ["AnimalLeather", "@@unique([shopifyVariantId])"],
    ["ProductStyleAnimal", "@@unique([productStyleId, animalId])"],
    ["ProductHost", "@@unique([shopId, shopifyProductId])"],
    ["CustomDesign", "@@unique([shopId, idempotencyKey])"],
    ["CustomDesign", "@@unique([shopId, shareToken])"],
    ["OrderLineDesign", "@@unique([shopifyOrderId, shopifyLineItemId])"],
    ["WebhookEvent", "@@unique([shopifyWebhookId])"],
  ])("%s giữ ràng buộc %s", (model, constraint) => {
    expect(modelBody(model).replace(/\s+/g, " ")).toContain(constraint.replace(/\s+/g, " "));
  });

  // Ruling R5 — cụm bất biến không được có FK nào.
  it.each(["CustomDesign", "CustomDesignSelection", "OrderLineDesign", "WebhookEvent"])(
    "%s không khai @relation nào (soft reference, không FK)",
    (model) => {
      expect(modelBody(model)).not.toContain("@relation");
    },
  );

  // Mặt còn lại của R5: bảng cấu hình PHẢI có FK thật.
  it.each([
    ["Leather", 3],              // shop + displayImage + textureImage
    ["ProductStyleLeather", 2],  // productStyle + leather
    ["ProductStyleAnimal", 3],   // productStyle + animal + svgAsset
  ])("%s khai ít nhất %i @relation", (model, least) => {
    expect((modelBody(model).match(/@relation/g) ?? []).length).toBeGreaterThanOrEqual(least);
  });

  // Ruling R6.
  it.each(["ProductStyleLeather", "AnimalLeather"])("%s lưu cả giá admin nhập và giá đọc ngược", (model) => {
    const body = modelBody(model);
    expect(body).toMatch(/priceInput\s+Decimal\?\s+@db\.Decimal\(10,\s*2\)/);
    expect(body).toMatch(/variantPriceSnapshot\s+Decimal\?\s+@db\.Decimal\(10,\s*2\)/);
  });

  it("client sinh ra biết mọi model", () => {
    for (const model of EXPECTED_MODELS) {
      expect(Prisma.ModelName, `client chưa generate lại?`).toHaveProperty(model);
    }
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/prisma/schema.test.ts`
Expected: FAIL — schema hiện tại vẫn là bản cũ.

- [ ] **Step 3: Thay `prisma/schema.prisma`**

Chép nguyên khối `prisma` trong spec §7 (dòng ~300–610 của file spec), rồi áp bốn thay đổi sau:

1. **Thêm `@relation` thật** cho mọi tham chiếu cấu hình, kèm back-relation ở phía đối diện. Nhiều quan hệ cùng trỏ về `Asset` nên **bắt buộc đặt tên**: `@relation("LeatherDisplayImage", …)`, `@relation("LeatherTextureImage", …)`, `@relation("StitchDisplayImage", …)`, `@relation("AnimalDisplayImage", …)`, `@relation("StyleDisplayImage", …)`, `@relation("StyleAnimalSvg", …)`.
2. **Không FK nào** trong `CustomDesign`, `CustomDesignSelection`, `OrderLineDesign`, `WebhookEvent` (R5).
3. **Thêm `priceInput`** vào `ProductStyleLeather` và `AnimalLeather` (R6), đặt ngay trên `variantPriceSnapshot`.
4. `Stitch`, `Animal`, `Style` trong spec viết tắt — bổ sung `createdAt DateTime @default(now())` và `updatedAt DateTime @updatedAt` cho đồng bộ với `Leather`, và index `@@index([shopId, archivedAt, isActive, sortOrder])` giống `Leather`.

Khối `generator` / `datasource` giữ nguyên hiện trạng.

Mẫu cho quan hệ nhiều-đường-tới-`Asset` (áp cùng kiểu cho các bảng còn lại):

```prisma
model Asset {
  id               String    @id @default(cuid())
  shopId           String
  shop             Shop      @relation(fields: [shopId], references: [id])
  kind             AssetKind
  storagePath      String
  publicUrl        String
  mimeType         String
  byteSize         Int
  checksumSha256   String
  width            Int?
  height           Int?
  originalFilename String
  svgValidatedAt   DateTime?
  svgContractVer   String?
  createdAt        DateTime  @default(now())
  createdBy        String?
  archivedAt       DateTime?

  leatherDisplays  Leather[]            @relation("LeatherDisplayImage")
  leatherTextures  Leather[]            @relation("LeatherTextureImage")
  stitchDisplays   Stitch[]             @relation("StitchDisplayImage")
  animalDisplays   Animal[]             @relation("AnimalDisplayImage")
  styleDisplays    Style[]              @relation("StyleDisplayImage")
  styleAnimalSvgs  ProductStyleAnimal[] @relation("StyleAnimalSvg")

  @@unique([shopId, kind, checksumSha256])
  @@index([shopId, kind, archivedAt])
}

model Leather {
  id                  String    @id @default(cuid())
  shopId              String
  shop                Shop      @relation(fields: [shopId], references: [id])
  name                String
  slug                String
  displayImageAssetId String
  displayImage        Asset     @relation("LeatherDisplayImage", fields: [displayImageAssetId], references: [id])
  textureImageAssetId String
  textureImage        Asset     @relation("LeatherTextureImage", fields: [textureImageAssetId], references: [id])
  isActive            Boolean   @default(true)
  sortOrder           Int       @default(0)
  archivedAt          DateTime?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  styleLeathers  ProductStyleLeather[]
  animalLeathers AnimalLeather[]

  @@unique([shopId, slug])
  @@index([shopId, archivedAt, isActive, sortOrder])
}
```

- [ ] **Step 4: Validate và generate**

```bash
npx prisma format
npx prisma validate
npx prisma generate
```

`prisma validate` bắt mọi quan hệ thiếu back-relation hoặc thiếu tên — chạy tới khi sạch trước khi đi tiếp.

- [ ] **Step 5: Port hai route còn dùng `Shop`**

`src/app/api/auth/callback/route.ts` và `src/app/api/webhooks/app-uninstalled/route.ts` đang dùng field `shop`. Đọc cả hai file, đổi sang `shopDomain`, và ở route uninstall ghi thêm `uninstalledAt: new Date()` cạnh `installed: false`. Ở callback, `upsert` phải set `installedAt` khi tạo mới và `uninstalledAt: null` khi cài lại.

- [ ] **Step 6: Chạy test và toàn bộ**

Run: `npx vitest run tests/prisma/schema.test.ts && npm test && npx tsc --noEmit && npm run build`
Expected: tất cả PASS.

- [ ] **Step 7: KHÔNG chạy `db push`**

`prisma db push` xoá bảng trên Supabase thật — thao tác phá huỷ, nằm ngoài quyền của implementer. Ghi vào report rằng schema đã sẵn sàng và con người cần chạy `npm run prisma:push` khi muốn áp lên DB. Task 7 đưa việc này vào runbook.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(db): thay schema cũ bằng schema hai ma trận giá của spec §7"
```

---

### Task 4: `src/shared/` — line item properties và định dạng id

`_wk_design_id` là **khớp nối duy nhất** giữa đơn Shopify và design trong DB. Mất property này là mất luôn liên kết, và không có cách nào dựng lại.

Storefront **ghi** các property này (P3), webhook **đọc** chúng (P4). Hai đầu ở hai bundle khác nhau. Định nghĩa chúng hai lần là bảo đảm sẽ lệch — nên chúng sống ở `src/shared/`, và P3 sẽ bundle thư mục này vào theme extension.

**Vì sao phải parse bằng zod chứ không `as` thẳng:** Cart AJAX API cho **bất kỳ ai** đặt property tuỳ ý lên line item. Property đến webhook là dữ liệu người lạ ghi được, không phải dữ liệu ta ghi ra. Parse, đừng tin.

**Files:**
- Create: `src/shared/lineItemProperties.ts`, `src/shared/ids.ts`, `src/shared/index.ts`
- Create: `src/lib/ids.ts`
- Modify: `package.json` (thêm `zod`)
- Modify: `scripts/bundle-extension.mjs` (alias `@` → `src`)
- Test: `tests/shared/lineItemProperties.test.ts`, `tests/shared/ids.test.ts`, `tests/shared/purity.test.ts`, `tests/lib/ids.test.ts`

**Interfaces:**
- Produces:
  - `WK_PROPERTY_VERSION = 1`
  - `WK_PROP = { designId: "_wk_design_id", role: "_wk_role", preview: "_wk_preview", version: "_wk_v" }`
  - `WK_LABEL = { animal: "Animal", animalLeather: "Animal Leather", stitch: "Stitch" }`
  - `buildMainLineProperties(input: MainLineInput): Record<string, string>`
  - `buildAddonLineProperties(designId: string): Record<string, string>`
  - `parseLineProperties(raw: unknown): ParsedLineProperties | null`
  - `designIdSchema`, `shareTokenSchema` (zod)
  - `newDesignId(): string`, `newShareToken(): string` (từ `src/lib/ids.ts`, **không** phải `src/shared`)

- [ ] **Step 1: Thêm zod**

```bash
npm install zod@^3.23.8
```

- [ ] **Step 2: Viết test thất bại cho line item properties**

Tạo `tests/shared/lineItemProperties.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  WK_PROP,
  WK_LABEL,
  WK_PROPERTY_VERSION,
  buildMainLineProperties,
  buildAddonLineProperties,
  parseLineProperties,
} from "@/shared/lineItemProperties";

const DESIGN_ID = "cd_7hK9mQwErTyUiOpAsDf";
const PREVIEW = "https://cdn.example/design/abc.svg";

const MAIN_INPUT = {
  designId: DESIGN_ID,
  previewUrl: PREVIEW,
  animalName: "Alligator",
  animalLeatherName: "Togo Brown",
  stitchName: "Gold",
};

describe("buildMainLineProperties", () => {
  it("sinh đúng bảy property của spec §4.4", () => {
    expect(buildMainLineProperties(MAIN_INPUT)).toEqual({
      [WK_PROP.designId]: DESIGN_ID,
      [WK_PROP.role]: "main",
      [WK_PROP.preview]: PREVIEW,
      [WK_PROP.version]: String(WK_PROPERTY_VERSION),
      [WK_LABEL.animal]: "Alligator",
      [WK_LABEL.animalLeather]: "Togo Brown",
      [WK_LABEL.stitch]: "Gold",
    });
  });

  it("KHÔNG lặp lại Style và Body Leather — variant title đã mang chúng", () => {
    const keys = Object.keys(buildMainLineProperties(MAIN_INPUT));
    expect(keys).not.toContain("Style");
    expect(keys).not.toContain("Body Leather");
  });

  it("KHÔNG bao giờ chứa giá hay mã màu hex", () => {
    const serialized = JSON.stringify(buildMainLineProperties(MAIN_INPUT));
    expect(serialized).not.toMatch(/price|\$\d|#[0-9a-fA-F]{6}/);
  });

  it("chỉ _wk_preview được mang đường dẫn file — không rò tên file SVG master", () => {
    // Spec §4.4 cấm đưa "tên file SVG" vào properties. `_wk_preview` là ngoại lệ
    // có chủ ý: nó là URL công khai của baked design SVG, chính là thứ cart dùng
    // để hiện ảnh. Test này chốt rằng KHÔNG property nào KHÁC mang đuôi .svg.
    const built = buildMainLineProperties(MAIN_INPUT);
    const others = Object.entries(built).filter(([key]) => key !== WK_PROP.preview);
    for (const [key, value] of others) {
      expect(value, `${key} không được mang tên file`).not.toMatch(/\.svg\b/);
    }
  });

  it("mọi khoá kỹ thuật đều bắt đầu bằng dấu gạch dưới (ẩn khỏi cart khách)", () => {
    for (const key of Object.values(WK_PROP)) expect(key).toMatch(/^_wk_/);
  });
});

describe("buildAddonLineProperties", () => {
  it("chỉ mang ba property, không có preview và không có nhãn hiện", () => {
    expect(buildAddonLineProperties(DESIGN_ID)).toEqual({
      [WK_PROP.designId]: DESIGN_ID,
      [WK_PROP.role]: "addon",
      [WK_PROP.version]: String(WK_PROPERTY_VERSION),
    });
  });

  it("dùng cùng designId với dòng chính — đó là thứ nối hai dòng", () => {
    expect(buildAddonLineProperties(DESIGN_ID)[WK_PROP.designId]).toBe(
      buildMainLineProperties(MAIN_INPUT)[WK_PROP.designId],
    );
  });
});

describe("parseLineProperties", () => {
  it("đọc lại được thứ chính nó ghi ra", () => {
    expect(parseLineProperties(buildMainLineProperties(MAIN_INPUT))).toMatchObject({
      designId: DESIGN_ID,
      role: "main",
      version: WK_PROPERTY_VERSION,
    });
    expect(parseLineProperties(buildAddonLineProperties(DESIGN_ID))).toMatchObject({
      designId: DESIGN_ID,
      role: "addon",
    });
  });

  it("đọc được mảng {name,value} — dạng Shopify gửi trong webhook", () => {
    const asShopifySends = Object.entries(buildMainLineProperties(MAIN_INPUT)).map(
      ([name, value]) => ({ name, value }),
    );
    expect(parseLineProperties(asShopifySends)).toMatchObject({ designId: DESIGN_ID, role: "main" });
  });

  it.each([
    ["thiếu hoàn toàn", {}],
    ["dòng thường của khách", { Engraving: "Happy birthday" }],
    ["designId sai định dạng", { [WK_PROP.designId]: "'; DROP TABLE", [WK_PROP.role]: "main", [WK_PROP.version]: "1" }],
    ["role lạ", { [WK_PROP.designId]: DESIGN_ID, [WK_PROP.role]: "admin", [WK_PROP.version]: "1" }],
    ["version không phải số", { [WK_PROP.designId]: DESIGN_ID, [WK_PROP.role]: "main", [WK_PROP.version]: "v1" }],
    ["null", null],
    ["chuỗi", "_wk_design_id=cd_x"],
  ])("trả null cho %s", (_label, input) => {
    expect(parseLineProperties(input)).toBeNull();
  });

  it("bỏ qua property lạ do khách tự thêm qua Cart AJAX API", () => {
    const parsed = parseLineProperties({
      ...buildMainLineProperties(MAIN_INPUT),
      _wk_admin: "true",
      "<script>": "x",
    });
    expect(parsed).toMatchObject({ designId: DESIGN_ID, role: "main" });
    expect(parsed).not.toHaveProperty("_wk_admin");
  });
});
```

- [ ] **Step 3: Viết test thất bại cho định dạng id**

Tạo `tests/shared/ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { designIdSchema, shareTokenSchema, DESIGN_ID_PREFIX } from "@/shared/ids";

describe("designIdSchema", () => {
  it("chấp nhận id đúng định dạng", () => {
    expect(designIdSchema.safeParse("cd_7hK9mQwErTyUiOpAsDf").success).toBe(true);
    expect(designIdSchema.safeParse("cd_A-b_C0123456789xyzAB").success).toBe(true);
  });

  it.each([
    ["thiếu prefix", "7hK9mQwErTyUiOpAsDf12"],
    ["prefix sai", "de_7hK9mQwErTyUiOpAsDf"],
    ["quá ngắn", "cd_short"],
    ["quá dài", "cd_7hK9mQwErTyUiOpAsDfEXTRA"],
    ["ký tự ngoài alphabet", "cd_7hK9mQwErTyUiOpAs.f"],
    ["có khoảng trắng", "cd_7hK9mQwErTyUiOpAs f"],
    ["rỗng", ""],
  ])("từ chối %s", (_label, value) => {
    expect(designIdSchema.safeParse(value).success).toBe(false);
  });

  it("prefix được export để nơi khác không hardcode lại", () => {
    expect(DESIGN_ID_PREFIX).toBe("cd_");
  });
});

describe("shareTokenSchema", () => {
  it("chấp nhận token 22 ký tự, không prefix", () => {
    expect(shareTokenSchema.safeParse("A".repeat(22)).success).toBe(true);
  });

  it.each([["21 ký tự", "A".repeat(21)], ["23 ký tự", "A".repeat(23)], ["có prefix", `cd_${"A".repeat(19)}`]])(
    "từ chối %s",
    (_label, value) => {
      expect(shareTokenSchema.safeParse(value).success).toBe(false);
    },
  );
});
```

- [ ] **Step 4: Viết test hàng rào thuần**

Tạo `tests/shared/purity.test.ts` — dựa theo `tests/svg-engine/index.test.ts`, đệ quy để thư mục con sau này không thoát được:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SHARED_DIR = fileURLToPath(new URL("../../src/shared/", import.meta.url));

function sharedSources(directory: string = SHARED_DIR, prefix = ""): Array<[string, string]> {
  const files: Array<[string, string]> = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...sharedSources(`${directory}${entry.name}/`, `${prefix}${entry.name}/`));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    files.push([`${prefix}${entry.name}`, readFileSync(directory + entry.name, "utf8")]);
  }
  return files;
}

function importPatterns(moduleName: string): RegExp[] {
  return [
    new RegExp(`from\\s*["']${moduleName}`),
    new RegExp(`require\\s*\\(\\s*["']${moduleName}`),
    new RegExp(`import\\s*\\(\\s*["']${moduleName}`),
  ];
}

/**
 * P3 bundle `src/shared/` vào theme extension bằng esbuild. Bất cứ thứ gì trong
 * danh sách này lọt vào đây sẽ hoặc làm vỡ build, hoặc kéo vài trăm KB vào một
 * bundle mục tiêu 8KB, hoặc — tệ nhất — kéo mã server vào mã chạy ở trình duyệt
 * khách.
 */
describe("src/shared thuần TypeScript", () => {
  const forbidden = ["next", "react", "react-dom", "@prisma/client", "linkedom", "@supabase/supabase-js"];

  it.each(forbidden)("không import %s", (moduleName) => {
    for (const [file, body] of sharedSources()) {
      for (const pattern of importPatterns(moduleName)) {
        expect(body, `${file} import ${moduleName}`).not.toMatch(pattern);
      }
    }
  });

  it("không import module node:*", () => {
    for (const [file, body] of sharedSources()) {
      expect(body, `${file} dùng node builtin`).not.toMatch(/from\s*["']node:/);
    }
  });

  it("không đọc process.env", () => {
    for (const [file, body] of sharedSources()) {
      expect(body, `${file} đọc process.env`).not.toMatch(/process\.env/);
    }
  });

  it("có ít nhất một file — hàng rào rỗng là hàng rào vô nghĩa", () => {
    expect(sharedSources().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Chạy ba bộ test, xác nhận đỏ**

Run: `npx vitest run tests/shared/`
Expected: FAIL — chưa có module nào.

- [ ] **Step 6: Viết `src/shared/ids.ts`**

```ts
import { z } from "zod";

/** Alphabet URL-safe của nanoid. Dùng chung cho designId và shareToken. */
export const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
export const DESIGN_ID_PREFIX = "cd_";
export const DESIGN_ID_BODY_LENGTH = 21;
export const SHARE_TOKEN_LENGTH = 22;

const BODY = "[A-Za-z0-9_-]";

export const designIdSchema = z
  .string()
  .regex(new RegExp(`^${DESIGN_ID_PREFIX}${BODY}{${DESIGN_ID_BODY_LENGTH}}$`), "designId sai định dạng");

export const shareTokenSchema = z
  .string()
  .regex(new RegExp(`^${BODY}{${SHARE_TOKEN_LENGTH}}$`), "shareToken sai định dạng");

export type DesignId = z.infer<typeof designIdSchema>;
export type ShareToken = z.infer<typeof shareTokenSchema>;
```

- [ ] **Step 7: Viết `src/shared/lineItemProperties.ts`**

Yêu cầu hành vi (đừng chép mù, để test ở Step 2 dẫn đường):
- `parseLineProperties` nhận **cả hai** dạng: object `Record<string,string>` (dạng client gửi lên Cart AJAX API) và mảng `{name, value}` (dạng Shopify trả trong payload webhook). Chuẩn hoá về object trước khi parse.
- `designId` đi qua `designIdSchema`. `role` là enum `"main" | "addon"`. `version` là chuỗi số, coerce sang number.
- `previewUrl` **chỉ bắt buộc ở dòng `main`**, và phải là `https://`. Dòng `addon` không có nó.
- Trả `null` khi không parse được — không ném. Webhook xử lý cả đơn không phải custom, và một exception ở đó nghĩa là Shopify retry vô hạn.
- Zod schema là một discriminated union trên `role`, để dòng addon mang `_wk_preview` bị từ chối chứ không âm thầm bỏ qua.

- [ ] **Step 8: Viết `src/shared/index.ts`**

Barrel export mọi thứ công khai từ `ids.ts` và `lineItemProperties.ts`. Task 5 nối thêm.

- [ ] **Step 9: Viết `src/lib/ids.ts` (server-side, có test riêng)**

```ts
import { randomBytes } from "node:crypto";
import { DESIGN_ID_PREFIX, DESIGN_ID_BODY_LENGTH, ID_ALPHABET, SHARE_TOKEN_LENGTH } from "@/shared/ids";

/**
 * Sinh id ngẫu nhiên trên alphabet 64 ký tự.
 *
 * Alphabet dài đúng 64 nên `byte & 63` phủ đều — không cần rejection sampling và
 * không có lệch modulo. Nếu ai đó đổi `ID_ALPHABET`, hằng số dưới đây sẽ ném lỗi
 * ngay lúc nạp module thay vì âm thầm sinh id lệch phân phối.
 */
if (ID_ALPHABET.length !== 64) {
  throw new Error(`ID_ALPHABET phải dài đúng 64 ký tự, đang là ${ID_ALPHABET.length}`);
}

function randomId(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ID_ALPHABET[bytes[i] & 63];
  return out;
}

export function newDesignId(): string {
  return DESIGN_ID_PREFIX + randomId(DESIGN_ID_BODY_LENGTH);
}

export function newShareToken(): string {
  return randomId(SHARE_TOKEN_LENGTH);
}
```

Tạo `tests/lib/ids.test.ts` kiểm: id sinh ra luôn qua được `designIdSchema` / `shareTokenSchema` (chạy 1000 lần), mọi ký tự nằm trong `ID_ALPHABET`, và 1000 id liên tiếp không trùng nhau.

- [ ] **Step 10: Thêm alias `@` vào bundler extension**

Trong `scripts/bundle-extension.mjs`, thêm vào object `alias` đang có:

```js
      "@": path.resolve(process.cwd(), "src"),
```

esbuild thay cả subpath, nên `@/shared/lineItemProperties` giải ra `src/shared/lineItemProperties`. P3 mới thật sự dùng đường này; thêm bây giờ để P3 không mất một buổi debug vì nó thiếu.

- [ ] **Step 11: Chạy tất cả**

Run: `npm test && npx tsc --noEmit && npm run bundle:extension && npm run build`
Expected: tất cả PASS. `bundle:extension` phải chạy lọt — nó là hồi quy cho Step 10.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(shared): hợp đồng line item properties và định dạng id dùng chung"
```

---

### Task 5: `src/shared/` — hợp đồng API storefront

Hai payload nối server (P3 viết route) với widget (P3 viết UI). Khai bằng zod ở một chỗ để hai bên không lệch, và để widget **parse** phản hồi thay vì `as`-cast nó.

**Files:**
- Create: `src/shared/customizerConfig.ts`, `src/shared/designRequest.ts`
- Modify: `src/shared/index.ts` (export thêm)
- Test: `tests/shared/customizerConfig.test.ts`, `tests/shared/designRequest.test.ts`

**Interfaces:**
- Consumes: `designIdSchema`, `shareTokenSchema` từ `@/shared/ids` (Task 4).
- Produces: `customizerConfigSchema`, `createDesignRequestSchema`, `createDesignResponseSchema`, `designErrorCodeSchema`, `DESIGN_ERROR_CODES`, cùng các type suy ra.

- [ ] **Step 1: Viết test thất bại cho config payload**

Tạo `tests/shared/customizerConfig.test.ts`. Dựng một fixture hợp lệ đúng theo ví dụ JSON trong spec §8.2, rồi kiểm:

- payload đầy đủ parse thành công;
- `preselectStyleId` là optional (đóng gói 1-product không có nó);
- thiếu `textureImageUrl` ở một leather → **fail** (thiếu texture là customizer không render được thân ví);
- `colorHex` của stitch phải khớp `^#[0-9A-Fa-f]{6}$`; `"red"` và `"#FFF"` → fail;
- `variantId` phải là **chuỗi** chữ số, không phải number — id Shopify vượt `Number.MAX_SAFE_INTEGER` và JSON.parse sẽ làm hỏng chúng âm thầm;
- mảng `leathers` / `styles` rỗng → parse được (product chưa cấu hình xong), nhưng `styles[].animals[].svgUrl` thiếu → fail;
- payload thừa khoá lạ → parse được và khoá lạ **bị loại bỏ** (zod strip mặc định), để server thêm field mới không làm vỡ widget cũ đang chạy trên theme.

Điểm cuối là hợp đồng tương thích ngược quan trọng nhất của task này — viết một test riêng nói rõ điều đó.

- [ ] **Step 2: Viết test thất bại cho create-design**

Tạo `tests/shared/designRequest.test.ts`, kiểm:

- request đủ sáu trường (`productId`, `styleId`, `bodyLeatherId`, `animalId`, `animalLeatherId`, `stitchId`) + `idempotencyKey` parse được;
- thiếu bất kỳ trường nào → fail, và `error.issues[].path` chỉ đúng tên trường (P3 map lỗi này lên UI theo `field`);
- `idempotencyKey` phải là uuid v4;
- response 201 parse được: `designId` qua `designIdSchema`, `shareToken` qua `shareTokenSchema`, `lines` có **đúng hai** phần tử, `summary.total` bằng `bodyPrice + animalPrice`;
- `lines` một phần tử → fail (mô hình hai dòng là bất biến của spec §4.2);
- mọi mã lỗi trong `DESIGN_ERROR_CODES` parse được, và một mã bịa ra thì không.

`DESIGN_ERROR_CODES` chốt cứng **đúng sáu** giá trị spec §8.2 liệt kê: `NOT_AVAILABLE`, `NOT_IN_PRODUCT`, `MISSING_SVG`, `VARIANT_MISSING`, `VARIANT_UNAVAILABLE`, `INVALID_COMBINATION`. Viết một test khẳng định danh sách khớp **đúng bằng** tập đó — không thiếu, không thừa — để không ai lặng lẽ thêm mã rồi quên xử lý nó ở UI.

- [ ] **Step 3: Chạy, xác nhận đỏ**

Run: `npx vitest run tests/shared/customizerConfig.test.ts tests/shared/designRequest.test.ts`
Expected: FAIL — chưa có module.

- [ ] **Step 4: Viết `src/shared/customizerConfig.ts`**

Bám sát ví dụ JSON spec §8.2. Vài quyết định kiểu phải giữ đúng:

```ts
import { z } from "zod";

/** Id Shopify là số 64-bit. Giữ dạng chuỗi ở mọi nơi — number sẽ mất chính xác. */
const shopifyId = z.string().regex(/^\d+$/, "id Shopify phải là chuỗi chữ số");
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "màu phải là #RRGGBB");
const httpsUrl = z.string().url().startsWith("https://");
```

Rồi dựng `leatherSchema`, `stitchSchema`, `styleSchema` (có `leathers[]` và `animals[]` lồng trong), `animalSchema`, và `customizerConfigSchema` gộp lại.

- [ ] **Step 5: Viết `src/shared/designRequest.ts`**

```ts
export const DESIGN_ERROR_CODES = [
  "NOT_AVAILABLE",
  "NOT_IN_PRODUCT",
  "MISSING_SVG",
  "VARIANT_MISSING",
  "VARIANT_UNAVAILABLE",
  "INVALID_COMBINATION",
] as const;
```

`createDesignResponseSchema.lines` dùng `z.tuple([lineSchema, lineSchema])` chứ không `z.array(...).length(2)` — tuple cho type suy ra là `[Line, Line]`, nên P3 truy cập `lines[0]` / `lines[1]` mà không phải kiểm undefined.

Thêm `.refine()` trên `summary` khẳng định `total === bodyPrice + animalPrice` (so sánh trên đơn vị **cent, số nguyên** — đừng so float).

- [ ] **Step 6: Nối vào `src/shared/index.ts`**

- [ ] **Step 7: Chạy tất cả**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, gồm cả `tests/shared/purity.test.ts` — hai module mới cũng phải sạch framework.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(shared): zod cho payload config và create-design của storefront"
```

---

### Task 6: Supabase Storage

Nơi lưu SVG mockup, texture, display image, và baked design SVG. Bucket public-read (spec §5: CDN, public read); ghi chỉ từ server bằng service-role key.

**Ruling R2 hiện thực hoá ở đây.** Spec §8.1 mô tả luồng hai bước `upload-url` → `commit`, tức browser cầm signed URL ghi thẳng vào Storage. Với SVG điều đó có nghĩa **bytes gốc chưa sanitize nằm trong bucket** — vi phạm ràng buộc toàn cục đầu tiên của plan này. Module này vì thế **không có** hàm nào nhận bytes SVG thô. Đường duy nhất đưa SVG vào Storage là `uploadSanitizedSvg`, và nó nhận một chuỗi mà caller đã chạy qua `sanitizeSvgRoot()`.

**Files:**
- Create: `src/lib/storage/index.ts`
- Modify: `package.json` (thêm `@supabase/supabase-js`)
- Test: `tests/lib/storage/index.test.ts`

**Interfaces:**
- Consumes: `sanitizeSvgRoot` từ `@/svg-engine` (P1a) — chỉ ở tầng caller (P2), không import ở đây.
- Produces:
  - `sha256Hex(bytes: Uint8Array | string): string`
  - `storagePathFor(kind: AssetKind, checksum: string, extension: string): string`
  - `uploadBinaryAsset(input): Promise<StoredAsset>` — cho TEXTURE / DISPLAY
  - `uploadSanitizedSvg(input): Promise<StoredAsset>` — cho SVG_MOCKUP / DESIGN_SVG
  - `StoredAsset = { storagePath, publicUrl, checksumSha256, byteSize, mimeType }`
  - `createStorageClient()` — cho phép tiêm client giả trong test

- [ ] **Step 1: Thêm dependency**

```bash
npm install @supabase/supabase-js@^2.45.0
```

- [ ] **Step 2: Viết test thất bại**

Tạo `tests/lib/storage/index.test.ts`. Test **không** chạm mạng: mọi hàm upload nhận client qua tham số tuỳ chọn, và test truyền vào một object giả ghi lại lời gọi.

Phải kiểm:

- `sha256Hex` khớp giá trị đã biết: `sha256Hex("abc")` === `"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"`.
- `storagePathFor("TEXTURE", "ab12…", "webp")` → `"texture/ab12….webp"` — thư mục theo kind viết thường, tên file **là checksum**. Đây là thứ làm `@@unique([shopId, kind, checksumSha256])` tự dedupe: cùng nội dung → cùng đường dẫn → ghi đè chính nó.
- `uploadSanitizedSvg` gọi client với `contentType: "image/svg+xml"` và **`cacheControl` dài** (file bất biến theo checksum).
- `uploadSanitizedSvg` **ném lỗi** khi chuỗi đầu vào chứa `<script`, `onload=`, hay `<!--`. Đây là kiểm tra thứ hai, cố tình thừa: nó không thay thế sanitizer, nó bắt trường hợp caller quên gọi sanitizer. Test cả ba payload.
- `uploadSanitizedSvg` ném lỗi khi chuỗi không bắt đầu bằng `<svg` sau khi trim — bytes gốc thường có XML prolog hoặc DOCTYPE, và `root.outerHTML` thì không. Đây chính là cái chốt cửa của Global Constraint đầu tiên: **truyền bytes gốc vào đây sẽ ném lỗi, không âm thầm lưu**.
- `uploadBinaryAsset` từ chối mimeType ngoài allowlist (`image/webp`, `image/png`, `image/jpeg`).
- Cả hai từ chối file vượt `MAX_ASSET_BYTES` (đặt 4 MB — dưới giới hạn body 4.5 MB của Vercel serverless; ghi lý do đó vào comment).
- `publicUrl` dựng từ `SUPABASE_URL` + bucket + path, và **không bao giờ** chứa service-role key.
- Thiếu `SUPABASE_URL` hoặc `SUPABASE_SERVICE_ROLE_KEY` → `createStorageClient()` **ném lỗi ngay**, không trả về client câm. (Cùng bài học với `verifySessionToken` ở P0: cấu hình rỗng phải là lỗi ồn ào, không phải mặc định im lặng.)

- [ ] **Step 3: Chạy, xác nhận đỏ**

Run: `npx vitest run tests/lib/storage/index.test.ts`
Expected: FAIL — chưa có module.

- [ ] **Step 4: Viết `src/lib/storage/index.ts`**

Ghi chú bắt buộc ở đầu file, giải thích vì sao không có hàm nhận SVG thô:

```ts
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
```

- [ ] **Step 5: Chạy tất cả**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(storage): Supabase Storage với đường ghi SVG chỉ nhận bản đã sanitize"
```

---

### Task 7: Biến môi trường, runbook, và đồng bộ tài liệu

Task cuối: làm cho những gì sáu task trước dựng nên **vận hành được** — biến môi trường phải khai, bucket phải có người tạo, và hai tài liệu điều hướng (`CLAUDE.md`, spec) phải thôi mô tả thế giới cũ.

**Files:**
- Modify: `.env.example`
- Create: `docs/runbooks/supabase-storage.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md` (§8.1 và §7)
- Test: `tests/env.test.ts`

- [ ] **Step 1: Viết test thất bại cho `.env.example`**

Tạo `tests/env.test.ts`. Nó bắt lỗi vận hành hay gặp nhất của repo này: code đọc một biến mà `.env.example` không nhắc tới, nên biến đó không bao giờ được đặt trên Vercel và app hỏng khi deploy — đúng thứ đã xảy ra với `WK_ALLOWED_SHOPS`.

```ts
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const EXAMPLE = readFileSync(`${REPO}.env.example`, "utf8");

function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}${entry.name}`;
    if (entry.isDirectory()) sources(`${full}/`, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(readFileSync(full, "utf8"));
  }
  return acc;
}

describe(".env.example", () => {
  it("khai mọi biến mà src/ thật sự đọc", () => {
    const used = new Set<string>();
    for (const body of sources(`${REPO}src/`)) {
      for (const match of body.matchAll(/process\.env\.([A-Z0-9_]+)/g)) used.add(match[1]);
    }
    // NODE_ENV do runtime cung cấp, không phải biến ta khai.
    used.delete("NODE_ENV");
    const missing = [...used].filter((name) => !new RegExp(`^${name}=`, "m").test(EXAMPLE)).sort();
    expect(missing, "biến bị đọc nhưng không có trong .env.example").toEqual([]);
  });

  it("không chứa credential thật", () => {
    expect(EXAMPLE).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);          // JWT Supabase
    expect(EXAMPLE).not.toMatch(/postgresql:\/\/[^:]+:(?!your_)[^@\s]{8,}@/); // mật khẩu DB thật
  });
});
```

- [ ] **Step 2: Chạy — có thể đỏ ngay cả trước khi sửa**

Run: `npx vitest run tests/env.test.ts`
Expected: FAIL, liệt kê `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`. Nếu nó liệt kê thêm biến khác, đó là phát hiện thật — thêm chúng vào `.env.example` luôn.

- [ ] **Step 3: Bổ sung `.env.example`**

Thêm vào cuối, kèm chú thích tiếng Việt theo phong cách các mục sẵn có:

```bash
# Supabase Storage — nơi lưu SVG mockup, texture, display image, baked design SVG.
# Bucket phải để public read (storefront nạp texture trực tiếp từ CDN).
# Xem docs/runbooks/supabase-storage.md để tạo bucket và policy.
SUPABASE_URL="https://your_project_ref.supabase.co"

# Service-role key — TOÀN QUYỀN, bỏ qua mọi RLS. Chỉ đặt ở server (Vercel env),
# không bao giờ đưa vào biến NEXT_PUBLIC_*, không bao giờ gửi xuống browser.
SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"

SUPABASE_STORAGE_BUCKET="wk-assets"
```

- [ ] **Step 4: Viết `docs/runbooks/supabase-storage.md`**

Theo mẫu `docs/runbooks/credential-rotation.md` đã có. Nội dung: tạo bucket `wk-assets` public, cấu trúc thư mục (`svg_mockup/`, `texture/`, `display/`, `design_svg/`), xác nhận `Access-Control-Allow-Origin: *` trên response CDN (spec §13 rủi ro S5 — texture nạp inline trong SVG cần CORS), lấy service-role key ở đâu, đặt ba biến trên Vercel, và một mục **Kiểm chứng** với lệnh `curl -I` cụ thể để biết bucket đã đúng.

Thêm một mục **Áp schema lần đầu**: `npm run prisma:push` là thao tác phá huỷ trên DB thật; ghi rõ nó xoá sạch bảng cũ, và điều đó đã được thống nhất vì dữ liệu hiện tại là seed demo.

- [ ] **Step 5: Cập nhật `CLAUDE.md`**

Ba mục đang mô tả sai thế giới sau P1b:
- **"API version đang lệch 3 chỗ"** → thay bằng: đã chốt một hằng số ở `src/lib/shopify/apiVersion.ts`, và `tests/lib/shopify/apiVersion.test.ts` giữ nó không lệch lại.
- **"JSON-trong-String"** (`CompatibilityRule`, `PriceRule`) → hai model đó không còn tồn tại; xoá gạch đầu dòng.
- **"`src/app/page.tsx` là admin thật"** + "cây route `/admin/*` là bản cũ trùng chức năng" → `/admin/*` đã xoá; `page.tsx` giờ là shell chờ P2.

Thêm mới, ngắn gọn:
- `src/shared/` là code thuần, được bundle vào cả theme extension — hàng rào ở `tests/shared/purity.test.ts`.
- Đường ghi SVG vào Storage chỉ nhận bản đã sanitize; giải thích một câu vì sao (`ownerDocument`).
- Mục "Lệch giữa thiết kế và code hiện tại" cần viết lại: `pricingEngine`, `api/proxy/customizer-config`, `api/cart/validate` đã bị xoá, không còn là code chết nữa.

- [ ] **Step 6: Cập nhật spec**

Hai chỗ, mỗi chỗ vài dòng — spec là tài liệu P2/P3 sẽ đọc, để nó nói dối là để P2 hiện thực hoá một lỗ hổng.

1. **§8.1, khối `# Assets`** — thay ba dòng `upload-url` / `commit` / `validate-svg` bằng:

```
POST   /api/admin/assets                        multipart; server sanitize SVG rồi mới lưu
                                                → { assetId, publicUrl, validation? }
POST   /api/admin/assets/validate-svg           dry-run, không lưu
```

Kèm một đoạn ghi rõ ruling R2 và lý do (browser ghi thẳng = bytes chưa lọc vào bucket).

2. **§7** — ghi nhận ruling R5 (cụm bất biến không mang FK nào, kể cả `shopId`) và R6 (thêm `priceInput` vào hai bảng giá, kèm lý do §12.2 cho admin lưu giá trước khi generate).

- [ ] **Step 7: Chạy toàn bộ lần cuối**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: tất cả PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: biến môi trường Storage, runbook bucket, đồng bộ CLAUDE.md và spec"
```

---

## Self-review

**Spec coverage — P1 (spec §14) liệt kê sáu gạch đầu dòng:**

| Yêu cầu P1 | Task |
|---|---|
| migration drop bảng cũ + tạo schema mới | Task 2 (gỡ phụ thuộc) + Task 3 |
| `src/shared/` (zod) thay `packages/shared-types` | Task 4 + Task 5 (tạo), Task 2 (xoá bản cũ, ruling R3) |
| Supabase Storage bucket + policy + upload-url flow | Task 6 + Task 7 (runbook). Luồng upload đổi theo ruling R2. |
| SVG sanitizer + validator (linkedom) | **Đã xong ở P1a** — 252 test |
| migrate `fish-*` → `animal-*` cho 2 file demo | **Đã xong ở P1a** — `scripts/migrate-svg-ids.mjs` + 2 fixture |
| chốt MỘT Shopify API version | Task 1 |

Gate của P1 — "`npm test` xanh, bộ test contract port từ `test svg/tests`" — đã đạt ở P1a và mọi task ở đây kết thúc bằng một lần chạy `npm test` xanh.

**Rủi ro đã nhận diện, không tự sửa được trong plan:**

1. **Task 3 không áp schema lên DB thật.** `prisma db push` là thao tác phá huỷ; plan cố ý dừng ở `generate` và đẩy việc áp cho con người qua runbook. Hệ quả: P2 không chạy được cho tới khi ai đó chạy lệnh đó. Đây là đánh đổi có chủ ý, không phải thiếu sót.
2. **Không có test nào chạm DB thật.** Toàn bộ Task 3 kiểm bằng văn bản schema và `Prisma.ModelName`. Một ràng buộc đúng cú pháp nhưng sai ngữ nghĩa (ví dụ `@@unique` trên cột nullable hành xử khác kỳ vọng ở Postgres) sẽ lọt. P2 — nơi bắt đầu ghi dữ liệu thật — là chỗ bắt được.
3. **`variantPriceSnapshot` là `Decimal?` còn `quotedTotal` là `Decimal`.** Prisma trả `Decimal.js` chứ không phải `number`; mọi phép cộng giá ở P3/P4 phải qua `.plus()`, không phải `+`. Ghi ở đây để task đầu tiên chạm vào tiền không phát hiện muộn.
4. **Task 2 xoá `/api/proxy/*` trong khi `shopify.app.toml` vẫn khai `app_proxy`.** Không phải nói dối — khai báo chỉ trỏ base URL, không hứa route con nào tồn tại. P3 dựng lại `/apps/customizer/config` và `/apps/customizer/designs` dưới đó.
5. **Widget cũ `src/storefront-customizer/CustomizerApp.tsx` sống sót qua P1b** và POST tới `/api/proxy/save-design` vừa bị xoá. Chấp nhận được: không có theme thật nào đang bật block đó. P5 xoá widget.

## Execution Handoff

Plan lưu ở `docs/superpowers/plans/2026-09-10-p1b-data-foundation.md`.
