import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

/**
 * Admin nhúng (iframe trong Shopify Admin). CSP `frame-ancestors` cho route này
 * được khai ở `next.config.mjs` — thiếu là trắng trang.
 *
 * Ruling R6: MỌI thứ của admin UI render dưới đúng route "/" này — không tạo
 * `page.tsx` mới ở route khác. `next.config.mjs` chỉ khai CSP `frame-ancestors`
 * cho "/" (và một `/admin/:path*` bất hoạt); một trang thật ở route khác sẽ
 * phục vụ THIẾU header đó và Shopify Admin âm thầm từ chối iframe — tab trắng,
 * không log lỗi. Chuyển tab bên trong `AdminShell` là state React, không phải
 * điều hướng route.
 */
export default function EmbeddedAdminPage() {
  return <AdminShell />;
}
