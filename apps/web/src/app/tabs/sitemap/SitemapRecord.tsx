"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LoadingIcon from "@/components/parts/LoadingIcon";
import Markdown from "@/components/parts/Markdown";
import { useSpecMarkdown } from "@/lib/useSpecMarkdown";
import { textStyle } from "../UiDesign/tokens";

/**
 * サイトマップの判断の記録(`{リポジトリ}/yyz/spec/sitemap.md`。#588)。
 *
 * 図と同じ画面の「記録」タブに置く。図の意味を決めている判断(ID の割り当て、
 * タブを入れ子にする理由、箱の寸法の決め方など)は図を見ながら読むものなので、
 * 別のページにはしない。
 * 記録が無いリポジトリでもエラーにしない(#587 の仕組みが 204 を「記録なし」として
 * 区別する)。
 */
export default function SitemapRecord({ repo }: { repo: string }) {
  const state = useSpecMarkdown(repo, "sitemap");

  if (state.status === "loading") {
    return (
      <Box className="flex items-center gap-2 p-4">
        <LoadingIcon size="small" label={`${repo} のサイトマップの記録を読み込み中`} />
        <Box sx={{ ...textStyle("Body-14N-170"), color: "var(--text-secondary)" }}>
          読み込み中…
        </Box>
      </Box>
    );
  }

  if (state.status === "error") {
    return (
      <Box className="p-4">
        <Alert severity="error">{state.message}</Alert>
      </Box>
    );
  }

  if (state.status === "none") {
    return (
      <Box
        className="p-4"
        sx={{ ...textStyle("Body-16N-170"), color: "var(--text-secondary)" }}
      >
        {repo} のサイトマップには、判断の記録(`yyz/spec/sitemap.md`)がありません。
      </Box>
    );
  }

  return (
    <Box
      className="w-full overflow-auto px-8 py-6"
      sx={{
        backgroundColor: "var(--surface-base)",
        color: "var(--text-primary)",
      }}
    >
      <Box sx={{ maxWidth: "860px" }}>
        <Markdown>{state.markdown}</Markdown>
      </Box>
    </Box>
  );
}
