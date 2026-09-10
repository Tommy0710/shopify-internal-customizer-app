# 🗺️ Bản đồ file & thư mục — Wild & King Customizer

Giải thích **từng file/thư mục** trong repo: dùng để làm gì, có cần thiết không, xóa được không.

Ký hiệu mức độ cần thiết:

| Ký hiệu | Nghĩa |
|---|---|
| 🟢 **Bắt buộc** | Xóa là app hỏng / không build / không deploy được |
| 🔵 **Cần cho dev** | Không ảnh hưởng production nhưng mất công cụ làm việc |
| 🟡 **Đang chết** | Code chạy được nhưng **hiện không ai gọi tới** — hoặc nối lại, hoặc xóa |
| 🔴 **Thừa** | Xóa được ngay, không mất gì |

---

## 1. Cấu hình gốc

| File | Vai trò | Mức độ |
|---|---|---|
| `package.json` | Scripts (`dev`, `build`, `bundle:extension`, `shopify:deploy`…) + dependency. Khai cả `prisma.seed`. | 🟢 Bắt buộc |
| `package-lock.json` | Khóa version dependency. Vercel build dựa vào file này. | 🟢 Bắt buộc |
| `tsconfig.json` | TypeScript config. Quan trọng: alias `@/*` → `./src/*`, và **`exclude: ["extensions"]`** để bundle JS đã minify không bị type-check. | 🟢 Bắt buộc |
| `next.config.mjs` | Chỉ làm 2 việc, nhưng thiếu là chết: CSP `frame-ancestors` cho `/admin/*` (không có → iframe trong Shopify Admin trắng trang) và CORS cho `/api/proxy/*`. | 🟢 Bắt buộc |
| `tailwind.config.ts` | Tailwind cho **admin UI**. `content` quét `src/app`, `src/components`, `src/pages`, `src/storefront-customizer`. Có palette `shopify.*` tùy chỉnh. | 🟢 Bắt buộc |
| `postcss.config.mjs` | Nạp tailwind + autoprefixer. | 🟢 Bắt buộc |
| `shopify.app.toml` | ⭐ Trái tim cấu hình Shopify: `client_id`, `application_url`, `access_scopes`, `redirect_urls`, `[webhooks]`, `[app_proxy]`. Sửa file này rồi **phải** `npm run shopify:deploy` mới có hiệu lực. | 🟢 Bắt buộc |
| `.env.example` | Mẫu biến môi trường. File `.env` thật bị gitignore. | 🔵 Cần cho dev |
| `.gitignore` | Chặn commit `.env`, `node_modules`, `.next`, `.shopify`, `.DS_Store`… | 🟢 Bắt buộc |
| `.npmrc` | Chỉ 1 dòng `ignore-scripts=false` — để postinstall của Shopify CLI và Prisma chạy được. | 🟢 Bắt buộc |
| `.theme-check.yml` (gốc) | Nới giới hạn kích thước JS cho theme check. **Trùng y hệt** file cùng tên trong `extensions/product-customizer-block/`. Theme check chạy trong thư mục extension nên bản gốc không có tác dụng. | 🔴 Thừa — xóa được |
| `README.md` | Tài liệu vận hành đầy đủ. ⚠️ Đang chứa **credential production thật** (API secret + password DB) → repo bắt buộc private. | 🟢 Bắt buộc |
| `CLAUDE.md` | Hướng dẫn kiến trúc cho Claude Code. | 🔵 Cần cho dev |
| `.DS_Store` | Rác của macOS Finder. Đã bị gitignore. | 🔴 Thừa — xóa được |

---

## 2. `src/app/` — Next.js App Router

### 2.1 Khung ứng dụng

| File | Vai trò | Mức độ |
|---|---|---|
| `layout.tsx` | Root layout. Nạp `globals.css`, thẻ `<meta name="shopify-api-key">` + script **App Bridge** (bắt buộc để nhúng vào Shopify Admin), và Google Fonts cho 5 font khắc laser. | 🟢 Bắt buộc |
| `globals.css` | 3 dòng `@tailwind` + reset body. | 🟢 Bắt buộc |
| `page.tsx` | **Đây mới là trang admin đang chạy thật** (route `/`, chính là màn hình merchant thấy trong Shopify Admin). Dạng tab: Dashboard / Products / Orders — import lại `admin/products/page` và `admin/orders/page` làm nội dung tab. ⚠️ Có bug: đọc `orderData.designs` trong khi API trả `{ jobs, draftDesigns }` → KPI luôn bằng 0; lọc status `READY_FOR_PRODUCTION` không tồn tại trong schema. | 🟢 Bắt buộc (cần sửa bug) |
| `storefront-preview/page.tsx` | Trang giả lập storefront để test widget mà không cần vào Shopify. Có nút bắn webhook `orders/create` giả. ⚠️ Truyền `proxyUrl="/api/cart/validate"` nhưng widget lại nối thêm `/save-design` → gọi vào URL không tồn tại. | 🔵 Cần cho dev (đang lỗi) |

