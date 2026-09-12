# Runbook — kiểm tra thủ công admin UI trong Shopify Admin thật

Chạy quy trình này khi: vừa deploy một thay đổi cho admin UI (`src/components/admin/`,
`src/lib/admin-ui/`) lên Vercel, hoặc trước khi cho merchant thật dùng lần đầu sau
phase P2c.

## Vì sao runbook này tồn tại (Ruling R3)

Toàn bộ 756 test của P2c mock `window.shopify.idToken()` qua `stubAppBridge`
(`src/lib/admin-ui/testFetch.ts`) — không test nào chạy trong một iframe Shopify
Admin thật. `adminFetch` (`src/lib/admin-ui/adminFetch.ts`) giả định global đó
tồn tại và trả token hợp lệ ngay khi app được nhúng; giả định này **chưa từng
được xác nhận ngoài test**. Nếu sai — App Bridge không nạp kịp, CSP chặn
`app-bridge.js`, hay token bị `WK_ALLOWED_SHOPS`/session token verify từ chối —
toàn bộ admin UI hỏng ngay từ request đầu tiên, và `npm test` sẽ vẫn xanh vì nó
không chạm tới đường này. Đây là bài kiểm duy nhất đóng lỗ hổng đó. Đây là smoke
test một lần, không phải QA đầy đủ — nếu tất cả các bước dưới đây pass, coi như
đủ để tin tưởng admin UI hoạt động trong môi trường thật.

## Chuẩn bị

- Dev store: `wildandking-demo.myshopify.com` (đã cài app `Wild & King
  Customizer`, xem README mục "Thông tin hệ thống").
- Đăng nhập Shopify Admin bằng tài khoản có quyền truy cập dev store đó.
- Mở DevTools (Console + Network tab) TRƯỚC khi mở app — một số lỗi CORS/CSP chỉ
  log ở request đầu tiên lúc iframe nạp.

## Các bước

1. **Mở app từ Shopify Admin** — Settings → Apps and sales channels → `Wild &
   King Customizer` (hoặc link cài đặt trực tiếp nếu đã có). **Pass** nếu iframe
   hiện ra `AdminShell` (hai tab "Attributes"/"Products") trong vài giây. **Fail**
   nếu trang trắng, hoặc DevTools báo `Refused to display '...' in a frame` —
   đó là dấu hiệu CSP `frame-ancestors` sai (xem Ruling R6, `next.config.mjs`).

2. **Tab Attributes tải dữ liệu thật.** Tab "Attributes" là mặc định khi mở app
   — xác nhận danh sách "Leathers" hiện lên với dữ liệu thật của shop (không kẹt
   ở spinner "Đang tải…", không hiện banner lỗi đỏ). Bấm qua ba sub-nav còn lại
   (Stitches, Animals, Styles) — mỗi cái phải tự tải danh sách riêng, không kẹt
   spinner, không banner lỗi.

3. **Round-trip tạo/sửa một attribute.** Ở nhóm bất kỳ (khuyên dùng Leathers):
   bấm "Add", điền tên + các field bắt buộc, lưu. **Pass** nếu drawer đóng lại
   và item mới xuất hiện ngay trong danh sách. Mở lại item vừa tạo, sửa tên, lưu
   lần nữa — xác nhận tên mới hiện trong danh sách. Nếu có sẵn item cũ không cần
   giữ, thử luôn "Archive"/"Restore" một item để xác nhận round-trip đó cũng
   chạy.

4. **Tab Products tải dữ liệu thật.** Chuyển sang tab "Products" — danh sách
   product (hoặc trang trống hợp lệ nếu shop chưa có product nào cấu hình) phải
   hiện ra, không kẹt spinner, không banner lỗi. Nếu có ít nhất một product,
   bấm vào để mở detail — các section (Hosts, Styles & body pricing, Animals &
   applique pricing, SVG mockups, Stitches) đều phải tải xong, không phải mỗi
   section kẹt tải mãi.

5. **Console sạch.** Xem lại tab Console lẫn Network trong DevTools từ lúc mở
   app tới hết bước 4. **Pass** nếu không có dòng nào nhắc tới `CORS`,
   `Content-Security-Policy`, hay `frame-ancestors`. Một vài warning vô hại từ
   Shopify Admin/App Bridge (không liên quan tới domain của app này) không tính
   là fail.

## Nếu fail

Đừng đoán — bước fail nào cũng nên tái hiện lại bằng cách mở Network tab và xem
đúng request nào trả về lỗi gì, request đó có header `Authorization: Bearer …`
hay không (thiếu header nghĩa là `window.shopify.idToken()` không chạy được
phía client, không phải lỗi server), rồi mới sửa. Ghi lại kết quả (pass/fail +
ảnh chụp lỗi nếu có) vào issue/PR liên quan trước khi merge tiếp.
