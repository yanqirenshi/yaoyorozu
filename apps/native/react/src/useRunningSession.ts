import { useCallback, useEffect, useRef, useState } from "react";

import {
  getRunningSession,
  interruptRunningSession,
  isAppError,
  listRunningSessions,
  onRunningSessionChanged,
  respondPermission,
  sendToRunningSession,
  startRunningSession,
  stopRunningSession,
  subscribeRunningSessionProgress,
  switchRunningSession,
} from "./api";
import type {
  PermissionSuggestionDto,
  ProgressEventDto,
  RunningPermissionModeDto,
  RunningSessionDto,
  RunningSessionRefDto,
  RunningSessionSwitchDto,
} from "./api/types";

// ビューアの会話ビューから、app が起動したまま持つ claude CLI と対話するための状態
// (issue #392。Phase 1。#407 で複数の実行中セッション・画面ごとの購読に対応)。業務状態は
// Rust 側(`RunningSessionByApp`)にあり、ここには「サーバから取得した表示用のスナップショット」
// (`running`。表示中の会話の実行中セッション。イベント → Query で取り直す。楽観更新しない)と、
// 返答中の画面表示(作成中の吹き出し・ツール・送信中の行)だけを持つ。途中経過(Channel)は表示の
// 材料で、確定した内容は会話ファイルの行(ファイル監視で届く。#314)が正になる。
//
// 実行中セッションは複数あり、宛先は `RunningSessionRefDto`(pid_domain + pid + started_at)。
// 途中経過は**画面ごとに購読する**(`subscribeRunningSessionProgress`)ので、画面の再読み込み・
// 別の画面でも、実行中のセッションを見つけたら購読し直して途中経過が届く。

/** 作成中の AI の吹き出しの1区間(テキストブロック1つ分)。ツールの開始で区切られる。 */
export type LiveSegment = { id: number; text: string };

/** 返答中に出すツールの表示。 */
export type LiveTool = {
  toolUseId: string;
  toolName: string;
  state: "running" | "done" | "error";
};

/** 送信中の行(`SentLineConfirmed` の uuid が会話の一覧に現れたら消す)。 */
export type PendingLine = { text: string; imageCount: number; uuid: string | null };

export type LiveTurn = {
  pendingLine: PendingLine | null;
  segments: LiveSegment[];
  tools: LiveTool[];
  /** このターンを始めた時点で一覧にあった行の uuid。それ以外の assistant 行が「このターンの確定行」。 */
  baselineUuids: string[];
};

const EMPTY_TURN: LiveTurn = { pendingLine: null, segments: [], tools: [], baselineUuids: [] };

/** 起動して待機になるまでの上限。 */
const START_TIMEOUT_MS = 30000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function messageOf(e: unknown): string {
  return isAppError(e) ? e.message : String(e);
}

type Options = {
  /** 表示中の会話の ID(その会話の実行中セッションを扱う。無ければ `null`)。 */
  sessionId: string | null;
  /**
   * ターンが終わった(`TurnFinished`)・プロセスが終了した。確定した行を取り直す(差分反映。
   * #314)。`target` はそのときの実行中セッション(会話の特定に使う。無ければ `null`)。
   */
  onTurnFinished: (target: RunningSessionDto | null) => Promise<void> | void;
  /** 画面のエラー表示へ出す(既存のバナー。#346)。 */
  onError: (message: string) => void;
  /** いま一覧にある行の uuid(ターンの開始時に控える)。 */
  getMessageUuids: () => string[];
};

/** 宛先を文字列にする(購読の張り替えの判定に使う)。 */
function refKey(target: RunningSessionRefDto): string {
  return `${target.pid_domain}|${target.pid}|${target.started_at}`;
}

