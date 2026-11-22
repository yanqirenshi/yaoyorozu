import type { Metadata } from "next";
import { connection } from "next/server";
import AppShell from "./AppShell";
import "./App.css";

export const metadata: Metadata = {
  title: "YAOYOROZU",
  description: "YAOYOROZU(Next.js + Rust サーバ)",
};

// リクエストごとの nonce(Content-Security-Policy。`src/proxy.ts`)を付けるため、動的に描画する。
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return (
    <html lang="ja">
      <body>
        {/* App.css は Vite 版の `#root` に高さを与えている。同じ見た目にそろえる。 */}
        <div id="root">
          <AppShell>{children}</AppShell>
        </div>
      </body>
    </html>
  );
}
