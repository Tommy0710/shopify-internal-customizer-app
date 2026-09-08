import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hmacBypassEnabled, verifyShopifyWebhook } from "@/lib/hmac";

export const dynamic = "force-dynamic";

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

    const order = JSON.parse(rawBody);
    console.log(`📦 Order Webhook: Order #${order.order_number} (ID: ${order.id}) from ${shopHeader}`);

    const matchedJobs: string[] = [];

    if (order.line_items && Array.isArray(order.line_items)) {
      for (const lineItem of order.line_items) {
        const designProp = lineItem.properties?.find(
          (p: { name: string; value: string }) => p.name === "_custom_design_id"
        );

        if (designProp && designProp.value) {
          const designId = designProp.value;

          try {
            // Update Design status to ORDERED
            await db.design.update({
              where: { id: designId },
              data: { status: "ORDERED" },
            });

            // Create Production Job
            const job = await db.productionJob.upsert({
              where: { designId },
              update: {
                shopifyOrderId: String(order.id),
                shopifyOrderNumber: String(order.order_number),
                customerEmail: order.email || order.customer?.email || null,
                shippingAddress: order.shipping_address ? `${order.shipping_address.address1}, ${order.shipping_address.city}` : null,
                status: "NEW",
              },
              create: {
                designId,
                shopifyOrderId: String(order.id),
                shopifyOrderNumber: String(order.order_number),
                customerEmail: order.email || order.customer?.email || null,
                shippingAddress: order.shipping_address ? `${order.shipping_address.address1}, ${order.shipping_address.city}` : null,
                status: "NEW",
                notes: `Line item: ${lineItem.title}`,
              },
            });

            matchedJobs.push(job.id);
          } catch (dbErr) {
            console.warn(`Could not link design ${designId} with production job:`, dbErr);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      orderNumber: order.order_number,
      createdJobsCount: matchedJobs.length,
    });
  } catch (error: any) {
    console.error("Webhook processing error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
