# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> `README.md` là tài liệu vận hành đầy đủ (credential, deploy, troubleshooting). File này chỉ ghi những thứ cần đọc-nhiều-file mới hiểu.

## Lệnh thường dùng

```bash
npm run dev                 # Next.js (3000) + Shopify CLI song song (concurrently)
npm run dev:app             # chỉ Next.js — dùng khi không cần tunnel Shopify
npm run build               # prisma generate → bundle:extension → next build
npm run bundle:extension    # esbuild src/storefront-customizer → extensions/.../assets/customizer-bundle.js
npm run lint                # next lint
npm run shopify:deploy      # deploy app config + theme extension (KHÔNG tự động khi push git)
npm run prisma:push         # đẩy schema lên Supabase (dev, không tạo migration)
npm run prisma:seed         # nạp config dây đồng hồ mẫu
npx prisma studio           # GUI xem/sửa DB
```

`npm test` chạy Vitest (`vitest run`, config `vitest.config.ts`, test ở `tests/`). `npm run test:watch` để watch. Không có E2E.

Deploy: push `main` → Vercel tự build backend. Theme extension **phải** `npm run shopify:deploy` thủ công, và phải chạy `bundle:extension` trước đó (hoặc `npm run build`).

## Kiến trúc

Ba tầng chạy ở ba nơi khác nhau, nối với nhau bằng Shopify chứ không phải bằng import:

1. **Theme App Extension** (`extensions/product-customizer-block/`) — chạy trong DOM storefront, không iframe. `blocks/customizer.liquid` render `<div id="product-customizer-root" data-*>` rồi Shopify nạp `assets/customizer-bundle.js`. Toàn bộ dữ liệu vào React đi qua `data-*` attribute của div đó.
2. **Next.js App Router** (`src/app/`) — vừa là backend API vừa là embedded admin (nhúng iframe trong Shopify Admin). Deploy trên Vercel.
3. **Prisma + Supabase Postgres** (`prisma/schema.prisma`) — nguồn sự thật cho config sản phẩm, design, và hàng chờ sản xuất.

### Bundle storefront: React source → Preact runtime
`src/storefront-customizer/CustomizerApp.tsx` import `react` thật vì trang `/storefront-preview` trong Next.js dùng lại chính component đó. Việc đổi sang Preact **chỉ xảy ra ở tầng bundler** — `scripts/bundle-extension.mjs` alias `react`/`react-dom` → `preact/compat` (130KB → 8KB). **Đừng đổi import trong source**, đã từng gây type incompatibility. `customizer-bundle.js` là artifact sinh ra nhưng vẫn được commit (Shopify CLI cần nó lúc deploy) — không sửa tay.

### Xác thực: ba cơ chế HMAC khác nhau
- OAuth callback (`api/auth/callback`): HMAC hex, query nối bằng `&`, verify inline trong route.
- App Proxy (`api/proxy/*`): HMAC hex, query sort alphabet, nối **không có dấu phân cách** — `verifyShopifyProxySignature` trong `src/lib/hmac.ts`.
- Webhook (`api/webhooks/*`): HMAC **base64** của raw body, header `X-Shopify-Hmac-Sha256` — `verifyShopifyWebhook`.

Cả ba **luôn được kiểm**, ở mọi môi trường. Cách duy nhất tắt là đặt tường minh `WK_SKIP_HMAC=1` (`hmacBypassEnabled()` trong `src/lib/hmac.ts`), và hàm đó **ném lỗi** nếu biến bật cùng `NODE_ENV=production` — app từ chối phục vụ request thay vì chạy không xác thực. Suy luận theo `NODE_ENV` đã bị gỡ ở P0; đừng khôi phục nó.

