import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained server bundle so the Docker image doesn't
  // need to ship node_modules or run `next start` against the full repo.
  output: "standalone",
  // A second build next to the usual one (the browser tests build with
  // their own API address into .next-browser, leaving .next alone).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Where nginx does not stand in front (development, the browser tests): the
  // API under the site's own address, as in production, so the session cookie
  // belongs to the page's address.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET;
    if (!target) return [];
    return ["/api", "/uploads"].map((p) => ({ source: `${p}/:path*`, destination: `${target}${p}/:path*` }));
  },
};

export default nextConfig;
