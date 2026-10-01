import { useEffect, useRef, useState } from "react";
import Badge from "./Badge";
import LoadingIcon from "./LoadingIcon";
import SelectButton from "./SelectButton";
import type { RunningPermissionModeDto, RunningSessionDto, StartModelDto } from "./api/types";
import {
  PERMISSION_MODE_LABELS,
  MAX_SESSION_NAME_CHARS,
  START_MODELS,
  START_MODEL_DEFAULT_LABEL,
  START_MODEL_LABELS,
  startModelLabel,
  currentPermissionModeLabel,
  processStateLabel,
  processStateTone,
  selectableModeOf,
} from "./runningSessionLabels";

// 会話ビューの上部に出す、実行中セッション(app が起動したままの claude)の状態表示
// (issue #392。#409 で、現在のモデル・権限モードの表示と、その場での切り替えを足した)。
// プロセスの状態・権限モード・モデルを出し、中断・終了の操作を置く。状態は
// イベント → Query で取り直したもの(楽観更新しない)。起動中・実行中は LoadingIcon(#393)。
//
// - 切り替えの選択は既存部品の選択ボタン(`SelectButton`)で開く一覧から行う。切り替えている間
//   (`switching`)と、起動中は操作できない。結果(現在値)は CLI が受け入れたあとの取り直しで
//   表示に反映される(要求しただけでは変わらない)。
// - モデルは CLI が報告した一覧(`available_models`)から選ばせる(`set_model` は名前を検証しない)。
// - 未起動のときは「次の起動」の権限モードとモデル(issue #445)を選べ、再開に付ける表示名
//   (任意)を入れられる。起動前は CLI が動いていないので一覧が無く、モデルは別名の固定の選択肢
//   (既定 / fable / opus / sonnet / haiku)から選ばせる(自由入力にしない)。

type MenuKey = "mode" | "model" | "start-model";

const MODES: RunningPermissionModeDto[] = ["default", "plan", "accept_edits", "auto"];

type Props = {
  /** 表示中の会話の、app が起動している実行中セッション。無ければ `null`。 */
  running: RunningSessionDto | null;
  /** 次に起動するときの権限モード(未起動のとき、状態の横に出す)。 */
  selectedMode: RunningPermissionModeDto;
  /** 権限モードを選んだ(起動中なら切り替え、未起動なら次の起動の値)。 */
  onSelectMode: (mode: RunningPermissionModeDto) => void;
  /** モデルを選んだ(起動中だけ)。 */
  onSelectModel: (model: string) => void;
  /** 次に起動するときのモデル(未起動のとき。`null` は既定)。 */
  selectedStartModel: StartModelDto | null;
  onSelectStartModel: (model: StartModelDto | null) => void;
  /** 切り替えの結果を待っている間(選択を止める)。 */
  switching: boolean;
  /** 再開に付ける表示名(任意。未起動のときだけ入力欄を出す)。 */
  resumeName: string;
  onResumeNameChange: (name: string) => void;
  /** 再開に付ける表示名の入力欄とモデルの選択を出すか(会話ファイルのある会話の再開のとき)。 */
  canConfigureResume: boolean;
  onInterrupt: () => void;
  onStop: () => void;
  /** 未起動のとき「終了」の位置に出す「起動」ボタンから呼ぶ(issue #484)。 */
  onStart: () => void;
  /** 起動中(issue #484)。ボタンを押せなくし、表示を「起動中…」にする。 */
  starting: boolean;
};

