# Wild & King Customizer — Thiết kế lại toàn bộ (Design Spec)

- **Ngày:** 2026-09-08
- **Trạng thái:** Đã duyệt, sẵn sàng lập kế hoạch triển khai
- **Thay thế:** toàn bộ schema nghiệp vụ, admin UI và storefront customizer hiện tại
- **Tài liệu bắt buộc đọc kèm:** `docs/SVG_CUSTOMIZER_ACTION_GUIDE.md` (hợp đồng SVG — nguồn sự thật)

---

## 1. Bối cảnh và mục tiêu

Wild & King bán card holder da thủ công tuỳ chỉnh. Khách chọn **Style**, **Body leather**, **Animal**, **Animal leather**, **Stitch** ngay trên trang sản phẩm; preview SVG cập nhật tức thì; thêm vào giỏ với đúng giá do Shopify quản lý; đơn hàng sinh ra bản ghi sản xuất bất biến.

App hiện tại có hạ tầng đúng (OAuth, App Proxy, Theme App Extension, Vercel, Supabase) nhưng **toàn bộ tầng nghiệp vụ sai mô hình**: schema kiểu "option group" generic, storefront hardcode option và tự tính giá ở client, admin ba tab không khớp nhu cầu, `/api/admin/*` không có xác thực.

**Mục tiêu:**
1. Admin đúng **hai tab**: Attributes và Products.
2. Storefront render SVG thật theo hợp đồng trong action guide, không iframe.
3. Shopify là **nguồn sự thật duy nhất về giá**; browser không bao giờ gửi giá lên.
4. Số variant tăng **tuyến tính** khi thêm style/animal/leather, không nhân bội.
5. DB giữ snapshot bất biến đủ để sản xuất và tái dựng hình.

---

## 2. Phạm vi

### Trong phạm vi (MVP)
- Session token auth cho admin; rotate credential đã lộ.
- Schema mới hoàn chỉnh, drop toàn bộ bảng cũ.
- Supabase Storage cho SVG, texture, display image, baked design SVG.
- SVG sanitizer + validator theo hợp đồng `animal-*`.
- Admin 2 tab, gồm bộ sinh variant Shopify.
- SVG engine dùng chung storefront + admin + validator.
- App Block mới (Shadow DOM), 5 lựa chọn, preview live.
- Add to cart 2 dòng, cart/drawer đã custom, đồng bộ qty/remove.
- Webhook idempotency 2 lớp + đối soát nhóm dòng.
- Hàng chờ sản xuất trong admin.
- Deep link chia sẻ design.

### Ngoài phạm vi (Phase 2+)
- Shopify Cart Transform / Cart Validation Function.
- Render PNG/PDF bằng headless browser.
- Rule engine loại trừ tổ hợp.
- Bulk import attribute (CSV).
- i18n đa ngôn ngữ (MVP: English 100%).
- Upload artwork tự do từ khách.

---

## 3. Nguyên tắc kiến trúc

1. **Server không tin bất kỳ giá trị nào ngoài ID mờ.** Client gửi `styleId`, `leatherId`, `animalId`, `animalLeatherId`, `stitchId`. Mọi label, hex, URL, variant, giá đều do server tra ngược từ DB.
2. **Shopify tính tiền.** Số tiền khách thực trả luôn do Shopify tính từ `variantId`. Client không bao giờ gửi giá lên; server không bao giờ gửi giá xuống để tính tiền.
3. **Giá *hiển thị* ưu tiên Liquid, có fallback snapshot.** Variant nằm trên trang hiện tại lấy từ `product.variants | json`. Variant thuộc product khác (dòng phụ phí, hoặc khi đóng gói N-product) không với tới được bằng Liquid — dùng `variantPriceSnapshot` từ config, và **mọi đơn được đối soát tổng với `quotedTotal` ở webhook** (§11.2). Snapshot chỉ sai được trong khoảng giữa hai lần sync, và sai lệch đó bị bắt ở webhook chứ không bao giờ ảnh hưởng số tiền thu.
4. **Variant tạo một lần lúc cấu hình**, không bao giờ tạo hoặc xoá lúc bán hàng.
5. **Attribute không bao giờ hard-delete**, chỉ `archivedAt`.
6. **Một implementation cho SVG contract**, dùng chung ba nơi.
7. **Phát hiện thay vì chặn** với các vector giả mạo còn lại; webhook gắn cờ, người thật xử lý.

---

## 4. Mô hình thương mại Shopify

### 4.1. Công thức giá

```
giá = f(style, bodyLeather)  +  f(animal, animalLeather)
      └── ma trận A ──┘         └── ma trận B ──┘
```

Hai ma trận **2 chiều độc lập**. Giá con vật không phụ thuộc style. Stitch và edge paint miễn phí.

Điều này tránh được ma trận 4 chiều (`10 × 8 × 8 × 10 = 64.000` tổ hợp) — vốn bất khả thi vì Shopify chỉ cho **3 option/product** và trần variant là 100 (2048 với product API mới, cần xác minh theo plan).

**Tăng trưởng tuyến tính:** thêm 1 animal = `+ (số leather)` variant, không phải nhân bội.

### 4.2. Hai dòng giỏ hàng

| | Vai trò | Nguồn variant | Cart | Checkout |
|---|---|---|---|---|
| ① | Dòng chính — thân ví | ma trận A | Hiện, mang ảnh preview và tổng của cả nhóm | Hiện |
| ② | Dòng phụ phí — con vật | ma trận B | **Ẩn** | Hiện (Shopify không cho sửa) |

Ẩn dòng ② trong cart khiến khách **không có nút Remove** cho nó — loại bỏ được rủi ro xoá lẻ.

### 4.3. Đóng gói variant — bộ sinh tự chọn

DB chỉ lưu `shopifyVariantId` cho từng cặp. Việc các variant nằm trong 1 hay N product là chi tiết của bộ sinh:

| Điều kiện | Đóng gói | Ví dụ hiển thị |
|---|---|---|
| `styles × leathers <= 100` | 1 product, 2 option | `Custom Card Holder` — `Minimalist / Suede Brown` |
| `> 100` | 1 product mỗi style, 1 option | `Custom Card Holder — Minimalist` — `Suede Brown` |

Tương tự cho ma trận B (`Animal Applique` gộp, hoặc `Alligator Applique` tách).

Admin hiện trước con số và phương án trước khi bấm xác nhận. Schema, API, storefront, webhook **không đổi** giữa hai cách đóng gói.

### 4.4. Line item properties

Dòng ①:
```
_wk_design_id   cd_7hK9mQ…      hidden
_wk_role        main            hidden
_wk_preview     https://…svg    hidden
_wk_v           1               hidden
Animal          Alligator       visible
Animal Leather  Togo Brown      visible
Stitch          Gold            visible
```

Dòng ②:
```
_wk_design_id   cd_7hK9mQ…      hidden
_wk_role        addon           hidden
_wk_v           1               hidden
```

`Style` và `Body Leather` **không lặp lại** — variant title đã mang chúng.

Property tiền tố `_` bị ẩn khỏi cart/checkout của khách nhưng **vẫn hiện trong Order admin**.

**Không đưa vào properties:** JSON đầy đủ, giá, hex, tên file SVG.

### 4.5. Sinh variant bằng Admin GraphQL

Dùng `productSet` (khai báo toàn bộ product + options + variants trong một mutation). Fallback: `productOptionsCreate` + `productVariantsBulkCreate` / `productVariantsBulkUpdate`.

Bộ sinh gán luôn **variant image**:
- Ma trận A → display image của leather.
- Ma trận B → display image của animal.

Ghi ngược `shopifyVariantId`, `shopifyVariantGid`, `variantPriceSnapshot`, `variantSyncedAt` vào DB.

> **Nợ kỹ thuật phải trả trong P1:** API version hiện lệch ba chỗ — `shopify.app.toml` khai `2026-10`, `src/lib/shopify.ts` dùng `ApiVersion.October24`, `executeShopifyGraphQL` hardcode `2024-10`. Chốt **một** version duy nhất, khai trong một hằng số, dùng ở mọi nơi.

---

## 5. Kiến trúc hệ thống

```
SHOPIFY STOREFRONT
  Product page → App Block (customizer.liquid)
    ├ <div data-wk-customizer data-product-id data-shop-domain data-proxy-prefix …>
    └ <script type="application/json" id="wk-variants">{{ product.variants | json }}</script>
                    │ mount vào SHADOW ROOT (không iframe)
                    ▼
        customizer-bundle.js  (preact qua alias, ~25KB gz)
          ├ svg-engine/  (hàm thuần: validate · applyTexture · applyStitch · loader race-guard)
          └ ui/          (5 swatch grid · giá từ wk-variants · CTA)
                    │
        GET  /apps/customizer/config          POST /apps/customizer/designs
        GET  /apps/customizer/designs/:token  (deep link)
                    │ App Proxy, HMAC ký bởi Shopify
                    ▼
VERCEL — Next.js 14 App Router
  /api/proxy/*      HMAC proxy
  /api/admin/*      session token (JWT) + shop allowlist
  /api/webhooks/*   HMAC base64 trên raw body
  src/shared/       zod schema + type (server & admin)
  src/svg-engine/   hàm thuần — dùng chung 3 nơi
                    │
      ┌─────────────┴──────────────┐
      ▼                            ▼
Supabase Postgres            Supabase Storage (CDN, public read)
  pooled 6543 runtime          svg_mockup/{sha256}.svg  đã sanitize
  direct 5432 migrate          texture/{sha256}.webp
                               display/{sha256}.webp
                               design_svg/{sha256}.svg  baked
                               (thư mục = AssetKind viết thường — storagePathFor)
```

