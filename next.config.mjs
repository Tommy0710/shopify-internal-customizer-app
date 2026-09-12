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
        // src/app/admin/* was deleted in P1b (schema it depended on is gone;
        // P2 rebuilds the embedded admin at "/"). This rule is inert today —
        // nothing is served under /admin/* — kept in case that path is ever
        // reused, so the CSP isn't the thing standing between then and a
        // blank iframe.
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
