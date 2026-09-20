import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained server bundle so the Docker image doesn't
  // need to ship node_modules or run `next start` against the full repo.
  output: "standalone",
};

export default nextConfig;
