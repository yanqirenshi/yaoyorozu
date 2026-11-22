// Rust サーバへの中継。`/api/<path>` → サーバの `/<path>`(`/api/rpc/get_settings` →
// `/rpc/get_settings`)。通知と途中経過は、この中継を通さず、ブラウザが Rust サーバへ直接つなぐ WebSocket で運ぶ(`api/events.ts`)。
// - トークンはここ(サーバ側)で付け、ブラウザへは渡さない。
// - Host / Origin を確かめる(DNS rebinding・他サイトからの呼び出し対策)。

import { NextResponse, type NextRequest } from "next/server";
import { bodyLimitFor } from "@/server/bodyLimits";
import { readServerPort, readServerToken } from "@/server/localServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 中継してよいのは、サーバが持つ入口だけ。
const ALLOWED = [/^rpc\/[a-z_]+$/, /^health$/];

const LOCAL_HOST = /^(127\.0\.0\.1|localhost):\d+$/i;

function error(code: string, message: string, status: number) {
  return NextResponse.json({ code, message }, { status });
}

/** 自分自身(同じ Host)からの要求だけを通す。 */
function originProblem(request: NextRequest): string | null {
  const host = request.headers.get("host") ?? "";
  if (!LOCAL_HOST.test(host)) return "Host が許可されていません";

  const origin = request.headers.get("origin");
  if (origin === null) {
    // 同一オリジンの GET は Origin を付けないことがある。変更を伴う要求には必須。
    return request.method === "GET" || request.method === "HEAD"
      ? null
      : "Origin がありません";
  }
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && url.host.toLowerCase() === host.toLowerCase()
      ? null
      : "Origin が許可されていません";
  } catch {
    return "Origin が許可されていません";
  }
}

async function relay(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const problem = originProblem(request);
  if (problem) return error("forbidden_origin", problem, 403);

  const { path } = await params;
  const target = path.join("/");
  if (!ALLOWED.some((re) => re.test(target))) {
    return error("not_found", "その入口はありません", 404);
  }

  const token = await readServerToken();
  if (!token) {
    return error(
      "server_unavailable",
      "サーバのトークンを読めません。サーバを起動してください",
      503,
    );
  }
  const port = await readServerPort();

  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  // 本文がサーバの上限を超えるものは、サーバへ送らずに 413 を返す(送ると、サーバが本文の途中で 413 を返して接続を
  // 閉じ、こちらの fetch が失敗して 503 になることがある)。
  const limit = bodyLimitFor(target);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (hasBody && declared > limit) {
    return error("payload_too_large", "送ろうとしたデータが大きすぎます", 413);
  }
  const body = hasBody ? await request.arrayBuffer() : undefined;
  if (body !== undefined && body.byteLength > limit) {
    return error("payload_too_large", "送ろうとしたデータが大きすぎます", 413);
  }
  let upstream: Response;
  try {
    upstream = await fetch(`http://127.0.0.1:${port}/${target}`, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      // ブラウザが切れたら、サーバへの接続も切る。
      signal: request.signal,
    });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return error(
      "server_unavailable",
      "サーバに接続できません。サーバを起動してください",
      503,
    );
  }

  const responseHeaders = new Headers();
  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType) responseHeaders.set("Content-Type", upstreamType);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export { relay as GET, relay as POST };
