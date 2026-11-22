"use client";

// 取り直し(他のタブの変更 = `settings:updated`・つなぎ直し = `onReconnected`・`session:changed` など)が、
// **入力中(未保存の変更がある)の欄を上書きしない**ための小さな hook。
//
// 使い方:
//   const guard = useRefreshGuard(dirty);
//   // 取り直しの結果を欄へ入れる前に:
//   if (force || guard.shouldApply()) { 欄へ入れる; guard.clear(); }   // 未保存が無ければ今までどおり
//   // 未保存があれば shouldApply() が false を返し、`guard.stale` が真になる。
//   {guard.stale && <StaleNotice onReload={() => 取り直す(force)} />}
//
// - `dirty`: 未保存の変更があるか(各画面が持つ dirty 状態、または「読み込んだ値と入力値の比較」)。
// - `shouldApply()`: 今、取り直した値を欄へ入れてよいか。未保存の変更があれば false を返して `stale` を立てる。
// - `clear()`: 取り直した(または保存した)ので、「ほかで変更されました」の知らせを消す。

import { useCallback, useRef, useState } from "react";

export function useRefreshGuard(dirty: boolean) {
  const [stale, setStale] = useState(false);
  // 取り直しの完了(非同期)は古いレンダリングの値を見ないよう、最新の dirty を ref で読む。
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const shouldApply = useCallback((): boolean => {
    if (dirtyRef.current) {
      setStale(true);
      return false;
    }
    setStale(false);
    return true;
  }, []);

  const clear = useCallback(() => setStale(false), []);

  return { stale, shouldApply, clear };
}
