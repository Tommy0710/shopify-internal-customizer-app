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
npm run test:db             # Vitest chống Postgres THẬT (tests-db/) — cần Docker
```

`npm test` chạy Vitest hermetic (`vitest run`, config `vitest.config.ts`, test ở `tests/`, không chạm DB). `npm run test:watch` để watch. `npm run test:db` (`scripts/test-db.mjs`) là bộ test riêng ở `tests-db/` — cần Docker chạy, tự dựng container Postgres tạm, `prisma db push --force-reset` schema thật rồi chạy test; **từ chối** kết nối tới bất kỳ host nào không phải localhost (chống gõ nhầm biến env trỏ vào Supabase thật) trước khi chạm DB. Không mock Prisma trong `tests-db/` — ranh giới duy nhất được giả lập là `src/lib/admin/assetStorage.ts` (Supabase Storage). Không có E2E.

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
Mọi route `/api/admin/*` **phải** viết bằng `withAdminSession` (`src/lib/auth/withAdminSession.ts`) — đây là cách DUY NHẤT được chấp nhận, không còn prologue chép tay. Hình bắt buộc: `export const GET = withAdminSession(async (req, { session, params }) => { … })` (tương tự cho `POST`/`PATCH`/…). Route động khai kiểu params qua generic — `withAdminSession<{ id: string }>(…)` — và wrapper **chuyển tiếp** `params` của Next xuống handler; route tĩnh nhận `params = {}`. (Bản đầu nuốt mất `params`: `where: { id: undefined }` trong Prisma nghĩa là KHÔNG LỌC, một `deleteMany` sẽ trúng mọi hàng.) Wrapper tự gọi `requireAdminSession(req)`, verify Bearer token HS256 bằng `SHOPIFY_API_SECRET`, đối chiếu `dest`/`iss` với `WK_ALLOWED_SHOPS` (so sánh lowercase), và tự `return auth.response` ở nhánh lỗi (401 token sai/thiếu, 403 shop ngoài allowlist) — handler thật chỉ chạy khi đã có session hợp lệ. `WK_ALLOWED_SHOPS` trống = chặn tất cả — thiếu biến trên Vercel là mọi request admin 403.

Lý do bắt buộc một hình duy nhất: `requireAdminSession` **trả về** union `{ session } | { response }`, nó không ném lỗi. Bản guard cũ (gọi hàm rồi tự viết `if ("response" in auth) return auth.response;` ở đầu mỗi handler) để lọt một route thật trong review P1b — người viết gọi hàm rồi VỨT kết quả, code biên dịch sạch, route trả 200 không cần Authorization header. `tests/app/api/admin/route-guard.test.ts` duyệt mọi file route dưới `src/app/api/`, tính **URL Next phục vụ** (bỏ segment route group `(x)`), và với mọi URL bắt đầu bằng `/api/admin` thì từ chối bất cứ handler export nào KHÔNG được gán trực tiếp `export const <METHOD> = withAdminSession(` — kể cả `export { GET }` tách riêng, `export let GET`, và route đặt trong route group như `api/(internal)/admin/x`. Mỗi dạng đó từng để lọt một route không guard thật.

Client Shopify (`src/lib/shopify/client.ts`) lấy qua `getShopify()` — dựng lười ở lần gọi đầu, ném nếu `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`/`SHOPIFY_APP_URL` rỗng. Không dựng lúc import vì `next build` nạp route module; không bao giờ rơi về secret mặc định (bản cũ làm vậy, và token tự ký bằng secret mặc định đó được `decodeSessionToken` chấp nhận).

`SHOPIFY_API_SECRET` hoặc `SHOPIFY_API_KEY` rỗng ⇒ `verifySessionToken` ném ngay. Đừng gỡ guard đó: chuỗi rỗng là khoá HMAC hợp lệ (dài 0), nên `jose` sẽ chấp nhận token do bất kỳ ai tự ký.

### Route admin (P2a): lớp thứ hai `adminApi`, luôn nằm BÊN TRONG `withAdminSession`
Hình bắt buộc của mọi route dưới `/api/admin/*` kể từ P2a: `export const GET = withAdminSession(adminApi(handler))` — không phải chỉ `withAdminSession(...)` như mục trên (P1b) mô tả, đó mới là lớp ngoài. `adminApi` (`src/lib/admin/adminApi.ts`) là lớp thứ hai:
1. tra `Shop` theo `session.shopDomain` (case-insensitive) — chưa cài/đã gỡ → 409 `SHOP_NOT_INSTALLED`;
2. bắt `AdminHttpError` mà code nghiệp vụ ném, và lỗi Prisma đã biết (P2002/P2003/P2025 dịch bởi `src/lib/admin/prismaErrors.ts`), trả đúng hình lỗi bên dưới;
3. để mọi lỗi khác nổi lên — Next trả 500, vào log.

Route file vì vậy chỉ còn vài dòng khai `attributeHandlers(kind)` / `productHandlers` / `handleAssetUpload` rồi bọc hai lớp — logic thật nằm ở `src/lib/admin/*.ts` (`attributes.ts`, `assets.ts`, `products.ts`, `readiness.ts`, `diff.ts`, `money.ts`). Đã có 22 route file dưới `src/app/api/admin/` (`find src/app/api/admin -name route.ts`): attribute CRUD ×4 nhóm (leathers/stitches/animals/styles, mỗi nhóm `GET`/`POST`/`PATCH`/`DELETE`/`reorder`), `assets` (upload + validate-svg), `products` (list/create/get/update + `PUT` hosts/styles/animals/stitches + ma trận giá `styles/:id/leathers`, `animals/:id/leathers` + lưới SVG `styles/:id/animals`). **Chưa có**: Shopify passthrough + sinh variant (`/shopify/*`, `/variants/*` — P2b) và designs/production queue (`/designs`, `/order-lines/*` — P2c).

**Hai hình lỗi** (`src/lib/admin/http.ts`): 422 → `{ errors: [{ field, code, message }] }` (khớp hình spec §8.2); mọi lỗi khác → `{ error: "<CODE>", ...extra }` (`jsonError`/`notFound`/`conflict`/`AdminHttpError` đều dựng hình này). Không route nào tự viết `NextResponse.json({ error })` riêng — hai hình lỗi là hai hình, không hơn.

**Scope shop cho bảng join không có `shopId`:** `ProductStyle`, `ProductAnimal`, `ProductStitch`, `ProductStyleLeather`, `AnimalLeather`, `ProductStyleAnimal` không mang cột `shopId` trực tiếp — chỉ bắc cầu lên `CustomizableProduct` qua `productId`/`productStyleId`/`productAnimalId`. Mọi handler có `:id` phải gọi `loadProductForShop(tx, shop.id, params.id)` (`src/lib/admin/products.ts`) TRƯỚC bất kỳ query nào trên các bảng này — id đúng nhưng thuộc shop khác và id không tồn tại phải trả CÙNG một 404 (không tiết lộ product của shop khác có tồn tại hay không). `ProductHost` là ngoại lệ — nó CÓ cột `shopId` riêng.

**`PUT` quan hệ — ngữ nghĩa diff (R4):** admin luôn gửi TOÀN BỘ danh sách mong muốn, server diff bằng khoá (`diffByKey`, `src/lib/admin/diff.ts`) với hàng đang có trong DB. Phần tử **vắng mặt khỏi danh sách** → `isActive = false`, hàng VẪN CÒN — áp dụng cho style/animal/stitch (`PUT .../styles|animals|stitches`) lẫn ma trận giá (`PUT .../styles/:id/leathers`, `.../animals/:id/leathers`). **Ngoại lệ duy nhất: `ProductHost`** (`PUT .../hosts`) — vắng mặt khỏi danh sách → hàng bị **XOÁ thật** (`deleteMany`), không chỉ tắt.

**Tiền trong admin JSON luôn là chuỗi**, ví dụ `"80.00"`, không bao giờ `number` — `priceSchema` (nhận string hoặc number ở input, chuẩn hoá, từ chối số không tròn cent kiểu `0.1+0.2` thay vì làm tròn âm thầm) và `formatPrice` (Decimal Prisma → string, `.toFixed(2)`) ở `src/lib/admin/money.ts`. Không route nào được `JSON.stringify` thẳng một `Prisma.Decimal`.

### Luồng dữ liệu dự kiến (theo thiết kế, spec `docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md`)
Storefront chọn option → `POST /api/admin/products/:id/…` (admin, cấu hình trước) và `POST /apps/customizer/designs` (storefront, P3 dựng lại dưới App Proxy) → server tính giá từ DB → tạo `CustomDesign` (DRAFT) + `CustomDesignSelection` → trả property chứa id design → widget gọi Cart AJAX API gắn property → webhook `orders/create` đọc property đó từ line item → tạo `OrderLineDesign` (`productionStatus = NEW`) → admin đổi status qua route dưới `/api/admin/order-lines/*`.

P1b (schema + storage + hợp đồng zod) và P2a (admin API: attribute CRUD, asset upload, product config, ma trận giá, readiness — xem mục "Route admin" ở trên) đã xong. Còn thiếu: `/apps/customizer/*` (storefront, App Proxy — P3), Shopify passthrough + sinh variant (`/api/admin/shopify/*`, `/api/admin/products/:id/variants/*` — P2b), designs & production queue (`/api/admin/designs`, `/api/admin/order-lines/*` — P2c). Xem `docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md` §8 cho full API surface dự kiến.

### Hai chỗ code lệch khỏi mô tả gốc của brief P2a — đã CHỐT, không phải bug
- **`GET /api/admin/products/:id` trả cây PHẲNG**, không lồng dưới khoá `"product"` — xem comment ở `ProductTreeDto` trong `src/lib/admin/products.ts`. Ví dụ lồng từng xuất hiện trong tài liệu nội bộ là chép nhầm từ ví dụ storefront `GET /apps/customizer/config` (spec §8.2) — một route hoàn toàn khác, chưa tồn tại.
- **Readiness** (`src/lib/admin/readiness.ts`, `ReadinessCode`) không chỉ kiểm style/animal/stitch bị archive mà đang active — mã `ARCHIVED_ATTRIBUTE` còn phủ ô lưới SVG (`ProductStyleAnimal.svgAssetId`/`defaultStitchId`): một asset SVG_MOCKUP hay stitch mặc định bị archive SAU KHI đã wire vào một ô active không tự sinh `MISSING_SVG` (ô "vẫn có mặt" trong cây), nên phải kiểm riêng — thiếu kiểm này từng để `ready:true` lọt qua trong khi storefront serve customizer trỏ tới asset đã chết.

### `src/shared/` — hợp đồng zod dùng chung, giữ thuần để còn bundle được
`src/shared/` (zod contracts: `ids.ts`, `designRequest.ts`, `lineItemProperties.ts`, `customizerConfig.ts`) là định nghĩa MỘT lần của các payload nối server với storefront. Hôm nay chỉ `src/lib/ids.ts` import nó; route P3 và widget P3 sẽ là consumer thật.

**Storefront có bundle zod hay không là quyết định MỞ của P3**, không phải điều đã xảy ra. Đã đo: bundle `src/shared` bằng esbuild tốn 61,4 KB minified / 15,3 KB gzip, trong khi spec §5.2 đặt ngân sách ~25 KB gzip cho TOÀN BỘ bundle và nói storefront chỉ import type. Ba phương án để cân ở P3 ngày 1: zod đầy đủ / zod mini / chỉ type + validate tay. Alias `@` → `src` đã có sẵn trong `scripts/bundle-extension.mjs`.

Dù chọn gì, `src/shared/` vẫn phải thuần — không framework, không `@/lib/*` (bắc cầu kéo code server vào), không Node builtin (cả `node:x` lẫn `x` trần), không `process.env` / `process[…]`. Luật sống ở **một** chỗ, `tests/helpers/purityFence.ts`, và cả hàng rào `tests/shared/purity.test.ts` lẫn hàng rào svg-engine đều đọc nó — trước đây mỗi bên tự giữ danh sách và chúng lệch nhau.

### Ghi SVG vào Storage: chỉ nhận bản đã sanitize
`uploadSanitizedSvg` (`src/lib/storage/index.ts`) không nhận bytes SVG gốc — hợp đồng là caller phải `parse → sanitizeSvgRoot() → truyền root.outerHTML`. Lý do module vẫn tự kiểm tra thêm ("bytes gốc" + chạy `sanitizeSvgRoot` lần hai như verifier) thay vì tin caller: một comment/XML-prolog/DOCTYPE đặt TRƯỚC thẻ `<svg>` sống trong `root.ownerDocument` của parser, ngoài phạm vi mà `sanitizeSvgRoot(root)` (chỉ thấy subtree của `root`) nhìn thấy được — nên `root.outerHTML` có thể "sạch" trong khi chuỗi gốc chứa mã độc trước thẻ `<svg>`. Tương tự cho mọi thứ **sau** `</svg>`: parser dừng ở thẻ đóng của root, nên phần đuôi không bao giờ vào cây. Vì vậy chuỗi đưa vào phải **parse lại ra đúng chính nó** (`parseSvgFromText(svg).outerHTML === svg.trim()`) — đó chính là định nghĩa "là `root.outerHTML`". Một chuỗi gõ tay, kể cả vô hại, sẽ bị từ chối: caller gõ tay là caller đã rời hợp đồng.

### Lệch giữa thiết kế và code hiện tại
`pricingEngine.ts`, `api/proxy/customizer-config`, `api/cart/validate` — cả ba từng là code chết chạy trên schema cũ — **đã bị xoá** ở P1b (không còn là lệch cần theo dõi). Widget hiện tại (`CustomizerApp.tsx`, `src/storefront-customizer/`) vẫn POST tới `/apps/customizer/save-design`, route đó **chưa tồn tại** trong cây API hiện tại — chấp nhận được vì chưa có theme thật nào bật block này; nối lại luồng theo spec §8 là việc của P2/P3. Toàn bộ admin API cấu hình (attributes/assets/products/ma trận giá, P2a) **đã tồn tại thật** — xem mục "Route admin" ở trên; đừng nhầm với các route storefront/`/apps/customizer/*` vẫn còn là P3 chưa viết.

## Quy ước & bẫy

- **Prisma trên serverless:** `DATABASE_URL` là pooled (6543, bắt buộc `?pgbouncer=true&connection_limit=1`), `DIRECT_URL` là direct (5432) chỉ dùng cho `db push`/`migrate`.
- **API version đã chốt MỘT nơi duy nhất:** `SHOPIFY_API_VERSION` ở `src/lib/shopify/apiVersion.ts` (hiện `2026-07`). Trước P1b nó lệch ở ba chỗ; giờ `tests/lib/shopify/apiVersion.test.ts` giữ cho không lệch lại được — mọi nơi cần gọi Admin API phải import hằng số đó, không hardcode version.
- **`uid` trong `shopify.extension.toml`** là định danh extension trên Shopify. Đổi = tạo extension mới, mất liên kết theme cũ.
- **Route API mới cần tính động** phải khai `export const dynamic = "force-dynamic"` (mọi route hiện có đều có, trừ `api/auth/*`).
- **Header đặc biệt ở `next.config.mjs`:** CSP `frame-ancestors` cho `/` và `/admin/*`, CORS cho `/api/proxy/*`.
- **`src/app/page.tsx` là shell chờ P2 UI**, không phải admin thật — API (`src/app/api/admin/`, P2a) đã xong nhưng UI hai tab Attributes/Products (spec §12) chưa viết. Cây route `/admin/*` (bản cũ trùng chức năng) đã bị xoá ở P1b — không còn nguy cơ sửa nhầm file đó.
- **Prisma `Decimal` không phải `number`.** Xem mục "Cho phase sau" bên dưới — chạm sớm, không chỉ ở P4.

## Cho phase sau (chưa chặn P1b, nhưng sẽ vấp nếu quên)

- **`Decimal` của Prisma trả về object `Decimal.js`, không phải `number`.** Hai bẫy, một ồn một im:
  - *Ồn:* `a + b` trên hai `Decimal` là lỗi TS2365 — tsc bắt được. Nó chỉ thành chuỗi nối (`"19.9945.01"`) khi type đã mất (`any`, dữ liệu qua JSON). Dùng `.plus()`/`.minus()`/`.toNumber()`.
  - *Im — cái thật sự nguy hiểm:* `JSON.stringify` một `Decimal` ra **chuỗi** `"19.99"`, không phải số. Route trả thẳng object Prisma ra JSON thì client nhận chuỗi, và mọi schema `z.number()` trong `src/shared/` (ví dụ `summary` của create-design) sẽ từ chối. Mọi giá rời server phải được đổi tường minh (`.toNumber()`, hoặc tốt hơn là tính bằng cent nguyên).
  Chỗ đầu tiên chạm tiền thật: response create-design (P3) và đối soát đơn `totalMatchesQuote` (P4).
