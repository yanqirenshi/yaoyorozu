/**
 * YAOYOROZU のドメインのオブジェクトモデル。
 *
 * データモデル(TM、`tm.ts`)を元に起こす。TM は「何を個体指定子として、何と何が
 * 関係するか」を描き、こちらは「アプリの中にどんなオブジェクトがあり、どう
 * 繋がるか」を描く。apps/native の domain クレート(Rust)で実装する前提で書くため、
 * フィールド名は snake_case、型は Rust の型にする。フィールド名は TM の物理名
 * (camelCase)と1対1に対応させる(例: `systemUuid` → `system_uuid`)。
 *
 * 【TM からの写し方】
 * - リソース・イベントはクラスにする。個体指定子もフィールドとして持つ
 *   (オブジェクトの同一性の根拠になるため)。ただし他のモノから継承した個体指定子
 *   (`(R)` 付き)はフィールドにせず、関連で表す(TM の `(R)` は「関係がある」の意味で
 *   参照キーではないため)。
 * - 対照表(R-R)・対応表(E-E)は、それ自身の属性が無ければクラスにせず、多重度付きの
 *   関連にする。属性が付いた段階で関連クラスに格上げする。
 * - 日時は domain クレートに合わせて UNIX エポックからのミリ秒(`u64`)で持つ
 *   (domain は chrono 等に依存しておらず、既存の `*_ms` も同じ単位)。まだ起きていない
 *   出来事の日時(削除日時など)は `Option` にする。
 * - 導出できる値(TM の `(D)`)は、UML の派生属性にならって名前の前に `/` を付ける
 *   (例: `/last_prompt`)。実装ではフィールドにせず、計算するメソッドにしてよい。
 * - 多重度は TM の結線記号を写す。記号は「そのエンティティが相手1件に対して何件か」を
 *   表すので、UML で同じ側の端に置く多重度とそのまま対応する
 *   (鳥足+横棒 = `1..*`、鳥足+丸 = `0..*`、横棒+横棒 = `1`、横棒+丸 = `0..1`)。
 *
 * 【スコープ】TM の「実行環境」のうち PC・ユーザー(第1弾)、Gitリポジトリ(第2弾)、
 * Gitブランチ・ワーキングツリー(第3弾)と、セッション(第4弾)。設定ファイル類と、
 * セッションまわり(セッションファイル・ログ行・入力キュー・作業ディレクトリ・実行中
 * セッション)は次段以降。既存のクラスとそれらの関係も、相手のクラスを書く段階で足す。
 *
 * 【TM との違い・未決】
 * - `home_directory` は TM どおりユーザーに置いている。ただし TM の「PC．ユーザー」の
 *   説明にあるとおり同じユーザー名が複数の PC にありうるので、実際のパスは PC ごとに
 *   違いうる。そうなら PC × ユーザー の組(関連クラス)の属性にすべきで、TM 側の
 *   判断を仰いでから直す。
 * - `repository_path` を Gitリポジトリの個体指定子にしている(TM どおり)。ただし TM の
 *   「PC．Gitリポジトリ」の説明にあるとおり同じリポジトリを複数の PC にクローンしうるので、
 *   置き場所のパスは PC ごとに違いうる。パスでは PC をまたいで同じリポジトリだと言えない
 *   ため、`home_directory` と同じく TM 側と相談する(パスを PC × Gitリポジトリ の組の
 *   属性にし、別の個体指定子を立てる、など)。
 */
import type { DiagramInput } from "@yanqirenshi/d3.classes";
import { attr, defineDiagram, type ClassDef } from "./classDiagram";

