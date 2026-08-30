// apps/native/crates/domain/src/session_line.rs のクラス図データ(Labo試作)
// 実装: PR #40 / スキーマ根拠: reports/claude-session-jsonl-format.md §5
//
// d3.classes の関係線は「classes 配列の順序から自動採番される class-N」を
// 参照する仕様のため、並べ替えに強いよう物理名→ID のヘルパーで参照する。
import type { ClassInput, DiagramInput, RelationshipInput } from "@yanqirenshi/d3.classes";

const CLASSES: ClassInput[] = [
  // ============ 合併型(行の入口) ============
  {
    name: { physical: "SessionLine", logical: "SessionLine", description: "jsonl 1行。serde(tag=type)" }, // 論理名: セッションログ行
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
    name: { physical: "ChainLineBase", logical: "ChainLineBase", description: "flattenで各行に埋め込み" }, // 論理名: チェーン行共通
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
    name: { physical: "UserLine", logical: "UserLine", description: "人間の入力/ツール実行結果" }, // 論理名: ユーザー行
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
    name: { physical: "UserMessage", logical: "UserMessage", description: "" }, // 論理名: ユーザーメッセージ
    attributes: ["+ role: Option<String>", "+ content: Option<UserContent>"],
    position: { x: 40, y: 560 },
  },
  {
    name: { physical: "UserContent", logical: "UserContent", description: "serde(untagged)" }, // 論理名: ユーザー本文
    stereotype: "enumeration",
    attributes: ["Text(String)", "Blocks(Vec<UserContentBlock>)"],
    position: { x: 40, y: 800 },
  },
  {
    name: { physical: "UserContentBlock", logical: "UserContentBlock", description: "serde(tag=type)" }, // 論理名: userブロック
    stereotype: "enumeration",
    attributes: ["tool_result", "text", "image", "Unknown"],
    position: { x: 40, y: 1040 },
  },
  // ============ 会話本体: assistant ============
  {
    name: { physical: "AssistantLine", logical: "AssistantLine", description: "" }, // 論理名: AI応答行
    attributes: ["+ request_id: Option<String>", "+ message: AssistantMessage"],
    position: { x: 380, y: 300 },
  },
  {
    name: { physical: "AssistantMessage", logical: "AssistantMessage", description: "Anthropic API形式" }, // 論理名: AI応答メッセージ
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
    name: { physical: "AssistantContentBlock", logical: "AssistantContentBlock", description: "serde(tag=type)" }, // 論理名: assistantブロック
    stereotype: "enumeration",
    attributes: ["text", "thinking", "tool_use", "Unknown"],
    position: { x: 380, y: 830 },
  },
  {
    name: { physical: "Usage", logical: "Usage", description: "" }, // 論理名: トークン使用量
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
    name: { physical: "CacheCreation", logical: "CacheCreation", description: "" }, // 論理名: キャッシュ作成量
    attributes: ["+ ephemeral_1h_input_tokens: u64", "+ ephemeral_5m_input_tokens: u64"],
    position: { x: 380, y: 1300 },
  },
  // ============ content ブロック実体 ============
  {
    name: { physical: "TextBlock", logical: "TextBlock", description: "表示対象はこれのみ" }, // 論理名: 本文
    attributes: ["+ text: String"],
    position: { x: 40, y: 1610 },
  },
  {
    name: { physical: "ThinkingBlock", logical: "ThinkingBlock", description: "非表示" }, // 論理名: 思考
    attributes: ["+ thinking: String", "+ signature: String"],
    position: { x: 330, y: 1610 },
  },
  {
    name: { physical: "ToolUseBlock", logical: "ToolUseBlock", description: "非表示" }, // 論理名: ツール呼び出し
    attributes: ["+ id: String", "+ name: String", "+ input: Value"],
    position: { x: 620, y: 1610 },
  },
  {
    name: { physical: "ToolResultBlock", logical: "ToolResultBlock", description: "非表示" }, // 論理名: ツール結果
    attributes: ["+ tool_use_id: String", "+ content: Value", "+ is_error: Option<bool>"],
    position: { x: 910, y: 1610 },
  },
  {
    name: { physical: "ImageBlock", logical: "ImageBlock", description: "非表示" }, // 論理名: 画像
    attributes: ["+ source: Value"],
    position: { x: 1200, y: 1610 },
  },
  // ============ 内部イベント: system ============
  {
    name: { physical: "SystemLine", logical: "SystemLine", description: "serde(tag=subtype)" }, // 論理名: システム行
    stereotype: "enumeration",
    attributes: ["stop_hook_summary", "api_error", "compact_boundary", "informational", "Unknown"],
    position: { x: 720, y: 380 },
  },
  {
    name: { physical: "StopHookSummaryLine", logical: "StopHookSummaryLine", description: "" }, // 論理名: フック実行結果
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
    name: { physical: "HookInfo", logical: "HookInfo", description: "" }, // 論理名: フック情報
    attributes: ["+ command: Option<String>", "+ duration_ms: Option<u64>"],
    position: { x: 1060, y: 1080 },
  },
  {
    name: { physical: "SystemLevel", logical: "SystemLevel", description: "" }, // 論理名: 重要度
    stereotype: "enumeration",
    attributes: ["Info", "Warning", "Error", "Suggestion", "Unknown"],
    position: { x: 1060, y: 900 },
  },
  {
    name: { physical: "ApiErrorLine", logical: "ApiErrorLine", description: "" }, // 論理名: APIエラー行
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
    name: { physical: "ApiErrorDetail", logical: "ApiErrorDetail", description: "" }, // 論理名: APIエラー詳細
    attributes: ["+ message: Option<String>", "+ formatted: Option<String>", "+ is_network_down: Option<bool>"],
    position: { x: 1060, y: 1240 },
  },
  {
    name: { physical: "CompactBoundaryLine", logical: "CompactBoundaryLine", description: "parentUuid=null起点" }, // 論理名: 履歴圧縮境界
    attributes: [
      "+ logical_parent_uuid: Option<String>",
      "+ content: Option<String>",
      "+ is_meta: Option<bool>",
      "+ compact_metadata: CompactMetadata",
    ],
    position: { x: 720, y: 1220 },
  },
  {
    name: { physical: "CompactMetadata", logical: "CompactMetadata", description: "" }, // 論理名: 圧縮メタ
    attributes: ["+ trigger: Option<String>", "+ pre_tokens: Option<u64>", "+ post_tokens: Option<u64>"],
    position: { x: 1060, y: 1400 },
  },
  {
    name: { physical: "InformationalLine", logical: "InformationalLine", description: "" }, // 論理名: 情報通知行
    attributes: ["+ content: Option<String>", "+ is_meta: Option<bool>"],
    position: { x: 720, y: 1460 },
  },
  // ============ 内部イベント: attachment ============
  {
    name: { physical: "AttachmentLine", logical: "AttachmentLine", description: "attachment.typeで23種(未使用のためValueのまま)" }, // 論理名: 付帯情報行
    attributes: ["+ attachment: Value"],
    position: { x: 1060, y: 300 },
  },
  // ============ セッションメタ ============
  {
    name: { physical: "QueueOperationLine", logical: "QueueOperationLine", description: "" }, // 論理名: 入力キュー投入
    attributes: ["+ operation: Option<String>", "+ content: Option<String>", "+ session_id: Option<String>"],
    position: { x: 1400, y: 40 },
  },
  {
    name: { physical: "LastPromptLine", logical: "LastPromptLine", description: "" }, // 論理名: 直近プロンプト
    attributes: ["+ last_prompt: Option<String>", "+ leaf_uuid: Option<String>", "+ session_id: Option<String>"],
    position: { x: 1400, y: 210 },
  },
  {
    name: { physical: "CustomTitleLine", logical: "CustomTitleLine", description: "最後の行が有効" }, // 論理名: 会話タイトル
    attributes: ["+ custom_title: Option<String>", "+ session_id: Option<String>"],
    position: { x: 1400, y: 380 },
  },
  {
    name: { physical: "AiTitleLine", logical: "AiTitleLine", description: "" }, // 論理名: AI生成タイトル
    attributes: ["+ ai_title: Option<String>", "+ session_id: Option<String>"],
    position: { x: 1400, y: 530 },
  },
  {
    name: { physical: "ModeLine", logical: "ModeLine", description: "実測はnormalのみ" }, // 論理名: モード
    attributes: ["+ mode: Option<String>", "+ session_id: Option<String>"],
    position: { x: 1400, y: 680 },
  },
  {
    name: { physical: "PrLinkLine", logical: "PrLinkLine", description: "" }, // 論理名: GitHub PRリンク
    attributes: ["+ pr_number: Option<u64>", "+ pr_url: Option<String>", "+ pr_repository: Option<String>"],
    position: { x: 1400, y: 830 },
  },
  {
    name: { physical: "AtisLatchLine", logical: "AtisLatchLine", description: "atisは全件空文字列" }, // 論理名: 用途不明
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
