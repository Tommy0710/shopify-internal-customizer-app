# Runbook — Rotate credential

Chạy quy trình này khi: có người rời dự án, nghi ngờ lộ secret, hoặc secret
từng bị commit vào git.

> **Lịch sử:** `SHOPIFY_API_SECRET` và password Supabase từng được commit
> trong `README.md` (đã xoá ở commit của P0). Giá trị vẫn nằm trong git
> history, nên **hai secret đó phải được rotate** — xoá file không đủ.

## 1. Shopify API secret

1. Shopify Partners → Apps → **Wild & King Customizer** → API credentials.
2. Bấm **Rotate** cho client secret. Ghi lại giá trị mới.
3. Cập nhật `SHOPIFY_API_SECRET`:
   - Vercel → project `wild-king-customizer` → Settings → Environment Variables (scope Production)
   - File `.env` cục bộ của từng người
4. Vercel → Deployments → **Redeploy** (biến môi trường chỉ có hiệu lực sau redeploy).
5. Kiểm chứng: một request App Proxy thật phải trả 200, và một request sai
   chữ ký phải trả 401.

**Ảnh hưởng:** secret này dùng để verify HMAC của App Proxy và webhook.
Giữa lúc rotate và lúc redeploy xong, request sẽ bị từ chối. Làm ngoài giờ
cao điểm.

## 2. Password database Supabase

1. Supabase → Project Settings → Database → **Reset database password**.
2. Cập nhật **cả hai** connection string — chúng dùng chung một password:
   - `DATABASE_URL` — pooled, port `6543`, giữ nguyên `?pgbouncer=true&connection_limit=1`
   - `DIRECT_URL` — direct, port `5432`
3. Cập nhật ở cả Vercel và `.env` cục bộ.
4. Vercel → Redeploy.
5. Kiểm chứng: mở `/admin`, KPI phải load được (không có `PrismaClientInitializationError`).

## 3. Access token của shop

Access token lưu trong bảng `Shop` không tự hết hạn. Nếu cần thu hồi:

1. Shopify Admin của shop → Settings → Apps → gỡ cài **Wild & King Customizer**.
   Webhook `app/uninstalled` sẽ đặt `Shop.installed = false`.
2. Cài lại app để cấp token mới.

## 4. Sau khi rotate

- [ ] Xác nhận không còn secret trong file đang theo dõi:
      `git grep -n "shpss_\|pooler.supabase.com"`
- [ ] Repo vẫn để **private**.
- [ ] Ghi lại ngày rotate ở cuối file này.

## Nhật ký rotate

| Ngày | Secret | Người thực hiện | Lý do |
|---|---|---|---|
| | | | |