### 5.1. Không iframe — dùng Shadow DOM

**Lý do kỹ thuật cần cách ly:**
1. Theme Shopify hầu như luôn có reset kiểu `svg { max-width:100%; height:auto }` — đủ để bóp méo mockup dựa trên `viewBox` + `preserveAspectRatio`.
2. SVG chứa khoảng 120 ID toàn cục (`stitch-clip-01`…`wallet-body-clip`). Trùng ID với theme khiến `url(#wallet-body-clip)` bind nhầm và artwork tràn ra ngoài hình ví.

Shadow DOM giải quyết cả hai mà vẫn giữ `/cart/add.js` same-origin, không postMessage, không double-fetch. Thuộc tính kế thừa (font, color) vẫn xuyên qua shadow boundary nên widget hoà vào theme.

**Rủi ro cần spike ngày đầu P3:** Safari từng có bug resolve `filter: url(#…)` trong shadow root. SVG dùng `feTurbulence`, `feDropShadow`, `mix-blend-mode: soft-light`.

**Fallback đã định:** light DOM + prefix mọi ID bằng `wk-<mountId>-` lúc inject (rewrite `id=`, `href="#…"`, `url(#…)` bằng một hàm thuần, test được).

### 5.2. Bundle

Giữ nguyên trick alias `react`/`react-dom` → `preact/compat` trong `scripts/bundle-extension.mjs`. **Không đổi import trong source** — đã từng gây type incompatibility.

`src/shared/` dùng zod cho server và admin. Storefront **chỉ import `type`** (0 byte runtime) và validate thủ công nhẹ, để giữ bundle nhỏ.

---

## 6. SVG contract và engine

### 6.1. Hợp đồng bắt buộc

Theo `docs/SVG_CUSTOMIZER_ACTION_GUIDE.md` §2. Mỗi SVG phải có **đúng một** phần tử cho mỗi ID:

| ID | Element | Vai trò |
|---|---|---|
| `wallet-preview` | `<svg>` | Root |
| `wallet-body-shape` | shape | Hình học thân ví |
| `animal-shape` | shape | Hình học con vật |
| `wallet-body-clip` | `<clipPath>` | Cắt artwork theo thân ví |
| `animal-clip` | `<clipPath>` | Cắt artwork theo con vật |
| `body-artwork` | `<image>` | Đích nhận texture thân ví |
| `animal-artwork` | `<image>` | Đích nhận texture con vật |
| `stitches` | `<g>` | Nhóm chỉ, `fill="var(--wallet-stitches)"` |

**Chỉ chấp nhận contract `animal-*`.** File dùng `fish-*` bị từ chối kèm hint rõ ràng. Không hỗ trợ song song hai bộ ID (guide §2 cấm).

Hai file demo hiện có (`fish.svg`, `crocodile.svg`) phải migrate `fish-shape`/`fish-clip`/`fish-artwork`/`fish-outline` → `animal-*`, cập nhật mọi `href="#…"` và `url(#…)` liên quan, trước khi upload.

### 6.2. Thao tác runtime

```
Đổi body leather    → setImageHref(root, 'body-artwork',   leather.textureUrl)
Đổi animal leather  → setImageHref(root, 'animal-artwork', leather.textureUrl)
Đổi stitch          → root.style.setProperty('--wallet-stitches', normalizeHex(hex))
Đổi style/animal    → nạp SVG mới (xem 6.3)
```

`setImageHref` đặt `href`, gỡ `hidden`, đặt `visibility="visible"`. Bỏ texture thì ngược lại.

Các ngăn ví tự cập nhật theo vì chúng dùng `<use href="#body-artwork">` — không cần logic riêng.

Texture là **URL bền vững từ CDN**, không phải `blob:`. Không cần `revokeObjectURL`. Không bao giờ có `blob:` trong DB hay cart property.

### 6.3. Vòng đời đổi mockup

```
seq = ++sequence                       // race guard
fetch(svgUrl) → text
DOMParser(…, "image/svg+xml")
validateContract(doc)
  ├ fail → giữ preview cũ, hiện lỗi, revert lựa chọn
  └ ok   → if (seq !== sequence) return        // response cũ đến trễ: bỏ
           importNode → replaceWith
           RE-QUERY #body-artwork / #animal-artwork    // ref cũ đã chết
           apply lại cả hai texture + stitch hiện tại
           nếu khách CHƯA tự chọn stitch → dùng defaultStitchId của mockup mới
```

Port từ `test svg/src/mockups.js` (`createMockupLoader`) và `test svg/src/app.js`.

### 6.4. Chuẩn hoá màu

Port `normalizeHex` từ `test svg/src/stitches-color.js`: `#abc` → `#AABBCC`, `aabbcc` → `#AABBCC`, giá trị không hợp lệ **không được ghi vào SVG**.

Server chuẩn hoá `Stitch.colorHex` lúc ghi DB; storefront nhận hex đã chuẩn.

### 6.5. Validator (server-side, lúc upload)

Chạy trên Node bằng `linkedom`. Kiểm tra:
- Root là `<svg>` trong namespace `http://www.w3.org/2000/svg`, `id="wallet-preview"`.
- Không có lỗi parse.
- Mỗi ID bắt buộc xuất hiện **đúng một lần**.
- `body-artwork` và `animal-artwork` thực sự là `<image>`.
- Mỗi artwork target tham chiếu đúng `clipPath` tương ứng.
- `#stitches` dùng `var(--wallet-stitches)` cho màu chính.
- Mọi `href="#…"` và `url(#…)` trỏ tới ID tồn tại.
- Không có `<script>`, `<foreignObject>`, thuộc tính `on*`, hay external resource ngoài allowlist.

**Allowlist ID là hằng số compile-time.** Không bao giờ nối chuỗi từ input vào selector (guide §8).

Trả về báo cáo từng ID (xem 8.1) để admin sửa file chính xác.

### 6.6. Baked design SVG

Lúc tạo design, server sinh một SVG hoàn chỉnh với texture và màu chỉ **ghi cứng**:

```
master SVG + bodyTextureUrl + animalTextureUrl + stitchHex
    ↓ linkedom, thuần DOM, không cần browser
design-<sha256>.svg → Supabase Storage → Asset(kind = DESIGN_SVG)
```

Lợi ích:
- **Bất biến thật.** Admin thay master SVG sau này, đơn cũ vẫn mở đúng hình đã bán.
- **Xưởng mở được ngay** bằng browser hoặc Illustrator, in không vỡ.
- **Tự dedupe** nhờ `@@unique([shopId, kind, checksumSha256])`. Storage tăng theo số **tổ hợp**, không theo số **đơn**.

URL của file này đi vào `_wk_preview` để cart hiển thị.

---

## 7. Database schema

PostgreSQL qua Prisma. `DATABASE_URL` pooled (6543, `?pgbouncer=true&connection_limit=1`), `DIRECT_URL` direct (5432) cho migrate.

Mọi bảng nghiệp vụ mang `shopId` — sẵn sàng multi-shop dù hiện chỉ một.

**Quy ước quan hệ:** schema dưới viết các khoá ngoại dưới dạng cột `String` cho gọn. Khi hiện thực hoá bằng Prisma, khai `@relation` thật cho **mọi** tham chiếu cấu hình (`Leather.displayImageAssetId`, `ProductStyleLeather.leatherId`, `ProductStyleAnimal.svgAssetId`…). **Ngoại lệ có chủ ý:** `CustomDesign.*Id` và `CustomDesignSelection.attributeId` giữ nguyên dạng soft reference **không có FK** — để archive hoặc xoá attribute không bao giờ phá được đơn cũ. Snapshot mới là nguồn sự thật cho đơn đã đặt.

