/** @type {import('next').NextConfig} */

// Who may frame the embedded admin. Anything not listed cannot iframe it.
const embeddedAdminCsp = {
  key: "Content-Security-Policy",
  value: "frame-ancestors https://*.myshopify.com https://admin.shopify.com;",
};

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // The real embedded admin is src/app/page.tsx, served at "/".
        source: "/",
        headers: [embeddedAdminCsp],
      },
      {
        // The older /admin/* route tree renders the same screens.
        source: "/admin/:path*",
        headers: [embeddedAdminCsp],
      },
      {
        // App Proxy requests need to support CORS or iframe embedding
        source: "/api/proxy/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
    ];
  },
};

export default nextConfig;
