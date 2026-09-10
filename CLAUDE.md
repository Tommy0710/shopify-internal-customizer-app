# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> `README.md` là tài liệu vận hành đầy đủ (credential, deploy, troubleshooting). File này chỉ ghi những thứ cần đọc-nhiều-file mới hiểu.

## Lệnh thường dùng

```bash
npm run dev                 # Next.js (3000) + Shopify CLI song song (concurrently)
npm run dev:app             # chỉ Next.js — dùng khi không cần tunnel Shopify
npm run build               # prisma generate → bundle:extension → next build
npm run bundle:extension    # esbuild src/storefront-customizer → extensions/.../assets/customizer-bundle.js
npm run shopify:deploy      # deploy app config + theme extension (KHÔNG tự động khi push git)
npm run prisma:push         # đẩy schema lên Supabase (dev, không tạo migration)
npx prisma studio           # GUI xem/sửa DB
```

`npm test` chạy Vitest (`vitest run`, config `vitest.config.ts`, test ở `tests/`). `npm run test:watch` để watch. Không có E2E.

**Repo không có tầng lint.** `package.json` vẫn còn script `"lint": "next lint"` nhưng nó hỏng từ trước P1b: không có config ESLint nào trong repo, nên `next lint` rơi vào prompt tương tác chọn config và treo — **đừng chạy `npm run lint`**. Sửa nằm ngoài phạm vi P1b (cần chọn + cấu hình một bộ rule ESLint thật). Cho tới khi ai đó làm việc đó, mọi ràng buộc phong cách/pattern đều do test và code review gánh, không có gì tự động chặn ở commit hay CI.

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

### Xác thực admin: session token App Bridge, bắt buộc qua `withAdminSession`
Mọi route `/api/admin/*` **phải** viết bằng `withAdminSession` (`src/lib/auth/withAdminSession.ts`) — đây là cách DUY NHẤT được chấp nhận, không còn prologue chép tay. Hình bắt buộc: `export const GET = withAdminSession(async (req, { session }) => { … })` (tương tự cho `POST`/`PATCH`/…). Wrapper tự gọi `requireAdminSession(req)`, verify Bearer token HS256 bằng `SHOPIFY_API_SECRET`, đối chiếu `dest`/`iss` với `WK_ALLOWED_SHOPS` (so sánh lowercase), và tự `return auth.response` ở nhánh lỗi (401 token sai/thiếu, 403 shop ngoài allowlist) — handler thật chỉ chạy khi đã có session hợp lệ. `WK_ALLOWED_SHOPS` trống = chặn tất cả — thiếu biến trên Vercel là mọi request admin 403.

Lý do bắt buộc một hình duy nhất: `requireAdminSession` **trả về** union `{ session } | { response }`, nó không ném lỗi. Bản guard cũ (gọi hàm rồi tự viết `if ("response" in auth) return auth.response;` ở đầu mỗi handler) để lọt một route thật trong review P1b — người viết gọi hàm rồi VỨT kết quả, code biên dịch sạch, route trả 200 không cần Authorization header. `tests/app/api/admin/route-guard.test.ts` quét mọi `route.ts` dưới `src/app/api/admin/` và từ chối bất cứ handler export nào KHÔNG được gán trực tiếp từ `withAdminSession(` — kể cả dạng `export { GET }` tách riêng (cũng từng để lọt một route không guard vì scanner cũ không thấy được handler).

`SHOPIFY_API_SECRET` hoặc `SHOPIFY_API_KEY` rỗng ⇒ `verifySessionToken` ném ngay. Đừng gỡ guard đó: chuỗi rỗng là khoá HMAC hợp lệ (dài 0), nên `jose` sẽ chấp nhận token do bất kỳ ai tự ký.

### Luồng dữ liệu dự kiến (theo thiết kế, spec `docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md`)
Storefront chọn option → `POST /api/admin/products/:id/…` (admin, cấu hình trước) và `POST /apps/customizer/designs` (storefront, P3 dựng lại dưới App Proxy) → server tính giá từ DB → tạo `CustomDesign` (DRAFT) + `CustomDesignSelection` → trả property chứa id design → widget gọi Cart AJAX API gắn property → webhook `orders/create` đọc property đó từ line item → tạo `OrderLineDesign` (`productionStatus = NEW`) → admin đổi status qua route dưới `/api/admin/order-lines/*`.

P1b (schema + storage + hợp đồng zod) đã xong; các route API kể trên (`/apps/customizer/*`, phần lớn `/api/admin/*`) **chưa tồn tại** — đó là việc của P2/P3. Xem `docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md` §8 cho full API surface dự kiến.