```prisma
enum AssetKind        { SVG_MOCKUP TEXTURE DISPLAY DESIGN_SVG }
enum DesignStatus     { DRAFT ORDERED CANCELLED }
enum LineRole         { MAIN ADDON }
enum ProductionStatus { NEW IN_PRODUCTION QC SHIPPED ON_HOLD }
enum AttributeType    { STYLE BODY_LEATHER ANIMAL ANIMAL_LEATHER STITCH }

model Shop {
  id          String   @id @default(cuid())
  shopDomain  String   @unique
  accessToken String
  scope       String?
  installed   Boolean  @default(true)
  installedAt DateTime @default(now())
  uninstalledAt DateTime?
  updatedAt   DateTime @updatedAt
}

// ── Thư viện file ─────────────────────────────────────────────
model Asset {
  id               String    @id @default(cuid())
  shopId           String
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

  @@unique([shopId, kind, checksumSha256])
  @@index([shopId, kind, archivedAt])
}

// ── Attributes (phẳng) ────────────────────────────────────────
model Leather {
  id                  String  @id @default(cuid())
  shopId              String
  name                String
  slug                String
  displayImageAssetId String
  textureImageAssetId String
  isActive            Boolean @default(true)
  sortOrder           Int     @default(0)
  archivedAt          DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([shopId, slug])
  @@index([shopId, archivedAt, isActive, sortOrder])
}

model Stitch {
  id                  String  @id @default(cuid())
  shopId              String
  name                String
  slug                String
  displayImageAssetId String?
  colorHex            String            // ^#[0-9A-F]{6}$ — chuẩn hoá lúc ghi
  isActive            Boolean @default(true)
  sortOrder           Int     @default(0)
  archivedAt          DateTime?
  @@unique([shopId, slug])
}

model Animal {
  id                  String  @id @default(cuid())
  shopId              String
  name                String
  slug                String
  displayImageAssetId String
  isActive            Boolean @default(true)
  sortOrder           Int     @default(0)
  archivedAt          DateTime?
  @@unique([shopId, slug])
}

model Style {
  id                  String  @id @default(cuid())
  shopId              String
  name                String
  slug                String
  displayImageAssetId String
  isActive            Boolean @default(true)
  sortOrder           Int     @default(0)
  archivedAt          DateTime?
  @@unique([shopId, slug])
}

// ── Product cấu hình ──────────────────────────────────────────
model CustomizableProduct {
  id        String   @id @default(cuid())
  shopId    String
  name      String                        // nhãn nội bộ
  isEnabled Boolean  @default(false)
  archivedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([shopId, isEnabled])
}

// Trang sản phẩm Shopify nào được phép render customizer này.
// Cần thiết vì bộ sinh có thể đóng gói thành 1 hoặc N Shopify product;
// App Block chỉ biết product.id của trang nó đang đứng.
model ProductHost {
  id               String  @id @default(cuid())
  shopId           String
  productId        String                 // → CustomizableProduct
  shopifyProductId String
  shopifyProductGid String
  handleSnapshot   String?
  titleSnapshot    String?
  preselectStyleId String?                // khi đóng gói 1 product mỗi style
  isPrimary        Boolean @default(false)
  syncedAt         DateTime?

  @@unique([shopId, shopifyProductId])    // ★ 1 trang chỉ thuộc 1 customizer
  @@index([productId])
}

// ── Ma trận A: style × body leather (CÓ GIÁ) ──────────────────
model ProductStyle {
  id        String  @id @default(cuid())
  productId String
  styleId   String
  isActive  Boolean @default(true)
  sortOrder Int     @default(0)
  @@unique([productId, styleId])
}

model ProductStyleLeather {
  id             String @id @default(cuid())
  productStyleId String
  leatherId      String

  shopifyProductId     String
  shopifyVariantId     String
  shopifyVariantGid    String
  variantTitleSnapshot String?
  variantSkuSnapshot   String?
  priceInput           Decimal? @db.Decimal(10,2)   // giá admin gõ vào lưới, chưa chắc đã sync
  variantPriceSnapshot Decimal? @db.Decimal(10,2)   // giá đọc ngược từ Shopify — CHỈ admin xem
  variantSyncedAt      DateTime?
  variantMissing       Boolean  @default(false)

  isActive  Boolean @default(true)
  sortOrder Int     @default(0)

  @@unique([productStyleId, leatherId])
  @@unique([shopifyVariantId])
  @@index([shopifyProductId])
}

// ── Ma trận B: animal × animal leather (CÓ GIÁ, độc lập style) ─
model ProductAnimal {
  id        String  @id @default(cuid())
  productId String
  animalId  String
  isActive  Boolean @default(true)
  sortOrder Int     @default(0)
  @@unique([productId, animalId])
}

model AnimalLeather {
  id              String @id @default(cuid())
  productAnimalId String
  leatherId       String

  shopifyProductId     String
  shopifyVariantId     String
  shopifyVariantGid    String
  variantTitleSnapshot String?
  priceInput           Decimal? @db.Decimal(10,2)   // giá admin gõ vào lưới, chưa chắc đã sync
  variantPriceSnapshot Decimal? @db.Decimal(10,2)
  variantSyncedAt      DateTime?
  variantMissing       Boolean  @default(false)

  isActive  Boolean @default(true)
  sortOrder Int     @default(0)

  @@unique([productAnimalId, leatherId])
  @@unique([shopifyVariantId])
  @@index([shopifyProductId])
}

// ── SVG per Style × Animal ────────────────────────────────────
model ProductStyleAnimal {
  id              String  @id @default(cuid())
  productStyleId  String
  animalId        String
  displayLabel    String?
  description     String?
  svgAssetId      String
  defaultStitchId String?
  isActive        Boolean @default(true)
  sortOrder       Int     @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([productStyleId, animalId])
  @@index([productStyleId, isActive, sortOrder])
}

model ProductStitch {
  id        String  @id @default(cuid())
  productId String
  stitchId  String
  isActive  Boolean @default(true)
  sortOrder Int     @default(0)
  @@unique([productId, stitchId])
}

// ── Design (bất biến) ─────────────────────────────────────────
model CustomDesign {
  id             String @id                    // cd_<nanoid21>
  shopId         String
  productId      String
  status         DesignStatus @default(DRAFT)
  shareToken     String                         // nanoid22, ngẫu nhiên
  idempotencyKey String?

  mainVariantId  String
  addonVariantId String
  quotedTotal    Decimal @db.Decimal(10,2)

  styleId            String?
  styleName          String
  bodyLeatherId      String?
  bodyLeatherName    String
  bodyTextureAssetId String
  animalId           String?
  animalName         String
  animalLeatherId    String?
  animalLeatherName  String
  animalTextureAssetId String
  stitchId           String?
  stitchName         String
  stitchHex          String

  svgAssetId      String
  bakedSvgAssetId String

  snapshot        Json
  snapshotVersion Int  @default(1)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([shopId, shareToken])
  @@unique([shopId, idempotencyKey])
  @@index([shopId, status, createdAt])
  @@index([shopId, mainVariantId])
}

model CustomDesignSelection {
  id            String        @id @default(cuid())
  designId      String
  attributeType AttributeType
  attributeId   String                          // soft ref, KHÔNG FK
  label         String
  value         String
  colorHex      String?
  assetId       String?
  sortOrder     Int

  @@unique([designId, attributeType])
  @@index([designId])
}

// ── Đơn hàng + sản xuất ───────────────────────────────────────
model OrderLineDesign {
  id       String @id @default(cuid())
  shopId   String
  designId String

  shopifyOrderId    String
  shopifyOrderName  String
  shopifyLineItemId String
  quantity          Int
  soldVariantId     String
  lineRole          LineRole

  groupIntact       Boolean @default(true)      // đủ MAIN + ADDON, qty khớp
  totalMatchesQuote Boolean @default(true)      // tổng khớp quotedTotal

  customerEmail       String?
  shippingAddressJson Json?
  orderedAt           DateTime

  productionStatus ProductionStatus @default(NEW)
  productionNotes  String?
  statusUpdatedAt  DateTime?
  statusUpdatedBy  String?

  @@unique([shopifyOrderId, shopifyLineItemId])
  @@index([shopId, productionStatus, orderedAt])
  @@index([designId])
}

model WebhookEvent {
  id               String   @id @default(cuid())
  shopifyWebhookId String
  topic            String
  shopDomain       String
  status           String   @default("RECEIVED")
  attempts         Int      @default(0)
  lastError        String?
  receivedAt       DateTime @default(now())
  processedAt      DateTime?

  @@unique([shopifyWebhookId])
  @@index([topic, receivedAt])
}
```

### 7.1. Vì sao vừa `snapshot Json` vừa cột phẳng vừa bảng `Selection`

Ba mục đích khác nhau, không trùng lặp:
- `snapshot` — bản ghi sản xuất đầy đủ tại thời điểm đặt, gồm URL asset và metadata. Không đọc để query.
- Cột phẳng — index được, để admin lọc ("mọi đơn dùng Crocodile").
- `Selection` — render bảng tóm tắt không cần parse JSON; thêm attribute thứ 6 sau này không phải migrate cột.

### 7.2. Ràng buộc quan trọng

| Ràng buộc | Chống được |
|---|---|
| `Asset(shopId, kind, checksumSha256)` | Upload trùng file; dedupe baked SVG |
| `ProductStyleLeather(shopifyVariantId)` unique | Hai cặp cùng trỏ một variant → đơn hàng mơ hồ |
| `AnimalLeather(shopifyVariantId)` unique | Như trên |
| `ProductStyleAnimal(productStyleId, animalId)` | Đúng một SVG cho một tổ hợp |
| `CustomDesign(shopId, idempotencyKey)` | Double-click tạo hai design |
| `CustomDesign(shopId, shareToken)` | Va chạm token deep link |
| `OrderLineDesign(shopifyOrderId, shopifyLineItemId)` | `orders/create` + `orders/paid` nhân đôi |
| `WebhookEvent(shopifyWebhookId)` | Shopify retry xử lý lại |

