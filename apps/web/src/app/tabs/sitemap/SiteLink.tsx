"use client";

import type { ReactNode } from "react";
import NextLink from "next/link";
import MuiLink from "@mui/material/Link";

/** サイトの詳細ページ(/sitemap/sites/:id)のパス。 */
export function siteHref(id: number): string {
  return `/sitemap/sites/${id}`;
}

/**
 * サイトマップの画面で使うテキストリンク。基本デザイン「リンクテキスト」
 * (uiLinkText.ts)のステートに従う。
 *   - 通常: 京紫-700・下線 1px / 訪問済: 京紫-900・下線 1px
 *   - ホバー: 京紫-800・下線 2px / 押下中: 京紫-900・下線 2px
 *   - キーボードフォーカス: 金茶-600 の 2px リングを 2px 離して描く
 * 色は tokens.css の変数から引く(規約 §4)。文字の大きさは呼び出し側に合わせる。
 */
export default function SiteLink({
  href,
  children,
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  /** リンク文言だけでは行き先が分からないときに、読み上げ用の名前を与える。 */
  ariaLabel?: string;
}) {
  return (
    <MuiLink
      component={NextLink}
      href={href}
      underline="always"
      aria-label={ariaLabel}
      sx={{
        color: "var(--link-default)",
        textDecorationColor: "currentColor",
        textDecorationThickness: "1px",
        textUnderlineOffset: "2px",
        "&:visited": { color: "var(--link-visited)" },
        "&:hover": {
          color: "var(--color-kyomurasaki-800)",
          textDecorationThickness: "2px",
        },
        "&:active": {
          color: "var(--color-kyomurasaki-900)",
          textDecorationThickness: "2px",
        },
        "&:focus-visible": {
          outline: "2px solid var(--focus-ring)",
          outlineOffset: "2px",
        },
      }}
    >
      {children}
    </MuiLink>
  );
}