### 2.2 Cây route `/admin/*` — bản cũ trùng chức năng

| File | Vai trò | Mức độ |
|---|---|---|
| `admin/layout.tsx` | Header + nav riêng cho `/admin/*`. Chỉ áp dụng cho cây route này, `page.tsx` ở gốc không dùng. Import `Sparkles` nhưng không xài. | 🟡 Đang chết |
| `admin/page.tsx` | Dashboard KPI dạng Server Component (đếm trực tiếp bằng Prisma — thực ra **đúng hơn** bản client ở `page.tsx`). Trùng chức năng với tab Dashboard của `page.tsx`. | 🟡 Đang chết |
| `admin/products/page.tsx` | Form CRUD `ProductConfig`. **Vừa là route `/admin/products` vừa là tab Products của `page.tsx`** → không xóa được. Hiện chỉ upsert được `ProductConfig`, chưa CRUD được `OptionGroup`/`OptionValue`. | 🟢 Bắt buộc |
| `admin/orders/page.tsx` | Bảng hàng chờ sản xuất, đổi status NEW→IN_PRODUCTION→QC→SHIPPED. Cũng dùng chung 2 chỗ như trên. | 🟢 Bắt buộc |

> 👉 Việc nên làm: xóa `admin/layout.tsx` + `admin/page.tsx`, di chuyển 2 file còn lại ra `src/components/` để không còn là route.

### 2.3 `src/app/api/` — API routes

**OAuth**

| File | Vai trò | Mức độ |
|---|---|---|
| `api/auth/route.ts` | Điểm khởi đầu cài app: `?shop=xxx` → redirect sang màn hình authorize của Shopify. | 🟢 Bắt buộc |
| `api/auth/callback/route.ts` | Shopify gọi lại với `code` + `hmac` → verify HMAC → đổi lấy `access_token` → lưu bảng `Shop` → redirect vào admin app. | 🟢 Bắt buộc |

**App Proxy** (Shopify chuyển tiếp `https://<shop>/apps/customizer/*` → `/api/proxy/*`, kèm chữ ký HMAC)

| File | Vai trò | Mức độ |
|---|---|---|
| `api/proxy/save-design/route.ts` | **Endpoint duy nhất widget đang thật sự gọi.** Lưu design (engraving, font, màu, ảnh, raw JSON) → trả `designId`. Có handler `OPTIONS` cho CORS preflight. | 🟢 Bắt buộc |
| `api/proxy/customizer-config/route.ts` | Trả `ProductConfig` + option groups + values + rules cho widget. **Widget hiện không gọi** — nó dùng mảng option hardcode trong `CustomizerApp.tsx`. | 🟡 Đang chết (nên nối lại) |

**Nghiệp vụ**

| File | Vai trò | Mức độ |
|---|---|---|
| `api/cart/validate/route.ts` | Luồng "đúng" theo thiết kế: tính lại giá bằng `pricingEngine` → tạo `Design` + `DesignSelection` → trả `summaryProperties` có `_custom_design_id`. **Không ai gọi.** Ngoài ra chưa verify HMAC và hardcode fallback (`shop` = demo store, `productId` = `8129384729101`, giá = 65). | 🟡 Đang chết (rủi ro bảo mật khi bật lại) |
| `api/admin/products/route.ts` | `GET` list config, `POST` upsert `ProductConfig`. ⚠️ **Không có xác thực** — ai biết URL đều gọi được. | 🟢 Bắt buộc (cần thêm auth) |
| `api/admin/orders/route.ts` | `GET` list `ProductionJob` + design chưa có job, `PATCH` đổi status. ⚠️ **Không có xác thực.** | 🟢 Bắt buộc (cần thêm auth) |

**Webhooks**

| File | Vai trò | Mức độ |
|---|---|---|
| `api/webhooks/orders-create/route.ts` | Nhận `orders/create` + `orders/paid` → tìm property `_custom_design_id` trong từng line item → `Design.status = ORDERED` + tạo `ProductionJob`. Mắt xích nối Shopify ↔ xưởng sản xuất. | 🟢 Bắt buộc |
| `api/webhooks/app-uninstalled/route.ts` | Đánh dấu `Shop.installed = false` khi gỡ app. | 🟢 Bắt buộc |

---

## 3. `src/lib/` — thư viện dùng chung

