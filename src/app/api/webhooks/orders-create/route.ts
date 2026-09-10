import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook, hmacBypassEnabled } from "@/lib/hmac";

export const dynamic = "force-dynamic";

/**
 * Nhận và xác thực webhook đơn hàng.
 *
 * P1b rút route này còn phần xác thực: nghiệp vụ cũ chạy trên schema đã bị thay.
 * P4 dựng lại đầy đủ — idempotency hai lớp (`WebhookEvent` + `OrderLineDesign`),
 * đối soát nhóm dòng MAIN/ADDON, tạo bản ghi sản xuất. Xem spec §11.
 *
 * Trả 200 cho mọi payload hợp lệ: Shopify retry khi nhận non-2xx, và ở giai đoạn
 * này không có gì để retry cho thành công.
 */
export async function POST(req: NextRequest) {
  // BẮT BUỘC đọc raw body trước mọi thứ: `req.json()` rồi `JSON.stringify` lại
  // sẽ đổi byte và HMAC sai.
  const rawBody = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");

  if (!hmacBypassEnabled() && !verifyShopifyWebhook(rawBody, hmacHeader)) {
    return NextResponse.json({ error: "INVALID_HMAC" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
