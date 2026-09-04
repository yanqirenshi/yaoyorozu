/**
 * デザインシステム「用語集」。
 *
 * 他のデザインシステムで使われている用語を集めたもの。YAOYOROZU が採用している
 * わけではなく、外部の文書を読むときの対応表として持つ。
 */

export type GlossaryTerm = {
  term: string;
  meaning: string;
};

/** どのデザインシステムでも通じる共通語。 */
export const COMMON_TERMS: GlossaryTerm[] = [
  {
    term: "デザイントークン",
    meaning: "名前を付けたデザイン上の決定。値ではなく名前で参照する。",
  },
  {
    term: "プリミティブ / セマンティック / コンポーネント",
    meaning:
      "トークンの3層。別名で global / alias / component、option / decision とも呼ぶ。",
  },
  {
    term: "エイリアストークン",
    meaning: "他のトークンを指すトークン。セマンティック層の実体。",
  },
  {
    term: "Atomic Design",
    meaning:
      "Brad Frost による分類。atoms / molecules / organisms / templates / pages の5階層。",
  },
  {
    term: "Style Dictionary",
    meaning:
      "Amazon 製のトークン変換ツール。JSON から各プラットフォームの形式を出力する事実上の標準。",
  },
  {
    term: "DTCG",
    meaning:
      "W3C Design Tokens Community Group。$value / $type を持つ JSON の交換フォーマットを策定している。",
  },
  {
    term: "Anatomy(アナトミー)",
    meaning:
      "コンポーネントの部位を分解した図。コンポーネント仕様の定番セクション。",
  },
  {
    term: "ステート",
    meaning:
      "default / hover / active / focus / disabled / selected などの状態。",
  },
  {
    term: "Do / Don't",
    meaning: "良い例と悪い例の対比。ほぼすべてのシステムが採用する書式。",
  },
  {
    term: "スケール",
    meaning:
      "段階的な値の並び。type scale(文字)、spacing scale(余白)、shape scale(角)。",
  },
  {
    term: "密度(density)",
    meaning: "同じ面積に詰め込む情報量の段階。業務システムで重要になる。",
  },
  {
    term: "モード / テーマ",
    meaning: "light / dark / high contrast などの切り替え単位。",
  },
];

export type GlossarySystem = {
  key: string;
  name: string;
  org: string;
  url: string;
  terms: GlossaryTerm[];
};

export type GlossaryCategory = {
  key: string;
  label: string;
  description: string;
  systems: GlossarySystem[];
};

