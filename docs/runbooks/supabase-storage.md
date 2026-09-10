# Runbook — Supabase Storage cho asset

Chạy quy trình này khi: dựng project mới, hoặc bucket `wk-assets` bị xoá/đổi
tên và cần tạo lại. `src/lib/storage/index.ts` là đường ghi asset DUY NHẤT
của app (SVG mockup, texture, display image, baked design SVG) — không có
route hay script nào khác ghi vào bucket này.

## 0. Tạo bucket

1. Supabase Dashboard → project → **Storage** → **New bucket**.
2. Tên: `wk-assets` (khớp `SUPABASE_STORAGE_BUCKET` ở `.env.example`). Đổi
   tên khác thì phải đổi biến môi trường theo, ở cả `.env` cục bộ lẫn Vercel.
3. **Public bucket: BẬT.** Storefront nạp texture trực tiếp từ CDN của
   Supabase (không qua proxy server) — bucket private sẽ làm mọi texture vỡ
   ảnh trên trang sản phẩm.
4. Không cần tạo policy RLS thủ công cho ghi: server luôn dùng
   `SUPABASE_SERVICE_ROLE_KEY`, key này bỏ qua mọi RLS.

## 1. Cấu trúc thư mục trong bucket

`src/lib/storage/index.ts` tự sinh path theo `storagePathFor(kind, checksum,
extension)` — không cần tạo thư mục tay, Supabase Storage tạo path khi upload
lần đầu. Bốn thư mục sẽ xuất hiện, tương ứng bốn giá trị của enum
`AssetKind`:

| Thư mục | `AssetKind` | Nội dung |
|---|---|---|
| `svg_mockup/` | `SVG_MOCKUP` | SVG mockup style × animal, admin upload |
| `texture/` | `TEXTURE` | Ảnh texture da (PNG/JPEG/WebP) |
| `display/` | `DISPLAY` | Ảnh đại diện cho leather/animal/style trong admin UI |
| `design_svg/` | `DESIGN_SVG` | SVG đã bake — kết quả cuối của một `CustomDesign` |

Tên file trong mỗi thư mục LÀ checksum SHA-256 của nội dung
(`<checksum>.<extension>`) — đây là thứ làm việc ghi trùng nội dung tự
dedupe (`@@unique([shopId, kind, checksumSha256])` ở `Asset`), không phải
quy ước đặt tên tuỳ chọn.

## 2. Xác nhận CORS (`Access-Control-Allow-Origin: *`)

Spec §13 rủi ro **S5**: texture được nạp **inline trong SVG** (thẻ `<image
href="…">` bên trong `<svg>` render trực tiếp trên storefront) — trình duyệt
áp CORS cho tải ảnh kiểu này, khác với thẻ `<img>` thường. Supabase Storage
public bucket trả `Access-Control-Allow-Origin: *` mặc định, nhưng **phải xác
nhận bằng lệnh thật**, không suy đoán từ "bucket đã public":

```bash
curl -sI "https://<project_ref>.supabase.co/storage/v1/object/public/wk-assets/texture/<checksum>.png" \
  | grep -i "access-control-allow-origin"
```

Kỳ vọng: `access-control-allow-origin: *`. Thiếu dòng này ⇒ texture sẽ tải
được qua `<img>` bình thường nhưng vỡ khi nạp inline trong SVG trên
storefront — lỗi chỉ hiện trong Console trình duyệt, không hiện ở Network
tab dưới dạng request fail rõ ràng. Fallback nếu Supabase đổi hành vi: proxy
texture qua App Proxy thay vì trỏ thẳng CDN (spec §13, ghi chú S5).

## 3. Lấy service-role key

1. Supabase Dashboard → project → **Project Settings** → **API**.
2. Mục **Project API keys** → copy **`service_role`** (KHÔNG phải
   `anon`/`publishable` — key đó không đủ quyền upload và cũng không nên
   dùng cho việc này).
3. Key này **TOÀN QUYỀN, bỏ qua mọi RLS**. Chỉ đặt ở biến môi trường phía
   server (Vercel), không bao giờ đặt tên biến dạng `NEXT_PUBLIC_*`, không
   bao giờ để lọt xuống response gửi cho browser.

## 4. Đặt ba biến môi trường trên Vercel

Vercel → project `wild-king-customizer` → Settings → Environment Variables
(scope **Production**, và **Preview** nếu preview deployment cũng cần upload
asset):

