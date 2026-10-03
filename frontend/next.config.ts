import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained server bundle so the Docker image doesn't
  // need to ship node_modules or run `next start` against the full repo.
  output: "standalone",
  // A second build next to the usual one (the browser tests build with
  // their own API address into .next-browser, leaving .next alone).
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
