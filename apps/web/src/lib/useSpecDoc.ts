import { useEffect, useState } from "react";

export type SpecDocState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/**
 * `GET /api/spec/{repo}/{doc}` を叩いて実行時にデータを取る(#543)。
 * /{repo}/wbs(#544)で最初に書いた形を、構成図・ポンチ絵(#548)で2・3回目に
 * 使うことになったため、ここへ共通化した。
 *
 * repo・doc が変わったら即「読み込み中」に戻す(レンダー中の setState で行う。
 * useEffect の中で直接 setState すると react-hooks/set-state-in-effect に当たる
 * ため、TmInspector 等と同じ流儀で prop の変化をレンダー中に検知する)。
 */
export function useSpecDoc<T>(repo: string, doc: string): SpecDocState<T> {
  const [state, setState] = useState<SpecDocState<T>>({ status: "loading" });
  const [loadedKey, setLoadedKey] = useState(`${repo}/${doc}`);
  const key = `${repo}/${doc}`;
  if (key !== loadedKey) {
    setLoadedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/spec/${encodeURIComponent(repo)}/${encodeURIComponent(doc)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `読み込みに失敗しました(${res.status})`);
        }
        return (await res.json()) as T;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
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
