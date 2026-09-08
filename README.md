# 🛍️ Wild & King Customizer — Shopify Internal Custom Product App

App **nội bộ (Custom Distribution)** cho phép khách hàng tùy biến sản phẩm da thủ công (dây đồng hồ, ví, money clip…) ngay trên trang sản phẩm Shopify, đồng thời cung cấp bảng quản trị nhúng trong Shopify Admin để cấu hình option và theo dõi hàng chờ sản xuất.

Kiến trúc theo chuẩn **Shopify Online Store 2.0**: `Theme App Extension` (widget chạy trực tiếp trong DOM storefront, **không dùng iframe**) + `App Proxy` (gọi API cùng domain, ký HMAC) + `Embedded Next.js Admin` (nhúng trong Shopify Admin qua App Bridge).

> **Đọc file này trước khi làm bất cứ việc gì.** Phần [Bạn cần làm gì tiếp theo](#-bạn-cần-làm-gì-tiếp-theo) ở cuối liệt kê các việc còn dang dở.

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
| Webhook API version | `2026-10` |
| App Proxy | `https://<shop>/apps/customizer/*` → `https://wild-king-customizer.vercel.app/api/proxy/*` |

**Deploy tự động:** push lên nhánh `main` của GitHub → Vercel tự build & deploy. Theme extension **KHÔNG** tự deploy, phải chạy `npm run shopify:deploy` thủ công.

---

## 🧱 Tech Stack

| Lớp | Công nghệ |
|---|---|
| Backend / Admin | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| ORM / DB | Prisma 5 + Supabase PostgreSQL (pooled + direct URL) |
| Storefront widget | React 18 source → bundle bằng esbuild, alias sang **Preact/compat** (giảm ~130KB → ~8KB) |
| Shopify | `@shopify/shopify-api` v11, Shopify CLI v3, Theme App Extension |
| Hosting | Vercel (serverless) |
| Icon / UI | lucide-react, clsx, tailwind-merge |

---

## 🏗️ Cấu trúc thư mục

```
App noi bo/
├── extensions/
│   └── product-customizer-block/          # 🎨 THEME APP EXTENSION (chạy trên storefront)
│       ├── blocks/customizer.liquid       # App Block: mount point <div id="product-customizer-root">
│       │                                  #   truyền product.id, variant.id, shop domain qua data-*
│       │                                  #   có {% schema %} cho merchant chỉnh title/màu/text nút
│       ├── assets/
│       │   ├── customizer-bundle.js       # ⚠️ FILE BUILD — sinh ra bởi npm run bundle:extension
│       │   └── customizer.css             # CSS thủ công cho widget
│       ├── locales/en.default.json
│       └── shopify.extension.toml         # type = "theme", uid cố định (KHÔNG đổi)
│
├── packages/
│   └── shared-types/src/                  # 📦 Types dùng chung storefront ↔ admin ↔ API
│       ├── config.ts                      # ProductConfig, OptionGroup, OptionValue
│       ├── design.ts                      # Design, DesignSelection, ProductionJob
│       ├── api.ts                         # Request/Response shapes
│       └── index.ts
│
├── prisma/
│   ├── schema.prisma                      # 9 model (xem mục Database bên dưới)
│   ├── seed.mjs                           # Dữ liệu mẫu: shop demo + config dây đồng hồ bespoke
│   └── dev.db                             # (legacy SQLite, KHÔNG dùng nữa — đã chuyển Postgres)
│
├── scripts/
│   └── bundle-extension.mjs               # esbuild: src/storefront-customizer → assets/customizer-bundle.js
│                                          #   alias react→preact/compat để giảm bundle size
│
├── src/
│   ├── app/                               # Next.js App Router
│   │   ├── page.tsx                       # ⭐ TRANG CHÍNH — Embedded Admin (Shopify nhúng URL này)
│   │   │                                  #   3 tab bằng useState: Dashboard | Product Configs | Production Queue
│   │   ├── layout.tsx                     # Root layout + nhúng script App Bridge
│   │   ├── globals.css
│   │   ├── storefront-preview/page.tsx    # Trang xem trước widget ngoài Shopify (dev/QA)
│   │   ├── admin/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                   # ⚠️ LEGACY — trùng chức năng với src/app/page.tsx, chưa dùng
│   │   │   ├── products/page.tsx          # UI cấu hình option/giá (được page.tsx import làm tab)
│   │   │   └── orders/page.tsx            # UI hàng chờ sản xuất (được page.tsx import làm tab)
│   │   └── api/
│   │       ├── auth/route.ts              # Bước 1 OAuth: redirect sang /admin/oauth/authorize
│   │       ├── auth/callback/route.ts     # Bước 2 OAuth: verify HMAC → đổi code lấy token → lưu bảng Shop
│   │       ├── proxy/
│   │       │   ├── customizer-config/     # GET  — storefront lấy cấu hình option của product
│   │       │   └── save-design/           # POST — lưu thiết kế nháp (DRAFT)
│   │       ├── cart/validate/route.ts     # POST — ⭐ TÍNH GIÁ PHÍA SERVER + tạo Design + trả line item properties
│   │       ├── admin/
│   │       │   ├── products/route.ts      # GET danh sách config | POST upsert config
│   │       │   └── orders/route.ts        # GET jobs + draftDesigns | PATCH đổi status job
│   │       └── webhooks/
│   │           ├── orders-create/         # Đọc property _custom_design_id → Design=ORDERED + tạo ProductionJob
│   │           └── app-uninstalled/       # Đánh dấu shop gỡ cài đặt
│   │
│   ├── lib/
│   │   ├── db.ts                          # Prisma singleton (tránh tạo nhiều connection khi hot-reload)
│   │   ├── hmac.ts                        # verifyShopifyProxySignature + verifyShopifyWebhook (timingSafeEqual)
│   │   ├── shopify.ts                     # Khởi tạo shopifyApi + helper executeShopifyGraphQL
│   │   └── pricing/pricingEngine.ts       # ⭐ calculateServerPrice — nguồn giá DUY NHẤT đáng tin
│   │
│   └── storefront-customizer/
│       ├── index.tsx                      # Entry: mount React vào #product-customizer-root,
│       │                                  #   lắng nghe shopify:section:load để re-mount trong Theme Editor
│       └── CustomizerApp.tsx              # Toàn bộ UI chọn da / khóa / size / khắc laser + add to cart
│
├── web/                                   # Shim cho Shopify CLI (type=backend, port 3000)
│   ├── shopify.web.toml                   #   dev = "npm --prefix .. run dev:app"
│   └── package.json
│
├── supabase/.temp/                        # Cache CLI của Supabase (đã gitignore)
├── shopify.app.toml                       # ⭐ Cấu hình app: URL, scopes, webhooks, app_proxy
├── next.config.mjs                        # CSP frame-ancestors cho /admin/*, CORS cho /api/proxy/*
├── tailwind.config.ts / postcss.config.mjs / tsconfig.json
└── .env.example                           # Mẫu biến môi trường
```

### Quy ước quan trọng
- **Không sửa tay** `extensions/product-customizer-block/assets/customizer-bundle.js` — file này bị ghi đè mỗi lần build. Sửa ở `src/storefront-customizer/`.
- `CustomizerApp.tsx` dùng import `react` thật (vì trang `storefront-preview` trong Next.js cần React runtime). Việc đổi sang Preact chỉ xảy ra ở **tầng bundler** (`scripts/bundle-extension.mjs`). **Đừng đổi import trong source** — đã từng gây lỗi type incompatibility.
- `uid` trong `shopify.extension.toml` là định danh extension trên Shopify. Đổi = tạo extension mới, mất liên kết theme cũ.

---

## 🗄️ Database

Supabase PostgreSQL, quản lý qua Prisma. Dùng **2 connection string**:
- `DATABASE_URL` — pooled (port `6543`, `?pgbouncer=true&connection_limit=1`) cho runtime serverless.
- `DIRECT_URL` — direct (port `5432`) cho `prisma migrate` / `db push`.

### Sơ đồ quan hệ

```
Shop (1 bản ghi / 1 store — lưu accessToken OAuth)

ProductConfig ──┬─< OptionGroup ──< OptionValue
                ├─< CompatibilityRule      (nếu chọn A thì cấm B)
                ├─< PriceRule              (tổ hợp option → phụ thu)
                └─< Design ──┬─< DesignSelection
                             └─1 ProductionJob
```

### Các model

| Model | Vai trò | Trường then chốt |
|---|---|---|
| `Shop` | Lưu token OAuth của store | `shop` (unique), `accessToken`, `scope`, `installed` |
| `ProductConfig` | Gắn 1 sản phẩm Shopify với bộ tùy chỉnh | `shopifyProductId` (unique), `basePrice`, `isEnabled` |
| `OptionGroup` | Nhóm lựa chọn | `type`: `LEATHER` / `BUCKLE` / `SIZE` / `STITCH` / `ENGRAVING` / `CUSTOM`, `required`, `sortOrder` |
| `OptionValue` | Từng lựa chọn | `code`, `colorHex`, `extraPrice`, `inStock`, `sortOrder` |
| `CompatibilityRule` | Ràng buộc loại trừ | `ifOptionValueId` → `thenDisallowOptionValueIds` (JSON array dạng String) |
| `PriceRule` | Phụ thu theo tổ hợp | `conditionOptionValueIds` (JSON array dạng String), `additionalPrice` |
| `Design` | Một thiết kế của khách | `id` = `dsg_xxxxxxxx`, `status`: `DRAFT`→`ORDERED`→`IN_PRODUCTION`→`QC`→`SHIPPED` |
| `DesignSelection` | Snapshot lựa chọn (tên đã "đóng băng") | `groupName`, `valueName`, `extraPrice` |
| `ProductionJob` | Lệnh sản xuất sinh từ đơn hàng | `designId` (unique 1-1), `shopifyOrderNumber`, `status`: `NEW`/`IN_PRODUCTION`/`QC`/`SHIPPED` |

> ⚠️ `CompatibilityRule.thenDisallowOptionValueIds` và `PriceRule.conditionOptionValueIds` là **String chứa JSON**, không phải array Postgres — phải `JSON.parse()` khi đọc.

### Lệnh làm việc với DB

```bash
npm run prisma:generate     # sinh Prisma Client sau khi sửa schema
npm run prisma:push         # đẩy schema lên Supabase (dev — không tạo file migration)
npm run prisma:seed         # nạp dữ liệu mẫu (shop demo + config dây đồng hồ)
npx prisma studio           # GUI xem/sửa dữ liệu tại localhost:5555
```

Với production nên chuyển sang migration có version:
```bash
npx prisma migrate dev --name <ten_thay_doi>   # tạo migration ở local
npx prisma migrate deploy                       # áp dụng lên production
```

---

## ⚙️ Biến môi trường

Copy `.env.example` → `.env` rồi điền. **Tuyệt đối không commit `.env`** (đã có trong `.gitignore`).

| Biến | Ý nghĩa | Lấy ở đâu |
|---|---|---|
| `SHOPIFY_API_KEY` | Client ID của app | Partners Dashboard → App → API credentials |
| `SHOPIFY_API_SECRET` | Client Secret — dùng verify HMAC proxy & webhook | như trên |
| `SHOPIFY_APP_URL` | URL public của app (dev: tunnel; prod: domain Vercel) | Shopify CLI in ra khi `dev`, hoặc Vercel |
| `SCOPES` | `read_products,write_products,read_orders,write_orders,read_themes,write_themes` | phải khớp `shopify.app.toml` |
| `DATABASE_URL` | Supabase pooled connection (port 6543) | Supabase → Project Settings → Database → Connection pooling |
| `DIRECT_URL` | Supabase direct connection (port 5432) | như trên, mục Direct connection |
| `NODE_ENV` | `development` / `production` | — |
| `WK_ALLOWED_SHOPS` | **Bắt buộc.** Danh sách shop được vào embedded admin, ngăn cách bằng dấu phẩy. Để trống = chặn tất cả (mọi request `/api/admin/*` trả 403). Không bao giờ dùng `*`. | Domain `.myshopify.com` của shop — production hiện tại là `wildandking-demo.myshopify.com` |
| `WK_SKIP_HMAC` | Chỉ dùng khi dev cục bộ. Đặt `1` để bỏ qua xác thực HMAC của App Proxy / webhook / OAuth callback. **Tuyệt đối không đặt trên Vercel** — app sẽ ném lỗi nếu bật cùng `NODE_ENV=production`. | Tự đặt trong `.env` cục bộ; mặc định để trống |

**Trên Vercel:** khai báo cùng bộ biến này ở Settings → Environment Variables (scope `Production`) — **trừ `WK_SKIP_HMAC`, biến này không bao giờ được khai trên Vercel**. `WK_ALLOWED_SHOPS` thì **bắt buộc phải có**: thiếu nó, embedded admin trả 403 cho mọi request. Sau khi đổi biến phải **Redeploy** thì mới có hiệu lực.

> 🔐 **Xác thực HMAC luôn bật ở mọi môi trường.** Trước đây nó được suy ra từ `NODE_ENV`, nghĩa là mọi môi trường không phải production — kể cả preview deployment công khai — đều chạy không xác thực; điều đó đã bị gỡ bỏ. Cách duy nhất để tắt là đặt tường minh `WK_SKIP_HMAC=1` trong `.env` cục bộ, và app sẽ **ném lỗi, từ chối phục vụ request** nếu biến này bật cùng `NODE_ENV=production`.

### 🔑 Lấy giá trị `.env` ở đâu

Giá trị thật **không** được ghi trong repo. Lấy từ:

- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` — Shopify Partners → App → API credentials
- `DATABASE_URL`, `DIRECT_URL` — Supabase → Project Settings → Database
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
#    → mở .env và dán nguyên khối ở mục "🔑 File .env thực tế đang dùng" phía trên

# 4. Sinh Prisma Client + đồng bộ schema + seed dữ liệu mẫu
npm run prisma:generate
npm run prisma:push
npm run prisma:seed

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

Truy cập: Admin tại `http://localhost:3000`, xem trước widget tại `http://localhost:3000/storefront-preview`.

---

## 🔄 Luồng hoạt động end-to-end

```
① CÀI ĐẶT (OAuth)
   Merchant mở install link
     → GET /api/auth?shop=xxx.myshopify.com
     → redirect tới https://<shop>/admin/oauth/authorize
     → Shopify gọi lại GET /api/auth/callback?code=...&hmac=...
     → verify HMAC → POST /admin/oauth/access_token → lưu accessToken vào bảng Shop
     → redirect về https://<shop>/admin/apps/<API_KEY>

② KHÁCH TÙY CHỈNH TRÊN STOREFRONT
   Trang sản phẩm render block customizer.liquid
     → <div id="product-customizer-root" data-product-id="..." data-shop-domain="...">
     → customizer-bundle.js mount React vào div đó
     → GET /apps/customizer/customizer-config?productId=...   (App Proxy, có chữ ký HMAC)
        └─ Shopify chuyển tiếp tới /api/proxy/customizer-config trên Vercel
     → trả về ProductConfig + OptionGroups + OptionValues + rules
     → khách chọn option, UI hiển thị giá tạm tính

③ THÊM VÀO GIỎ
   POST /api/cart/validate  { configId, productId, selections, engravingText, ... }
     → calculateServerPrice() TÍNH LẠI GIÁ TỪ DB (không tin giá client gửi lên)
     → tạo Design (status=DRAFT) + DesignSelection
     → trả về summaryProperties, trong đó có _custom_design_id
   → widget gọi Shopify Cart AJAX API, gắn summaryProperties làm line item properties

④ KHÁCH THANH TOÁN
   Shopify bắn webhook orders/create + orders/paid
     → POST /api/webhooks/orders-create
     → verify X-Shopify-Hmac-Sha256
     → duyệt line_items, tìm property _custom_design_id
     → Design.status = ORDERED  +  tạo ProductionJob (status = NEW)

⑤ XƯỞNG SẢN XUẤT
   Shopify Admin → Apps → Wild & King Customizer  (nhúng iframe wild-king-customizer.vercel.app)
     → tab "Production Queue" gọi GET /api/admin/orders
     → nhân viên đổi status qua PATCH /api/admin/orders  (NEW → IN_PRODUCTION → QC → SHIPPED)
```

**Vì sao giá phải tính ở server:** người dùng có thể sửa JS trên trình duyệt. `pricingEngine.ts` đọc `extraPrice` từ DB, áp `PriceRule`, kiểm `CompatibilityRule` và kiểm option `required` — đây là nguồn giá duy nhất được tin.

---

## 🚀 Quy trình publish lên Shopify

App này dùng **Custom Distribution** (cài trực tiếp cho 1 store), **không cần Shopify duyệt**, không lên App Store.

### Bước 1 — Deploy backend lên Vercel

```bash
# Cách A: tự động (khuyến nghị) — đã bật GitHub integration
git add -A
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
url = "https://wild-king-customizer.vercel.app/api/proxy"
```

> ⚠️ TOML rất khó tính về thứ tự: mọi cặp `key = value` ở cấp gốc phải nằm **trước** bảng `[section]` đầu tiên. Đặt sau sẽ lỗi parse — lỗi này đã từng xảy ra.

### Bước 3 — Deploy app config + theme extension lên Shopify

```bash
npm run bundle:extension     # LUÔN build lại bundle trước khi deploy
npm run shopify:deploy       # = shopify app deploy
```

Lệnh này đẩy lên Shopify: `shopify.app.toml` (URL, scopes, webhooks, app proxy) và toàn bộ `extensions/`. Shopify tạo một **version mới** và release nó.

### Bước 4 — Cài app vào store (chỉ làm lần đầu)

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

- [ ] Mở trang sản phẩm trên storefront → widget hiện, không kẹt ở "Đang tải…"
- [ ] DevTools → Network: `/apps/customizer/customizer-config` trả **200** (không phải 401 → sai HMAC, hoặc 404 → app proxy chưa đúng)
- [ ] Chọn option → giá cập nhật đúng
- [ ] Add to cart → giỏ hàng hiển thị các thuộc tính tùy chỉnh
- [ ] Đặt 1 đơn test → Shopify Admin → Apps → tab Production Queue phải xuất hiện job mới
- [ ] Partners Dashboard → App → **Webhooks**: không có delivery nào fail

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
| API proxy trả **404** | `[app_proxy]` trong `shopify.app.toml` chưa deploy. Chạy `shopify app deploy` |
| Admin không hiện trong Shopify (iframe trắng) | Thiếu header CSP `frame-ancestors` — kiểm tra `next.config.mjs`; hoặc `application_url` sai |
| Đơn hàng không sinh ProductionJob | Line item thiếu property `_custom_design_id` (khách add to cart bằng nút gốc của theme), hoặc webhook fail — xem Partners → Webhooks |
| `PrismaClientInitializationError` trên Vercel | Thiếu `DATABASE_URL`/`DIRECT_URL`, hoặc quên `?pgbouncer=true&connection_limit=1` ở pooled URL |
| Lỗi parse `shopify.app.toml` | Có `key = value` cấp gốc nằm sau `[section]` — di chuyển lên đầu file |
| Type error khi build sau khi sửa customizer | Đã đổi import React → Preact trong source. Hoàn nguyên về `react`; alias chỉ đặt ở `scripts/bundle-extension.mjs` |

Xem log production:
```bash
vercel logs https://wild-king-customizer.vercel.app --follow
```

---

## ✅ Bạn cần làm gì tiếp theo

Trạng thái hiện tại: hạ tầng đã chạy (Vercel + Supabase + OAuth + App Proxy + Theme Extension đều live). Phần còn thiếu chủ yếu là hoàn thiện logic và kiểm thử.

### 🔴 Ưu tiên cao — có bug / rủi ro bảo mật

1. **Sửa lệch key giữa API và UI Dashboard.**
   `GET /api/admin/orders` trả về `{ jobs, draftDesigns }`, nhưng `src/app/page.tsx` lại đọc `orderData.designs` → KPI luôn hiển thị 0. Ngoài ra code lọc theo `status === "READY_FOR_PRODUCTION"` trong khi schema chỉ có `NEW`/`IN_PRODUCTION`/`QC`/`SHIPPED`. Cần thống nhất tên trường và tập status.

2. ~~**Bổ sung xác thực cho `/api/admin/*`.**~~ ✅ **Đã xong (P0).** Mọi route `/api/admin/*` verify session token của App Bridge qua `requireAdminSession()` và đối chiếu shop với `WK_ALLOWED_SHOPS`.

3. **`/api/cart/validate` vẫn hardcode fallback.**
   Chữ ký App Proxy **đã được kiểm** (P0), nhưng `shop` vẫn mặc định về `wildandking-demo.myshopify.com`, `productId` fallback `"8129384729101"`, giá fallback `65`. P1 sẽ thay thế route này.

4. **Kiểm thử webhook thật.** Đặt một đơn hàng test có `_custom_design_id` và xác nhận `ProductionJob` được tạo. Đây là mắt xích chưa được verify end-to-end.

### 🟡 Ưu tiên trung bình

5. **Xóa `src/app/admin/page.tsx`** — code cũ trùng chức năng với `src/app/page.tsx`, dễ gây nhầm khi sửa nhầm file.
6. **Chuyển sang Prisma migration có version** (`prisma migrate`) thay cho `db push`, để thay đổi schema production có thể audit và rollback.
7. **Xóa `prisma/dev.db`** — tàn dư SQLite, dự án đã dùng Postgres.
8. **Commit thay đổi đang treo:** `shopify.app.toml` đang có sửa đổi chưa commit (Shopify CLI tự sắp xếp lại + đổi `app_proxy.url` thành URL tuyệt đối).
9. **Bỏ `console.log`/`console.error` rải rác** trong các API route, thay bằng logger có cấu trúc.

### 🟢 Nên có

10. **Mở rộng test** — `npm test` (Vitest) đã phủ `hmac.ts`, session token, guard `/api/admin/*`, guard `/api/cart/validate` và validate shop domain. Còn thiếu: `pricingEngine.ts` (unit) và luồng add-to-cart (E2E).
11. **Upload ảnh preview thiết kế** — `Design.previewUrl` đã có trong schema nhưng chưa có luồng sinh/upload ảnh (cân nhắc Supabase Storage).
12. **Xuất file cho xưởng** — nút tải PDF/PNG spec sản xuất từ tab Production Queue.
13. **CRUD OptionGroup/OptionValue trong Admin UI** — hiện chỉ upsert được `ProductConfig`; muốn thêm màu da mới vẫn phải sửa `seed.mjs` hoặc vào Prisma Studio.
14. **Thống nhất API version** — `shopify.app.toml` khai `2026-10`, `src/lib/shopify.ts` dùng `ApiVersion.October24`, `executeShopifyGraphQL` hardcode `2024-10`.

---

## 📚 Liên kết

- [Shopify Theme App Extensions](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions)
- [Shopify App Proxy](https://shopify.dev/docs/apps/build/online-store/display-dynamic-data)
- [Shopify CLI configuration](https://shopify.dev/docs/apps/tools/cli/configuration)
- [Prisma + Supabase](https://www.prisma.io/docs/orm/overview/databases/supabase)
- [Next.js App Router](https://nextjs.org/docs/app)