### 7.3. Soft delete

`isActive = false` (tạm ẩn khỏi storefront) và `archivedAt != null` (nghỉ hẳn, ẩn khỏi cả admin list) là **hai khái niệm khác nhau**, cùng tồn tại.

Attribute không bao giờ hard-delete. `CustomDesignSelection.attributeId` là soft reference nên xoá attribute không phá đơn cũ.

### 7.4. Rulings ghi nhận khi hiện thực hoá (P1b)

**R5 — cụm bất biến không mang FK nào, kể cả `shopId`.** Đoạn mở đầu §7 đã nói `CustomDesign.*Id`/`CustomDesignSelection.attributeId` là soft reference không FK; ruling này mở rộng thêm một bậc: **`CustomDesign.shopId` cũng là một cột `String` trần, không phải quan hệ Prisma `@relation` tới `Shop`.** Lý do giống hệt lý do các `*Id` khác không mang FK — nếu `shopId` là FK thật, xoá/đổi shop (hiếm nhưng không phải không thể — hợp nhất store, hay môi trường test dọn dẹp) sẽ vướng ràng buộc FK vào đúng bảng lẽ ra phải bất biến tuyệt đối. `@@unique([shopId, shareToken])` và `@@unique([shopId, idempotencyKey])` vẫn dùng `shopId` để scope tính duy nhất — chỉ là không có `@relation` đằng sau cột đó.

**R6 — thêm `priceInput` vào `ProductStyleLeather` và `AnimalLeather`** (khối §7 ở trên đã cập nhật cả hai model). Bản spec gốc chỉ có `variantPriceSnapshot` — giá **đọc ngược từ Shopify sau khi variant đã tồn tại**. Nhưng UI mô tả ở §12.2 cho thấy admin gõ giá vào ô (`$ 80.00`) **trước khi** bấm "Generate variants" — tại thời điểm đó chưa có variant Shopify nào để đọc ngược giá, nên không có chỗ nào lưu con số admin vừa gõ. `priceInput` là chỗ đó: giá trị admin nhập, dùng làm input cho bước generate variant (`POST .../variants/generate` đọc `priceInput` để set giá Shopify variant mới), độc lập với `variantPriceSnapshot` (chỉ có giá trị sau khi đã sync — có thể lệch với `priceInput` nếu ai đó sửa giá thẳng trên Shopify Admin, đó là tín hiệu cần `variantSyncedAt`/`variantMissing` theo dõi).

---

## 8. API surface

### 8.1. Admin — `/api/admin/*`

**Trạng thái (P2a, đã ship thật — verify trực tiếp trên code trước khi sửa mục này):** attribute CRUD, asset upload, product config (hosts/styles/animals/stitches + ma trận giá + lưới SVG), readiness — đã viết và có test (`npm test` + `npm run test:db`). **Chưa viết**: Shopify passthrough + sinh variant (P2b), designs & production queue (P2c) — đánh dấu riêng bên dưới.

**Auth — hai lớp wrapper bắt buộc**, `export const GET = withAdminSession(adminApi(handler))` (chi tiết ở CLAUDE.md mục "Route admin"): `withAdminSession` verify chữ ký HS256 App Bridge session token bằng `SHOPIFY_API_SECRET`, `aud === SHOPIFY_API_KEY`, đối chiếu `dest`/`iss` với **shop allowlist** `WK_ALLOWED_SHOPS` — 401 (token sai/thiếu/hết hạn) hoặc 403 (shop ngoài allowlist). `adminApi` (lớp trong) tra `Shop` theo `session.shopDomain` — 409 `SHOP_NOT_INSTALLED` nếu chưa cài/đã gỡ — rồi mới gọi handler nghiệp vụ; nó cũng bắt `AdminHttpError` và lỗi Prisma đã biết, dịch thành hai hình lỗi dưới đây.

**Hai hình lỗi duy nhất** (`src/lib/admin/http.ts`): `422` → `{ errors: [{ field, code, message }] }`; mọi mã khác → `{ error: "<CODE>", ...extra }`. Không route nào tự dựng hình lỗi riêng.

```
# Attributes — 4 nhóm cùng shape: leathers · stitches · animals · styles
GET    /api/admin/leathers?includeArchived=false   → { items: AttributeDto[] }
POST   /api/admin/leathers                          → 201 AttributeDto
PATCH  /api/admin/leathers/:id                       → AttributeDto
                                                        { archived: true }  → archive (archivedAt = now, IDEMPOTENT:
                                                                              gọi lại không ghi đè archivedAt cũ)
                                                        { archived: false } → khôi phục (archivedAt = null)
DELETE /api/admin/leathers/:id                       → AttributeDto — alias của PATCH { archived: true }.
                                                        KHÔNG hard-delete hàng; khôi phục lại bằng PATCH { archived: false }.
POST   /api/admin/leathers/reorder   { orderedIds: string[] }  → { ok: true }
                                                        409 STALE_ORDER nếu orderedIds không phải ĐÚNG BẰNG tập id
                                                        đang active hiện có — thiếu/thừa/trùng đều bị từ chối,
                                                        không đoán ý người dùng.
   … /stitches  /animals  /styles — cùng 4 route trên, khác field bắt buộc theo nhóm (xem dưới)

# Assets
POST   /api/admin/assets                 multipart: file, kind ∈ SVG_MOCKUP|DISPLAY|TEXTURE
                                          → 201 (mới) / 200 (trùng checksum, dedupe theo shopId+kind+sha256)
                                            { asset, created, validation?, sanitization? }
POST   /api/admin/assets/validate-svg    multipart: file — dry-run, KHÔNG lưu gì
                                          → { valid, validation, sanitization, externalRefs, embeddedRefs }

# Shopify passthrough (server giữ accessToken) — CHƯA VIẾT, P2b
GET    /api/admin/shopify/products?q=
GET    /api/admin/shopify/products/:id/variants

# Product config — ĐÃ VIẾT, P2a
GET    /api/admin/products                          → { items: ProductSummaryDto[] }
POST   /api/admin/products                { name }   → 201 ProductSummaryDto
GET    /api/admin/products/:id                       → ProductTreeDto — PHẲNG (xem ghi chú ngay dưới bảng này)
PATCH  /api/admin/products/:id           { name?, isEnabled? }
                                                        isEnabled: true → dựng lại cây, chạy readiness; chưa sẵn
                                                        sàng → 409 NOT_READY { problems: ReadinessProblem[] }.
                                                        isEnabled: false KHÔNG BAO GIỜ bị chặn (tắt khẩn cấp).
PUT    /api/admin/products/:id/hosts     [{ shopifyProductId, preselectStyleId?, isPrimary }]
                                                        ★ NGOẠI LỆ R4 duy nhất: phần tử vắng mặt khỏi danh sách
                                                        → hàng bị XOÁ thật, không chỉ tắt. shopifyProductId đã
                                                        gắn product khác trong cùng shop → 409 HOST_TAKEN
                                                        { shopifyProductId, productId }.
PUT    /api/admin/products/:id/styles    [{ styleId, isActive, sortOrder }]
PUT    /api/admin/products/:id/animals   [{ animalId, isActive, sortOrder }]
PUT    /api/admin/products/:id/stitches  [{ stitchId, isActive, sortOrder }]
                                                        R4: vắng mặt khỏi danh sách → isActive=false, hàng VẪN CÒN
                                                        (đưa lại đúng khoá đó sau → bật lại, tái dùng cùng hàng).
PUT    /api/admin/products/:id/styles/:styleId/leathers
                                         [{ leatherId, price, isActive, sortOrder }]
PUT    /api/admin/products/:id/animals/:animalId/leathers
                                         [{ leatherId, price, isActive, sortOrder }]
                                                        Cùng ngữ nghĩa R4. `price` là CHUỖI "80.00" (không phải
                                                        number — xem CLAUDE.md mục tiền). KHÔNG BAO GIỜ đụng
                                                        shopifyVariantId/variantPriceSnapshot (cột của P2b).
PUT    /api/admin/products/:id/styles/:styleId/animals
                                         [{ animalId, svgAssetId, displayLabel,
                                            description, defaultStitchId, isActive, sortOrder }]
                                                        Lưới SVG: mỗi cặp style×animal active cần đúng 1 ô active.

# Sinh variant — CHƯA VIẾT, P2b
POST   /api/admin/products/:id/variants/preview  → { matrixA:{count, packing, products[]}, matrixB:{…} }
POST   /api/admin/products/:id/variants/generate → chạy productSet, ghi ngược variant id
POST   /api/admin/products/:id/variants/sync     → refresh snapshot giá/title, phát hiện mồ côi

# Designs & production — CHƯA VIẾT, P2c
GET    /api/admin/designs?status=&productionStatus=&orderName=&flagged=true
GET    /api/admin/designs/:id
PATCH  /api/admin/order-lines/:id                { productionStatus, productionNotes }
```

