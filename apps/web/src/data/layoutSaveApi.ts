/**
 * 図のレイアウト調整(ノード座標・サイズ)を、開発時専用の保存API
 * (`POST /api/layout/<diagram>`)経由でリポジトリ内ファイル
 * (`src/data/layout/<diagram>.json`)へ保存するための共通クライアント。
 * web.md §2 の例外規定に従う。
 */

export const LAYOUT_DIAGRAMS = ["sitemap", "classes", "tm"] as const;
export type LayoutDiagram = (typeof LAYOUT_DIAGRAMS)[number];

export type LayoutSaveResult = {
  ok: boolean;
  /** 405 のときは本番ビルド(開発サーバー以外)での保存試行を表す。 */
  status: number;
};

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
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
