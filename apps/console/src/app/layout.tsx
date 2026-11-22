import type { Metadata } from "next";
import AppShell from "./AppShell";
import "./App.css";

export const metadata: Metadata = {
  title: "YAOYOROZU",
  description: "YAOYOROZU(Next.js + Rust サーバ)",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
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