`AttributeDto`: `{ id, name, slug, isActive, sortOrder, archivedAt, displayImage: {assetId,url}|null, textureImage?, colorHex? }`. `textureImage` chỉ có ở leathers; `colorHex` chỉ ở stitches. Field bắt buộc lúc tạo (`POST`) khác theo nhóm: leathers cần cả `displayImageAssetId` + `textureImageAssetId`; stitches cần `colorHex` (`displayImageAssetId` tuỳ chọn); animals/styles chỉ cần `displayImageAssetId`. Asset ref sai vì bất kỳ lý do gì (không tồn tại, sai shop, sai `kind`, đã archive) → luôn 422 `invalid_asset` — một mã lỗi cho mọi lý do, không phân biệt được từ response (đúng yêu cầu không tiết lộ dữ liệu shop khác).

**`GET /api/admin/products/:id` — `ProductTreeDto`, hình PHẲNG, không lồng dưới khoá `"product"`** (ruling P2a đã CHỐT — khác với ví dụ ở §8.2 `GET /apps/customizer/config`, một route storefront hoàn toàn khác đang trả `{ "product": {...} }`; nếu tài liệu nội bộ nào khác còn mô tả endpoint admin này lồng dưới `"product"`, đó là chép nhầm từ §8.2 — nguồn sự thật là `ProductTreeDto` ở `src/lib/admin/products.ts`):

```jsonc
{
  "id": "cfg_…", "name": "Custom Animal Card Holder", "isEnabled": false,
  "createdAt": "…", "updatedAt": "…",
  "hosts":    [ { "id", "shopifyProductId", "shopifyProductGid", "handleSnapshot",
                  "titleSnapshot", "preselectStyleId", "isPrimary", "syncedAt" } ],
  "styles":   [ { "styleId", "name", "isActive", "sortOrder", "archived",
                  "leathers": [ PriceCellDto ], "animals": [ StyleAnimalCellDto ] } ],
  "animals":  [ { "animalId", "name", "isActive", "sortOrder", "archived", "leathers": [ PriceCellDto ] } ],
  "stitches": [ { "stitchId", "name", "colorHex", "isActive", "sortOrder", "archived" } ],
  "readiness": { "ready": false, "problems": [ { "code", "message", "path": [] } ] }
}
```

`PriceCellDto`: `{ leatherId, name, price: string|null, isActive, sortOrder, archived, variant: PriceCellVariantDto|null }` — `variant` luôn `null` cho tới khi P2b (variant sync) ghi cột. `StyleAnimalCellDto` thêm `svgAssetId, svgUrl, svgAssetArchived, displayLabel, description, defaultStitchId, defaultStitchArchived`.

**`ReadinessCode`** (`src/lib/admin/readiness.ts`) — chỉ xét phần tử **active**; một hàng `isActive:false` không bao giờ sinh problem (tắt là cách "sửa"):
`NO_HOST` · `NO_ACTIVE_STYLE` · `NO_ACTIVE_ANIMAL` · `NO_ACTIVE_STITCH` · `STYLE_WITHOUT_LEATHER` · `ANIMAL_WITHOUT_LEATHER` · `MISSING_PRICE` · `MISSING_VARIANT` · `VARIANT_MISSING` · `MISSING_SVG` · `ARCHIVED_ATTRIBUTE`.
`ARCHIVED_ATTRIBUTE` phủ hai trường hợp, đừng đánh giá thấp danh sách này: (1) một style/animal/stitch/leather-cell đang active nhưng attribute nó trỏ tới đã bị archive; (2) **ô lưới SVG** (`ProductStyleAnimal.svgAssetId`/`defaultStitchId`) trỏ tới một asset SVG_MOCKUP hoặc stitch mặc định đã bị archive SAU KHI đã wire vào ô active — trường hợp này không tự sinh `MISSING_SVG` vì ô "vẫn có mặt" trong cây, nên phải kiểm riêng (thêm ở một vá lỗi sau review Task 6).

**Mã lỗi nghiệp vụ hay gặp ở nhóm Product:** 409 `HOST_TAKEN`, 409 `NOT_READY`, 409 `STALE_ORDER` (reorder attribute), 409 `SHOP_NOT_INSTALLED` (tầng `adminApi`), 422 `invalid_reference` (id style/animal/stitch/leather trong body `PUT` sai shop hoặc đã archive — kiểm MỘT LẦN cho toàn bộ danh sách trước khi ghi bất cứ gì), cộng 409/404 dịch tự động từ Prisma P2002/P2003/P2025 (`CONFLICT { fields }` / `IN_USE` / `NOT_FOUND`).

Dùng `PUT` cho quan hệ: admin gửi **toàn bộ** danh sách mong muốn, server diff bằng khoá (`diffByKey`). Tránh trạng thái nửa vời khi network fail và khớp với UI (checkbox + drag sort → lưu một lần). **Ngữ nghĩa phần tử vắng mặt (R4): `isActive = false`, hàng VẪN CÒN — trừ `ProductHost`, nơi vắng mặt nghĩa là XOÁ hàng thật.**

**Ruling R2 (P1b):** bỏ luồng signed-upload-url hai bước (`upload-url` → browser PUT thẳng lên bucket → `commit`) khỏi bản `# Assets` ở trên — luồng đó để browser ghi **bytes chưa lọc** thẳng vào bucket public, tức XSS (rủi ro S1, §13.2) nằm giữa lúc ghi và lúc admin/route nào đó lỡ đọc lại trước khi kiểm. Thay bằng một request multipart duy nhất đi qua server: `POST /api/admin/assets` nhận file, sanitize (SVG) hoặc kiểm magic byte (ảnh nhị phân), rồi mới gọi `uploadSanitizedSvg`/`uploadBinaryAsset` (`src/lib/storage/index.ts`) — không có đường nào để bytes chưa lọc chạm bucket. Cái giá phải trả: file đi qua Vercel serverless (giới hạn body ~4.5MB — xem `MAX_ASSET_BYTES`), không phải trực tiếp browser→Supabase; chấp nhận được vì asset (SVG, texture) luôn nhỏ hơn nhiều so với giới hạn đó.

**SVG mockup (`kind=SVG_MOCKUP`) — ba lớp từ chối, mỗi lớp KHÔNG lưu gì nếu trượt (P2a, ship thật):**
1. **R5** — SVG tham chiếu tài nguyên ngoài (`sanitization.externalRefs.length > 0`) → 422 `external_reference`, kèm `externalRefs`. Texture da hợp lệ chính LÀ URL ngoài ở route khác, nhưng một mockup admin upload thì không có lý do hợp lệ nào để trỏ ra ngoài — bị từ chối thẳng, không tự động gỡ.
2. **R6** — SVG nhúng tài nguyên `data:` URI (`findEmbeddedResourceRefs`) → 422 `embedded_resource`, kèm `embeddedRefs`. Policy sanitize CHUNG giữ `data:image/*` (kể cả `svg+xml`) vì SVG-as-image bị trình duyệt sandbox — nhưng endpoint mockup riêng này từ chối thêm, vì mockup master thật có 0 `data:` URI (artwork `<image>` không có `href` kiểu đó) và "có lẽ vô hại" không đủ ở ranh giới stored-XSS.
3. Không thoả hợp đồng customizer (`validateSvgContract`, đo **SAU** sanitize — đúng cái sẽ được lưu) → 422 `svg_contract`, kèm `validation` (`ValidationReport`) trong body.

Chỉ khi qua cả ba lớp, server mới gọi `uploadSanitizedSvg` và ghi `Asset` row (ruling R2).

**Ví dụ `validate-svg`** — dùng đúng tên trường của `SanitizeReport` thật (`src/svg-engine/sanitize.ts`): `removedElements` / `removedAttributes` / `externalRefs`, KHÔNG PHẢI `removedScripts` / `removedEventHandlers`:

```jsonc
{
  "valid": false,
  "validation": {
    "valid": false,
    "contractVersion": "animal-v1",
    "viewBox": "0 0 1427 1102",
    "checks": [
      { "id": "wallet-preview",    "status": "ok" },
      { "id": "wallet-body-shape", "status": "ok" },
      { "id": "body-artwork",      "status": "ok", "element": "image" },
      { "id": "animal-shape",      "status": "missing",
        "hint": "Found 'fish-shape'. File not migrated to the animal-* contract." },
      { "id": "animal-clip",       "status": "missing", "hint": "Found 'fish-clip'." },
      { "id": "animal-artwork",    "status": "missing", "hint": "Found 'fish-artwork'." },
      { "id": "stitches",          "status": "warning",
        "hint": "Group exists but fill does not use var(--wallet-stitches)." }
    ]
  },
  "sanitization": { "removedElements": [], "removedAttributes": [], "externalRefs": [] },
  "externalRefs": [],
  "embeddedRefs": []
}
```

### 8.2. Storefront — `/apps/customizer/*`

**Auth:** App Proxy HMAC. Lưu ý HMAC chứng minh request **đi qua storefront Shopify**, không chứng minh danh tính khách. Dữ liệu config là catalog công khai nên chấp nhận được; an ninh thật nằm ở bước tạo design.

```
GET /apps/customizer/config?productId=<Shopify numeric product id của trang hiện tại>
    200 → payload bên dưới · Cache-Control: public, max-age=60, stale-while-revalidate=300
    404 → không có ProductHost khớp, hoặc isEnabled=false
```