export const GLOSSARY_CATEGORIES: GlossaryCategory[] = [
  {
    key: "platform",
    label: "プラットフォーム発",
    description:
      "OS や巨大な業務基盤のためのもの。作り手が不特定多数になるため、規約が厳密で分量も多い。",
    systems: [
      {
        key: "material",
        name: "Material Design",
        org: "Google",
        url: "https://m3.material.io/",
        terms: [
          {
            term: "Material You / M3 / M3 Expressive",
            meaning: "世代の呼称。M3 Expressive は2025年の拡張。",
          },
          {
            term: "md.ref / md.sys / md.comp",
            meaning:
              "トークン命名の3層(reference / system / component)を接頭辞で表す。",
          },
          {
            term: "Tonal palette / Tone",
            meaning: "1色を明度0〜100の階調に展開したもの。",
          },
          {
            term: "HCT",
            meaning: "Google 独自の色空間。ダイナミックカラーの基盤。",
          },
          {
            term: "Dynamic Color",
            meaning: "壁紙などから配色を自動生成する仕組み。",
          },
          {
            term: "Color role",
            meaning:
              "primary / on-primary / primary-container のような役割名。",
          },
          {
            term: "on- 接頭辞",
            meaning:
              "その面の上に載せる前景色。on-surface は surface 上の文字色。",
          },
          {
            term: "State layer",
            meaning:
              "ホバー等で上に重ねる半透明の層。8% / 12% のように不透明度で定義する。",
          },
          {
            term: "Tonal elevation / Surface tint",
            meaning: "影ではなく色味で高さを表す仕組み。",
          },
          {
            term: "Window size class",
            meaning: "compact / medium / expanded の画面幅の分類。",
          },
          {
            term: "Canonical layout",
            meaning: "list-detail、supporting pane、feed などの定型レイアウト。",
          },
        ],
      },
      {
        key: "hig",
        name: "Human Interface Guidelines",
        org: "Apple",
        url: "https://developer.apple.com/design/human-interface-guidelines",
        terms: [
          { term: "HIG", meaning: "通称。コンポーネント集ではなく判断基準の文書。" },
          {
            term: "SF Symbols",
            meaning: "公式アイコンセット。文字と同じ寸法体系で組める。",
          },
          {
            term: "Dynamic Type",
            meaning: "ユーザーの文字サイズ設定に追従する仕組み。",
          },
          {
            term: "Materials / Vibrancy",
            meaning: "すりガラス状の背景素材と、その上での色の透け方。",
          },
          {
            term: "Liquid Glass",
            meaning: "2025年に導入された新しい視覚表現。",
          },
          { term: "Safe area", meaning: "ノッチ等を避けた安全領域。" },
          { term: "Size class", meaning: "compact / regular の2分類。" },
          {
            term: "Points(pt)",
            meaning: "解像度非依存の単位。@2x / @3x で実ピクセルに展開する。",
          },
        ],
      },
      {
        key: "fluent",
        name: "Fluent",
        org: "Microsoft",
        url: "https://fluent2.microsoft.design/",
        terms: [
          { term: "Fluent 2", meaning: "現行世代の呼称。" },
          {
            term: "Acrylic / Mica",
            meaning: "半透明・不透明の背景素材。Mica は Windows 11 の既定。",
          },
          { term: "Reveal", meaning: "ポインタ位置を光らせる表現。" },
          {
            term: "Global token / Alias token",
            meaning:
              "2層構造。colorNeutralBackground1 のようにキャメルケースで命名する。",
          },
          { term: "Griffel", meaning: "Fluent UI React v9 の CSS-in-JS エンジン。" },
        ],
      },
      {
        key: "slds",
        name: "Lightning Design System",
        org: "Salesforce",
        url: "https://lightningdesignsystem.com/",
        terms: [
          {
            term: "Blueprint",
            meaning:
              "コンポーネント仕様。マークアップ構造・状態・アクセシビリティ要件まで含む。",
          },
          {
            term: "Styling hooks",
            meaning:
              "外部から変更してよい CSS 変数(--slds-c-button-* など)。コンポーネント層のトークンを公開APIにしたもの。",
          },
          { term: "Theo", meaning: "初期のトークン変換ツール。Salesforce 製。" },
          { term: "Cosmos", meaning: "SLDS 2 の新しい見た目の呼称。" },
          {
            term: "SLDS Validator / Linter",
            meaning: "準拠しているかを機械的に検査するツール。",
          },
        ],
      },
    ],
  },
  {
    key: "product",
    label: "プロダクト企業発",
    description:
      "自社プロダクトのために作り、公開しているもの。規模が近いため実務ではもっとも参考になる。",
    systems: [
      {
        key: "polaris",
        name: "Polaris",
        org: "Shopify",
        url: "https://polaris.shopify.com/",
        terms: [
          {
            term: "Polaris tokens",
            meaning: "--p-color-bg-surface 形式の CSS 変数。",
          },
          {
            term: "Content guidelines",
            meaning:
              "文言・語調の規定。エラー文の書き方まで踏み込んでいる。",
          },
          {
            term: "Patterns",
            meaning: "複数のコンポーネントを組み合わせて解く定型課題。",
          },
        ],
      },
      {
        key: "primer",
        name: "Primer",
        org: "GitHub",
        url: "https://primer.style/",
        terms: [
          { term: "Primer Primitives", meaning: "トークン群のパッケージ名。" },
          {
            term: "--fgColor-* / --bgColor-* / --borderColor-*",
            meaning: "前景・背景・境界で分ける命名。",
          },
          {
            term: "muted / emphasis / onEmphasis",
            meaning: "強度を表す語彙。",
          },
          { term: "Octicons", meaning: "公式アイコンセット。" },
          {
            term: "dark dimmed",
            meaning: "明るさを落としたダークテーマの独自バリエーション。",
          },
        ],
      },
      {
        key: "atlassian",
        name: "Atlassian Design System",
        org: "Atlassian",
        url: "https://atlassian.design/",
        terms: [
          { term: "ADS / Atlaskit", meaning: "システム名 / React 実装。" },
          {
            term: "color.background.accent.blue.subtlest",
            meaning: "ドット区切りで階層を連ねる命名。",
          },
          {
            term: "subtle / subtlest / bold / bolder",
            meaning: "強度を表す語彙。",
          },
          { term: "space.100", meaning: "数値スケールの余白トークン。" },
          { term: "Content design", meaning: "ライティング担当領域の呼称。" },
        ],
      },
      {
        key: "carbon",
        name: "Carbon",
        org: "IBM",
        url: "https://carbondesignsystem.com/",
        terms: [
          {
            term: "IBM Design Language",
            meaning: "親となるデザイン言語。Carbon はその実装にあたる。",
          },
          { term: "2x Grid", meaning: "2の倍数を基本にしたグリッド。" },
          { term: "IBM Plex", meaning: "自社書体。" },
          {
            term: "Productive / Expressive",
            meaning:
              "業務用と表現用で、タイポグラフィとモーションを2系統持つ。",
          },
          {
            term: "Layer model($layer-01)",
            meaning: "面の重なりを番号で管理する仕組み。",
          },
          {
            term: "White / Gray 10 / Gray 90 / Gray 100",
            meaning: "4つのテーマ名。",
          },
          {
            term: "Pictogram",
            meaning: "アイコンより大きい、説明のための図。",
          },
        ],
      },
      {
        key: "spectrum",
        name: "Spectrum",
        org: "Adobe",
        url: "https://spectrum.adobe.com/",
        terms: [
          { term: "Spectrum 2", meaning: "現行世代。" },
          {
            term: "Scale(desktop / mobile)",
            meaning: "密度の2段階。同じ画面を2つの寸法体系で持つ。",
          },
          {
            term: "light / dark / darkest",
            meaning: "3つのカラーテーマ。",
          },
          {
            term: "gray-100 / size-100",
            meaning: "数値ベースのサイジング。",
          },
          {
            term: "Workflow icons / UI icons",
            meaning: "機能を表すアイコンと、UI部品用のアイコンを区別する。",
          },
        ],
      },
      {
        key: "antd",
        name: "Ant Design",
        org: "Ant Group",
        url: "https://ant.design/",
        terms: [
          {
            term: "Seed Token → Map Token → Alias Token",
            meaning:
              "3層のトークン。種となる少数の値から機械的に展開する点が独特。",
          },
          {
            term: "Algorithm",
            meaning:
              "defaultAlgorithm / darkAlgorithm / compactAlgorithm でテーマを生成する。",
          },
          { term: "ConfigProvider", meaning: "テーマを適用するコンポーネント。" },
          { term: "Ant Design Pro", meaning: "管理画面向けの上位セット。" },
        ],
      },
      {
        key: "baseweb",
        name: "Base Web",
        org: "Uber",
        url: "https://baseweb.design/",
        terms: [
          { term: "Base / Base Web", meaning: "デザイン / React 実装。" },
          {
            term: "Foundation と Semantic",
            meaning: "2層のテーマ構造。",
          },
          { term: "Styletron", meaning: "CSS-in-JS エンジン。" },
        ],
      },
    ],
  },
  {
    key: "public",
    label: "公共機関",
    description:
      "説明責任があるため、値や規則の根拠が必ず書かれている。アクセシビリティの参照先として質が高い。",
    systems: [
      {
        key: "govuk",
        name: "GOV.UK Design System",
        org: "英国政府",
        url: "https://design-system.service.gov.uk/",
        terms: [
          {
            term: "Styles / Components / Patterns",
            meaning: "3分類。この分け方は多くのシステムに影響した。",
          },
          { term: "GOV.UK Frontend", meaning: "実装パッケージ。" },
          {
            term: "Service Manual / Service Standard",
            meaning:
              "サービス開発の手引きと基準。デザインシステムの上位に置かれる文書。",
          },
          {
            term: "Progressive enhancement",
            meaning: "JavaScript なしでも動く前提から積み上げる原則。",
          },
          {
            term: "One thing per page",
            meaning: "1画面につき1つの問いだけを置く入力パターン。",
          },
          {
            term: "Error summary / Task list",
            meaning: "広く模倣されている定型パターン。",
          },
          {
            term: "Design history",
            meaning: "変更の意思決定履歴を公開する仕組み。",
          },
          { term: "GDS Transport", meaning: "専用書体。" },
        ],
      },
      {
        key: "uswds",
        name: "U.S. Web Design System",
        org: "米国政府",
        url: "https://designsystem.digital.gov/",
        terms: [
          { term: "USWDS 3", meaning: "現行世代。" },
          {
            term: "Utilities",
            meaning: "トークンから生成したユーティリティクラス群。",
          },
          {
            term: "units()",
            meaning: "余白などをトークン単位で書くための関数。",
          },
          {
            term: "Section 508",
            meaning: "準拠すべき米国のアクセシビリティ法。",
          },
        ],
      },
      {
        key: "dads",
        name: "デジタル庁デザインシステム",
        org: "デジタル庁",
        url: "https://design.digital.go.jp/",
        terms: [
          {
            term: "基本デザイン",
            meaning:
              "Foundations の訳語。/ui の「基本」はこの呼び方を借りている。",
          },
          {
            term: "Dsp / Std / Dns / Oln / Mono",
            meaning: "テキストスタイルのカテゴリ略号。",
          },
          {
            term: "達成基準バッジ(JIS2016 / WCAG2.2)",
            meaning: "どの規格の要件かを示す表示。",
          },
        ],
      },
    ],
  },
  {
    key: "japan",
    label: "日本の企業",
    description:
      "日本語の組版とアクセシビリティの扱いが参考になる。公開の姿勢自体を明文化しているものが多い。",
    systems: [
      {
        key: "smarthr",
        name: "SmartHR Design System",
        org: "SmartHR",
        url: "https://smarthr.design/",
        terms: [
          { term: "SmartHR UI", meaning: "OSS の React 実装。" },
          {
            term: "パーソナリティ",
            meaning: "基本原則にあたる4つの価値観。",
          },
          {
            term: "基本要素 / プロダクト / コミュニケーション",
            meaning:
              "3分類。営業資料や写真の扱いまで含むのが特徴。",
          },
        ],
      },
      {
        key: "spindle",
        name: "Spindle",
        org: "Ameba(サイバーエージェント)",
        url: "https://spindle.ameba.design/",
        terms: [
          {
            term: "デザイン原則 / アクセシビリティ / パフォーマンス",
            meaning:
              "3本柱。パフォーマンスをデザインシステムの構成要素に含めるのは珍しい。",
          },
          { term: "Spindle UI", meaning: "実装ライブラリ。" },
        ],
      },
      {
        key: "freee",
        name: "freee",
        org: "freee",
        url: "https://a11y-guidelines.freee.co.jp/",
        terms: [
          {
            term: "Vibes",
            meaning: "UI コンポーネントライブラリ。Storybook で公開している。",
          },
          {
            term: "freee アクセシビリティー・ガイドライン / チェックシート",
            meaning:
              "単独で参照されることが多い a11y 文書。項目が実務的で使いやすい。",
          },
        ],
      },
    ],
  },
];

export type NamingStyle = {
  style: string;
  examples: string;
  note: string;
};

/** トークン名の付け方の分類。 */
export const NAMING_STYLES: NamingStyle[] = [
  {
    style: "階層をドットで連ねる",
    examples: "md.sys.color.primary / color.background.accent.blue.subtlest",
    note: "機械処理しやすい。名前は長くなる。",
  },
  {
    style: "用途を短縮語で",
    examples: "--fgColor-muted / --p-color-bg-surface",
    note: "読み書きが速い。略語の学習が要る。",
  },
  {
    style: "段階を数値で",
    examples: "$layer-01 / gray-100 / space.100",
    note: "順序が明確。意味は名前から読めない。",
  },
];

export type StrengthVocabulary = {
  system: string;
  scale: string;
};

/** 強度(目立ちにくさ〜目立ちやすさ)を表す語彙。 */
export const STRENGTH_VOCABULARY: StrengthVocabulary[] = [
  { system: "Atlassian", scale: "subtlest → subtle → bold → bolder" },
  { system: "Primer", scale: "muted → default → emphasis → onEmphasis" },
  { system: "Material", scale: "container と on- の組み合わせ" },
];
