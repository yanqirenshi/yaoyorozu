import { TEXT_STYLE_GROUPS } from "@/data/uiTypography";
import { isOpenable, siteHref, type SitemapModel } from "@/lib/sitemap";

/** 基本デザインのテキストスタイルから文字サイズ(px)を引く(規約 §4)。 */
function fontSizeOf(name: string): number {
  const style = TEXT_STYLE_GROUPS.flatMap((group) => group.styles).find(
    (s) => s.name === name,
  );
  if (!style) throw new Error("未定義のテキストスタイルです: " + name);
  return style.sizePx;
}

// ノード名は「UI-16M-100」、パスは「Mono-14N-150」(パス・ID 用)の大きさに合わせる。
// d3.sitemap は字体を指定できないため、大きさと色だけを渡す。
const LABEL_FONT_SIZE = fontSizeOf("UI-16M-100");
const PATH_FONT_SIZE = fontSizeOf("Mono-14N-150");

// d3.sitemap 0.6.0 のリンク(ノード名・パス)は必ず別タブで開く。基本デザイン
// 「リンクテキスト」の「新しいタブで開くことを予告する」に従い、外部リンクの
// アイコン(uiIcon.ts の external-link)の代わりに ↗ を添える。SVG の文字の中には
// アイコンを置けないため。
const NEW_TAB_MARK = " ↗";

type RenderNode = {
  id: number;
  label: { contents: string; position: { x: number; y: number } };
  position: { x: number; y: number };
  children: RenderNode[];
};

/**
 * サイトマップのノードを d3.sitemap 0.6.0 に渡す形に整える。描画専用の加工なので、
 * 仕様データ(`yyz/spec/sitemap.json`)・保存値(`layout/sitemap.json`)・
 * インスペクタには持ち込まない。
 *
 *   - children の位置: 仕様データと保存値は「親の左上」からの相対座標で持つ。
 *     d3.sitemap 0.6.0 は親に内側の余白(padding)があると「余白の内側」を起点に
 *     するため、ここで余白の分を引く。保存値の座標系は変えない(変えると、開いた
 *     ままの画面が古い座標系の値を書き戻して配置がずれる)。
 *   - ノード名: そのサイトの詳細ページ(/{リポジトリ名}/sitemap/sites/{id})への
 *     リンクにする。
 *   - パス: 画面のパスをボックスの上に添える。ブラウザで開けるパス(引数を含まない
 *     Webアプリの画面)は、その画面へのリンクにする。
 */
export function toRenderNodes<T extends RenderNode>(
  nodes: T[],
  model: SitemapModel,
  repo: string,
): T[] {
  return nodes.map((n) => {
    const site = model.siteById.get(n.id);
    const padding = model.paddingByChildId.get(n.id) ?? 0;
    const path = site?.path ?? null;
    const openable = site !== undefined && isOpenable(site);

    return {
      ...n,
      position: { x: n.position.x - padding, y: n.position.y - padding },
      label: {
        ...n.label,
        contents: n.label.contents + NEW_TAB_MARK,
        link: { url: siteHref(repo, n.id) },
        font: { size: LABEL_FONT_SIZE, color: "var(--link-default)" },
      },
      ...(path
        ? {
            path: {
              contents: openable ? path + NEW_TAB_MARK : path,
              ...(openable ? { link: { url: path } } : {}),
              font: {
                size: PATH_FONT_SIZE,
                color: openable ? "var(--link-default)" : "var(--text-secondary)",
              },
            },
          }
        : {}),
      children: toRenderNodes(n.children as T[], model, repo),
    } as T;
  });
}
