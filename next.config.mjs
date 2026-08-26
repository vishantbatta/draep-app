import withPwaInit from "next-pwa";

/** @type {import('next-pwa').PWAConfig} */
const pwaConfig = {
  dest: "public",
  register: true,
  skipWaiting: true,
  clientsClaim: true,
  disable: process.env.NODE_ENV === "development",
  // Next emits `/_next/app-build-manifest.json` but never serves it in
  // production — precacheing it makes the workbox install fail on its 404,
  // so the service worker never activates and Chrome never offers an install.
  buildExcludes: [/app-build-manifest\.json$/],
  fallbacks: {
    document: "/offline",
  },
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "google-fonts-cache",
        expiration: {
          maxEntries: 10,
          maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
        },
      },
    },
    {
      urlPattern: /\.(?:eot|otf|ttc|ttf|woff|woff2|font.css)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-font-assets",
        expiration: {
          maxEntries: 16,
          maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
        },
      },
    },
    {
      urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-image-assets",
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
        },
      },
    },
    {
      urlPattern: /\.(?:js|css)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-resources",
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
        },
      },
    },
    {
      // Backend API + image proxies (same-origin /uploads, /designs, /api/v1)
      urlPattern: /\/(?:api|uploads|designs)\//i,
      handler: "NetworkFirst",
      method: "GET",
      options: {
        cacheName: "api-cache",
        networkTimeoutSeconds: 5,
        expiration: {
          maxEntries: 48,
          maxAgeSeconds: 60 * 60 * 24, // 24h
        },
      },
    },
    {
      // App shell: serve cached HTML if network fails
      urlPattern: /\/$/i,
      handler: "NetworkFirst",
      options: {
        cacheName: "html-cache",
        networkTimeoutSeconds: 5,
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 60 * 60 * 24, // 24h
        },
      },
    },
  ],
};

const withPwa = withPwaInit(pwaConfig);

/** @type {import('next').NextConfig} */

// Backend origin (no trailing slash). All API calls and /uploads/* are
// proxied through the Next.js dev/server so the browser sees everything
// as same-origin — no CORS headers needed anywhere.
const BACKEND_ORIGIN =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/v\d+$/, "") ??
  "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  // TEMP(verify): allow building to a scratch dir so verification builds
  // don't clobber the running dev server's .next. Remove before commit.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  async headers() {
    return [
      {
        // The service worker must always be fetched fresh: a browser may
        // reuse an HTTP-cached sw.js on first registration and for up to 24h
        // on update checks. Vercel's default for public/ statics is
        // max-age=14400, which would pin phones to a stale (possibly broken)
        // worker across deploys.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        // /app/orders has no index page — the orders list lives on /app.
        // Forward admin login links (/app/orders/?token=…) to the dashboard;
        // the query string (incl. the token) is preserved automatically.
        source: "/app/orders",
        destination: "/app",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        // Proxy uploaded assets through the Next.js origin so <img>/fetch
        // calls hit same-origin URLs (eliminates all CORS issues).
        source: "/uploads/:path*",
        destination: `${BACKEND_ORIGIN}/uploads/:path*`,
      },
      {
        // Proxy design library hero images (served by FastAPI from
        // be/storage/designs/*) so browser URLs stay same-origin.
        source: "/designs/:path*",
        destination: `${BACKEND_ORIGIN}/designs/:path*`,
      },
      {
        // Proxy all backend API calls. Combined with admin-api.ts / api/client.ts
        // using relative /api/v1/* URLs, this makes every backend request
        // same-origin — no CORS middleware needed on the FastAPI side.
        source: "/api/v1/:path*",
        destination: `${BACKEND_ORIGIN}/api/v1/:path*`,
      },
    ];
  },
};

export default withPwa(nextConfig);
