import { NextRequest, NextResponse } from "next/server";
import { isValidShopDomain } from "@/lib/auth/shopDomain";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return NextResponse.json({ error: "Missing shop parameter" }, { status: 400 });
  }

  // `shop` is interpolated into the redirect host below. Anything that is not
  // a real *.myshopify.com domain would send the user off a trusted origin.
  if (!isValidShopDomain(shop)) {
    return NextResponse.json({ error: "Invalid shop domain" }, { status: 400 });
  }

  const clientId = process.env.SHOPIFY_API_KEY || "";
  const scopes = process.env.SCOPES || "read_products,write_products,read_orders,write_orders,read_themes,write_themes";
  const redirectUri = `${process.env.SHOPIFY_APP_URL || "http://localhost:3000"}/api/auth/callback`;

  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${encodeURIComponent(
    scopes
  )}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return NextResponse.redirect(installUrl);
}
