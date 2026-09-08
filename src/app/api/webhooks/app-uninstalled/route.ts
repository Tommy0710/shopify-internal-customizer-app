import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hmacBypassEnabled, verifyShopifyWebhook } from "@/lib/hmac";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
    const shopHeader = req.headers.get("x-shopify-shop-domain") || "";

    if (!hmacBypassEnabled()) {
      const isValid = verifyShopifyWebhook(rawBody, hmacHeader);
      if (!isValid) {
        return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
      }
    }

    if (shopHeader) {
      await db.shop.updateMany({
        where: { shop: shopHeader },
        data: { installed: false },
      });
      console.log(`App uninstalled from shop: ${shopHeader}`);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error in app-uninstalled webhook:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
