import { useEffect, useRef } from "react";
import { reportWindowState } from "./api";
import type { WindowTabDto } from "./api";

// このウィンドウの表示状態(タブの配列+アクティブタブ)をレジストリへ
// 報告する共通フック(ハブ化 その1。issue #83)。タブ付きビューア
// (TabbedSessionsPage)・単一プロファイルウィンドウ(SessionsPage 単体。
// Phase 1 の別ウィンドウ)の両方から使う。報告は表示用スナップショットで
// あり、業務状態ではない(native.md §2。SSoT はあくまで backend 側の
// レジストリ)。
//
// `enabled=false` の間は一切報告しない。1つのウィンドウの状態は1箇所からだけ
// 報告すべきで(タブ管理側が持つ全タブの配列を1回で置き換える設計のため、
// 複数箇所から報告すると互いの内容を消し合ってしまう)、タブ化されたビューア
// では TabbedSessionsPage が報告し、その配下でマウントされる SessionsPage
// 自身はこのフックを無効化する。
export function useReportWindowState(
  tabs: WindowTabDto[],
  activeTabIndex: number,
  enabled: boolean = true,
) {
  // tabs は毎レンダーで新しい配列参照になりうるため、内容が実際に変わった
  // ときだけ報告する(不要なIPC呼び出しを避ける)。
  const key = JSON.stringify({ tabs, activeTabIndex, enabled });
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    if (!enabled) return;
    reportWindowState(tabs, activeTabIndex).catch((e) => console.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
