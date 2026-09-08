import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hmacBypassEnabled, verifyShopifyProxySignature } from "@/lib/hmac";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const shop = url.searchParams.get("shop");
    const productId = url.searchParams.get("productId");

    if (!hmacBypassEnabled()) {
      const isValid = verifyShopifyProxySignature(url.searchParams);
      if (!isValid) {
        return NextResponse.json({ error: "Invalid HMAC signature" }, { status: 401 });
      }
    }

    if (!productId) {
      return NextResponse.json({ error: "Missing productId" }, { status: 400 });
    }

    const config = await db.productConfig.findFirst({
      where: {
        shopifyProductId: String(productId),
        ...(shop ? { shop } : {}),
      },
      include: {
        optionGroups: {
          include: {
            values: {
              orderBy: { sortOrder: "asc" },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
        compatibilityRules: true,
        priceRules: true,
      },
    });

    if (!config) {
      return NextResponse.json({
        config: {
          id: "cfg_default",
          productTitle: "Bespoke Customizer",
          basePrice: 65,
          isEnabled: true,
        },
      });
    }

    return NextResponse.json({ config });
  } catch (error: any) {
    console.error("Error loading customizer config:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
