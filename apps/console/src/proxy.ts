// 画面(HTML)の応答に Content-Security-Policy を付ける(Next.js の Proxy。旧称 middleware)。
//
// ねらい: Markdown の無害化(`safeMarkdown.ts`)を万一抜けた細工が入っても、(a) インラインのスクリプト・
// on 属性が実行されず、(b) 外への送信・読み込み(画像・fetch・`@import` など)が出ていかない、二重の守り。
// 画面の内容(CLAUDE.md・会話)は clone したリポジトリやエージェントが書くので、外から細工が入りうる。
//
// - スクリプトは**リクエストごとの nonce** + `'strict-dynamic'` だけ(`'unsafe-inline'` は付けない)。
//   Next はこのヘッダーから nonce を取り出し、自分の(インラインを含む)スクリプトに付ける。
//   nonce を付けるには動的な描画が要るため、ルートの layout で `connection()` を呼んでいる。
// - `connect-src 'self' ws://127.0.0.1:<サーバのポート>`: fetch は同じオリジン(中継)だけ。通知と途中経過の WebSocket は、
//   Rust サーバのポートへ直接(ワイルドカードにしない)。ポートは実行時に決まるので、サーバが書いたポートのファイルを読む
//   (サーバを起動し直して変わっても、次の画面の応答から追従する)。外へは送れない。
// - `img-src 'self' data: blob:`: 外部の画像は読み込まない(読み込むだけで、開いたことが外へ伝わるため)。
//   会話の中の外部の画像は表示されなくなる(了承済み)。
// - `style-src 'self' 'unsafe-inline'`: command-dock・markdown.sitter が Shadow DOM の中に `<style>` を
//   入れる(nonce を付けられない)ため、インラインのスタイルは許す。スタイル経由の外部読み込みは
//   `img-src`・`font-src`・`default-src` が止める。Markdown の HTML からは `<style>`・`style` 属性を落としている。
// - 開発(`next dev`)だけ、React の都合で `'unsafe-eval'` と HMR の `ws:` を足す。本番(`next start`)には付けない。

import { NextResponse, type NextRequest } from "next/server";
import { readServerPort } from "@/server/localServer";

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const serverPort = await readServerPort();
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `connect-src 'self' ws://127.0.0.1:${serverPort}${isDev ? " ws:" : ""}`,
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // 中継(`/api/*`)・静的ファイルには付けない(HTML の応答にだけ付ける)。
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
