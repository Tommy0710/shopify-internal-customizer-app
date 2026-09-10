export const dynamic = "force-dynamic";

/**
 * Admin nhúng (iframe trong Shopify Admin). CSP `frame-ancestors` cho route này
 * được khai ở `next.config.mjs` — thiếu là trắng trang.
 *
 * P1b để trống có chủ ý: admin cũ chạy trên schema đã bị thay, admin mới thuộc P2.
 */
export default function EmbeddedAdminPage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Wild &amp; King Customizer</h1>
      <p style={{ color: "#6b7280", marginTop: "0.75rem" }}>
        Nền tảng dữ liệu đã sẵn sàng. Giao diện quản trị hai tab (Attributes ·
        Products) sẽ có ở giai đoạn P2.
      </p>
    </main>
  );
}
