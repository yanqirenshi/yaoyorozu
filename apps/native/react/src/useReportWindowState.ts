import { useEffect, useRef } from "react";
import { reportWindowState } from "./api";
import type { WindowTabDto } from "./api";

// このウィンドウの表示状態(タブの配列+アクティブタブ)をレジストリへ
// 報告する共通フック(ハブ化 その1。issue #83)。「1ウィンドウ=1プロファイル」
// への一本化(issue #91)で `SessionsPage` が唯一の呼び出し元になり、常に
// 要素数1の配列を報告する(DTO・ハブ側のグラフ描画は変えずそのまま使う)。
// 報告は表示用スナップショットであり、業務状態ではない(native.md §2。
// SSoT はあくまで backend 側のレジストリ)。
//
// `enabled=false` の間は一切報告しない(対象プロファイルIDがまだ解決できて
// いない初回読み込み前など)。
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
