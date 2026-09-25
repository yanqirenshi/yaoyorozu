/**
 * Classes 図(`/class-diagram`)のクラスを分類する、クリーンアーキテクチャの層の定義。
 *
 * どのクラスがどの層かは、図ごとのデータファイル(`classes-*.ts`)が決める
 * (`defineDiagram` の `layerOf` が図ごとの既定、クラスの `layer` が例外)。ここには層そのもの
 * (名前・意味・このプロジェクトでの対応・色)だけを書く。色分けとインスペクタの表示は
 * `ClassesTab.tsx` が使う。
 *
 * 色は `COLOR_PALETTE`(`uiDesign.ts`)のトーンスケールを、生成された `tokens.css` の
 * カスタムプロパティ経由で参照する(hex は直書きしない)。
 */
import type { ArchitectureLayer } from "./classDiagram";

export type ArchitectureLayerDef = {
  key: ArchitectureLayer;
  /** 画面に出す名前(クリーンアーキテクチャの用語)。 */
  label: string;
  /** 原著での呼び名。 */
  english: string;
  /** その層の意味。 */
  role: string;
  /** このプロジェクト(apps/native)での対応。 */
  mapping: string;
  /** 箱の塗り(CSS の値)。 */
  fill: string;
  /** 箱の枠線(CSS の値)。 */
  border: string;
};

/** 内側から外側の順。依存は外側から内側へだけ向く。 */
export const ARCHITECTURE_LAYERS: ArchitectureLayerDef[] = [
  {
    key: "enterprise",
    label: "企業のビジネスルール",
    english: "Entities",
    role: "アプリに依存しない、ドメインの概念とその規則。もっとも変わりにくい。",
    mapping:
      "TM を元にしたオブジェクトモデル(`classes-domain.ts`)。domain クレートのうち、TM のモノにあたる型。",
    fill: "var(--color-kincha-300)",
    border: "var(--color-kincha-600)",
  },
  {
    key: "application",
    label: "アプリケーションのビジネスルール",
    english: "Use Cases",
    role: "このアプリ固有の手順と、その入出力。外側(画面・ファイル・外部サービス)は port(trait)を通してだけ使う。",
    mapping:
      "app クレート(ユースケースと port)と、domain クレートのうちアプリ固有の型(表示・保存・やり取りのためのデータ、アプリの設定)。",
    fill: "var(--color-suou-300)",
    border: "var(--color-suou-600)",
  },
  {
    key: "adapter",
    label: "インターフェイスアダプター",
    english: "Interface Adapters",
    role: "内側の型と、外側が使う形式(画面へ渡す JSON、ファイル、外部サービス)を変換する。",
    mapping:
      "tauri クレートの DTO・コマンド、infra クレートの port の実装(gateway)。",
    fill: "var(--color-kusairo-300)",
    border: "var(--color-kusairo-600)",
  },
  {
    key: "framework",
    label: "フレームワークとドライバ",
    english: "Frameworks & Drivers",
    role: "フレームワーク、OS、ライブラリなど、外側のもの。詳細として内側から切り離す。",
    mapping:
      "Tauri 本体(状態管理・ローカルAPIサーバ)、ファイル監視(notify)、ファイル I/O、git コマンド、キーチェーン、React。",
    fill: "var(--color-kyomurasaki-300)",
    border: "var(--color-kyomurasaki-600)",
  },
];

export const ARCHITECTURE_LAYER_BY_KEY: Record<
  ArchitectureLayer,
  ArchitectureLayerDef
> = Object.fromEntries(
  ARCHITECTURE_LAYERS.map((layer) => [layer.key, layer]),
) as Record<ArchitectureLayer, ArchitectureLayerDef>;
