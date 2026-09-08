import { NextResponse, type NextRequest } from "next/server";
import { writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { LAYOUT_DIAGRAMS, type LayoutDiagram } from "@/data/layoutSaveApi";

function isLayoutDiagram(value: string): value is LayoutDiagram {
  return (LAYOUT_DIAGRAMS as readonly string[]).includes(value);
}

// App(Tauri)側のローカルAPI(native.md §7)。ポートは apps/native の
// `app::LOCAL_API_PORT` と同じ値をここに複製する(Web側からRustのソースは
// 参照できないため。変更時は両方揃えること。issue #123)。
const LOCAL_API_BASE_URL = "http://127.0.0.1:14200";

// 認証トークンの保存場所(native.md §7)。Windows の app_data_dir は
// `%APPDATA%\<identifier>`(`apps/native/tauri/tauri.conf.json` の
// identifier)。ブラウザへは渡さず、Next.js サーバ側でのみ読む。
function localApiTokenPath(): string | null {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  // 実行時の環境変数に依存する動的パスであり、ビルド時のファイルトレース
  // (Turbopack NFT)対象ではない(誤ってプロジェクト全体をトレースしようと
  // する警告が出るため明示的に無視する)。
  return path.join(
    /* turbopackIgnore: true */ appData,
    "com.yaoyorozu.native",
    "local-api-token",
  );
}

async function readLocalApiToken(): Promise<string | null> {
  const tokenPath = localApiTokenPath();
  if (!tokenPath) return null;
  try {
    return (await readFile(tokenPath, "utf-8")).trim();
  } catch {
    // App が一度も起動していない(トークンファイルが無い)場合もここに来る。
    // App未起動と同じ扱いにする(フォールバック判定へ進む)。
    return null;
  }
}

// 保存先パスはフロントから受け取らずサーバ側(許可リスト)で解決する。
async function writeLayoutFileDirectly(
  diagram: LayoutDiagram,
  body: unknown,
): Promise<void> {
  const filePath = path.join(
    process.cwd(),
    "src/data/layout",
    `${diagram}.json`,
  );
  await writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`, "utf-8");
}

// レイアウト保存APIは web.md §2 の「API・DBは導入しない」の唯一の例外。
// 保存の実体は App(Tauri)のローカルAPI(native.md §7)へのプロキシとし、
// このRoute Handlerはファイルへは直接書き込まない(issue #123)。
// App未起動時は、開発時のみ従来のfs直接書き込みへフォールバックする。
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ diagram: string }> },
) {
  const { diagram } = await params;
  if (!isLayoutDiagram(diagram)) {
    return NextResponse.json({ error: "unknown diagram" }, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // apps/web から見たリポジトリルート(`<repo_root>/apps/web`)。Appの
  // 登録済みプロファイルの repository_path と完全一致する必要がある
  // (native.md §7)。
  const repoRoot = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    "..",
    "..",
  );
  const token = await readLocalApiToken();

  if (token) {
    try {
      const res = await fetch(`${LOCAL_API_BASE_URL}/layout/${diagram}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ repo_root: repoRoot, overrides: body }),
      });
      if (res.ok) {
        return NextResponse.json({ ok: true });
      }
      // Appが返した明確なエラー(401/403/404等)をそのまま伝える。
      const message = await res.text().catch(() => "");
      return NextResponse.json(
        { error: message || "Appでの保存に失敗しました" },
        { status: res.status },
      );
    } catch {
      // 接続エラー(App未起動等)。フォールバック判定へ進む。
    }
  }

  if (process.env.NODE_ENV === "development") {
    await writeLayoutFileDirectly(diagram, body);
    console.warn(
      `[layout] App(YAOYOROZU)に到達できないため、fsへの直接書き込みにフォールバックしました(diagram=${diagram})`,
    );
    return NextResponse.json({ ok: true, fallback: true });
  }

  return NextResponse.json(
    { error: "App(YAOYOROZU)が起動していません" },
    { status: 503 },
  );
}