| File | Vai trò | Mức độ |
|---|---|---|
| `db.ts` | Prisma Client singleton (giữ trên `globalThis` ở dev để hot-reload không tạo connection mới). | 🟢 Bắt buộc |
| `hmac.ts` | 2 hàm verify: `verifyShopifyProxySignature` (hex, query sort alphabet, **nối không dấu phân cách**) và `verifyShopifyWebhook` (**base64** của raw body). Dùng `timingSafeEqual`. | 🟢 Bắt buộc |
| `pricing/pricingEngine.ts` | `calculateServerPrice()` — đọc `extraPrice` từ DB, cộng dồn, kiểm option `required`, kiểm `CompatibilityRule`. Là **nguồn giá duy nhất được tin**. Chỉ được gọi bởi `api/cart/validate` (đang chết) → hiện cũng chết theo. ⚠️ Nhận `PriceRule` từ DB nhưng **chưa hề áp dụng** logic của nó. | 🟡 Đang chết (nhưng đừng xóa — cần nối lại) |
| `shopify.ts` | Khởi tạo `@shopify/shopify-api` + helper `executeShopifyGraphQL`. **Không file nào import.** API version cũng lệch (`October24` vs `2024-10` hardcode vs `2026-10` trong toml). | 🟡 Đang chết |

---

## 4. `src/storefront-customizer/` — widget chạy trên storefront

| File | Vai trò | Mức độ |
|---|---|---|
| `index.tsx` | Entry point của bundle. Tìm `#product-customizer-root`, đọc toàn bộ `data-*` attribute, mount React. Có cờ `data-mounted` chống mount trùng, và lắng nghe `shopify:section:load` để re-mount khi merchant chỉnh trong Theme Customizer. | 🟢 Bắt buộc |
| `CustomizerApp.tsx` | Toàn bộ UI tùy chỉnh (da / khóa / lug width / chỉ khâu / khắc laser + font) và logic add-to-cart. ⚠️ **Danh sách option đang hardcode trong file** (`LEATHER_MATERIALS`, `BUCKLE_OPTIONS`, `LUG_WIDTHS`, `STITCH_COLORS`) → sửa giá/màu trong Admin không có tác dụng gì lên storefront. Cũng tự tính `totalExtraPrice` ở client rồi gửi thẳng lên cart. Hàm `handleImageUpload` được viết nhưng không có input nào gọi. | 🟢 Bắt buộc (cần sửa lớn) |

> Component này **dùng chung** cho cả bundle storefront lẫn trang `/storefront-preview`, nên phải import `react` thật. Việc đổi sang Preact chỉ làm ở tầng bundler.

---

## 5. `extensions/product-customizer-block/` — Theme App Extension

| File | Vai trò | Mức độ |
|---|---|---|
| `shopify.extension.toml` | Khai `name`, `type = "theme"`, và **`uid`** — định danh extension trên Shopify. **Đổi `uid` = tạo extension mới, mất liên kết với theme đang chạy.** | 🟢 Bắt buộc |
| `blocks/customizer.liquid` | App Block. `{% schema %}` khai 3 setting merchant chỉnh được trong Theme Editor (tiêu đề, chữ nút, màu chủ đạo) + trỏ `stylesheet` và `javascript`. Phần HTML render `<div id="product-customizer-root">` với đầy đủ `data-*` và placeholder loading. | 🟢 Bắt buộc |
| `assets/customizer.css` | CSS cho widget (`spc-*`). Viết tay, **không dùng Tailwind** (Tailwind chỉ dành cho admin). | 🟢 Bắt buộc |
| `assets/customizer-bundle.js` | **File sinh tự động** bởi `npm run bundle:extension` — 1 dòng, đã minify. Vẫn phải commit vì Shopify CLI cần nó lúc deploy. **Tuyệt đối không sửa tay** — mọi thay đổi bị ghi đè ở lần build kế. | 🟢 Bắt buộc (nhưng là artifact) |
| `locales/en.default.json` | Tên hiển thị của extension. Shopify **bắt buộc** phải có file locale mặc định. | 🟢 Bắt buộc |
| `.theme-check.yml` | Tắt cảnh báo kích thước JS (bundle React vượt ngưỡng mặc định). | 🟢 Bắt buộc |

---

## 6. `prisma/`

| File | Vai trò | Mức độ |
|---|---|---|
| `schema.prisma` | 8 model: `Shop`, `ProductConfig` → `OptionGroup` → `OptionValue`, `CompatibilityRule`, `PriceRule`, `Design` → `DesignSelection`, `ProductionJob`. Dùng `DATABASE_URL` (pooled 6543) + `directUrl` (5432). | 🟢 Bắt buộc |
| `seed.mjs` | Nạp shop demo + config "Custom Bespoke Watch Strap" đầy đủ option groups. Cũng là **nơi duy nhất** hiện thêm được option value mới (Admin UI chưa làm được). | 🔵 Cần cho dev |

