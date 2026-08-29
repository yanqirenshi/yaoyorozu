// apps/native/crates/domain/src/session_line.rs のクラス図データ(Labo試作)
// 実装: PR #40 / スキーマ根拠: reports/claude-session-jsonl-format.md §5
//
// d3.classes の関係線は「classes 配列の順序から自動採番される class-N」を
// 参照する仕様のため、並べ替えに強いよう物理名→ID のヘルパーで参照する。
import type { ClassInput, DiagramInput, RelationshipInput } from "@yanqirenshi/d3.classes";

const CLASSES: ClassInput[] = [
  // ============ 合併型(行の入口) ============
  {
    name: { physical: "SessionLine", logical: "セッションログ行", description: "jsonl 1行。serde(tag=type)" },
    stereotype: "enumeration",
    attributes: [
      "user", "assistant", "system", "attachment",
      "queue-operation", "last-prompt", "custom-title", "ai-title",
      "mode", "pr-link", "atis-latch", "Unknown(serde other)",
    ],
    position: { x: 720, y: 40 },
  },
  // ============ 会話チェーン共通 ============
  {
    name: { physical: "ChainLineBase", logical: "チェーン行共通", description: "flattenで各行に埋め込み" },
    attributes: [
      "+ uuid: Option<String>",
      "+ parent_uuid: Option<String>",
      "+ is_sidechain: Option<bool>",
      "+ session_id: Option<String>",
      "+ timestamp: Option<String>",
      "+ cwd: Option<String>",
      "+ entrypoint: Option<String>",
      "+ version: Option<String>",
      "+ git_branch: Option<String>",
      "+ slug: Option<String>",
      "+ agent_id: Option<String>",
    ],
    position: { x: 1060, y: 560 },
  },
  // ============ 会話本体: user ============
  {
    name: { physical: "UserLine", logical: "ユーザー行", description: "人間の入力/ツール実行結果" },
    attributes: [
      "+ message: UserMessage",
      "+ prompt_id: Option<String>",
      "+ permission_mode: Option<String>",
      "+ tool_use_result: Option<Value>",
      "+ source_tool_assistant_uuid: Option<String>",
    ],
    position: { x: 40, y: 300 },
  },
  {
    name: { physical: "UserMessage", logical: "ユーザーメッセージ", description: "" },
    attributes: ["+ role: Option<String>", "+ content: Option<UserContent>"],
    position: { x: 40, y: 560 },
  },
  {
    name: { physical: "UserContent", logical: "ユーザー本文", description: "serde(untagged)" },
    stereotype: "enumeration",
    attributes: ["Text(String)", "Blocks(Vec<UserContentBlock>)"],
    position: { x: 40, y: 800 },
  },
  {
    name: { physical: "UserContentBlock", logical: "userブロック", description: "serde(tag=type)" },
    stereotype: "enumeration",
    attributes: ["tool_result", "text", "image", "Unknown"],
    position: { x: 40, y: 1040 },
  },
  // ============ 会話本体: assistant ============
  {
    name: { physical: "AssistantLine", logical: "AI応答行", description: "" },
    attributes: ["+ request_id: Option<String>", "+ message: AssistantMessage"],
    position: { x: 380, y: 300 },
  },
  {
    name: { physical: "AssistantMessage", logical: "AI応答メッセージ", description: "Anthropic API形式" },
    attributes: [
      "+ id: Option<String>",
      "+ model: Option<String>",
      "+ content: Vec<AssistantContentBlock>",
      "+ stop_reason: Option<String>",
      "+ usage: Option<Usage>",
    ],
    position: { x: 380, y: 560 },
  },
  {
    name: { physical: "AssistantContentBlock", logical: "assistantブロック", description: "serde(tag=type)" },
    stereotype: "enumeration",
    attributes: ["text", "thinking", "tool_use", "Unknown"],
    position: { x: 380, y: 830 },
  },
  {
    name: { physical: "Usage", logical: "トークン使用量", description: "" },
    attributes: [
      "+ input_tokens: u64",
      "+ output_tokens: u64",
      "+ cache_creation_input_tokens: u64",
      "+ cache_read_input_tokens: u64",
      "+ cache_creation: Option<CacheCreation>",
    ],
    position: { x: 380, y: 1040 },
  },
  {
    name: { physical: "CacheCreation", logical: "キャッシュ作成量", description: "" },
    attributes: ["+ ephemeral_1h_input_tokens: u64", "+ ephemeral_5m_input_tokens: u64"],
    position: { x: 380, y: 1300 },
  },
  // ============ content ブロック実体 ============
  {
    name: { physical: "TextBlock", logical: "本文", description: "表示対象はこれのみ" },
    attributes: ["+ text: String"],
    position: { x: 40, y: 1610 },
  },
  {
    name: { physical: "ThinkingBlock", logical: "思考", description: "非表示" },
    attributes: ["+ thinking: String", "+ signature: String"],
    position: { x: 330, y: 1610 },
  },
  {
    name: { physical: "ToolUseBlock", logical: "ツール呼び出し", description: "非表示" },
    attributes: ["+ id: String", "+ name: String", "+ input: Value"],
    position: { x: 620, y: 1610 },
  },
  {
    name: { physical: "ToolResultBlock", logical: "ツール結果", description: "非表示" },
    attributes: ["+ tool_use_id: String", "+ content: Value", "+ is_error: Option<bool>"],
    position: { x: 910, y: 1610 },
  },
  {
    name: { physical: "ImageBlock", logical: "画像", description: "非表示" },
    attributes: ["+ source: Value"],
    position: { x: 1200, y: 1610 },
  },
  // ============ 内部イベント: system ============
  {
    name: { physical: "SystemLine", logical: "システム行", description: "serde(tag=subtype)" },
    stereotype: "enumeration",
    attributes: ["stop_hook_summary", "api_error", "compact_boundary", "informational", "Unknown"],
    position: { x: 720, y: 380 },
  },
  {
    name: { physical: "StopHookSummaryLine", logical: "フック実行結果", description: "" },
    attributes: [
      "+ level: Option<SystemLevel>",
      "+ hook_count: Option<u64>",
      "+ hook_infos: Vec<HookInfo>",
      "+ prevented_continuation: Option<bool>",
      "+ stop_reason: Option<String>",
      "+ tool_use_id: Option<String>",
    ],
    position: { x: 720, y: 640 },
  },
  {
    name: { physical: "HookInfo", logical: "フック情報", description: "" },
    attributes: ["+ command: Option<String>", "+ duration_ms: Option<u64>"],
    position: { x: 1060, y: 1080 },
  },
  {
    name: { physical: "SystemLevel", logical: "重要度", description: "" },
    stereotype: "enumeration",
    attributes: ["Info", "Warning", "Error", "Suggestion", "Unknown"],
    position: { x: 1060, y: 900 },
  },
  {
    name: { physical: "ApiErrorLine", logical: "APIエラー行", description: "" },
    attributes: [
      "+ error: ApiErrorDetail",
      "+ retry_in_ms: Option<u64>",
      "+ retry_attempt: Option<u64>",
      "+ max_retries: Option<u64>",
      "+ source: Option<String>",
    ],
    position: { x: 720, y: 960 },
  },
  {
    name: { physical: "ApiErrorDetail", logical: "APIエラー詳細", description: "" },
    attributes: ["+ message: Option<String>", "+ formatted: Option<String>", "+ is_network_down: Option<bool>"],
    position: { x: 1060, y: 1240 },
  },
  {
    name: { physical: "CompactBoundaryLine", logical: "履歴圧縮境界", description: "parentUuid=null起点" },
    attributes: [
      "+ logical_parent_uuid: Option<String>",
      "+ content: Option<String>",
      "+ is_meta: Option<bool>",
      "+ compact_metadata: CompactMetadata",
    ],
    position: { x: 720, y: 1220 },
  },
  {
    name: { physical: "CompactMetadata", logical: "圧縮メタ", description: "" },
    attributes: ["+ trigger: Option<String>", "+ pre_tokens: Option<u64>", "+ post_tokens: Option<u64>"],
    position: { x: 1060, y: 1400 },
  },
  {
    name: { physical: "InformationalLine", logical: "情報通知行", description: "" },
    attributes: ["+ content: Option<String>", "+ is_meta: Option<bool>"],
    position: { x: 720, y: 1460 },
  },
  // ============ 内部イベント: attachment ============
  {
    name: { physical: "AttachmentLine", logical: "付帯情報行", description: "attachment.typeで23種(未使用のためValueのまま)" },
    attributes: ["+ attachment: Value"],
    position: { x: 1060, y: 300 },
  },
  // ============ セッションメタ ============
  {
    name: { physical: "QueueOperationLine", logical: "入力キュー投入", description: "" },
    attributes: ["+ operation: Option<String>", "+ content: Option<String>", "+ session_id: Option<String>"],
    position: { x: 1400, y: 40 },
  },
  {
    name: { physical: "LastPromptLine", logical: "直近プロンプト", description: "" },
    attributes: ["+ last_prompt: Option<String>", "+ leaf_uuid: Option<String>", "+ session_id: Option<String>"],
    position: { x: 1400, y: 210 },
  },
  {
    name: { physical: "CustomTitleLine", logical: "会話タイトル", description: "最後の行が有効" },
    attributes: ["+ custom_title: Option<String>", "+ session_id: Option<String>"],
    position: { x: 1400, y: 380 },
  },
  {
    name: { physical: "AiTitleLine", logical: "AI生成タイトル", description: "" },
    attributes: ["+ ai_title: Option<String>", "+ session_id: Option<String>"],
    position: { x: 1400, y: 530 },
  },
  {
    name: { physical: "ModeLine", logical: "モード", description: "実測はnormalのみ" },
    attributes: ["+ mode: Option<String>", "+ session_id: Option<String>"],
    position: { x: 1400, y: 680 },
  },
  {
    name: { physical: "PrLinkLine", logical: "GitHub PRリンク", description: "" },
    attributes: ["+ pr_number: Option<u64>", "+ pr_url: Option<String>", "+ pr_repository: Option<String>"],
    position: { x: 1400, y: 830 },
  },
  {
    name: { physical: "AtisLatchLine", logical: "用途不明", description: "atisは全件空文字列" },
    attributes: ["+ atis: Option<String>", "+ session_id: Option<String>"],
    position: { x: 1400, y: 1000 },
  },
];

// 物理名 → d3.classes が自動採番する "class-N" を引く(配列順に依存させない)
const id = (physical: string): string => {
  const i = CLASSES.findIndex((c) => c.name.physical === physical);
  if (i < 0) throw new Error(`unknown class: ${physical}`);
  return `class-${i + 1}`;
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
  type,
  from: { classId: id(from), point: fromPoint },
  to: { classId: id(to), point: toPoint },
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
