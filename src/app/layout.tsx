import type { Metadata } from "next";
import "@shopify/polaris/build/esm/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shopify Internal Custom Product App",
  description: "Internal App & Customizer Management System for Shopify",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <head>
        <meta name="shopify-api-key" content={process.env.SHOPIFY_API_KEY || "21102b2e2138173c5ab87e5ad38ef1e4"} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&family=Montserrat:wght@400;600;700&family=Pacifico&family=Playfair+Display:ital,wght@0,600;1,400&family=Roboto:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