> ⚠️ `CompatibilityRule.thenDisallowOptionValueIds` và `PriceRule.conditionOptionValueIds` là **String chứa JSON array**, không phải array Postgres — luôn phải `JSON.parse()`.

---

## 7. `scripts/`

| File | Vai trò | Mức độ |
|---|---|---|
| `bundle-extension.mjs` | esbuild: `src/storefront-customizer/index.tsx` → `extensions/.../assets/customizer-bundle.js`. Điểm mấu chốt: **alias `react`/`react-dom` → `preact/compat`** (~130KB → ~8KB) mà không cần sửa import trong source. Loader `.png` → dataurl, `.svg` → text. | 🟢 Bắt buộc |

---

## 8. `packages/shared-types/`

| File | Vai trò | Mức độ |
|---|---|---|
| `src/config.ts` | Interface `OptionValue`, `OptionGroup`, `CompatibilityRule`, `PriceRule`, `ProductCustomizerConfig`. | 🔴 Thừa |
| `src/design.ts` | Interface `CustomDesignSelection`, `CustomDesignInput`, `CustomDesignPayload`. | 🔴 Thừa |
| `src/api.ts` | Interface request/response cho các API. | 🔴 Thừa |
| `src/index.ts` | Re-export 3 file trên. | 🔴 Thừa |

> Thư mục này **không có `package.json`, không có path alias trong `tsconfig.json`, và không file nào import**. Đây là tàn dư của ý tưởng monorepo chưa hoàn thành. Type đang bị định nghĩa lặp lại rải rác trong `src/app/admin/*/page.tsx` và `pricingEngine.ts`.
>
> **Hai lựa chọn:** (a) xóa hẳn, hoặc (b) nối lại — thêm `"@shared/*": ["./packages/shared-types/src/*"]` vào `tsconfig.json` rồi dùng chung cho cả admin, API và widget. Cách (b) tốt hơn, vì đúng những type này sẽ chống được đúng loại bug đang có ở `page.tsx` (`designs` vs `jobs`).

---

## 9. `web/`

| File | Vai trò | Mức độ |
|---|---|---|
| `shopify.web.toml` | Nói cho Shopify CLI biết đây là backend, chạy ở port 3000, lệnh dev/build là gì. Không có file này thì `shopify app dev` không biết khởi động app ra sao. | 🟢 Bắt buộc |
| `package.json` | Shim mỏng, mọi script đều `npm --prefix .. run <x>`. Chỉ tồn tại vì Shopify CLI kỳ vọng mỗi "web" là một package. | 🟢 Bắt buộc |

---

## 10. Dependency thừa trong `package.json`

| Package | Tình trạng |
|---|---|
| `clsx` | Không file nào import → 🔴 gỡ được |
| `tailwind-merge` | Không file nào import → 🔴 gỡ được |
| `@shopify/theme` | Không thấy dùng trong script nào (`@shopify/cli` đã đủ) → 🟡 kiểm tra lại trước khi gỡ |

---

## 📋 Tóm tắt: xóa gì được ngay

**An toàn tuyệt đối:**
- `.DS_Store`
- `.theme-check.yml` ở thư mục gốc (bản trong `extensions/` mới là bản có tác dụng)
- Dependency `clsx`, `tailwind-merge`

**Nên xóa sau khi xác nhận không ai dùng route `/admin/*`:**
- `src/app/admin/layout.tsx`
- `src/app/admin/page.tsx`

**Đừng xóa dù đang chết — đây là phần còn thiếu, không phải rác:**
- `src/lib/pricing/pricingEngine.ts` + `src/app/api/cart/validate/route.ts` + `src/app/api/proxy/customizer-config/route.ts`

  Ba file này là luồng "giá tính ở server" đúng chuẩn. Widget hiện tự tính giá ở client và bỏ qua chúng — nghĩa là **khách có thể sửa JS để đổi giá**. Việc cần làm là sửa `CustomizerApp.tsx` để: (1) fetch option từ `/apps/customizer/customizer-config` thay vì hardcode, (2) gọi `/api/cart/validate` (nên chuyển thành `/api/proxy/cart-validate` để có HMAC) trước khi add-to-cart.

- `packages/shared-types/` — nên nối vào `tsconfig.json` thay vì xóa.
- `src/lib/shopify.ts` — giữ lại nếu sắp gọi Admin GraphQL API; xóa nếu không.
