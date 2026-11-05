import type { NextConfig } from "next";

// Tokens live in the browser's storage, so a script slipped into a page must
// have nowhere to send them: connections go to our own API only. Inline
// scripts stay allowed because Next.js needs them without per-request nonces.
function contentSecurityPolicy() {
  const api = process.env.NEXT_PUBLIC_API_URL || "";
  const apiOrigin = /^https?:/.test(api) ? new URL(api).origin : "";
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src 'self' data: blob: https://api.qrserver.com ${apiOrigin}`,
    // Call recordings play straight from the telephony provider (a short-lived link).
    `media-src 'self' blob: https://api.zadarma.com ${apiOrigin}`,
    `connect-src 'self' ${apiOrigin}`,
    `frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com ${apiOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ").replace(/\s+;/g, ";");
}

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
  // Not in development: its hot reload needs eval and its own socket.
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy() }] }];
  },
};

export default nextConfig;
