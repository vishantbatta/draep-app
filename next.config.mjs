/** @type {import('next').NextConfig} */

// Backend origin (no trailing slash). All API calls and /uploads/* are
// proxied through the Next.js dev/server so the browser sees everything
// as same-origin — no CORS headers needed anywhere.
const BACKEND_ORIGIN =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/v\d+$/, "") ??
  "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        // Proxy uploaded assets through the Next.js origin so <img>/fetch
        // calls hit same-origin URLs (eliminates all CORS issues).
        source: "/uploads/:path*",
        destination: `${BACKEND_ORIGIN}/uploads/:path*`,
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

export default nextConfig;