const DEFS: ClassDef[] = [
  // ============ 実行環境 ============
  {
    name: { physical: "Pc", logical: "Pc", description: "Claude Code を動かしているマシン。TM: PC(リソース)" }, // 論理名: PC
    attributes: [
      attr("system_uuid", "String"), // 個体指定子。OS 由来のマシン固有値(アプリで採番しない)
      attr("pc_name", "String"),
      attr("description", "String"),
    ],
    position: { x: 420, y: 40 },
  },
  {
    name: { physical: "User", logical: "User", description: "マシンを使う人。TM: ユーザー(リソース)" }, // 論理名: ユーザー
    attributes: [
      attr("user_id", "String"), // 個体指定子。OS のユーザー名
      attr("user_name", "String"),
      attr("home_directory", "PathBuf"),
    ],
    position: { x: 40, y: 40 },
  },
  {
    name: { physical: "GitRepository", logical: "GitRepository", description: "プロダクト開発の対象として登録したリポジトリ。TM: Gitリポジトリ(リソース)" }, // 論理名: Gitリポジトリ
    attributes: [
      attr("repository_path", "PathBuf"), // 個体指定子。リポジトリのパス
      attr("repository_name", "String"),
      attr("description", "String"),
    ],
    position: { x: 800, y: 40 },
  },
  {
    name: { physical: "GitBranch", logical: "GitBranch", description: "ブランチの作成・削除。git 自体はブランチに ID を持たないため、管理対象にするために ID を新設する。TM: Gitブランチ(イベント)" }, // 論理名: Gitブランチ
    attributes: [
      attr("branch_id", "String"), // 個体指定子。アプリが新設する GitブランチID
      attr("branch_name", "String"),
      attr("description", "String"),
      attr("created_at_time", "u64"),
      attr("deleted_at_time", "Option<u64>"),
    ],
    position: { x: 1198, y: 25 },
  },
  {
    name: { physical: "GitWorktree", logical: "GitWorktree", description: "ワーキングツリーの作成・削除。git の識別子は台帳のディレクトリ名(パス由来)だけなので、ID を新設する。TM: ワーキングツリー(イベント)" }, // 論理名: ワーキングツリー
    attributes: [
      attr("worktree_id", "String"), // 個体指定子。アプリが新設する ワーキングツリーID
      attr("worktree_name", "String"),
      attr("description", "String"),
      attr("worktree_folder_path", "PathBuf"), // TM: フォルダパス(Claude)。実物のディレクトリ
      attr("worktree_git_file_path", "PathBuf"), // TM: ファイルパス(git)。直下の .git ファイル
      attr("created_at_time", "u64"),
      attr("deleted_at_time", "Option<u64>"),
    ],
    position: { x: 1195, y: 396 },
  },
  // ============ 会話 ============
  {
    name: { physical: "Session", logical: "Session", description: "1つの会話。セッションIDは会話開始時に発番される UUID v4 で、.jsonl のファイル名にもなる(ただしファイルは識別しない)。TM: セッション(リソース)" }, // 論理名: セッション
    attributes: [
      attr("session_id", "String"), // 個体指定子。UUID v4
      attr("custom_title", "Option<String>"), // custom-title 行(最後の行が有効)
      attr("ai_title", "Option<String>"),
      attr("mode", "Option<String>"),
      attr("slug", "Option<String>"), // TM: セッション別名
      attr("/last_prompt", "Option<String>"), // TM: 直近入力テキスト(D)。ログから導出する
    ],
    position: { x: 240, y: -300 },
  },
];

const { classes, rel } = defineDiagram(DEFS);

const RELATIONSHIPS = [
  // TM: PC．ユーザー(対照表、属性なし)。1台に1人以上、1人が1台以上。
  // 横向き(User の右辺 → Pc の左辺)にしているのは多重度を見せるため。d3.classes は
  // 多重度の文字を接続辺によらず端点の少し上(起点は右寄り、終点は左寄り)に置くので、
  // 下辺につなぐと文字が箱の内側に入り、箱の下に隠れる(0.7.0 で確認)。
  rel("association", "User", "Pc", "利用する", "right", "left", {
    fromMultiplicity: "1..*",
    toMultiplicity: "1..*",
  }),
  // TM: PC．Gitリポジトリ(対照表、属性なし)。1台にリポジトリは 0 件以上、
  // 1つのリポジトリは 1 台以上の PC に置かれる。多重度を見せるため同じく横向きにする。
  rel("association", "Pc", "GitRepository", "保持する", "right", "left", {
    fromMultiplicity: "1..*",
    toMultiplicity: "0..*",
  }),
  // TM: Gitリポジトリ 1 : Gitブランチ 0..*(E-R。ブランチ側の repositoryPath(R))。
  rel("association", "GitRepository", "GitBranch", "持つ", "right", "left", {
    fromMultiplicity: "1",
    toMultiplicity: "0..*",
  }),
  // TM: Gitリポジトリ 1 : ワーキングツリー 1..*(E-R。リポジトリ本体が常に1つ目)。
  // ワーキングツリーはブランチの真下に置く(画面上での手調整で決めた配置)。
  rel("association", "GitRepository", "GitWorktree", "持つ", "right", "left", {
    fromMultiplicity: "1",
    toMultiplicity: "1..*",
  }),
  // TM: Gitブランチ．ワーキングツリー(対応表、属性なし)。ブランチを開けるワーキング
  // ツリーは1つまで、ワーキングツリーが開くブランチも1つまで(detached HEAD なら無し)。
  // 起点はブランチの下辺、終点はワーキングツリーの上辺(手調整で決めた接続辺)。
  // この向きだと起点側の多重度 0..1 はブランチの箱の下に隠れる(d3.classes の制約。
  // User → Pc の説明を参照)。
  rel("association", "GitBranch", "GitWorktree", "チェックアウト先", "bottom", "top", {
    fromMultiplicity: "0..1",
    toMultiplicity: "0..1",
  }),
  // TM: ユーザー．セッション(対照表、属性なし)。1人に会話は 0 件以上、1つの会話は
  // 必ず1人のもの。User の右辺は Pc への線で使っているため、上辺から出して Session の
  // 左辺につなぐ(多重度の文字を隠さない向きがこれしか無い)。そのため Session は
  // User の右上に置く。
  rel("association", "User", "Session", "持つ", "top", "left", {
    fromMultiplicity: "1",
    toMultiplicity: "0..*",
  }),
];

export const DOMAIN_CLASS_DATA: DiagramInput = {
  classes,
  relationships: RELATIONSHIPS,
};
