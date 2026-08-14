import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      "@yanqirenshi/d3.classes":
        "../../node_modules/@yanqirenshi/d3.classes/dist/class.js",
      "@yanqirenshi/colonoscope":
        "../../node_modules/@yanqirenshi/colonoscope/dist/index.js",
    },
  },
};

export default nextConfig;
