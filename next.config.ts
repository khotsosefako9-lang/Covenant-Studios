import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg and pg-boss use Node built-ins; keep them out of the bundle.
  serverExternalPackages: ["pg", "pg-boss"],
};

export default nextConfig;
