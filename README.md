# 🛍️ Wild & King Customizer — Shopify Internal Custom Product App

App **nội bộ (Custom Distribution)** cho phép khách hàng tùy biến sản phẩm da thủ công (dây đồng hồ, ví, money clip…) ngay trên trang sản phẩm Shopify, đồng thời cung cấp bảng quản trị nhúng trong Shopify Admin để cấu hình attribute, ma trận giá, và theo dõi hàng chờ sản xuất.

Kiến trúc theo chuẩn **Shopify Online Store 2.0**: `Theme App Extension` (widget chạy trực tiếp trong DOM storefront, **không dùng iframe**) + `App Proxy` (gọi API cùng domain, ký HMAC) + `Embedded Next.js Admin` (nhúng trong Shopify Admin qua App Bridge).

> **Đọc file này trước khi làm bất cứ việc gì.** Phần [Bạn cần làm gì tiếp theo](#-bạn-cần-làm-gì-tiếp-theo) ở cuối liệt kê các việc còn dang dở.
>
> **Trạng thái hiện tại (sau P1b — nền tảng dữ liệu):** schema Postgres (18 model), Supabase Storage, và hợp đồng zod dùng chung storefront/admin đã xong. **Phần lớn route API và toàn bộ admin UI hai tab (Attributes · Products) chưa được viết** — đó là P2/P3. Đừng tin theo trí nhớ về "luồng end-to-end" của bản thiết kế cũ (dùng `ProductConfig`/`OptionGroup`/`Design`…) — schema đó đã bị xoá. Nguồn sự thật cho thiết kế mới là `docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md`.

---

## 📌 Thông tin hệ thống (Production)

| Hạng mục | Giá trị |
|---|---|
| Tên app (Shopify) | `Wild & King Customizer` |
| App handle | `wk-internal-customizer` |
| Client ID / API Key | `21102b2e2138173c5ab87e5ad38ef1e4` |
| GitHub repo | https://github.com/PHUONGNAM101203/shopify-internal-customizer-app |
| Production URL | https://wild-king-customizer.vercel.app |
| Hosting | Vercel — project `wild-king-customizer` |
| Database | Supabase PostgreSQL 17.6 — project ref `jdobnvvorpkoqkpxcdhw` |
| Dev store | `wildandking-demo.myshopify.com` |
| Theme extension UID | `0a224368-cac3-af26-7d8e-302063d9d999e58322af` |
| Shopify API version | `2026-07` — một hằng số duy nhất, xem [`src/lib/shopify/apiVersion.ts`](src/lib/shopify/apiVersion.ts) |
| App Proxy | `https://<shop>/apps/customizer/*` → `https://wild-king-customizer.vercel.app/api/proxy/*` (khai báo trong `shopify.app.toml`; route con dưới `/api/proxy/*` **chưa được viết lại** — P3) |
| Supabase Storage bucket | `wk-assets` (public read) — xem `docs/runbooks/supabase-storage.md` |

**Deploy tự động:** push lên nhánh `main` của GitHub → Vercel tự build & deploy. Theme extension **KHÔNG** tự deploy, phải chạy `npm run shopify:deploy` thủ công.

---

## 🧱 Tech Stack

| Lớp | Công nghệ |
|---|---|
| Backend / Admin | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| ORM / DB | Prisma 5 + Supabase PostgreSQL (pooled + direct URL) |
| File storage | Supabase Storage (`@supabase/supabase-js`) — SVG mockup, texture, display image, baked design SVG |
| Validation / hợp đồng dùng chung | Zod (`src/shared/`) — cùng một schema chạy ở server lẫn ở bundle storefront |
| Storefront widget | React 18 source → bundle bằng esbuild, alias sang **Preact/compat** (giảm ~130KB → ~8KB) |
| Shopify | `@shopify/shopify-api` v14, Shopify CLI v3, Theme App Extension |
| Hosting | Vercel (serverless) |
| Icon / UI | lucide-react, clsx, tailwind-merge |

---

## 🏗️ Cấu trúc thư mục

```
shopify-internal-customizer-app/
├── extensions/
│   └── product-customizer-block/          # 🎨 THEME APP EXTENSION (chạy trên storefront)
│       ├── blocks/customizer.liquid       # App Block: mount point <div id="product-customizer-root">
│       │                                  #   truyền product.id, variant.id, shop domain qua data-*
│       ├── assets/
│       │   ├── customizer-bundle.js       # ⚠️ FILE BUILD — sinh ra bởi npm run bundle:extension
│       │   └── customizer.css
│       ├── locales/en.default.json
│       └── shopify.extension.toml         # type = "theme", uid cố định (KHÔNG đổi)
│
├── prisma/
│   └── schema.prisma                      # 18 model — xem mục Database bên dưới. Không còn seed.mjs.
│
├── scripts/
│   └── bundle-extension.mjs               # esbuild: src/storefront-customizer → assets/customizer-bundle.js
│                                          #   alias react→preact/compat để giảm bundle size
│
├── src/
│   ├── app/                               # Next.js App Router
│   │   ├── page.tsx                       # Shell chờ P2 — KHÔNG PHẢI admin thật. Cây route
│   │   │                                  #   `/admin/*` cũ đã bị xoá ở P1b (chạy trên schema cũ).
│   │   ├── layout.tsx                     # Root layout + nhúng script App Bridge
│   │   ├── globals.css
│   │   ├── storefront-preview/page.tsx    # Trang xem trước widget ngoài Shopify (dev/QA)
│   │   └── api/
│   │       ├── auth/route.ts              # Bước 1 OAuth: redirect sang /admin/oauth/authorize
│   │       ├── auth/callback/route.ts     # Bước 2 OAuth: verify HMAC → đổi code lấy token → lưu bảng Shop
│   │       ├── admin/                     # ⚠️ TỒN TẠI NHƯNG RỖNG — không có route.ts nào.
│   │       │                              #   P2 lấp vào; MỌI handler bắt buộc viết bằng
│   │       │                              #   `withAdminSession` (xem CLAUDE.md).
│   │       └── webhooks/
│   │           ├── orders-create/         # Đọc property design id từ line item → tạo OrderLineDesign
│   │           └── app-uninstalled/       # Đánh dấu shop gỡ cài đặt
│   │
│   ├── lib/
│   │   ├── db.ts                          # Prisma singleton (tránh tạo nhiều connection khi hot-reload)
│   │   ├── ids.ts                         # Sinh id (node:crypto, KHÔNG dùng nanoid — ruling R4)
│   │   ├── hmac.ts                        # verifyShopifyProxySignature + verifyShopifyWebhook (timingSafeEqual)
│   │   ├── svg/parseSvgNode.ts            # Parse SVG text → DOM node (linkedom)
│   │   ├── storage/index.ts               # ⭐ ĐƯỜNG GHI ASSET DUY NHẤT — Supabase Storage. Chỉ nhận
│   │   │                                  #   SVG đã sanitize (xem CLAUDE.md); tự verify lần hai.
│   │   ├── auth/
│   │   │   ├── sessionToken.ts            # Verify App Bridge session token (HS256)
│   │   │   ├── shopDomain.ts              # Chuẩn hoá/so sánh shop domain
│   │   │   ├── requireAdminSession.ts     # Trả { session } | { response } — KHÔNG throw
│   │   │   └── withAdminSession.ts        # ⭐ Cách DUY NHẤT viết route `/api/admin/*` — bắt buộc
│   │   └── shopify/
│   │       ├── apiVersion.ts              # ⭐ NGUỒN SỰ THẬT DUY NHẤT cho Shopify API version
│   │       └── client.ts                  # Khởi tạo shopifyApi dùng SHOPIFY_API_VERSION ở trên
│   │
│   ├── shared/                            # Zod contracts DÙNG CHUNG server ↔ bundle storefront.
│   │   │                                  #   Phải là code thuần — không @supabase/supabase-js,
│   │   │                                  #   không process.env, không Node builtin.
│   │   │                                  #   Hàng rào: tests/shared/purity.test.ts
│   │   ├── ids.ts                         # Schema id design/share-token
│   │   ├── designRequest.ts               # Payload tạo design
│   │   ├── lineItemProperties.ts          # Property gắn vào Cart AJAX API
│   │   └── customizerConfig.ts            # Shape config trả về cho storefront
│   │
│   ├── svg-engine/                        # Sanitizer + renderer SVG (từ P1a) — 252+ test riêng
│   │
│   └── storefront-customizer/
│       ├── index.tsx                      # Entry: mount React vào #product-customizer-root
│       └── CustomizerApp.tsx              # UI widget — xem cảnh báo "lệch thiết kế" bên dưới
│
├── web/                                   # Shim cho Shopify CLI (type=backend, port 3000)
├── docs/
│   ├── runbooks/
│   │   ├── credential-rotation.md         # Rotate secret khi rời dự án / lộ secret
│   │   └── supabase-storage.md            # Tạo bucket Storage, CORS, biến môi trường, áp schema lần đầu
│   └── superpowers/specs/2026-09-08-wk-customizer-redesign-design.md   # ⭐ Spec thiết kế P1–P5
├── shopify.app.toml                       # Cấu hình app: URL, scopes, webhooks, app_proxy
├── next.config.mjs                        # CSP frame-ancestors cho `/` và `/admin/*`, CORS cho `/api/proxy/*`
├── tailwind.config.ts / postcss.config.mjs / tsconfig.json
└── .env.example                           # Mẫu biến môi trường
```

### Quy ước quan trọng
- **Không sửa tay** `extensions/product-customizer-block/assets/customizer-bundle.js` — file này bị ghi đè mỗi lần build. Sửa ở `src/storefront-customizer/`.
- `CustomizerApp.tsx` dùng import `react` thật (vì trang `storefront-preview` trong Next.js cần React runtime). Việc đổi sang Preact chỉ xảy ra ở **tầng bundler** (`scripts/bundle-extension.mjs`). **Đừng đổi import trong source** — đã từng gây lỗi type incompatibility.
- `uid` trong `shopify.extension.toml` là định danh extension trên Shopify. Đổi = tạo extension mới, mất liên kết theme cũ.
- `src/shared/` phải giữ thuần — nó chạy trong cả bundle Preact của storefront.

---

## 🗄️ Database

Supabase PostgreSQL, quản lý qua Prisma. Dùng **2 connection string**:
- `DATABASE_URL` — pooled (port `6543`, `?pgbouncer=true&connection_limit=1`) cho runtime serverless.
- `DIRECT_URL` — direct (port `5432`) cho `prisma db push` / `migrate`.

18 model, xem đầy đủ ở `prisma/schema.prisma`. Tóm tắt theo nhóm:

| Nhóm | Model | Vai trò |
|---|---|---|
| Shop | `Shop` | 1 bản ghi / 1 store — lưu `accessToken` OAuth |
| Thư viện file | `Asset` | Mọi SVG mockup, texture, display image, baked SVG — dedupe theo checksum |
| Attribute (phẳng) | `Leather`, `Stitch`, `Animal`, `Style` | Một danh sách `Leather` dùng chung cho cả body và animal |
| Product | `CustomizableProduct`, `ProductHost` | 1 customizer có thể gắn nhiều trang sản phẩm Shopify (`ProductHost`) |
| Ma trận A — style × body leather (CÓ GIÁ) | `ProductStyle`, `ProductStyleLeather` | `ProductStyleLeather` giữ cả `priceInput` (giá admin gõ, chưa chắc sync) lẫn `variantPriceSnapshot` (đọc ngược từ Shopify, chỉ admin xem) |
| Ma trận B — animal × animal leather (CÓ GIÁ, độc lập style) | `ProductAnimal`, `AnimalLeather` | Cùng cấu trúc hai giá như trên |
| SVG theo style × animal | `ProductStyleAnimal` | Đúng một SVG cho một tổ hợp (`@@unique([productStyleId, animalId])`) |
| Stitch khả dụng theo product | `ProductStitch` | — |
| Design (bất biến) | `CustomDesign`, `CustomDesignSelection` | **Không mang FK nào, kể cả `shopId`** (ruling R5) — archive/xoá attribute không bao giờ phá đơn cũ; `snapshot Json` là nguồn sự thật cho sản xuất |
| Đơn hàng + sản xuất | `OrderLineDesign` | Nối `CustomDesign` với line item Shopify thật; `productionStatus`: `NEW → IN_PRODUCTION → QC → SHIPPED` (+ `ON_HOLD`) |
| Idempotency webhook | `WebhookEvent` | Chống Shopify retry xử lý lại |

> ⚠️ **Bẫy Prisma `Decimal`:** các cột `Decimal` (`priceInput`, `variantPriceSnapshot`, `quotedTotal`…) trả về object `Decimal.js`, **không phải `number`**. `a + b` trên hai `Decimal` là **nối chuỗi im lặng**, không phải cộng. Dùng `.plus()`/`.minus()`/`.toNumber()`. Chỗ đầu tiên việc này chạm tiền thật: đối soát đơn hàng (`OrderLineDesign.totalMatchesQuote`).

> ⚠️ **Ràng buộc quan trọng khác** (đầy đủ ở spec §7.2): `Asset(shopId, kind, checksumSha256)` unique chống upload trùng; `ProductStyleLeather(shopifyVariantId)` và `AnimalLeather(shopifyVariantId)` unique chống hai cặp cùng trỏ một variant; `CustomDesign(shopId, idempotencyKey)` chống double-click tạo hai design; `OrderLineDesign(shopifyOrderId, shopifyLineItemId)` chống webhook `orders/create` + `orders/paid` nhân đôi.

> ⚠️ **Soft delete:** `isActive = false` (tạm ẩn khỏi storefront) và `archivedAt != null` (nghỉ hẳn, ẩn khỏi admin list) là **hai khái niệm khác nhau**. Attribute không bao giờ hard-delete.

### Lệnh làm việc với DB

```bash
npm run prisma:generate     # sinh Prisma Client sau khi sửa schema
npm run prisma:push         # đẩy schema lên Supabase (dev — không tạo file migration)
npx prisma studio           # GUI xem/sửa dữ liệu tại localhost:5555
```

Lần đầu áp schema P1b lên DB đang có schema cũ, `npm run prisma:push` **sẽ không chạy được**: bảng `Shop` có một hàng và cột bắt buộc mới `shopDomain` không có default, nên Prisma chỉ còn đường **reset toàn bộ database** (`npx prisma db push --force-reset`) — xoá sạch mọi bảng, mất `accessToken`, phải cài lại app. Chấp nhận được chỉ vì dữ liệu hiện tại là seed demo. Quy trình đầy đủ, đúng thứ tự: **`docs/runbooks/supabase-storage.md`, mục "Áp schema lần đầu"**.

Không còn `prisma/seed.mjs` — dữ liệu attribute/product nhập qua admin UI (P2) hoặc Prisma Studio thủ công.

Với production nên chuyển sang migration có version:
```bash
npx prisma migrate dev --name <ten_thay_doi>   # tạo migration ở local
npx prisma migrate deploy                       # áp dụng lên production
```

---

## ⚙️ Biến môi trường

Copy `.env.example` → `.env` rồi điền. **Tuyệt đối không commit `.env`** (đã có trong `.gitignore`). `tests/env.test.ts` quét `src/` để đối chiếu — biến nào bị đọc mà không khai trong `.env.example` sẽ làm `npm test` đỏ.

| Biến | Ý nghĩa | Lấy ở đâu |
|---|---|---|
| `SHOPIFY_API_KEY` | Client ID của app | Partners Dashboard → App → API credentials |
| `SHOPIFY_API_SECRET` | Client Secret — dùng verify HMAC proxy & webhook, verify session token admin | như trên |
| `SHOPIFY_APP_URL` | URL public của app (dev: tunnel; prod: domain Vercel) | Shopify CLI in ra khi `dev`, hoặc Vercel |
| `SCOPES` | `read_products,write_products,read_orders,write_orders,read_themes,write_themes` | phải khớp `shopify.app.toml` |
| `DATABASE_URL` | Supabase pooled connection (port 6543) | Supabase → Project Settings → Database → Connection pooling |
| `DIRECT_URL` | Supabase direct connection (port 5432) | như trên, mục Direct connection |
| `NODE_ENV` | `development` / `production` | — |
| `WK_ALLOWED_SHOPS` | **Bắt buộc.** Danh sách shop được vào embedded admin, ngăn cách bằng dấu phẩy. Để trống = chặn tất cả (mọi request `/api/admin/*` trả 403). Không bao giờ dùng `*`. | Domain `.myshopify.com` của shop — production hiện tại là `wildandking-demo.myshopify.com` |
| `WK_SKIP_HMAC` | Chỉ dùng khi dev cục bộ. Đặt `1` để bỏ qua xác thực HMAC của App Proxy / webhook / OAuth callback. **Tuyệt đối không đặt trên Vercel** — app sẽ ném lỗi nếu bật cùng `NODE_ENV=production`. | Tự đặt trong `.env` cục bộ; mặc định để trống |
| `SUPABASE_URL` | URL project Supabase, dùng cho Storage (asset SVG/ảnh) | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Key toàn quyền, bỏ qua RLS — CHỈ đặt phía server | như trên, mục Project API keys → `service_role` |
| `SUPABASE_STORAGE_BUCKET` | Tên bucket Storage — `wk-assets` | Tự đặt khi tạo bucket, xem `docs/runbooks/supabase-storage.md` |

**Trên Vercel:** khai báo cùng bộ biến này ở Settings → Environment Variables (scope `Production`) — **trừ `WK_SKIP_HMAC`, biến này không bao giờ được khai trên Vercel**. `WK_ALLOWED_SHOPS` thì **bắt buộc phải có**: thiếu nó, embedded admin trả 403 cho mọi request. Sau khi đổi biến phải **Redeploy** thì mới có hiệu lực.

> 🔐 **Xác thực HMAC luôn bật ở mọi môi trường.** Cách duy nhất để tắt là đặt tường minh `WK_SKIP_HMAC=1` trong `.env` cục bộ, và app sẽ **ném lỗi, từ chối phục vụ request** nếu biến này bật cùng `NODE_ENV=production`.

### 🔑 Lấy giá trị `.env` ở đâu

Giá trị thật **không** được ghi trong repo. Lấy từ:

- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` — Shopify Partners → App → API credentials
- `DATABASE_URL`, `DIRECT_URL` — Supabase → Project Settings → Database
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` — Supabase → Project Settings → API, và `docs/runbooks/supabase-storage.md`
- `WK_ALLOWED_SHOPS` — `wildandking-demo.myshopify.com`
- `WK_SKIP_HMAC` — để trống, trừ khi test cục bộ

Xem `docs/runbooks/credential-rotation.md` khi cần đổi secret.

---

## 💻 Setup môi trường local (từ đầu)

**Yêu cầu:** Node.js ≥ 18, npm, tài khoản Shopify Partners, quyền truy cập Supabase project.

```bash
# 1. Clone
gh repo clone PHUONGNAM101203/shopify-internal-customizer-app
cd shopify-internal-customizer-app

# 2. Cài dependencies
npm install

# 3. Cấu hình môi trường
cp .env.example .env
#    → điền giá trị thật, xem mục "🔑 Lấy giá trị .env ở đâu" phía trên

# 4. Sinh Prisma Client + đồng bộ schema
npm run prisma:generate
npm run prisma:push
#    Lần ĐẦU TIÊN trên một DB có schema cũ: lệnh này sẽ dừng và đòi RESET TOÀN
#    BỘ database. Đọc docs/runbooks/supabase-storage.md mục "Áp schema lần đầu"
#    TRƯỚC khi chạy.

# 5. Build bundle cho theme extension
npm run bundle:extension

# 6. Chạy dev (Next.js + Shopify CLI song song)
npm run dev
```

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy **đồng thời** `next dev` (port 3000) và `shopify app dev` (tunnel + sync extension) |
| `npm run dev:app` | Chỉ Next.js — dùng khi làm UI admin, không cần Shopify |
| `npm run dev:shopify` | Chỉ Shopify CLI |
| `npm run build` | `prisma generate` → `bundle:extension` → `next build` (đây là lệnh Vercel chạy) |
| `npm run bundle:extension` | Build lại widget storefront |
| `npm run shopify:deploy` | Đẩy config app + theme extension lên Shopify |
| `npm test` | Vitest hermetic (`vitest run`) — không chạm DB, `tests/` |
| `npm run test:db` | Vitest chống Postgres thật, `tests-db/` — **cần Docker chạy**; tự dựng container tạm, từ chối mọi host không phải localhost |

Truy cập: shell admin tạm thời (chờ P2) tại `http://localhost:3000`, xem trước widget tại `http://localhost:3000/storefront-preview`.

> **`npm run lint` HỎNG — đừng chạy.** Repo không có config ESLint; `next lint` rơi vào prompt tương tác và treo terminal. Đây là gap đã biết, nằm ngoài phạm vi P1b. Mọi ràng buộc phong cách hiện do test + code review gánh.

---

## 🔄 Luồng hoạt động — thiết kế (P2/P3), KHÔNG PHẢI trạng thái hiện tại

Đây là luồng **dự kiến** theo `docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md`. Trừ bước ① (OAuth — đã chạy thật), các route ở dưới **chưa tồn tại trong code** — implement là việc của P2 (admin) và P3 (storefront + App Proxy).

```
① CÀI ĐẶT (OAuth) — ĐÃ CHẠY THẬT
   Merchant mở install link
     → GET /api/auth?shop=xxx.myshopify.com
     → redirect tới https://<shop>/admin/oauth/authorize
     → Shopify gọi lại GET /api/auth/callback?code=...&hmac=...
     → verify HMAC → POST /admin/oauth/access_token → lưu accessToken vào bảng Shop
     → redirect về https://<shop>/admin/apps/<API_KEY>

② ADMIN CẤU HÌNH (P2 — chưa viết)
   Nhập attribute (Leather/Stitch/Animal/Style), gắn ProductHost, nhập giá vào
   ma trận A/B (priceInput), upload SVG per style×animal, "Generate variants"
   sinh Shopify variant thật rồi ghi ngược shopifyVariantId.
     → toàn bộ dưới /api/admin/*, bắt buộc viết bằng withAdminSession
        (xem CLAUDE.md; thư mục src/app/api/admin/ CHƯA tồn tại — P2 tạo nó)

③ KHÁCH TÙY CHỈNH TRÊN STOREFRONT (P3 — chưa viết)
   Trang sản phẩm render block customizer.liquid → customizer-bundle.js mount
   React vào #product-customizer-root
     → GET /apps/customizer/... (App Proxy, có chữ ký HMAC) lấy config
     → khách chọn option → POST /apps/customizer/designs
     → server tính giá từ DB, tạo CustomDesign (DRAFT) + CustomDesignSelection
     → trả property chứa id design
   → widget gọi Shopify Cart AJAX API, gắn property làm line item property

④ KHÁCH THANH TOÁN — webhook đã có, chờ property thật từ ③
   Shopify bắn webhook orders/create + orders/paid
     → POST /api/webhooks/orders-create
     → verify X-Shopify-Hmac-Sha256
     → duyệt line_items, tìm property design id
     → tạo OrderLineDesign (productionStatus = NEW)

⑤ XƯỞNG SẢN XUẤT (P2 — chưa viết)
   Admin UI → danh sách OrderLineDesign lọc theo productionStatus, đổi status
   NEW → IN_PRODUCTION → QC → SHIPPED qua PATCH /api/admin/order-lines/:id
```

**Vì sao giá phải tính ở server:** người dùng có thể sửa JS trên trình duyệt. Giá phải đọc từ `ProductStyleLeather`/`AnimalLeather` trong DB (không tin giá client gửi lên) — hiện chưa có route nào làm việc này; `pricingEngine.ts` cũ (chạy trên schema đã xoá) không còn tồn tại.

Widget hiện tại (`CustomizerApp.tsx`) **chưa nối theo luồng trên**: nó dùng mảng option hardcode (`LEATHER_MATERIALS`, `BUCKLE_OPTIONS`) và POST tới `/apps/customizer/save-design` — route đó chưa tồn tại. Chấp nhận được vì chưa có theme thật nào bật block này; nối lại là việc của P3.

---

## 🚀 Quy trình publish lên Shopify

App này dùng **Custom Distribution** (cài trực tiếp cho 1 store), **không cần Shopify duyệt**, không lên App Store.

### Bước 1 — Deploy backend lên Vercel

```bash
# Cách A: tự động (khuyến nghị) — đã bật GitHub integration
git add <file cụ thể>
git commit -m "feat: <mô tả>"
git push origin main          # Vercel tự build & deploy trong ~2 phút

# Cách B: thủ công bằng Vercel CLI
vercel --prod
```

Kiểm tra deploy thành công:
```bash
curl -I https://wild-king-customizer.vercel.app
curl -I "https://wild-king-customizer.vercel.app/api/auth?shop=wildandking-demo.myshopify.com"   # phải trả 307 redirect
```

### Bước 2 — Cập nhật `shopify.app.toml`

Chỉ cần làm khi đổi domain. Ba chỗ **bắt buộc phải cùng domain**:

```toml
application_url = "https://wild-king-customizer.vercel.app"

[auth]
redirect_urls = [ "https://wild-king-customizer.vercel.app/api/auth/callback" ]

[app_proxy]
url = "/api/proxy"
```

> ⚠️ TOML rất khó tính về thứ tự: mọi cặp `key = value` ở cấp gốc phải nằm **trước** bảng `[section]` đầu tiên. Đặt sau sẽ lỗi parse — lỗi này đã từng xảy ra.

### Bước 3 — Deploy app config + theme extension lên Shopify

```bash
npm run bundle:extension     # LUÔN build lại bundle trước khi deploy
npm run shopify:deploy       # = shopify app deploy
```

Lệnh này đẩy lên Shopify: `shopify.app.toml` (URL, scopes, webhooks, app proxy) và toàn bộ `extensions/`. Shopify tạo một **version mới** và release nó.

### Bước 4 — Cài app vào store (chỉ làm lần đầu, hoặc sau khi `prisma:push` xoá bảng `Shop`)

1. Vào [Shopify Partners Dashboard](https://partners.shopify.com) → **Apps** → *Wild & King Customizer*.
2. Chọn **Distribution** → **Custom distribution**.
3. Nhập domain store (`wildandking-demo.myshopify.com` hoặc store thật).
4. Copy **Install link**, dán vào trình duyệt → **Install app**.

Hoặc dùng CLI:
```bash
shopify app dev --store=wildandking-demo.myshopify.com
```

### Bước 5 — Bật App Block trên trang sản phẩm

1. Shopify Admin → **Online Store** → **Themes** → **Customize**.
2. Dropdown trên cùng chọn **Products** → **Default product**.
3. Cột trái, trong Product information → **Add block** → mục **Apps** → chọn **Custom Product Designer**.
4. Kéo block đến vị trí mong muốn (thường ngay trên nút *Add to cart*).
5. Chỉnh title / màu chủ đạo / text nút ở panel bên phải nếu cần → **Save**.

### Bước 6 — Kiểm tra sau khi publish

- [ ] Backend: `curl -I` các endpoint ở Bước 1 trả đúng status.
- [ ] Admin nhúng mở được trong Shopify Admin, không trắng trang (kiểm CSP).
- [ ] Partners Dashboard → App → **Webhooks**: không có delivery nào fail.
- [ ] Luồng storefront → add to cart → webhook → `OrderLineDesign` **chưa kiểm được** cho tới khi P2/P3 xong (route chưa tồn tại).

### Rollback

```bash
shopify app versions list          # xem các version đã deploy
shopify app release --version=<id> # quay lại version cũ
```
Backend Vercel: vào Vercel Dashboard → Deployments → chọn bản cũ → **Promote to Production**.

---

## 🧯 Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân & cách xử lý |
|---|---|
| Widget kẹt ở "Đang tải bảng tùy chỉnh…" | Bundle chưa build hoặc lỗi JS. Chạy `npm run bundle:extension` + `npm run shopify:deploy`, xem Console trình duyệt |
| API proxy trả **401 Invalid HMAC signature** | `SHOPIFY_API_SECRET` trên Vercel sai/thiếu, hoặc gọi thẳng URL Vercel thay vì qua `/apps/customizer` |
| API proxy trả **404** | Route con dưới `/api/proxy/*` chưa tồn tại (P3 chưa xong), hoặc `[app_proxy]` trong `shopify.app.toml` chưa deploy — chạy `shopify app deploy` |
| Admin không hiện trong Shopify (iframe trắng) | Thiếu header CSP `frame-ancestors` — kiểm tra `next.config.mjs`; hoặc `application_url` sai |
| `/api/admin/*` trả 403 | `WK_ALLOWED_SHOPS` thiếu hoặc không khớp shop domain (so sánh lowercase) trên Vercel — xem mục Biến môi trường |
| `/api/admin/*` trả 401 | `SHOPIFY_API_SECRET`/`SHOPIFY_API_KEY` sai/thiếu, hoặc session token App Bridge hết hạn |
| Route `/api/admin/*` mới build lỗi/test đỏ | Handler chưa viết đúng hình `export const METHOD = withAdminSession(...)` — `tests/app/api/admin/route-guard.test.ts` bắt lỗi này |
| Upload SVG bị từ chối ở `uploadSanitizedSvg` | Caller quên `sanitizeSvgRoot()` trước khi gọi, hoặc truyền bytes gốc còn comment/DOCTYPE trước thẻ `<svg>` — xem CLAUDE.md mục "Ghi SVG vào Storage" |
| Texture vỡ khi nạp inline trong SVG (nhưng `<img>` thường vẫn load được) | Thiếu CORS trên bucket Supabase — xem `docs/runbooks/supabase-storage.md` mục Kiểm chứng |
| `PrismaClientInitializationError` trên Vercel | Thiếu `DATABASE_URL`/`DIRECT_URL`, hoặc quên `?pgbouncer=true&connection_limit=1` ở pooled URL |
| `npm run prisma:push` dừng, báo "not possible to execute this step" hoặc đòi reset | Lần đầu áp schema P1b lên DB có schema cũ: cột bắt buộc `shopDomain` không default trên bảng `Shop` đang có hàng. Chỉ còn đường `npx prisma db push --force-reset` (xoá sạch mọi bảng). Làm theo runbook mục "Áp schema lần đầu" |
| Tổng tiền đối soát đơn sai một cách kỳ lạ (ra chuỗi thay vì số) | Cộng trực tiếp hai cột `Decimal` bằng `+` — dùng `.plus()` của Decimal.js |
| Lỗi parse `shopify.app.toml` | Có `key = value` cấp gốc nằm sau `[section]` — di chuyển lên đầu file |
| Type error khi build sau khi sửa customizer | Đã đổi import React → Preact trong source. Hoàn nguyên về `react`; alias chỉ đặt ở `scripts/bundle-extension.mjs` |
| `npm run lint` treo terminal | Đã biết — không có config ESLint. Đừng chạy lệnh này |

Xem log production:
```bash
vercel logs https://wild-king-customizer.vercel.app --follow
```

---

## ✅ Bạn cần làm gì tiếp theo

P1b (nền tảng dữ liệu) đã xong: schema 18 model, Supabase Storage, hợp đồng zod `src/shared/`, một Shopify API version duy nhất, `withAdminSession` bắt buộc cho mọi route admin. Những gì còn thiếu là **implement theo spec**, không phải sửa lỗi trên code cũ.

### 🔴 P2 — Admin (ưu tiên cao nhất, chặn P3)

1. **Viết toàn bộ `/api/admin/*` theo spec §8.1** (`docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md`) — attribute CRUD (leathers/stitches/animals/styles), asset upload (`POST /api/admin/assets` — server sanitize rồi mới lưu, ruling R2, xem spec §8.1), Shopify passthrough (đọc product/variant), product config + ma trận giá (A: style×leather, B: animal×leather), sinh variant (`preview`/`generate`/`sync`), designs & production queue. **Mọi handler bắt buộc viết bằng `withAdminSession`** — `tests/app/api/admin/route-guard.test.ts` sẽ đỏ nếu quên.
2. **Viết admin UI hai tab** (Attributes · Products, spec §12) thay cho shell tạm ở `src/app/page.tsx`.
3. **Quyết cách query admin scope theo `shopId`** cho các bảng join không mang `shopId` trực tiếp (`ProductStyle`, `ProductStyleLeather`, `ProductAnimal`, `AnimalLeather`, `ProductStyleAnimal`, `ProductStitch`, `CustomDesignSelection`) — phải join ngược lên `CustomizableProduct`. Quyết trước khi viết query đầu tiên.

### 🟡 P3 — Storefront + App Proxy

4. **Dựng lại route dưới `/apps/customizer/*`** (App Proxy) — `GET` lấy config, `POST /designs` tạo `CustomDesign` + tính giá server-side, dùng `src/shared/` cho request/response shape.
5. **Nối lại widget** (`CustomizerApp.tsx`) theo luồng thật thay vì mảng option hardcode + POST thẳng `/apps/customizer/save-design`.
6. **Kiểm thử webhook thật end-to-end.** Đặt một đơn hàng test, xác nhận `OrderLineDesign` được tạo đúng, `groupIntact`/`totalMatchesQuote` tính đúng (coi chừng bẫy `Decimal` — xem mục Database).

### 🟢 Vận hành / nên có

7. **Tạo bucket Supabase Storage `wk-assets`** trên project thật nếu chưa có — `docs/runbooks/supabase-storage.md`.
8. **Chuyển sang Prisma migration có version** (`prisma migrate`) thay cho `db push`, để thay đổi schema production có thể audit và rollback.
9. **Sửa `npm run lint`** — chọn + cấu hình một bộ rule ESLint thật (hiện tại script gọi `next lint` nhưng không có config, rơi vào prompt tương tác và treo). Nằm ngoài phạm vi P1b, chưa ai nhận việc này.
10. **Bỏ `console.log`/`console.error` rải rác** trong các API route, thay bằng logger có cấu trúc.

---

## 📚 Liên kết

- [Shopify Theme App Extensions](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions)
- [Shopify App Proxy](https://shopify.dev/docs/apps/build/online-store/display-dynamic-data)
- [Shopify CLI configuration](https://shopify.dev/docs/apps/tools/cli/configuration)
- [Prisma + Supabase](https://www.prisma.io/docs/orm/overview/databases/supabase)
- [Supabase Storage](https://supabase.com/docs/guides/storage)
- [Next.js App Router](https://nextjs.org/docs/app)