| Biến | Giá trị |
|---|---|
| `SUPABASE_URL` | `https://<project_ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | giá trị lấy ở bước 3 |
| `SUPABASE_STORAGE_BUCKET` | `wk-assets` |

Redeploy sau khi đổi biến — biến môi trường chỉ có hiệu lực từ lần build
tiếp theo.

Thiếu bất kỳ biến nào trong ba biến trên: `createStorageClient()` hoặc
`resolveBucket()` (`src/lib/storage/index.ts`) **ném lỗi ngay lúc gọi**, không
âm thầm tạo client hỏng — request upload sẽ trả lỗi 500 rõ ràng thay vì lỗi
mạng khó hiểu ở request đầu tiên.

## 5. Kiểm chứng

```bash
# Bucket tồn tại và public — phải trả 200, không phải 400/404.
curl -sI "https://<project_ref>.supabase.co/storage/v1/object/public/wk-assets/" | head -1

# Sau khi upload thử một asset (qua app, không phải tay) — object phải tải
# công khai KHÔNG cần Authorization header, và có header CORS đúng như bước 2.
curl -sI "https://<project_ref>.supabase.co/storage/v1/object/public/wk-assets/<kind>/<checksum>.<ext>" \
  | grep -iE "^(http|access-control-allow-origin|content-type):"
```

Kỳ vọng: HTTP 200, `access-control-allow-origin: *`, `content-type` khớp
`mimeType` đã upload (`image/svg+xml`, `image/png`, …).

## 6. Áp schema lần đầu (`npm run prisma:push`)

`npm run prisma:push` (= `prisma db push`) là thao tác **phá huỷ trên DB
thật** — không phải thao tác an toàn để chạy tuỳ tiện. Sự thật đã kiểm
chứng, không phải suy đoán:

- Lệnh này **KHÔNG** có cờ `--accept-data-loss`, nên Prisma sẽ **DỪNG lại và
  in cảnh báo liệt kê từng thay đổi phá huỷ**, chờ xác nhận — nó không âm
  thầm xoá gì cả.
- Khi xác nhận, nó sẽ:
  1. **DROP 8 bảng cũ** thuộc schema trước P1b (`ProductConfig`,
     `OptionGroup`, `OptionValue`, `CompatibilityRule`, `PriceRule`,
     `Design`, `DesignSelection`, `ProductionJob`).
  2. **Viết lại bảng `Shop`**: cột `shop` (cũ) → `shopDomain` (mới), kiểu
     `NOT NULL` và **không có default**. Hàng `Shop` hiện tại trong DB —
     bản ghi duy nhất giữ `accessToken` OAuth của store — **không sống sót
     qua thao tác này**.
- Hệ quả trực tiếp: **mất `accessToken` đã lưu**. App sẽ không gọi được
  Admin API cho tới khi cài lại.

### Thứ tự thao tác (làm đúng thứ tự, không đảo)

1. Xác nhận đã backup nếu DB có dữ liệu thật cần giữ (dev/demo — không bắt
   buộc, nhưng nên chụp lại nếu không chắc).
2. Đặt `DATABASE_URL` và `DIRECT_URL` trỏ đúng project Supabase định áp
   schema (không chạy nhầm lên project khác).
3. Chạy `npm run prisma:push`. Đọc kỹ danh sách cảnh báo phá huỷ Prisma in
   ra — đây là cơ hội DUY NHẤT để dừng lại trước khi mất dữ liệu. Xác nhận
   khi đã chắc.
4. **Cài lại app qua Shopify OAuth ngay sau khi push xong** — bảng `Shop` giờ
   trống, mọi route đọc `accessToken` sẽ lỗi cho tới khi có hàng mới:
   - Shopify Admin của shop (`wildandking-demo.myshopify.com` hoặc store
     thật) → gỡ cài app cũ nếu còn (không bắt buộc, nhưng dọn sạch trạng thái
     cũ).
   - Mở lại install link (Partners Dashboard → App → Distribution → Custom
     distribution → Install link), hoặc `GET /api/auth?shop=<shop>`.
   - Hoàn tất OAuth flow → `api/auth/callback` tạo lại hàng `Shop` mới với
     `accessToken` hiện hành.
5. Xác nhận: một request Admin API thật (ví dụ qua embedded admin) trả dữ
   liệu, không phải lỗi thiếu `Shop` hay token hết hạn.
6. Chạy các bước ở mục 0–5 phía trên (tạo bucket, CORS, service-role key,
   biến môi trường) nếu chưa làm — schema mới không tự tạo bucket Storage.

**Không có bước "seed dữ liệu mẫu" sau khi push** — `prisma/seed.mjs` đã bị
xoá cùng schema cũ (P1b Task 2); dữ liệu attribute/product nhập qua admin UI
(P2) hoặc Prisma Studio thủ công.
