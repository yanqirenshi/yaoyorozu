import { useEffect, useState } from "react";

export type SpecMarkdownState =
  | { status: "loading" }
  // .md が存在しない(正常。判断の記録が無い図もある。サイトマップ等)。
  | { status: "none" }
  | { status: "error"; message: string }
  | { status: "ready"; markdown: string };

/**
 * `GET /api/spec/{repo}/{doc}?format=md` を叩いて、判断の記録(Markdown)を
 * 実行時に取る(#587)。`useSpecDoc`(#544・#548)と同じ形だが、.md は無いことが
 * 正常にありうる(サーバは 204 を返す)ため、それを "none" として区別する
 * (呼び出し側はこのときエラー表示をしない)。
 */
export function useSpecMarkdown(repo: string, doc: string): SpecMarkdownState {
  const [state, setState] = useState<SpecMarkdownState>({ status: "loading" });
  const [loadedKey, setLoadedKey] = useState(`${repo}/${doc}`);
  const key = `${repo}/${doc}`;
  if (key !== loadedKey) {
    setLoadedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/spec/${encodeURIComponent(repo)}/${encodeURIComponent(doc)}?format=md`)
      .then(async (res) => {
        if (res.status === 204) {
          if (!cancelled) setState({ status: "none" });
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `読み込みに失敗しました(${res.status})`);
        }
        const markdown = await res.text();
        if (!cancelled) setState({ status: "ready", markdown });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repo, doc]);

  return state;
}