/** 表示中の会話の実行中セッションを選ぶ: 終了していないもの(あれば)、なければ最後に起動したもの。 */
function pickForSession(
  list: { target: RunningSessionRefDto; session_id: string; process_state: string }[],
  sessionId: string,
): RunningSessionRefDto | null {
  const mine = list.filter((s) => s.session_id === sessionId);
  const alive = mine.filter((s) => s.process_state !== "exited");
  const pool = alive.length > 0 ? alive : mine;
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => (b.target.started_at >= a.target.started_at ? b : a)).target;
}

export function useRunningSession({
  sessionId,
  onTurnFinished,
  onError,
  getMessageUuids,
}: Options) {
  const [running, setRunning] = useState<RunningSessionDto | null>(null);
  const runningRef = useRef<RunningSessionDto | null>(null);
  const [live, setLive] = useState<LiveTurn>(EMPTY_TURN);
  const liveRef = useRef<LiveTurn>(EMPTY_TURN);
  // 最後のセグメントにテキストを足してよいか(ツールの開始で閉じる)。
  const segmentOpenRef = useRef(false);
  const segmentIdRef = useRef(0);
  // 「終了」ボタンで自分から止めたか(意図した終了はエラーとして出さない)。
  const stoppedByUserRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  // いま途中経過を購読している宛先。
  const subscriptionRef = useRef<{ key: string; unsubscribe: () => void } | null>(null);
  // 購読の張り替えを直列にする(同じ宛先の二重購読を避ける)。
  const subscribingRef = useRef<Promise<void>>(Promise.resolve());

  const callbacks = useRef({ onTurnFinished, onError, getMessageUuids });
  useEffect(() => {
    callbacks.current = { onTurnFinished, onError, getMessageUuids };
  });

  const applyRunning = useCallback((next: RunningSessionDto | null) => {
    runningRef.current = next;
    setRunning(next);
  }, []);

  const updateLive = useCallback((update: (prev: LiveTurn) => LiveTurn) => {
    liveRef.current = update(liveRef.current);
    setLive(liveRef.current);
  }, []);

  const resetLive = useCallback(() => {
    segmentOpenRef.current = false;
    updateLive(() => EMPTY_TURN);
  }, [updateLive]);

  // Channel で届く途中経過(宛先付き)。表示の材料にするだけで、状態は持たない。
  const handleProgress = useCallback(
    (event: ProgressEventDto) => {
      switch (event.kind) {
        case "text_delta":
          updateLive((prev) => {
            if (segmentOpenRef.current && prev.segments.length > 0) {
              const last = prev.segments[prev.segments.length - 1];
              return {
                ...prev,
                segments: [...prev.segments.slice(0, -1), { ...last, text: last.text + event.text }],
              };
            }
            segmentOpenRef.current = true;
            segmentIdRef.current += 1;
            return {
              ...prev,
              segments: [...prev.segments, { id: segmentIdRef.current, text: event.text }],
            };
          });
          break;
        case "tool_started":
          segmentOpenRef.current = false;
          updateLive((prev) => ({
            ...prev,
            tools: [
              ...prev.tools.filter((t) => t.toolUseId !== event.tool_use_id),
              { toolUseId: event.tool_use_id, toolName: event.tool_name, state: "running" },
            ],
          }));
          break;
        case "tool_result_arrived":
          updateLive((prev) => ({
            ...prev,
            tools: prev.tools.map((t) =>
              t.toolUseId === event.tool_use_id
                ? { ...t, state: event.is_error ? "error" : "done" }
                : t,
            ),
          }));
          break;
        case "sent_line_confirmed":
          updateLive((prev) =>
            prev.pendingLine && prev.pendingLine.uuid === null
              ? { ...prev, pendingLine: { ...prev.pendingLine, uuid: event.uuid } }
              : prev,
          );
          break;
        case "turn_finished":
          // 確定した行を取り直してから、作成中の表示を片付ける(二重に見えない)。
          // 失敗のときの表示は、会話ファイルのエラー行(#364)が受け持つのでここでは出さない。
          Promise.resolve(callbacks.current.onTurnFinished(runningRef.current)).finally(resetLive);
          break;
      }
    },
    [updateLive, resetLive],
  );

  /** 途中経過の購読を `target` に合わせる(`null` なら購読をやめる)。 */
  const ensureSubscribed = useCallback(
    (target: RunningSessionRefDto | null): Promise<void> => {
      const run = async () => {
        const key = target ? refKey(target) : null;
        const current = subscriptionRef.current;
        if (current && current.key === key) return;
        if (current) {
          current.unsubscribe();
          subscriptionRef.current = null;
        }
        if (!target || !key) return;
        try {
          const unsubscribe = await subscribeRunningSessionProgress(target, (progress) => {
            // 購読の宛先の出来事だけを扱う(張り替えの途中で遅れて届いたものは捨てる)。
            if (subscriptionRef.current?.key === refKey(progress.target)) {
              handleProgress(progress.event);
            }
          });
          subscriptionRef.current = { key, unsubscribe };
        } catch {
          // 購読できなくても、状態(Query)と確定した行は取れるので、表示は劣化するだけ。
        }
      };
      subscribingRef.current = subscribingRef.current.then(run, run);
      return subscribingRef.current;
    },
    [handleProgress],
  );

  /** 表示中の会話の実行中セッションを取り直す(無ければ `null`)。 */
  const refresh = useCallback(async (): Promise<RunningSessionDto | null> => {
    const id = sessionIdRef.current;
    try {
      const target = id ? pickForSession(await listRunningSessions(), id) : null;
      const next = target ? await getRunningSession(target) : null;
      // 取得の間に会話が切り替わっていたら、古い結果は使わない。
      if (sessionIdRef.current !== id) return runningRef.current;
      applyRunning(next);
      return next;
    } catch (e) {
      callbacks.current.onError(messageOf(e));
      return runningRef.current;
    }
  }, [applyRunning]);

  // 表示中の会話が変わったら、その会話の実行中セッションを探し直す(返答中の表示は会話ごと)。
  useEffect(() => {
    resetLive();
    applyRunning(null);
    void refresh();
  }, [sessionId, refresh, resetLive, applyRunning]);

  // 生きている実行中セッションが見つかったら、途中経過を購読する(再読み込み・別の画面でも
  // 購読し直せる)。終了・なしなら購読をやめる。
  const aliveKey =
    running && running.process_state !== "exited" ? refKey(running.target) : null;
  useEffect(() => {
    void ensureSubscribed(runningRef.current && aliveKey ? runningRef.current.target : null);
  }, [aliveKey, ensureSubscribed]);
  useEffect(
    () => () => {
      void ensureSubscribed(null);
    },
    [ensureSubscribed],
  );

  // 状態変化の通知(軽量。中身は Query で取り直す)。表示中の会話のものだけ扱う。
  useEffect(() => {
    const unlistenPromise = onRunningSessionChanged((event) => {
      if (event.session_id !== sessionIdRef.current) return;
      const before = runningRef.current?.process_state;
      void refresh().then((next) => {
        // 返答中(実行中・権限待ち)から待機に戻ったら、ターンは終わっている。途中経過の通知
        // (Channel)を受け損ねても表示が残らないよう、状態の変化でも片付ける(通常は
        // `turn_finished` が先に片付ける)。
        if (
          (before === "running" || before === "awaiting_permission") &&
          next?.process_state === "idle" &&
          liveRef.current !== EMPTY_TURN
        ) {
          Promise.resolve(callbacks.current.onTurnFinished(next)).finally(resetLive);
        }
      });
      if (event.process_state === "exited" && event.exit_code !== null) {
        const byUser = stoppedByUserRef.current;
        stoppedByUserRef.current = false;
        if (!byUser && event.exit_code !== 0) {
          callbacks.current.onError(
            `実行中のセッション(claude)が終了しました(終了コード ${event.exit_code})`,
          );
        }
        // 終了したら、返答の途中の表示は残さない(確定した行は会話ファイルにある)。
        Promise.resolve(callbacks.current.onTurnFinished(runningRef.current)).finally(resetLive);
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refresh, resetLive]);

  /** 状態が条件を満たすまで、Query で取り直しながら待つ(楽観更新しない)。 */
  const waitUntil = useCallback(
    async (predicate: (s: RunningSessionDto | null) => boolean, timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const s = await refresh();
        if (predicate(s)) return s;
        if (Date.now() > deadline) return s;
        await sleep(100);
      }
    },
    [refresh],
  );

  /**
   * 送信。未起動なら起動して、待機になってから送る(起動中の送信は backend が断るため)。
   * 別のセッションが実行中のときは呼ばない(呼び出し側が確認して先に停止する)。
   */
  const send = useCallback(
    async (args: {
      profileId: string | null;
      project: string;
      sessionId: string;
      mode: RunningPermissionModeDto;
      text: string;
      images: string[];
    }): Promise<boolean> => {
      setBusy(true);
      stoppedByUserRef.current = false;
      segmentOpenRef.current = false;
      updateLive(() => ({
        pendingLine: { text: args.text, imageCount: args.images.length, uuid: null },
        segments: [],
        tools: [],
        baselineUuids: callbacks.current.getMessageUuids(),
      }));
      try {
        const current = runningRef.current;
        const alive = current !== null && current.process_state !== "exited";
        if (!alive) {
          const started = await startRunningSession(args.profileId, {
            kind: "resume",
            project: args.project,
            session_id: args.sessionId,
            mode: args.mode,
            name: null,
          });
          applyRunning(started);
        }
        const target = runningRef.current?.target;
        if (!target) {
          throw new Error("実行中のセッションが見つかりません");
        }
        // 送る前に購読しておく(送信直後の途中経過を取りこぼさない)。
        await ensureSubscribed(target);
        const ready = await waitUntil(
          (s) => s === null || s.process_state !== "starting",
          START_TIMEOUT_MS,
        );
        if (!ready || ready.process_state === "starting") {
          throw new Error("実行中のセッションの起動が終わりませんでした。しばらくしてからやり直してください");
        }
        if (ready.process_state === "exited") {
          throw new Error("実行中のセッションが起動できませんでした(起動直後に終了しました)");
        }
        await sendToRunningSession(ready.target, args.text, args.images);
        return true;
      } catch (e) {
        resetLive();
        callbacks.current.onError(messageOf(e));
        await refresh();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applyRunning, ensureSubscribed, refresh, resetLive, updateLive, waitUntil],
  );

  const respond = useCallback(
    async (
      requestId: string,
      behavior: "allow" | "deny",
      options: {
        updatedInput?: unknown;
        updatedPermissions?: PermissionSuggestionDto[];
        message?: string;
      } = {},
    ) => {
      const target = runningRef.current?.target;
      if (!target) return;
      try {
        await respondPermission(target, requestId, behavior, options);
      } catch (e) {
        callbacks.current.onError(messageOf(e));
      }
      await refresh();
    },
    [refresh],
  );

  const interrupt = useCallback(async () => {
    const target = runningRef.current?.target;
    if (!target) return;
    try {
      await interruptRunningSession(target);
    } catch (e) {
      callbacks.current.onError(messageOf(e));
    }
  }, []);

  /** 起動中に、モデル・権限モードを切り替える(結果は状態の取り直しで反映される)。 */
  const switchTo = useCallback(async (request: RunningSessionSwitchDto) => {
    const target = runningRef.current?.target;
    if (!target) return;
    try {
      await switchRunningSession(target, request);
    } catch (e) {
      callbacks.current.onError(messageOf(e));
    }
  }, []);

  const stop = useCallback(async () => {
    const target = runningRef.current?.target;
    if (!target) return;
    stoppedByUserRef.current = true;
    try {
      await stopRunningSession(target);
    } catch (e) {
      stoppedByUserRef.current = false;
      callbacks.current.onError(messageOf(e));
    }
    await refresh();
    resetLive();
  }, [refresh, resetLive]);

  return { running, live, busy, send, respond, interrupt, switchTo, stop };
}
