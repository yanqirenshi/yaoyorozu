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

/** 権限モードの表示名(Phase 1 は plan と default の2つ)。 */
export const PERMISSION_MODE_LABELS: Record<RunningPermissionModeDto, string> = {
  plan: "計画のみ(plan)",
  default: "確認しながら実行(default)",
};

/** 権限モードの短い名前(状態表示の並びに置く)。 */
export const PERMISSION_MODE_SHORT_LABELS: Record<RunningPermissionModeDto, string> = {
  plan: "plan",
  default: "default",
};

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