### Xác thực admin: session token App Bridge
`/api/admin/*` gọi `requireAdminSession(req)` (`src/lib/auth/requireAdminSession.ts`) ở dòng đầu mỗi handler — đọc Bearer token, verify HS256 bằng `SHOPIFY_API_SECRET`, đối chiếu `dest`/`iss` với `WK_ALLOWED_SHOPS` (so sánh lowercase). 401 nếu token sai/thiếu, 403 nếu shop ngoài allowlist. `WK_ALLOWED_SHOPS` trống = chặn tất cả — thiếu biến trên Vercel là mọi request admin 403. Guard là prologue chép tay, không có gì ở tầng type ép phải có; `tests/app/api/admin/route-guard.test.ts` là thứ duy nhất bắt được route quên nó.

`SHOPIFY_API_SECRET` hoặc `SHOPIFY_API_KEY` rỗng ⇒ `verifySessionToken` ném ngay. Đừng gỡ guard đó: chuỗi rỗng là khoá HMAC hợp lệ (dài 0), nên `jose` sẽ chấp nhận token do bất kỳ ai tự ký.

### Luồng dữ liệu dự kiến (theo thiết kế)
Storefront chọn option → `POST /api/cart/validate` → `calculateServerPrice()` tính lại giá từ DB → tạo `Design` (DRAFT) + `DesignSelection` → trả `summaryProperties` chứa `_custom_design_id` → widget gọi Cart AJAX API gắn properties → webhook `orders/create` đọc `_custom_design_id` từ line item → `Design.status = ORDERED` + tạo `ProductionJob` (NEW) → admin đổi status qua `PATCH /api/admin/orders`.

`_custom_design_id` là khớp nối duy nhất giữa đơn Shopify và design trong DB. Mất property này là mất luôn liên kết.

### Lệch giữa thiết kế và code hiện tại
Widget (`CustomizerApp.tsx`) **không** đi theo luồng trên: nó dùng mảng option hardcode (`LEATHER_MATERIALS`, `BUCKLE_OPTIONS`…), không gọi `/api/proxy/customizer-config`, không gọi `/api/cart/validate`, mà POST thẳng `{proxyUrl}/save-design` rồi tự dựng line item properties ở client. Hệ quả: `pricingEngine.ts`, `api/proxy/customizer-config`, `api/cart/validate` hiện là code chết; giá không được server xác minh. Nối lại luồng này là việc còn dang dở lớn nhất — xem mục "Bạn cần làm gì tiếp theo" trong README.

## Quy ước & bẫy

- **Prisma trên serverless:** `DATABASE_URL` là pooled (6543, bắt buộc `?pgbouncer=true&connection_limit=1`), `DIRECT_URL` là direct (5432) chỉ dùng cho `db push`/`migrate`.
- **JSON-trong-String:** `CompatibilityRule.thenDisallowOptionValueIds` và `PriceRule.conditionOptionValueIds` là `String` chứa JSON array, phải `JSON.parse()`. Không phải array Postgres.
- **API version đang lệch 3 chỗ:** `shopify.app.toml` = `2026-10`, `src/lib/shopify.ts` = `ApiVersion.October24`, `executeShopifyGraphQL` hardcode `2024-10` trong URL. Thống nhất trước khi thêm call Admin API.
- **`uid` trong `shopify.extension.toml`** là định danh extension trên Shopify. Đổi = tạo extension mới, mất liên kết theme cũ.
- **Route API mới cần tính động** phải khai `export const dynamic = "force-dynamic"` (mọi route hiện có đều có, trừ `api/auth/*`).
- **Header đặc biệt ở `next.config.mjs`:** CSP `frame-ancestors` cho `/` **và** `/admin/*` (thiếu là iframe Shopify Admin trắng trang — và `/` mới là admin thật, xem gạch đầu dòng cuối), CORS cho `/api/proxy/*`.
- **`src/app/page.tsx` là admin thật** (embedded, tab-based, import lại `admin/products/page` và `admin/orders/page`). Cây route `/admin/*` với `admin/layout.tsx` + `admin/page.tsx` là bản cũ trùng chức năng — sửa nhầm file rất dễ.
