import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import crypto from "crypto";
import { hmacBypassEnabled } from "@/lib/hmac";
import { isValidShopDomain } from "@/lib/auth/shopDomain";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const shop = url.searchParams.get("shop");
  const code = url.searchParams.get("code");
  const hmac = url.searchParams.get("hmac");

  if (!shop || !code || !hmac) {
    return NextResponse.json({ error: "Missing required OAuth parameters" }, { status: 400 });
  }

  // `shop` becomes the host of a fetch that carries `client_secret` in its
  // body. Validate it before that request can be built, and before the HMAC
  // check, which is skippable via WK_SKIP_HMAC on a developer machine.
  if (!isValidShopDomain(shop)) {
    return NextResponse.json({ error: "Invalid shop domain" }, { status: 400 });
  }

  // Validate HMAC
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const params: [string, string][] = [];
  url.searchParams.forEach((value, key) => {
    if (key !== "hmac" && key !== "signature") {
      params.push([key, value]);
    }
  });
  params.sort(([a], [b]) => a.localeCompare(b));
  const queryString = params.map(([k, v]) => `${k}=${v}`).join("&");

  const calculatedHmac = crypto.createHmac("sha256", secret).update(queryString).digest("hex");

  if (calculatedHmac !== hmac && !hmacBypassEnabled()) {
    return NextResponse.json({ error: "Invalid HMAC signature" }, { status: 400 });
  }

  try {
    // Exchange code for Access Token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || "Failed to retrieve access token");
    }

    // Save or update shop in Database
    await db.shop.upsert({
      where: { shopDomain: shop },
      update: {
        accessToken: tokenData.access_token,
        scope: tokenData.scope,
        installed: true,
        // Cài lại: xoá dấu gỡ cài cũ, nếu không `uninstalledAt` sẽ nói dối.
        uninstalledAt: null,
      },
      create: {
        shopDomain: shop,
        accessToken: tokenData.access_token,
        scope: tokenData.scope,
        installed: true,
        installedAt: new Date(),
      },
    });

    // Redirect to Admin dashboard
    return NextResponse.redirect(`https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`);
  } catch (error: any) {
    console.error("OAuth callback error:", error);
    return NextResponse.json({ error: error.message || "Failed OAuth handshake" }, { status: 500 });
  }
}
