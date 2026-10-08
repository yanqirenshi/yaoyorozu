"use client";

import Alert from "@mui/material/Alert";
import LoadingIcon from "@/components/parts/LoadingIcon";
import Markdown from "@/components/parts/Markdown";
import { useSpecMarkdown } from "@/lib/useSpecMarkdown";

/**
 * Classes の「判断の記録」タブ(#589)。`{リポジトリ}/yyz/spec/classes.md` を出す。
 *
 * 図と同じ画面に常時出すと、記録が長い(400行以上)ぶん図が見えなくなるため、
 * 「クラス図の書き方」と同じくタブにした(`DiagramPage` の extraTabs)。
 * 折りたたみを新しく作らずに済み、`?tab=record` で直接開ける・共有できる。
 */
export default function RepoClassesRecordTab({ repo }: { repo: string }) {
  const state = useSpecMarkdown(repo, "classes");

  if (state.status === "loading") {
    return (
      <div className="flex min-h-0 w-full flex-1 items-center gap-2 p-4 text-sm text-zinc-500">
        <LoadingIcon size="small" label={`${repo} のクラス図の記録を読み込み中`} />
        読み込み中…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="p-4">
        <Alert severity="error">{state.message}</Alert>
      </div>
    );
  }

  if (state.status === "none") {
    return (
      <div className="p-4">
        <Alert severity="info">
          このリポジトリには判断の記録(`yyz/spec/classes.md`)がありません。
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-0 w-full flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-4xl">
        <Markdown>{state.markdown}</Markdown>
      </div>
    </div>
  );
}