Server tra `ProductHost(shopId, shopifyProductId)` → `CustomizableProduct`. Nếu host mang `preselectStyleId` (đóng gói N-product), trả về để customizer chọn sẵn style tương ứng.

```jsonc
{
  "product": { "id": "cfg_…", "name": "Custom Animal Card Holder",
               "preselectStyleId": "sty_01" },
  "leathers": [
    { "id": "lth_01", "name": "Suede Brown",
      "displayImageUrl": "https://…/display/ab12.webp",
      "textureImageUrl": "https://…/texture/cd34.webp", "sortOrder": 1 }
  ],
  "stitches": [
    { "id": "st_01", "name": "Gold", "colorHex": "#E7C337",
      "displayImageUrl": "https://…" }
  ],
  "styles": [
    { "id": "sty_01", "name": "Minimalist", "displayImageUrl": "https://…",
      "leathers": [ { "leatherId": "lth_01", "variantId": "44928374652" } ],
      "animals":  [ { "id": "psa_01", "animalId": "ani_01", "label": "Alligator",
                      "description": "…", "displayImageUrl": "https://…",
                      "svgUrl": "https://…/svg/9f8e7d.svg",
                      "defaultStitchId": "st_01" } ] }
  ],
  "animals": [
    { "id": "ani_01", "name": "Alligator", "displayImageUrl": "https://…",
      "leathers": [ { "leatherId": "lth_01", "variantId": "55110022334" } ] }
  ]
}
```

`variantId` trả về để client tra **giá từ `wk-variants`** (Liquid), không phải để client tự quyết định thêm gì vào giỏ.

```
POST /apps/customizer/designs
     { productId, styleId, bodyLeatherId, animalId, animalLeatherId,
       stitchId, idempotencyKey }
     201 → { designId, shareToken, previewUrl,
             lines: [ { variantId, quantity, properties }, … ],
             summary: { bodyPrice, animalPrice, total } }
     422 → { errors: [ { field, code, message } ] }
     409 → { error: "VARIANT_UNAVAILABLE" }

GET  /apps/customizer/designs/:shareToken
     200 → snapshot đủ để rehydrate customizer (không lộ email/địa chỉ/order)
     404 → token không tồn tại
```

**Không có endpoint `/validate` riêng.** Validate *là* tạo — một round-trip, không có trạng thái trung gian để lệch.

**Idempotency:** client sinh `idempotencyKey` (uuid v4) một lần khi mount, gửi lại nguyên vẹn khi retry. Server upsert theo `(shopId, idempotencyKey)`. Sau khi add to cart thành công, client **sinh key mới** để thiết kế tiếp theo không ghi đè thiết kế trước.

**Mã lỗi:** `NOT_AVAILABLE`, `NOT_IN_PRODUCT`, `MISSING_SVG`, `VARIANT_MISSING`, `VARIANT_UNAVAILABLE`, `INVALID_COMBINATION`.

### 8.3. Webhooks — `/api/webhooks/*`

**Auth:** HMAC base64 trên **raw body**. Bắt buộc `await req.text()` trước mọi thứ; `req.json()` rồi `JSON.stringify` lại sẽ đổi byte và HMAC sai.

```
POST /api/webhooks/orders-create      topics: orders/create, orders/paid
POST /api/webhooks/products-update    topic:  products/update
POST /api/webhooks/app-uninstalled    topic:  app/uninstalled
```

---

## 9. Luồng storefront

### 9.1. App Block truyền context

```liquid
<div id="wk-customizer-root"
     data-product-id="{{ product.id }}"
     data-product-handle="{{ product.handle }}"
     data-shop-domain="{{ shop.permanent_domain }}"
     data-proxy-prefix="/apps/customizer"
     data-money-format="{{ shop.money_format | escape }}"
     data-block-title="{{ block.settings.title | escape }}">
  <div class="wk-skeleton">…</div>
</div>
<script type="application/json" id="wk-variants">{{ product.variants | json }}</script>
```

`{{ product.variants | json }}` cho **toàn bộ giá và availability từ Liquid**:
- Hiển thị giá khi đổi lựa chọn: **0 API call**, và luôn đúng bằng giá Shopify đang bán.
- Variant `available: false` → disable swatch tương ứng.

### 9.1.1. Nguồn giá hiển thị — thứ tự ưu tiên

| Variant cần hiển thị giá | Nguồn | Vì sao |
|---|---|---|
| Thuộc product của trang hiện tại | `wk-variants` (Liquid) | Chính xác tuyệt đối, 0 API call |
| Thuộc product khác, ≤ 20 handle | `all_products[handle]` render thêm vào `wk-variants-extra` | Vẫn là Liquid |
| Vượt 20 handle, hoặc product phụ phí | `variantPriceSnapshot` từ config | Fallback bắt buộc |

⚠️ **Liquid giới hạn 20 lookup `all_products` mỗi lần render trang.** Khi đóng gói N-product (10 style product + 10 animal product = 20 lookup) là chạm trần ngay. Vì vậy fallback snapshot **không phải trường hợp hiếm mà là đường đi mặc định cho dòng phụ phí**.

Giữ snapshot tươi bằng ba cơ chế: sync sau mỗi lần admin đổi giá, `products/update` webhook, và nút Sync thủ công. Sai lệch còn sót bị bắt ở đối soát webhook (§11.2) — **không bao giờ ảnh hưởng số tiền Shopify thu**, chỉ ảnh hưởng con số ước tính hiển thị trước khi vào giỏ.

Trong admin, `variantPriceSnapshot` luôn hiện kèm nhãn "cached" và `variantSyncedAt`.

### 9.2. Tắt variant picker gốc

Gỡ block "Variant picker" khỏi product section trong Theme Editor. Customizer thay thế hoàn toàn.

### 9.3. Deep link

`https://…/products/<handle>?wk=<shareToken>`

- `shareToken` là **nanoid 22 ký tự ngẫu nhiên**, không dùng ULID — ULID có phần thời gian tăng dần nên đoán được token lân cận và duyệt design người khác.
- Customizer đọc `?wk=` lúc mount, gọi `GET /apps/customizer/designs/:token`, apply toàn bộ lựa chọn.
- Nếu style/leather/animal trong link đã archive hoặc inactive → hiện thông báo và fallback về mặc định, **không vỡ**.
- Nút Share: copy link, dùng `navigator.share` trên mobile.

---

## 10. Cart và checkout

### 10.1. Add to cart

Client gọi `/cart/add.js` với **đúng** `lines` mà server trả về (xem 4.4). Client không tự dựng variantId hay properties.

### 10.2. Hiển thị cart — ba lớp phòng thủ

**Lớp 1 — Liquid.** Sửa cả `main-cart-items` **và** `cart-drawer`:
```liquid
{% if item.properties._wk_role == 'addon' %}{% continue %}{% endif %}
```
Dòng chính hiển thị:
- Ảnh: `item.properties._wk_preview` (baked SVG)
- Tiêu đề: variant title + property `Animal`
- Tổng: tổng mọi dòng cùng `_wk_design_id`

**Lớp 2 — JS fallback.** Script chạy trên mọi trang có cart: nếu phát hiện dòng `addon` vẫn hiện (theme khác, app cart bên thứ ba), ẩn nó và cộng giá vào dòng cha. Bảo hiểm khi đổi theme.

**Lớp 3 — webhook đối soát** (xem 11.2).

### 10.3. Đồng bộ số lượng và xoá

Sửa qty hoặc bấm Remove ở dòng chính → JS gom mọi dòng cùng `_wk_design_id` và gọi **một** `/cart/update.js` cập nhật đồng thời. Một request, không có trạng thái nửa vời.

### 10.4. Ràng buộc bắt buộc trong checklist nghiệm thu

- **Tắt dynamic checkout button** ("Buy it now") trên mọi product của customizer — nếu không, khách bỏ qua giỏ và đơn thiếu dòng phụ phí.
- **Weight:** đặt trọng lượng thật trên variant ma trận A, `0` trên ma trận B — nếu không phí ship tính hai lần.
- Product ma trận B phải **publish** để add to cart được, nhưng **không cho vào collection nào**. Đặt tên rõ là thành phần (`Alligator Applique`).

### 10.5. Giới hạn đã chấp nhận

Checkout do Shopify render, **không sửa được** (trừ Plus + checkout extensibility). Dòng phụ phí luôn hiện. Giảm thiểu bằng tên rõ ràng và variant image là ảnh thật của con vật.

---

## 11. Webhook và đối soát

### 11.1. Idempotency hai lớp

```
POST /api/webhooks/orders-create
 1. raw = await req.text()
 2. verify HMAC base64 (X-Shopify-Hmac-Sha256) → 401 nếu sai
 3. INSERT WebhookEvent(shopifyWebhookId)          ← lớp 1: transport
      ├ vi phạm unique → return 200 (đã xử lý)
      └ ok → tiếp
 4. Gom line_items theo _wk_design_id
    Với mỗi line: upsert OrderLineDesign
      where (shopifyOrderId, shopifyLineItemId)    ← lớp 2: nghiệp vụ
 5. Đối soát nhóm (11.2)
 6. CustomDesign.status = ORDERED
 7. WebhookEvent.status = PROCESSED
 8. return 200
```

