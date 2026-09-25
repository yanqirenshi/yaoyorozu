import LoadingIcon from "./LoadingIcon";
import type { RunningPermissionModeDto, RunningSessionDto } from "./api/types";
import {
  PERMISSION_MODE_LABELS,
  currentPermissionModeLabel,
  processStateLabel,
} from "./runningSessionLabels";

// 会話ビューの上部に出す、実行中セッション(app が起動したままの claude)の状態表示
// (issue #392)。プロセスの状態と権限モードを出し、中断・終了の操作を置く。状態は
// イベント → Query で取り直したもの(楽観更新しない)。起動中・実行中は LoadingIcon(#393)。

type Props = {
  /** 表示中の会話の、app が起動している実行中セッション。無ければ `null`。 */
  running: RunningSessionDto | null;
  /** 次に起動するときの権限モード(未起動のとき、状態の横に出す)。 */
  selectedMode: RunningPermissionModeDto;
  onInterrupt: () => void;
  onStop: () => void;
};

export default function RunningSessionBar({ running, selectedMode, onInterrupt, onStop }: Props) {
  const alive = running !== null && running.process_state !== "exited";
  const state = running?.process_state ?? null;
  const showsProgress = alive && (state === "starting" || state === "running");
  const canInterrupt = alive && (state === "running" || state === "awaiting_permission");

  return (
    <div className="running-bar" role="group" aria-label="実行中のセッション">
      {showsProgress && (
        <LoadingIcon
          size="small"
          label={state === "starting" ? "セッションを起動中" : "AI が応答中"}
        />
      )}
      <span className="running-bar-state" data-state={state ?? "none"}>
        {processStateLabel(state)}
      </span>
      <span className="running-bar-mode">
        {alive
          ? `権限モード: ${currentPermissionModeLabel(running.current_permission_mode)}`
          : `次の起動: ${PERMISSION_MODE_LABELS[selectedMode]}`}
      </span>
      {alive && running.current_model && (
        <span className="running-bar-mode">モデル: {running.current_model}</span>
      )}
      <span className="running-bar-actions">
        {canInterrupt && (
          <button type="button" className="running-bar-button" onClick={onInterrupt}>
            中断
          </button>
        )}
        {alive && (
          <button type="button" className="running-bar-button" onClick={onStop}>
            終了
          </button>
        )}
      </span>
    </div>
  );
}
