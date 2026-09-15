"use client";

import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import { findSitemapSite, type SitemapSite } from "@/data/sitemap";
// 文字の大きさ・太さは基本デザインのテキストスタイルから引く(規約 §4)。
import { textStyle } from "./UiDesign/tokens";
import SiteLink, { siteHref } from "./sitemap/SiteLink";

type Relation = {
  title: string;
  note: string;
  ids: (site: SitemapSite) => number[];
};

// 詳細ページに並べる位置づけ。サイトマップの図(包含と結線)をそのまま読み下す。
const RELATIONS: Relation[] = [
  {
    title: "上位",
    note: "結線でこのサイトへ入ってくる元",
    ids: (site) => site.fromIds,
  },
  {
    title: "下位",
    note: "このサイトから結線で出ていく先",
    ids: (site) => site.toIds,
  },
  {
    title: "親ページ",
    note: "このタブを含むページ",
    ids: (site) => (site.parentId === null ? [] : [site.parentId]),
  },
  {
    title: "タブ",
    note: "このページ内のタブ(パスは変わらず、クエリだけが変わる)",
    ids: (site) => site.childIds,
  },
];

const APP_LABEL: Record<NonNullable<SitemapSite["app"]>, string> = {
  native: "ネイティブアプリ",
  web: "Webアプリ",
};

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <Box component="section" sx={{ mt: "32px" }}>
      <Box component="h2" sx={textStyle("Head-16B-150")}>
        {title}
      </Box>
      {note && (
        <Box
          component="p"
          sx={{
            ...textStyle("Body-14N-170"),
            color: "var(--text-secondary)",
            mb: "8px",
          }}
        >
          {note}
        </Box>
      )}
      {children}
    </Box>
  );
}

function Empty() {
  return (
    <Box sx={{ ...textStyle("Body-14N-170"), color: "var(--text-secondary)" }}>
      なし
    </Box>
  );
}

// 隣り合うリンクは高さ 24px 以上・間隔 sp-2 をとる(基本デザイン「リンクテキスト」)。
const LIST_SX = {
  ...textStyle("Body-16N-170"),
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
} as const;

function DescriptionSection({ site }: { site: SitemapSite }) {
  // Webアプリの画面で、パスに引数(:id 等)を含まないものだけ、その画面を開ける。
  const openable =
    site.app === "web" && site.path !== null && !site.path.includes(":");

  return (
    <Section title="説明">
      {site.description ? (
        <Box
          component="p"
          sx={{ ...textStyle("Body-16N-170"), maxWidth: "720px" }}
        >
          {site.description}
        </Box>
      ) : (
        <Empty />
      )}
      {site.path && (
        <Box className="mt-3 flex min-h-6 flex-wrap items-center gap-3">
          {/* Bulma が code 要素に色と背景を当てるため、span で等幅にする。 */}
          <Box component="span" sx={textStyle("Mono-14N-150")}>
            {site.path}
          </Box>
          {site.app && (
            <Box
              component="span"
              sx={{
                ...textStyle("Body-14N-170"),
                color: "var(--text-secondary)",
              }}
            >
              {APP_LABEL[site.app]}の画面
            </Box>
          )}
          {openable && (
            <Box component="span" sx={textStyle("Body-14N-170")}>
              <SiteLink href={site.path}>「{site.label}」を開く</SiteLink>
            </Box>
          )}
        </Box>
      )}
    </Section>
  );
}

function WbsSection({ site }: { site: SitemapSite }) {
  return (
    <Section
      title={`関連する WBS(${site.wbs.length})`}
      note="この画面・アプリに対応する WBS の項目"
    >
      {site.wbs.length === 0 ? (
        <Empty />
      ) : (
        <Box component="ul" sx={LIST_SX}>
          {site.wbs.map((w) => (
            <li key={w.id} className="flex min-h-6 flex-wrap items-baseline gap-2">
              <span>{w.names.join(" > ")}</span>
              <Box
                component="span"
                sx={{
                  ...textStyle("Mono-14N-150"),
                  color: "var(--text-secondary)",
                }}
              >
                ID {w.id}
              </Box>
            </li>
          ))}
        </Box>
      )}
    </Section>
  );
}

function RelationSection({
  relation,
  site,
}: {
  relation: Relation;
  site: SitemapSite;
}) {
  const related = relation
    .ids(site)
    .map((id) => findSitemapSite(id))
    .filter((s): s is SitemapSite => s !== undefined);

  return (
    <Section
      title={`${relation.title}(${related.length})`}
      note={relation.note}
    >
      {related.length === 0 ? (
        <Empty />
      ) : (
        <Box component="ul" sx={LIST_SX}>
          {related.map((s) => (
            <li key={s.id} className="flex min-h-6 items-center">
              <SiteLink href={siteHref(s.id)}>{s.label}</SiteLink>
            </li>
          ))}
        </Box>
      )}
    </Section>
  );
}

/** サイトの詳細ページ(/sitemap/sites/:id)。 */
export default function SitemapSiteTab({ siteId }: { siteId: number }) {
  const site = findSitemapSite(siteId);

  return (
    <Box
      className="w-full overflow-auto px-8 py-6"
      sx={{
        backgroundColor: "var(--surface-base)",
        color: "var(--text-primary)",
      }}
    >
      <Box sx={textStyle("UI-14M-100")}>
        <SiteLink href="/sitemap">サイトマップに戻る</SiteLink>
      </Box>

      {site ? (
        <>
          <Box component="h1" sx={{ ...textStyle("Head-24B-150"), mt: "24px" }}>
            {site.label}
          </Box>
          <Box
            sx={{
              ...textStyle("Mono-14N-150"),
              color: "var(--text-secondary)",
              mt: "4px",
            }}
          >
            ID {site.id}
          </Box>

          <DescriptionSection site={site} />
          <WbsSection site={site} />
          {RELATIONS.map((relation) => (
            <RelationSection
              key={relation.title}
              relation={relation}
              site={site}
            />
          ))}
        </>
      ) : (
        <Box component="p" sx={{ ...textStyle("Body-16N-170"), mt: "24px" }}>
          このサイトはサイトマップにありません。
        </Box>
      )}
    </Box>
  );
}