Lớp 2 là lớp thực sự cứu: `orders/create` và `orders/paid` có **webhookId khác nhau** nên lớp 1 không chặn được chúng.

Shopify yêu cầu 200 trong 5 giây. Vài INSERT/UPDATE dư sức. **Không được** thêm render nặng vào đây.

### 11.2. Đối soát nhóm dòng

Với mỗi `_wk_design_id` trong đơn, kiểm tra:
1. Có **đủ** một dòng `MAIN` và một dòng `ADDON`.
2. `quantity` của hai dòng **bằng nhau**.
3. `soldVariantId` khớp `design.mainVariantId` / `design.addonVariantId`.
4. Tổng tiền của nhóm khớp `design.quotedTotal`.

Lệch bất kỳ điều nào → `groupIntact = false` hoặc `totalMatchesQuote = false` → **cờ 🚩 đỏ** trong admin. Đơn vẫn vào, người thật xử lý.

Đây là phương án đã chốt: **phát hiện, không chặn**. Nâng cấp lên Cart Validation Function chỉ khi thực sự có gian lận.

### 11.3. `products/update`

Nếu ai đó xoá hoặc đổi variant trong Shopify Admin, `shopifyVariantId` trong DB thành mồ côi và khách bấm Add to cart sẽ **im lặng thất bại**. Webhook này set `variantMissing = true` và hiện cảnh báo đỏ trong admin.

---

## 12. Admin — kiến trúc thông tin

Đúng **hai tab**: `Attributes` và `Products`. Ngôn ngữ: English 100%.

**Trạng thái (đã build ở phase gọi là "P2c" trong `docs/superpowers/plans/2026-09-11-p2c-admin-ui.md` — verify trực tiếp trên code trước khi sửa mục này; đừng nhầm với nhãn "P2c" cũ ở §8.1 phía trên, đó là designs/production-queue, giờ đã dời sang P4):** cả hai tab mô tả ở §12.1/§12.2 bên dưới đã viết và có test (`npm test`, 756 test qua jsdom cho phần component) — `src/components/admin/AdminShell.tsx` render dưới đúng route `"/"` (Ruling R6, không route App Router nào khác cho bất cứ màn hình admin nào — xem CLAUDE.md), gọi `/api/admin/*` thật (P2a) qua App Bridge session token CDN (không phải `@shopify/app-bridge-react`). **Chưa build**: thực thi "Generate variants" — nút đã có trên UI (`PriceMatrixSection.tsx`) nhưng `disabled`, chờ P2b sinh biến thể Shopify thật; và toàn bộ §12.3 Production queue — chờ P4 có dữ liệu đơn hàng từ webhook.

### 12.1. Tab Attributes

Sub-nav: `Leathers · Stitches · Animals · Styles`. Bốn nhóm dùng chung component list + drawer, khác nhau ở form field:

| | Name | Display image | Texture image | Color hex | Active / Sort |
|---|---|---|---|---|---|
| Leathers | ✅ | ✅ | ✅ | — | ✅ |
| Stitches | ✅ | ✅ | — | ✅ | ✅ |
| Animals | ✅ | ✅ | — | — | ✅ |
| Styles | ✅ | ✅ | — | — | ✅ |

Tab này **không đụng Shopify API**. Một danh sách `Leathers` duy nhất dùng cho cả body và animal.

### 12.2. Tab Products

Detail view, bốn section trên một trang (không wizard):

```
┌─ Styles & body pricing ──────────────────  [Generate variants] ─┐
│ ▾ ☑ Minimalist                                                   │
│     ☑ Suede Brown   $ 80.00  ✓ 4492…   ☑ Togo Brown   $ 95.00   │
│     ☑ Suede Beige   $ 80.00  ✓ 4493…   ☐ Crocodile      —       │
│ ▸ ☑ Classic                                                      │
└──────────────────────────────────────────────────────────────────┘

┌─ Animals & applique pricing ─────────────  [Generate variants] ─┐
│ ▾ ☑ Alligator                                                    │
│     ☑ Togo Brown    $ 50.00  ✓ 5511…   ☑ Suede Brown  $ 40.00   │
│ ▸ ☑ Angler Fish                                                  │
└──────────────────────────────────────────────────────────────────┘

┌─ SVG mockups (Style × Animal) ──────────────────────────────────┐
│              Alligator     Angler Fish    Bear                   │
│  Minimalist   ✓ SVG         ✓ SVG         ⚠ missing             │
│  Classic      ✓ SVG         ✓ SVG         ⚠ missing             │
└──────────────────────────────────────────────────────────────────┘

┌─ Stitches ──────────────────────────────────────────────────────┐
│ ☑ Gold ●   ☑ Cream ●   ☑ Crimson ●   ☐ White ○                  │
└──────────────────────────────────────────────────────────────────┘
```

Click ô Style × Animal → drawer: display label, description, **upload SVG** (validate ngay, báo cáo từng ID), **live preview** dùng chính `svg-engine` với dropdown thử leather và stitch, default stitch, active, sort.

`Generate variants` hiện trước con số và phương án đóng gói, chờ xác nhận, rồi chạy.

### 12.3. Production queue

**Chưa build** (cần `OrderLineDesign` thật từ webhook đơn hàng — P4; không dựng được trước đó).

Danh sách `OrderLineDesign` lọc theo `productionStatus`, hiện baked SVG, snapshot đầy đủ, cờ 🚩 khi đối soát lệch, đổi status `NEW → IN_PRODUCTION → QC → SHIPPED`.

---

## 13. Bảo mật

### 13.1. Phải vá ngay (P0, độc lập với redesign)

| # | Vấn đề | Xử lý |
|---|---|---|
| A1 | `/api/admin/*` **không có xác thực** — production | Session token JWT + shop allowlist |
| A2 | `README.md` chứa `SHOPIFY_API_SECRET` và password Supabase **thật**, đã vào git history | **Rotate cả hai** (xoá file không đủ). Xoá mục credential khỏi README |
| A3 | `NODE_ENV=development` bỏ qua toàn bộ HMAC | Đổi thành opt-in tường minh `WK_SKIP_HMAC=1`; fail-fast nếu bật cùng `NODE_ENV=production` |

### 13.2. Rủi ro SVG

| # | Rủi ro | Xử lý |
|---|---|---|
| S1 | XSS qua SVG upload — script chạy trong ngữ cảnh Shopify Admin có session token | Sanitize **server-side lúc upload**, lưu bản đã lọc. Strip `<script>`, `<foreignObject>`, mọi `on*`, `href` ngoài allowlist |
| S2 | ID collision với theme → artwork tràn ra ngoài hình ví | Shadow DOM; fallback prefix ID |
| S3 | CSS/selector injection | Allowlist ID hằng số compile-time, không nối chuỗi từ input |
| S4 | Contract `fish-*` vs `animal-*` → preview vỡ im lặng | Validator chỉ chấp nhận `animal-*`, reject kèm hint |
| S5 | Texture CORS trong SVG inline | Supabase public bucket trả `ACAO: *`. Test sớm. Fallback: proxy qua App Proxy |
| S6 | Stale response khi đổi animal nhanh | Race guard bằng sequence (port từ reference) |
| S7 | SVG filter trong Shadow DOM trên Safari | **Spike ngày đầu P3**; fallback light DOM + prefix ID |
| S8 | `blob:` lọt vào DB | Kiến trúc không có upload từ khách. Thêm CHECK chặn `blob:`/`data:` trong `Asset.publicUrl` |

### 13.3. Giá

| # | Rủi ro | Xử lý |
|---|---|---|
| P1 | Giá DB lệch giá Shopify | Storefront không đọc giá từ DB; lấy từ Liquid |
| P2 | Khách bypass variantId | Đối soát ở webhook + cờ 🚩 |
| P3 | Leather hết hàng | `available` từ Liquid → disable swatch; server check lại → 409 |
| P4 | Đổi giá giữa lúc khách đang chọn | Shopify tính lại lúc checkout; ta không giữ giá |

### 13.4. Khác

- Rate limit theo IP trên `POST /apps/customizer/designs`.
- `/api/admin/shopify/*` whitelist query cứng, không cho client truyền GraphQL tuỳ ý.

---

## 14. Kế hoạch triển khai

Dữ liệu Supabase hiện tại là seed demo, **cắt sạch** (đã xác nhận).

