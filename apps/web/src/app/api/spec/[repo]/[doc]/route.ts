import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

// #543/#544: 複数リポジトリの仕様データを、実行時に `{repository_path}/yyz/spec/{doc}.json`
// から読んで返す唯一の口。クライアントはリポジトリ名・ドキュメント名だけを渡し、
// パスはこのサーバ側でだけ組み立てる(web.md・native.md §4 と同じ考え方)。

/** 現時点で読めるドキュメント名の許可リスト。増やすときはここへ足す。 */
const SPEC_DOCS = ["wbs", "deployment", "unchi"] as const;
type SpecDoc = (typeof SPEC_DOCS)[number];
function isSpecDoc(value: string): value is SpecDoc {
  return (SPEC_DOCS as readonly string[]).includes(value);
}

// App(Tauri)の app_data_dir(native.md §7)。Windows では `%APPDATA%\<identifier>`
// (`apps/native/tauri/tauri.conf.json` の identifier)。ここは日々の作業用の MSI 版
// (`com.yaoyorozu.native`)固定で、開発版(別 identifier)は対象にしない
// (src/app/api/layout/[diagram]/route.ts と同じ前例・同じ理由)。
function localApiDataDir(): string | null {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return path.join(/* turbopackIgnore: true */ appData, "com.yaoyorozu.native");
}

/** App が永続化しているプロファイル1件分。読むのは repository_path だけ。 */
type Profile = { repository_path?: string | null };
type Settings = { profiles?: Profile[] };

/**
 * App の `settings.json` を読む。App が一度も起動していない・壊れている等で
 * 読めない場合は null(呼び出し側が「app が起動していない」旨のエラーにする)。
 */
async function readSettings(): Promise<Settings | null> {
  const dataDir = localApiDataDir();
  if (!dataDir) return null;
  try {
    const raw = await readFile(
      /* turbopackIgnore: true */ path.join(dataDir, "settings.json"),
      "utf-8",
    );
    return JSON.parse(raw) as Settings;
  } catch {
    return null;
  }
}

type ResolveResult =
  | { ok: true; repoPath: string }
  | { ok: false; reason: "settings-unreadable" }
  | { ok: false; reason: "repo-not-found" };

/**
 * リポジトリ名から実パスを引く。名前は `repository_path` の末尾のフォルダ名
 * (重複時の扱いは #544 では考えない。見つかった最初の一致を使う)。
 */
async function resolveRepoPath(repo: string): Promise<ResolveResult> {
  const settings = await readSettings();
  if (!settings) return { ok: false, reason: "settings-unreadable" };
  for (const profile of settings.profiles ?? []) {
    if (!profile.repository_path) continue;
    if (path.basename(profile.repository_path) === repo) {
      return { ok: true, repoPath: profile.repository_path };
    }
  }
  return { ok: false, reason: "repo-not-found" };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ repo: string; doc: string }> },
) {
  const { repo, doc } = await params;

  if (!isSpecDoc(doc)) {
    return NextResponse.json({ error: `未知のドキュメントです: ${doc}` }, { status: 404 });
  }

  const resolved = await resolveRepoPath(repo);
  if (!resolved.ok) {
    if (resolved.reason === "settings-unreadable") {
      return NextResponse.json(
        {
          error:
            "app(YAOYOROZU)の設定を読めませんでした。app を一度起動してリポジトリを登録してください。",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: `リポジトリ "${repo}" が app の設定に見つかりません。` },
      { status: 404 },
    );
  }

  const filePath = path.join(resolved.repoPath, "yyz", "spec", `${doc}.json`);
  try {
    const raw = await readFile(/* turbopackIgnore: true */ filePath, "utf-8");
    return new NextResponse(raw, {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return NextResponse.json(
      { error: `リポジトリ "${repo}" には仕様データ(${doc})がありません。` },
      { status: 404 },
    );
  }
}
