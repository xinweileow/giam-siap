import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the browser-preview tooling (proxied through 127.0.0.1) hit the dev server's HMR
  // endpoint without Next.js's cross-origin dev warning; harmless in production (unused there).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
