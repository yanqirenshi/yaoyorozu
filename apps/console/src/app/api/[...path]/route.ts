// Rust サーバへの中継。`/api/<path>` → サーバの `/<path>`(`/api/rpc/get_settings` →
// `/rpc/get_settings`、`/api/events` → `/events`)。
// - トークンはここ(サーバ側)で付け、ブラウザへは渡さない。
// - Host / Origin を確かめる(DNS rebinding・他サイトからの呼び出し対策)。
// - SSE は本文をそのまま流す(まとめない・貯めない)。

import { NextResponse, type NextRequest } from "next/server";
import { readServerPort, readServerToken } from "@/server/localServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 中継してよいのは、サーバが持つ入口だけ。
const ALLOWED = [/^rpc\/[a-z_]+$/, /^events$/, /^health$/];

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
    // 同一オリジンの GET(EventSource 等)は Origin を付けない。変更を伴う要求には必須。
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
  const isEvents = target === "events";
  if (isEvents) headers.set("Accept", "text/event-stream");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(`http://127.0.0.1:${port}/${target}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      // ブラウザが切れたら、サーバへの接続も切る(SSE の購読が残らないように)。
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
  if (isEvents) {
    // 途中の変換・圧縮・貯め込みをさせない。
    responseHeaders.set("Cache-Control", "no-cache, no-transform");
    responseHeaders.set("X-Accel-Buffering", "no");
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export { relay as GET, relay as POST };
