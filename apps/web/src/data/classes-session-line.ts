// apps/native/crates/domain/src/session_line.rs のクラス図データ(Labo試作)
// 実装: PR #40 / スキーマ根拠: reports/claude-session-jsonl-format.md §5
//
// クラスの id は物理名から機械的に付ける(d3.classes 0.6.0 以降は明示 id を受け付ける)。
// 関係線の classId、DOM の data-id、レイアウト保存のキーがすべて物理名で揃うため、
// 配列の並べ替えで参照がずれることがない。
import type {
  AttributeInput,
  ClassInput,
  DiagramInput,
  RelationshipInput,
} from "@yanqirenshi/d3.classes";

// フィールド。名前と型を分けて渡す。名前に `+ ` を書くと、ライブラリが補う
// 可視性記号と二重になる。
const attr = (physical: string, type: string): AttributeInput => ({
  name: { physical, logical: physical, description: "" },
  type,
  visibility: "public",
});

// 列挙のバリアント(serde の tag 値)。可視性も型も持たないため名前だけを描く。
const label = (physical: string): AttributeInput => ({
  name: { physical, logical: physical, description: "" },
  kind: "label",
});

const DEFS: Omit<ClassInput, "id">[] = [
  // ============ 合併型(行の入口) ============
  {
    name: { physical: "SessionLine", logical: "SessionLine", description: "jsonl 1行。serde(tag=type)" }, // 論理名: セッションログ行
    stereotype: "enumeration",
    attributes: [
      "user", "assistant", "system", "attachment",
      "queue-operation", "last-prompt", "custom-title", "ai-title",
      "mode", "pr-link", "atis-latch", "Unknown(serde other)",
    ].map(label),
    position: { x: -2280, y: 40 },
  },
  // ============ 会話チェーン共通 ============
  {
    name: { physical: "ChainLineBase", logical: "ChainLineBase", description: "flattenで各行に埋め込み" }, // 論理名: チェーン行共通
    attributes: [
      attr("uuid", "Option<String>"),
      attr("parent_uuid", "Option<String>"),
      attr("is_sidechain", "Option<bool>"),
      attr("session_id", "Option<String>"),
      attr("timestamp", "Option<String>"),
      attr("cwd", "Option<String>"),
      attr("entrypoint", "Option<String>"),
      attr("version", "Option<String>"),
      attr("git_branch", "Option<String>"),
      attr("slug", "Option<String>"),
      attr("agent_id", "Option<String>"),
    ],
    position: { x: -1940, y: 560 },
  },
  // ============ 会話本体: user ============
  {
    name: { physical: "UserLine", logical: "UserLine", description: "人間の入力/ツール実行結果" }, // 論理名: ユーザー行
    attributes: [
      attr("message", "UserMessage"),
      attr("prompt_id", "Option<String>"),
      attr("permission_mode", "Option<String>"),
      attr("tool_use_result", "Option<Value>"),
      attr("source_tool_assistant_uuid", "Option<String>"),
    ],
    position: { x: -2960, y: 300 },
  },
  {
    name: { physical: "UserMessage", logical: "UserMessage", description: "" }, // 論理名: ユーザーメッセージ
    attributes: [attr("role", "Option<String>"), attr("content", "Option<UserContent>")],
    position: { x: -2960, y: 560 },
  },
  {
    name: { physical: "UserContent", logical: "UserContent", description: "serde(untagged)" }, // 論理名: ユーザー本文
    stereotype: "enumeration",
    attributes: ["Text(String)", "Blocks(Vec<UserContentBlock>)"].map(label),
    position: { x: -2960, y: 800 },
  },
  {
    name: { physical: "UserContentBlock", logical: "UserContentBlock", description: "serde(tag=type)" }, // 論理名: userブロック
    stereotype: "enumeration",
    attributes: ["tool_result", "text", "image", "Unknown"].map(label),
    position: { x: -2960, y: 1040 },
  },
  // ============ 会話本体: assistant ============
  {
    name: { physical: "AssistantLine", logical: "AssistantLine", description: "" }, // 論理名: AI応答行
    attributes: [attr("request_id", "Option<String>"), attr("message", "AssistantMessage")],
    position: { x: -2620, y: 300 },
  },
  {
    name: { physical: "AssistantMessage", logical: "AssistantMessage", description: "Anthropic API形式" }, // 論理名: AI応答メッセージ
    attributes: [
      attr("id", "Option<String>"),
      attr("model", "Option<String>"),
      attr("content", "Vec<AssistantContentBlock>"),
      attr("stop_reason", "Option<String>"),
      attr("usage", "Option<Usage>"),
    ],
    position: { x: -2620, y: 560 },
  },
  {
    name: { physical: "AssistantContentBlock", logical: "AssistantContentBlock", description: "serde(tag=type)" }, // 論理名: assistantブロック
    stereotype: "enumeration",
    attributes: ["text", "thinking", "tool_use", "Unknown"].map(label),
    position: { x: -2620, y: 830 },
  },
  {
    name: { physical: "Usage", logical: "Usage", description: "" }, // 論理名: トークン使用量
    attributes: [
      attr("input_tokens", "u64"),
      attr("output_tokens", "u64"),
      attr("cache_creation_input_tokens", "u64"),
      attr("cache_read_input_tokens", "u64"),
      attr("cache_creation", "Option<CacheCreation>"),
    ],
    position: { x: -2620, y: 1040 },
  },
  {
    name: { physical: "CacheCreation", logical: "CacheCreation", description: "" }, // 論理名: キャッシュ作成量
    attributes: [attr("ephemeral_1h_input_tokens", "u64"), attr("ephemeral_5m_input_tokens", "u64")],
    position: { x: -2620, y: 1300 },
  },
  // ============ content ブロック実体 ============
  {
    name: { physical: "TextBlock", logical: "TextBlock", description: "表示対象はこれのみ" }, // 論理名: 本文
    attributes: [attr("text", "String")],
    position: { x: -2960, y: 1610 },
  },
  {
    name: { physical: "ThinkingBlock", logical: "ThinkingBlock", description: "非表示" }, // 論理名: 思考
    attributes: [attr("thinking", "String"), attr("signature", "String")],
    position: { x: -2670, y: 1610 },
  },
  {
    name: { physical: "ToolUseBlock", logical: "ToolUseBlock", description: "非表示" }, // 論理名: ツール呼び出し
    attributes: [attr("id", "String"), attr("name", "String"), attr("input", "Value")],
    position: { x: -2380, y: 1610 },
  },
  {
    name: { physical: "ToolResultBlock", logical: "ToolResultBlock", description: "非表示" }, // 論理名: ツール結果
    attributes: [attr("tool_use_id", "String"), attr("content", "Value"), attr("is_error", "Option<bool>")],
    position: { x: -2090, y: 1610 },
  },
  {
    name: { physical: "ImageBlock", logical: "ImageBlock", description: "非表示" }, // 論理名: 画像
    attributes: [attr("source", "Value")],
    position: { x: -1800, y: 1610 },
  },
  // ============ 内部イベント: system ============
  {
    name: { physical: "SystemLine", logical: "SystemLine", description: "serde(tag=subtype)" }, // 論理名: システム行
    stereotype: "enumeration",
    attributes: ["stop_hook_summary", "api_error", "compact_boundary", "informational", "Unknown"].map(label),
    position: { x: -2280, y: 380 },
  },
  {
    name: { physical: "StopHookSummaryLine", logical: "StopHookSummaryLine", description: "" }, // 論理名: フック実行結果
    attributes: [
      attr("level", "Option<SystemLevel>"),
      attr("hook_count", "Option<u64>"),
      attr("hook_infos", "Vec<HookInfo>"),
      attr("prevented_continuation", "Option<bool>"),
      attr("stop_reason", "Option<String>"),
      attr("tool_use_id", "Option<String>"),
    ],
    position: { x: -2280, y: 640 },
  },
  {
    name: { physical: "HookInfo", logical: "HookInfo", description: "" }, // 論理名: フック情報
    attributes: [attr("command", "Option<String>"), attr("duration_ms", "Option<u64>")],
    position: { x: -1940, y: 1080 },
  },
  {
    name: { physical: "SystemLevel", logical: "SystemLevel", description: "" }, // 論理名: 重要度
    stereotype: "enumeration",
    attributes: ["Info", "Warning", "Error", "Suggestion", "Unknown"].map(label),
    position: { x: -1940, y: 900 },
  },
  {
    name: { physical: "ApiErrorLine", logical: "ApiErrorLine", description: "" }, // 論理名: APIエラー行
    attributes: [
      attr("error", "ApiErrorDetail"),
      attr("retry_in_ms", "Option<u64>"),
      attr("retry_attempt", "Option<u64>"),
      attr("max_retries", "Option<u64>"),
      attr("source", "Option<String>"),
    ],
    position: { x: -2280, y: 960 },
  },
  {
    name: { physical: "ApiErrorDetail", logical: "ApiErrorDetail", description: "" }, // 論理名: APIエラー詳細
    attributes: [
      attr("message", "Option<String>"),
      attr("formatted", "Option<String>"),
      attr("is_network_down", "Option<bool>"),
    ],
    position: { x: -1940, y: 1240 },
  },
  {
    name: { physical: "CompactBoundaryLine", logical: "CompactBoundaryLine", description: "parentUuid=null起点" }, // 論理名: 履歴圧縮境界
    attributes: [
      attr("logical_parent_uuid", "Option<String>"),
      attr("content", "Option<String>"),
      attr("is_meta", "Option<bool>"),
      attr("compact_metadata", "CompactMetadata"),
    ],
    position: { x: -2280, y: 1220 },
  },
  {
    name: { physical: "CompactMetadata", logical: "CompactMetadata", description: "" }, // 論理名: 圧縮メタ
    attributes: [
      attr("trigger", "Option<String>"),
      attr("pre_tokens", "Option<u64>"),
      attr("post_tokens", "Option<u64>"),
    ],
    position: { x: -1940, y: 1400 },
  },
  {
    name: { physical: "InformationalLine", logical: "InformationalLine", description: "" }, // 論理名: 情報通知行
    attributes: [attr("content", "Option<String>"), attr("is_meta", "Option<bool>")],
    position: { x: -2280, y: 1460 },
  },
  // ============ 内部イベント: attachment ============
  {
    name: { physical: "AttachmentLine", logical: "AttachmentLine", description: "attachment.typeで23種(未使用のためValueのまま)" }, // 論理名: 付帯情報行
    attributes: [attr("attachment", "Value")],
    position: { x: -1940, y: 300 },
  },
  // ============ セッションメタ ============
  {
    name: { physical: "QueueOperationLine", logical: "QueueOperationLine", description: "" }, // 論理名: 入力キュー投入
    attributes: [
      attr("operation", "Option<String>"),
      attr("content", "Option<String>"),
      attr("session_id", "Option<String>"),
    ],
    position: { x: -1600, y: 40 },
  },
  {
    name: { physical: "LastPromptLine", logical: "LastPromptLine", description: "" }, // 論理名: 直近プロンプト
    attributes: [
      attr("last_prompt", "Option<String>"),
      attr("leaf_uuid", "Option<String>"),
      attr("session_id", "Option<String>"),
    ],
    position: { x: -1600, y: 210 },
  },
  {
    name: { physical: "CustomTitleLine", logical: "CustomTitleLine", description: "最後の行が有効" }, // 論理名: 会話タイトル
    attributes: [attr("custom_title", "Option<String>"), attr("session_id", "Option<String>")],
    position: { x: -1600, y: 380 },
  },
  {
    name: { physical: "AiTitleLine", logical: "AiTitleLine", description: "" }, // 論理名: AI生成タイトル
    attributes: [attr("ai_title", "Option<String>"), attr("session_id", "Option<String>")],
    position: { x: -1600, y: 530 },
  },
  {
    name: { physical: "ModeLine", logical: "ModeLine", description: "実測はnormalのみ" }, // 論理名: モード
    attributes: [attr("mode", "Option<String>"), attr("session_id", "Option<String>")],
    position: { x: -1600, y: 680 },
  },
  {
    name: { physical: "PrLinkLine", logical: "PrLinkLine", description: "" }, // 論理名: GitHub PRリンク
    attributes: [
      attr("pr_number", "Option<u64>"),
      attr("pr_url", "Option<String>"),
      attr("pr_repository", "Option<String>"),
    ],
    position: { x: -1600, y: 830 },
  },
  {
    name: { physical: "AtisLatchLine", logical: "AtisLatchLine", description: "atisは全件空文字列" }, // 論理名: 用途不明
    attributes: [attr("atis", "Option<String>"), attr("session_id", "Option<String>")],
    position: { x: -1600, y: 1000 },
  },
];

