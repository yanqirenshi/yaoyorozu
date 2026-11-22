import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // モノレポのルート(複数の lockfile があっても、作業フォルダの外を根にしない)。
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  // SSE(`/api/events`)を圧縮でまとめさせない(段階 1 で確かめる最重要点)。
  compress: false,
};

export default nextConfig;