export default function RunningSessionBar({
  running,
  selectedMode,
  onSelectMode,
  onSelectModel,
  selectedStartModel,
  onSelectStartModel,
  switching,
  resumeName,
  onResumeNameChange,
  canConfigureResume,
  onInterrupt,
  onStop,
  onStart,
  starting,
}: Props) {
  const alive = running !== null && running.process_state !== "exited";
  const state = running?.process_state ?? null;
  const showsProgress = alive && (state === "starting" || state === "running");
  const canInterrupt = alive && (state === "running" || state === "awaiting_permission");
  // 起動中(initialize の応答前)は CLI へ切り替えを要求できない。
  const canSwitch = alive && state !== "starting" && !switching;
  const models = running?.available_models ?? [];

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 外側のクリックで閉じる(既存のツールバーの一覧と同じ)。
  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenu]);

  // 起動状態が変わって選べなくなったら閉じる。
  useEffect(() => {
    if (alive && !canSwitch) setOpenMenu(null);
  }, [alive, canSwitch]);

  const currentMode = alive ? selectableModeOf(running.current_permission_mode) : selectedMode;

  return (
    <div className="running-bar" role="group" aria-label="実行中のセッション" ref={rootRef}>
      {showsProgress && (
        <LoadingIcon
          size="small"
          label={state === "starting" ? "セッションを起動中" : "AI が応答中"}
        />
      )}
      {/* 状態の変化を支援技術に伝える領域(色が変わっただけでは何も伝わらない。issue #411)。
          LoadingIcon は自分で role="status" を持つので、包まずバッジだけを包む。 */}
      <span className="running-bar-status" role="status">
        <Badge tone={processStateTone(state)} label={processStateLabel(state)} size="small" />
      </span>

      <span className="running-bar-switch">
        <span className="running-bar-mode">
          {alive
            ? `権限モード: ${currentPermissionModeLabel(running.current_permission_mode)}`
            : `次の起動: ${PERMISSION_MODE_LABELS[selectedMode]}`}
        </span>
        <SelectButton
          size="small"
          label="権限モード"
          disabled={alive && !canSwitch}
          onClick={() => setOpenMenu((m) => (m === "mode" ? null : "mode"))}
        />
        {openMenu === "mode" && (
          <div className="running-bar-menu" role="menu" aria-label="権限モード">
            {MODES.map((value) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={currentMode === value}
                className={`running-bar-menu-item${currentMode === value ? " active" : ""}`}
                onClick={() => {
                  setOpenMenu(null);
                  onSelectMode(value);
                }}
              >
                {PERMISSION_MODE_LABELS[value]}
              </button>
            ))}
          </div>
        )}
      </span>

      {alive && (
        <span className="running-bar-switch">
          <span className="running-bar-mode">
            モデル: {running.current_model ?? "(最初の返答のあとに表示)"}
          </span>
          <SelectButton
            size="small"
            label="モデル"
            disabled={!canSwitch || models.length === 0}
            onClick={() => setOpenMenu((m) => (m === "model" ? null : "model"))}
          />
          {openMenu === "model" && (
            <div className="running-bar-menu" role="menu" aria-label="モデル">
              {models.map((model) => (
                <button
                  key={model.value}
                  type="button"
                  role="menuitem"
                  className={`running-bar-menu-item${
                    running.current_model === model.value ? " active" : ""
                  }`}
                  title={model.description ?? undefined}
                  onClick={() => {
                    setOpenMenu(null);
                    onSelectModel(model.value);
                  }}
                >
                  {model.display_name}
                </button>
              ))}
            </div>
          )}
        </span>
      )}

      {/* 未起動: 次の起動のモデル(別名の固定の選択肢。issue #445)。 */}
      {!alive && canConfigureResume && (
        <span className="running-bar-switch">
          <span className="running-bar-mode">次の起動のモデル: {startModelLabel(selectedStartModel)}</span>
          <SelectButton
            size="small"
            label="モデル"
            onClick={() => setOpenMenu((m) => (m === "start-model" ? null : "start-model"))}
          />
          {openMenu === "start-model" && (
            <div className="running-bar-menu" role="menu" aria-label="次の起動のモデル">
              {[null, ...START_MODELS].map((value) => (
                <button
                  key={value ?? "default"}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedStartModel === value}
                  className={`running-bar-menu-item${selectedStartModel === value ? " active" : ""}`}
                  onClick={() => {
                    setOpenMenu(null);
                    onSelectStartModel(value);
                  }}
                >
                  {value === null ? START_MODEL_DEFAULT_LABEL : START_MODEL_LABELS[value]}
                </button>
              ))}
            </div>
          )}
        </span>
      )}

      {switching && <LoadingIcon size="small" label="設定を切り替え中" />}

      {/* 起動した claude がセッション間メッセージに対応していない版のときの説明(起動は止めない。
          issue #437)。 */}
      {alive && running.peer_messaging_warning && (
        <span className="running-bar-note" role="note">
          {running.peer_messaging_warning}
        </span>
      )}

      {!alive && canConfigureResume && (
        <span className="running-bar-name-field">
          <input
            type="text"
            className="running-bar-name"
            value={resumeName}
            maxLength={MAX_SESSION_NAME_CHARS}
            onChange={(e) => onResumeNameChange(e.target.value)}
            placeholder="表示名(任意)"
            aria-label="表示名(任意。次に開くときに付ける)"
            aria-describedby="running-bar-name-note"
          />
          {/* 入力欄には、会話の現在の表示名を初期値として入れてある(issue #445)。同じ値で再開すれば
              タイトルは変わらず、CLI が既定の名前(フォルダ名 + 連番)を付けない(セッション間
              メッセージの宛先に、役割名を使い続けられる)。変えると、CLI が会話ファイルにタイトルの行を
              足して、この会話のタイトルも変わる(最後のタイトルの行が採用される。CLI の挙動。#426)。
              空にもできる(その場合は CLI が既定の名前を付ける)。 */}
          <span id="running-bar-name-note" className="running-bar-name-note">
            変えると、この会話のタイトルも変わります
          </span>
        </span>
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
        {/* 未起動のとき「終了」の位置に出す(issue #484)。メッセージ無しで、いまバーで
            選んでいる値(権限モード・モデル・表示名)のまま起動だけする。会話ファイルが無い
            新規セッションや対象未確定のときは出さない(`canConfigureResume` と同じ条件)。 */}
        {!alive && canConfigureResume && (
          <button
            type="button"
            className="running-bar-button"
            disabled={starting}
            onClick={onStart}
          >
            {starting ? "起動中…" : "起動"}
          </button>
        )}
      </span>
    </div>
  );
}