```
P0  Bảo mật (1–2 ngày, deploy độc lập)
    session token auth · rotate secret · xoá credential khỏi README
    · đổi cơ chế bỏ-qua-HMAC thành opt-in
    ✅ Gate: gọi /api/admin/* không token → 401

P1  Nền tảng (3–4 ngày)
    migration drop bảng cũ + tạo schema mới
    · src/shared/ (zod) thay packages/shared-types (code chết)
    · Supabase Storage bucket + policy + upload-url flow
    · SVG sanitizer + validator (linkedom)
    · migrate fish-* → animal-* cho 2 file demo
    · chốt MỘT Shopify API version dùng ở mọi nơi
    ✅ Gate: npm test — bộ test contract port từ test svg/tests phải xanh

P2  Admin (6–8 ngày)
    shell 2 tab + session token client
    · Attributes: 4 CRUD + upload + drag sort
    · Products: 2 bảng giá + SVG grid + upload/validate + live preview
    · Generate variants (productSet) + sync
    · Production queue
    ✅ Gate: cấu hình trọn vẹn 1 product qua UI, không đụng DB tay

P3  SVG engine + Storefront (5–7 ngày)
    NGÀY 1: spike Shadow DOM + SVG filter trên Safari/Chrome/iOS   ← rủi ro cao nhất
    · port svg-engine + test
    · App Block mới (Shadow DOM, data-*, wk-variants)
    · UI 5 lựa chọn + preload texture + mobile
    · POST /designs + baked SVG + /cart/add.js
    · deep link
    ✅ Gate: checklist nghiệm thu §15

P4  Cart + Order (3–4 ngày)
    Liquid cart + drawer · JS đồng bộ qty/remove · JS fallback
    · webhook idempotency 2 lớp + đối soát nhóm
    · products/update webhook
    ✅ Gate: đặt đơn test thật; ProductionJob xuất hiện; cố tình xoá dòng addon → cờ 🚩

P5  Cutover (1 ngày)
    xoá CustomizerApp.tsx cũ, /admin/* cũ, pricingEngine, packages/shared-types
    · bundle:extension && shopify:deploy · bật App Block
```

**Chiến lược cutover storefront:** giữ App Block cũ nguyên vẹn tới P5, tạo App Block **mới song song** trong cùng extension (`uid` **không đổi** — đổi là mất liên kết theme). Merchant bật/tắt trong Theme Editor → rollback một click, không cần redeploy.

---

## 15. Tiêu chí nghiệm thu

Từ action guide §12, mở rộng cho sản phẩm này:

**SVG**
- Đổi body leather chỉ thay thân ví, không tràn ra ngoài; các ngăn ví cập nhật theo.
- Đổi animal leather chỉ thay con vật, không tràn; phủ cả phần cần câu (`animal-clip` gồm cả `hook-shape`).
- Viền, mắt, miệng, chi tiết vector vẫn hiển thị **trên** artwork.
- Đổi stitch cập nhật toàn bộ mũi chỉ, không đổi artwork hay màu da.
- Reset trả stitch về `defaultStitchId` đúng của mockup đang xem.
- Đổi style/animal giữ nguyên hai texture và giữ stitch do khách tự chọn.
- Mockup sai contract bị từ chối mà **không phá preview đang hiển thị**.
- Không có `blob:` trong DB hay cart property.

**Thương mại**
- Add to cart tạo **đúng hai dòng** cùng `_wk_design_id`.
- Cart hiển thị **một** dòng với ảnh baked SVG và tổng đúng.
- Cart drawer cũng ẩn dòng addon.
- Đổi qty ở dòng chính → cả hai dòng đổi theo.
- Remove ở dòng chính → cả hai dòng biến mất.
- Dynamic checkout button đã tắt.
- Checkout hiển thị hai dòng, subtotal đúng.
- Đơn hàng sinh `OrderLineDesign` cho cả hai dòng, `groupIntact = true`.
- Cố tình xoá dòng addon bằng tay → đơn có cờ 🚩.

**Deep link**
- Mở `?wk=<token>` khôi phục đúng toàn bộ lựa chọn.
- Token trỏ tới attribute đã archive → thông báo và fallback, không vỡ.

**Bảo mật**
- Gọi `/api/admin/*` không token → 401.
- Gọi `/api/proxy/*` sai HMAC ở production → 401.
- Upload SVG có `<script>` → bị từ chối.

Build hoặc type-check thành công **không thay thế** kiểm tra trực quan clipping và thứ tự layer.

---

## 15b. ✅ ĐÃ VÁ — hai lỗ hổng sanitizer (từng chặn P1b)

Phát hiện ở vòng re-review cuối của P1a, xác minh bằng thực thi, **cố ý hoãn** vì hôm nay chưa có
consumer nào inline markup đã lưu. **Phase nào dựng consumer đó phải vá trước khi dựng.**

### K — node comment không được sanitize (Critical, XSS thật)

`src/svg-engine/sanitize.ts` chỉ duyệt phần tử; node comment đi qua nguyên văn. Payload:

```
<svg id="wallet-preview"><!-- --!><script>alert(document.domain)</script><!-- -->…</svg>
```

Kết quả đo được: payload còn nguyên trong output, `sanitizeSvgRoot` trả `{removedElements:[],
removedAttributes:[],externalRefs:[]}`, `validateSvgContract` trả `valid: true`.

Khi markup này được inline vào trang Shopify Admin, tokenizer HTML ở trạng thái *comment-end-bang*
coi `--!>` là kết thúc comment, và `<script>` ngay sau đó chạy trong origin đang giữ session token.

**Vá:** gỡ node comment và processing-instruction trong `visit()`, và cho `checkSafety` từ chối chúng.
Kèm test rằng `checkSafety` tương đương "sanitizer sẽ không gỡ gì" — khẳng định này hiện **sai** với
node không phải phần tử.

**ĐÃ VÁ.** `visit()` duyệt `childNodes` và gỡ comment + processing instruction, ghi vào
`SanitizeReport.removedElements` dưới `nodeName` chuẩn của DOM (`#comment`,
`#processing-instruction`; `#` không phải ký tự mở đầu hợp lệ của tên XML nên không đụng tên phần
tử nào). `checkSafety` từ chối đúng hai loại node đó, nên khẳng định "an toàn = sanitizer sẽ không
gỡ gì" đúng cả với node không phải phần tử. Quy tắc nằm ở `unsafeNodeName` trong `policy.ts` — một
nguồn duy nhất cho cả hai cổng. CDATA cố tình KHÔNG bị gỡ: dữ liệu của một node CDATA không bao giờ
chứa được `]]>`, nên nó không thoát ra được ở cả parser XML lẫn HTML. linkedom không dựng được node
PI, nên nhánh PI chỉ test được ở tầng `policy` (browser DOMParser thì có).

### K4 — cổng `url(` phân biệt hoa thường (Important)

`sanitize.ts:102` và `validate.ts:99` đều dùng `value.includes("url(")`, trong khi tên hàm CSS
**không** phân biệt hoa thường. Hệ quả đo được với `style="background-image:URL(http://evil…)"`:
thuộc tính được giữ, không vào `externalRefs` (nên allowlist host của caller không bao giờ thấy nó),
và `clip-path="URL(#khong-ton-tai)"` không bị bắt là dangling reference.

**Vá:** lowercase giá trị trước khi qua cổng, hoặc bỏ cổng và để regex (vốn đã có cờ `i`) tự quyết.

**ĐÃ VÁ.** Cả hai cổng viết tay bị xoá; `extractUrlReferences` trong `policy.ts` là định nghĩa duy
nhất và mảng rỗng chính là câu trả lời "không có url() nào". Đo được thêm một biến thể mà cách
"lowercase rồi so khớp" vẫn trượt: `url (` có khoảng trắng — hợp lệ với CSS, không khớp
`includes("url(")`. Ngoài ra `extractUrlReferences` giải mã escape của CSS trước khi so khớp:
`style="filter:\75 rl(http://evil.example/x.svg#f)"` cũng đo được là fetch thật mà `externalRefs`
không bao giờ thấy. Giá trị `href` KHÔNG đi qua bước giải mã đó — nó không phải CSS, `\` trong nó
là một ký tự thật.

---

### ⚠️ Ràng buộc cho phase dựng upload endpoint

`sanitizeSvgRoot(root)` chỉ nhìn thấy **cây con của root**. Một comment đặt **trước** thẻ `<svg>`
sống sót trong `root.ownerDocument` dù `root.outerHTML` đã sạch.

**Endpoint upload phải lưu `root.outerHTML` sau khi sanitize — tuyệt đối không lưu bytes gốc do
người dùng tải lên.** Lưu bytes gốc là bypass toàn bộ sanitizer.

Hôm nay chưa có consumer nào nên chưa có phơi nhiễm; ghi ở đây để phase dựng endpoint đọc được.

---

## 16. Điểm còn mở (không chặn triển khai)

1. **Số lượng leather thực tế** → quyết định bộ sinh tạo 1 hay N product. Trả lời lúc nào cũng được; admin hiện con số trước khi generate.
2. **Cart Transform Function** để gộp hai dòng ở checkout → Phase 2, chỉ khi dòng phụ phí gây khó chịu thật sự. Cần xác minh plan eligibility.
3. **Rule engine loại trừ tổ hợp** → thêm bảng `AttributeExclusion` sau, thuần additive. Thiết kế query theo công thức `allowed = productLevelSet − exclusions`; MVP bảng exclusions không tồn tại và hàm trả về `productLevelSet`.
4. **GC design DRAFT cũ** → chưa cần; rows nhỏ. Xem lại khi số lượng đáng kể.
5. **Mandatory compliance webhooks** (customers/data_request, customers/redact, shop/redact) → custom distribution không bắt buộc, nhưng khai báo thì rẻ.
