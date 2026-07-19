import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typedRoutes: true,
  devIndicators: false,
  transpilePackages: ["@agent-trace/dashboard-ui"]
};

export default nextConfig;