const CLASSES: ClassInput[] = DEFS.map((c) => ({ ...c, id: c.name.physical }));

// 関係線はクラスの id(= 物理名)で参照する。綴り違いはここで落とす。
const ref = (physical: string): string => {
  if (!DEFS.some((c) => c.name.physical === physical)) {
    throw new Error(`unknown class: ${physical}`);
  }
  return physical;
};

type Side = "top" | "bottom" | "left" | "right";
const rel = (
  type: RelationshipInput["type"],
  from: string,
  to: string,
  label?: string,
  fromPoint: Side = "bottom",
  toPoint: Side = "top",
): RelationshipInput => ({
  // `<起点>-><終点>`。接続辺の手調整(layout/classes.json)のキーに使う。
  // 同じ組に2本張ると id が重複し、d3.classes が例外を出す(黙って上書きしない)。
  id: `${from}->${to}`,
  type,
  from: { classId: ref(from), point: fromPoint },
  to: { classId: ref(to), point: toPoint },
  ...(label ? { label } : {}),
});

const RELATIONSHIPS: RelationshipInput[] = [
  // SessionLine(tag=type) → 各バリアント
  rel("dependency", "SessionLine", "UserLine", "user", "left", "top"),
  rel("dependency", "SessionLine", "AssistantLine", "assistant", "left", "top"),
  rel("dependency", "SessionLine", "SystemLine", "system"),
  rel("dependency", "SessionLine", "AttachmentLine", "attachment", "right", "top"),
  rel("dependency", "SessionLine", "QueueOperationLine", "queue-operation", "right", "left"),
  rel("dependency", "SessionLine", "LastPromptLine", "last-prompt", "right", "left"),
  rel("dependency", "SessionLine", "CustomTitleLine", "custom-title", "right", "left"),
  rel("dependency", "SessionLine", "AiTitleLine", "ai-title", "right", "left"),
  rel("dependency", "SessionLine", "ModeLine", "mode", "right", "left"),
  rel("dependency", "SessionLine", "PrLinkLine", "pr-link", "right", "left"),
  rel("dependency", "SessionLine", "AtisLatchLine", "atis-latch", "right", "left"),
  // serde(flatten) による共通フィールドの合成
  rel("composition", "UserLine", "ChainLineBase", "flatten", "right", "left"),
  rel("composition", "AssistantLine", "ChainLineBase", "flatten", "right", "left"),
  rel("composition", "AttachmentLine", "ChainLineBase", "flatten"),
  rel("composition", "StopHookSummaryLine", "ChainLineBase", "flatten", "right", "left"),
  rel("composition", "ApiErrorLine", "ChainLineBase", "flatten", "right", "left"),
  rel("composition", "CompactBoundaryLine", "ChainLineBase", "flatten", "right", "left"),
  rel("composition", "InformationalLine", "ChainLineBase", "flatten", "right", "left"),
  // user 系
  rel("composition", "UserLine", "UserMessage"),
  rel("association", "UserMessage", "UserContent", "content"),
  rel("dependency", "UserContent", "UserContentBlock", "Blocks"),
  rel("dependency", "UserContentBlock", "ToolResultBlock", "tool_result", "bottom", "top"),
  rel("dependency", "UserContentBlock", "TextBlock", "text"),
  rel("dependency", "UserContentBlock", "ImageBlock", "image", "right", "left"),
  // assistant 系
  rel("composition", "AssistantLine", "AssistantMessage"),
  rel("association", "AssistantMessage", "AssistantContentBlock", "content"),
  rel("dependency", "AssistantContentBlock", "TextBlock", "text", "left", "top"),
  rel("dependency", "AssistantContentBlock", "ThinkingBlock", "thinking"),
  rel("dependency", "AssistantContentBlock", "ToolUseBlock", "tool_use", "right", "top"),
  rel("association", "AssistantMessage", "Usage", "usage", "bottom", "top"),
  rel("association", "Usage", "CacheCreation", "cache_creation"),
  // system 系(tag=subtype)
  rel("dependency", "SystemLine", "StopHookSummaryLine", "stop_hook_summary"),
  rel("dependency", "SystemLine", "ApiErrorLine", "api_error", "left", "left"),
  rel("dependency", "SystemLine", "CompactBoundaryLine", "compact_boundary", "left", "left"),
  rel("dependency", "SystemLine", "InformationalLine", "informational", "left", "left"),
  rel("association", "StopHookSummaryLine", "HookInfo", "hook_infos *", "bottom", "left"),
  rel("association", "StopHookSummaryLine", "SystemLevel", "level", "right", "left"),
  rel("composition", "ApiErrorLine", "ApiErrorDetail", "error", "right", "left"),
  rel("composition", "CompactBoundaryLine", "CompactMetadata", "compact_metadata", "right", "left"),
];

export const SESSION_LINE_CLASS_DATA: DiagramInput = {
  classes: CLASSES,
  relationships: RELATIONSHIPS,
};
