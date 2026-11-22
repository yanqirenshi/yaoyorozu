import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // モノレポのルート(複数の lockfile があっても、作業フォルダの外を根にしない)。
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  // 中継の応答を圧縮でまとめさせない(もとは SSE のため。通知と途中経過が WebSocket に移ったあとも、挙動を変えないため外していない)。
  compress: false,
};

export default nextConfig;
