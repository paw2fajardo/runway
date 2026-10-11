import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig: NextConfig = {
  output: "standalone",
  // libsql loads its platform binary dynamically, so tracing can miss it.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@libsql/linux-*/**/*"],
  },
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default function config(phase: string): NextConfig {
  return {
    ...nextConfig,
    // Keep production builds from replacing a running dev server's manifests.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  };
}