### `src/shared/` — code thuần, bundle vào cả theme extension
`src/shared/` (zod contracts: `ids.ts`, `designRequest.ts`, `lineItemProperties.ts`, `customizerConfig.ts`) được import cả ở server (`src/app/api/*`) lẫn ở bundle storefront (qua `CustomizerApp.tsx`/`scripts/bundle-extension.mjs`). Nó phải là code thuần — không `@supabase/supabase-js`, không `process.env`, không Node builtin — nếu không bundle storefront phình ra hoặc vỡ ở runtime Preact. `tests/shared/purity.test.ts` là hàng rào; nó quét cả dạng `import "x";` (bare, không `from`) vì đó là lỗ đã tìm thấy thật (P1b Task 4) cho `node:crypto` và `linkedom`.

### Ghi SVG vào Storage: chỉ nhận bản đã sanitize
`uploadSanitizedSvg` (`src/lib/storage/index.ts`) không nhận bytes SVG gốc — hợp đồng là caller phải `parse → sanitizeSvgRoot() → truyền root.outerHTML`. Lý do module vẫn tự kiểm tra thêm ("bytes gốc" + chạy `sanitizeSvgRoot` lần hai như verifier) thay vì tin caller: một comment/XML-prolog/DOCTYPE đặt TRƯỚC thẻ `<svg>` sống trong `root.ownerDocument` của parser, ngoài phạm vi mà `sanitizeSvgRoot(root)` (chỉ thấy subtree của `root`) nhìn thấy được — nên `root.outerHTML` có thể "sạch" trong khi chuỗi gốc chứa mã độc trước thẻ `<svg>`.

### Lệch giữa thiết kế và code hiện tại
`pricingEngine.ts`, `api/proxy/customizer-config`, `api/cart/validate` — cả ba từng là code chết chạy trên schema cũ — **đã bị xoá** ở P1b (không còn là lệch cần theo dõi). Widget hiện tại (`CustomizerApp.tsx`, `src/storefront-customizer/`) vẫn POST tới `/apps/customizer/save-design`, route đó **chưa tồn tại** trong cây API hiện tại — chấp nhận được vì chưa có theme thật nào bật block này; nối lại luồng theo spec §8 là việc của P2/P3.

## Quy ước & bẫy

- **Prisma trên serverless:** `DATABASE_URL` là pooled (6543, bắt buộc `?pgbouncer=true&connection_limit=1`), `DIRECT_URL` là direct (5432) chỉ dùng cho `db push`/`migrate`.
- **API version đã chốt MỘT nơi duy nhất:** `SHOPIFY_API_VERSION` ở `src/lib/shopify/apiVersion.ts` (hiện `2026-07`). Trước P1b nó lệch ở ba chỗ; giờ `tests/lib/shopify/apiVersion.test.ts` giữ cho không lệch lại được — mọi nơi cần gọi Admin API phải import hằng số đó, không hardcode version.
- **`uid` trong `shopify.extension.toml`** là định danh extension trên Shopify. Đổi = tạo extension mới, mất liên kết theme cũ.
- **Route API mới cần tính động** phải khai `export const dynamic = "force-dynamic"` (mọi route hiện có đều có, trừ `api/auth/*`).
- **Header đặc biệt ở `next.config.mjs`:** CSP `frame-ancestors` cho `/` và `/admin/*`, CORS cho `/api/proxy/*`.
- **`src/app/page.tsx` là shell chờ P2**, không phải admin thật. Cây route `/admin/*` (bản cũ trùng chức năng) đã bị xoá ở P1b — không còn nguy cơ sửa nhầm file đó. `src/app/api/admin/` hiện tồn tại nhưng rỗng (không có `route.ts` nào) — P2 lấp vào theo hình `withAdminSession` ở trên.
- **Prisma `Decimal` không phải `number`.** Xem mục "Cho phase sau" bên dưới — chạm sớm, không chỉ ở P4.

## Cho phase sau (chưa chặn P1b, nhưng sẽ vấp nếu quên)

- **`Decimal` của Prisma trả về object `Decimal.js`, không phải `number`.** `a + b` trên hai cột `Decimal` (ví dụ `ProductStyleLeather.priceInput` + `AnimalLeather.priceInput`, hay `OrderLineDesign` đối chiếu với `CustomDesign.quotedTotal`) cho ra **CHUỖI NỐI im lặng**, không phải tổng — TypeScript không bắt được vì `Decimal` có `.toString()` hợp lệ. Phải dùng `.plus()`/`.minus()`/`.toNumber()` của `Decimal.js`, không dùng toán tử `+`/`-` trực tiếp. Chỗ đầu tiên việc này chạm vào tiền thật là đối soát đơn hàng (field `totalMatchesQuote` của `OrderLineDesign`) — không phát hiện muộn ở đó.
