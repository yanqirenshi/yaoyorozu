import { findSitemapSite, parentPaddingOf } from "@/data/sitemap";
import { TEXT_STYLE_GROUPS } from "@/data/uiTypography";
import { siteHref } from "./SiteLink";

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
 * SITEMAP_DATA・保存値(sitemap.json)・インスペクタには持ち込まない。
 *
 *   - children の位置: SITEMAP_DATA と保存値は「親の左上」からの相対座標で持つ。
 *     d3.sitemap 0.6.0 は親に内側の余白(padding)があると「余白の内側」を起点に
 *     するため、ここで余白の分を引く。保存値の座標系は変えない(変えると、開いた
 *     ままの画面が古い座標系の値を書き戻して配置がずれる)。
 *   - ノード名: そのサイトの詳細ページ(/sitemap/sites/:id)へのリンクにする。
 *   - パス: 画面のパスをボックスの上に添える。Webアプリの画面(引数を含まない
 *     パス)は、その画面へのリンクにする。
 */
export function toRenderNodes<T extends RenderNode>(nodes: T[]): T[] {
  return nodes.map((n) => {
    const site = findSitemapSite(n.id);
    const padding = parentPaddingOf(n.id);
    const path = site?.path ?? null;
    const openable =
      site?.app === "web" && path !== null && !path.includes(":");

    return {
      ...n,
      position: { x: n.position.x - padding, y: n.position.y - padding },
      label: {
        ...n.label,
        contents: n.label.contents + NEW_TAB_MARK,
        link: { url: siteHref(n.id) },
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
      children: toRenderNodes(n.children as T[]),
    } as T;
  });
}
