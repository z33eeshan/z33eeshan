import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it out of the bundler and let Node
  // require it at runtime.
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Crawls and Common Crawl imports run well past the default limit.
    proxyTimeout: 300_000,
  },
};

export default nextConfig;
