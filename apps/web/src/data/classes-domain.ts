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
 *   (オブジェクトの同一性の根拠になるため)。
 * - 対照表(R-R)は、それ自身の属性が無ければクラスにせず、多重度付きの関連にする。
 *   属性が付いた段階で関連クラスに格上げする。
 * - 多重度は TM の結線記号を写す。記号は「そのエンティティが相手1件に対して何件か」を
 *   表すので、UML で同じ側の端に置く多重度とそのまま対応する
 *   (鳥足+横棒 = `1..*`、鳥足+丸 = `0..*`、横棒+横棒 = `1`、横棒+丸 = `0..1`)。
 *
 * 【スコープ】TM の「実行環境」のうち PC・ユーザー(第1弾)と Gitリポジトリ(第2弾)。
 * ユーザー．セッション、Gitブランチ・ワーキングツリー、設定ファイル類は次段以降。
 * Gitリポジトリとそれらの関係も、相手のクラスを書く段階で足す。
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
];

export const DOMAIN_CLASS_DATA: DiagramInput = {
  classes,
  relationships: RELATIONSHIPS,
};
