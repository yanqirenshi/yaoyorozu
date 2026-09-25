import type { BadgeTone } from "./Badge";
import type {
  PermissionSuggestionDto,
  ProcessStateDto,
  RunningPermissionModeDto,
} from "./api/types";

// 実行中セッション(issue #392)の表示用の文言。値の意味(状態・モード)は backend が持ち、
// ここは表示名だけ。

/** プロセスの状態の表示名。未起動(`null`)も含む。 */
export function processStateLabel(state: ProcessStateDto | null): string {
  switch (state) {
    case "starting":
      return "起動中";
    case "idle":
      return "待機";
    case "running":
      return "実行中";
    case "awaiting_permission":
      return "権限待ち";
    case "exited":
      return "終了";
    default:
      return "未起動";
  }
}

/**
 * プロセスの状態のバッジのトーン(意味で選ぶ。issue #411): まだ始まっていない・終わって落ち着いて
 * いる(未起動・停止中・待機)は `idle`、いま動いている・人の操作を待っている(起動中・実行中・
 * 権限待ち)は `running`。異常終了を区別する値は画面に来ていない(終了コードは通知だけ)ので、
 * `error` は使わない。
 */
export function processStateTone(state: ProcessStateDto | null): BadgeTone {
  switch (state) {
    case "starting":
    case "running":
    case "awaiting_permission":
      return "running";
    default:
      return "idle";
  }
}

/** 権限モードの表示名(選べるモード。issue #407 で acceptEdits・auto を足した)。 */
export const PERMISSION_MODE_LABELS: Record<RunningPermissionModeDto, string> = {
  plan: "計画のみ(plan)",
  default: "確認しながら実行(default)",
  accept_edits: "編集は確認しない(acceptEdits)",
  auto: "自動(auto)",
};

/**
 * いまの権限モード(CLI が返す値のまま)の短い名前。CLI 2.1.280 は `default` を `manual` に
 * 改名しているので、どちらも `default` として出す。知らない値はそのまま出す。
 */
export function currentPermissionModeLabel(value: string | null): string {
  switch (value) {
    case null:
      return "?";
    case "manual":
      return "default";
    default:
      return value;
  }
}

/** CLI が返す権限モードの値 → 画面で選べるモード(選べないものは `null`)。 */
export function selectableModeOf(value: string | null): RunningPermissionModeDto | null {
  switch (value) {
    case "plan":
      return "plan";
    case "default":
    case "manual":
      return "default";
    case "acceptEdits":
      return "accept_edits";
    case "auto":
      return "auto";
    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function destinationNote(destination: string): string {
  switch (destination) {
    case "session":
      return "このセッションのみ";
    case "localSettings":
    case "projectSettings":
    case "userSettings":
      return "設定に保存";
    default:
      return destination;
  }
}

/**
 * 「今後も許可」の提案(SDK の PermissionUpdate)を、ボタンに出す1行の文言にする。
 * 表示のためだけの文言で、返すときは提案をそのまま backend へ渡す。知らない種別は
 * 種別名のまま出す(版で増える)。
 */
export function describeSuggestion(suggestion: PermissionSuggestionDto): string {
  const content = asRecord(suggestion.suggestion_content) ?? {};
  const where = destinationNote(suggestion.suggestion_destination);
  switch (suggestion.suggestion_type) {
    case "setMode": {
      const mode = typeof content.mode === "string" ? content.mode : "?";
      return `許可して、モードを ${mode} にする(${where})`;
    }
    case "addRules": {
      const rules = Array.isArray(content.rules) ? content.rules : [];
      const names = rules
        .map((rule) => {
          const r = asRecord(rule);
          if (!r || typeof r.toolName !== "string") return null;
          return typeof r.ruleContent === "string" && r.ruleContent
            ? `${r.toolName}(${r.ruleContent})`
            : r.toolName;
        })
        .filter((name): name is string => name !== null);
      return `許可して、今後 ${names.join("、") || "このルール"} を許可する(${where})`;
    }
    case "addDirectories": {
      const dirs = Array.isArray(content.directories)
        ? content.directories.filter((d): d is string => typeof d === "string")
        : [];
      return `許可して、${dirs.join("、") || "このフォルダ"} を対象に加える(${where})`;
    }
    default:
      return `許可して、${suggestion.suggestion_type} を適用する(${where})`;
  }
}
