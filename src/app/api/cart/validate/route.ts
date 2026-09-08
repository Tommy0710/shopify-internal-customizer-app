import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calculateServerPrice } from "@/lib/pricing/pricingEngine";
import { hmacBypassEnabled, verifyShopifyProxySignature } from "@/lib/hmac";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);

    // This route writes Design/DesignSelection rows. It is reached through the
    // App Proxy, so it carries the same signature its /api/proxy/* siblings do.
    if (!hmacBypassEnabled()) {
      const isValid = verifyShopifyProxySignature(url.searchParams);
      if (!isValid) {
        return NextResponse.json({ error: "Invalid HMAC signature" }, { status: 401 });
      }
    }

    const body = await req.json();
    const { configId, productId, variantId, selections = {}, engravingText, engravingFont, previewUrl } = body;

    // Validate config and compute server price
    let pricing = await calculateServerPrice(configId, selections);

    if (!pricing.valid && !configId) {
      // Fallback calculation for basic configs
      pricing = {
        valid: true,
        errors: [],
        basePrice: 65,
        extraPrice: 0,
        totalPrice: 65,
        breakdown: [],
        selectionsDetail: Object.entries(selections).map(([k, v]) => ({
          groupName: k,
          valueName: String(v),
          extraPrice: 0,
        })),
      };
    }

    if (!pricing.valid) {
      return NextResponse.json({ valid: false, errors: pricing.errors }, { status: 400 });
    }

    // Create Design Record in DB
    const designId = "dsg_" + crypto.randomUUID().slice(0, 8);

    const savedDesign = await db.design.create({
      data: {
        id: designId,
        productConfigId: configId || null,
        shop: req.headers.get("x-shopify-shop-domain") || "wildandking-demo.myshopify.com",
        productId: String(productId || "8129384729101"),
        variantId: variantId ? String(variantId) : null,
        engravingText: engravingText || null,
        engravingFont: engravingFont || null,
        previewUrl: previewUrl || null,
        totalExtraPrice: pricing.extraPrice,
        rawSelections: JSON.stringify(selections),
        pricingJson: JSON.stringify(pricing.breakdown),
        status: "DRAFT",
        selections: {
          create: pricing.selectionsDetail.map((s) => ({
            groupName: s.groupName,
            valueName: s.valueName,
            extraPrice: s.extraPrice,
          })),
        },
      },
    });

    // Create Summary Properties for Shopify Cart
    const summaryProperties: Record<string, string> = {
      _custom_design_id: savedDesign.id,
    };

    pricing.selectionsDetail.forEach((s) => {
      summaryProperties[s.groupName] = s.valueName;
    });

    if (engravingText) {
      summaryProperties["Laser Engraving"] = `"${engravingText}" (${engravingFont || "Default"})`;
    }

    if (pricing.extraPrice > 0) {
      summaryProperties["Bespoke Fee"] = `+$${pricing.extraPrice.toFixed(2)}`;
    }

    return NextResponse.json({
      valid: true,
      designId: savedDesign.id,
      calculatedExtraPrice: pricing.extraPrice,
      summaryProperties,
    });
  } catch (error: any) {
    console.error("Cart validate error:", error);
    return NextResponse.json({ valid: false, errors: [error.message] }, { status: 500 });
  }
}
