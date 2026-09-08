/**
 * 図のレイアウト調整(ノード座標・サイズ)を保存API
 * (`POST /api/layout/<diagram>`)経由でリポジトリ内ファイル
 * (`src/data/layout/<diagram>.json`)へ保存するための共通クライアント。
 * web.md §2 の例外規定に従う。実体はApp(Tauri)のローカルAPIへの
 * プロキシで、App未起動時のみ開発時に限りfsへ直接書き込む(issue #123)。
 */

export const LAYOUT_DIAGRAMS = ["sitemap", "classes", "tm"] as const;
export type LayoutDiagram = (typeof LAYOUT_DIAGRAMS)[number];

export type LayoutSaveResult = {
  ok: boolean;
  status: number;
  /** 保存に失敗した場合、Appまたはサーバから返された具体的な理由。 */
  message?: string;
};

function extractErrorMessage(body: unknown): string | undefined {
  if (
    body !== null &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  return undefined;
}

export async function saveLayoutToApi(
  diagram: LayoutDiagram,
  overrides: unknown,
): Promise<LayoutSaveResult> {
  try {
    const res = await fetch(`/api/layout/${diagram}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overrides),
    });
    if (res.ok) {
      return { ok: true, status: res.status };
    }
    const body: unknown = await res.json().catch(() => null);
    return { ok: false, status: res.status, message: extractErrorMessage(body) };
  } catch {
    return { ok: false, status: 0 };
  }
}
