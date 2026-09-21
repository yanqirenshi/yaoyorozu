/**
 * 基本デザイン「アイコン」の仕様とサンプル。
 *
 * apps/native(command-dock)の既存アイコンに合わせ、
 * 20×20 のビューボックス・線幅1.7・currentColor を共通仕様とする。
 */

/** 作図の共通仕様。 */
export const ICON_DRAWING_SPEC = {
  viewBox: "0 0 20 20",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
  stroke: "currentColor",
  /** 図形を収める領域(ビューボックスの外周1pxは余白として空ける)。 */
  liveArea: "18×18(上下左右に1pxのマージン)",
};

export type IconSizeToken = {
  token: string;
  px: number;
  label: string;
  usage: string;
  /** 併記するテキストスタイル。 */
  pairedText: string;
};

/**
 * アイコンが置かれる位置ごとの4仕様。
 * サイズだけでなく「何と並ぶか」まで決めることで、行の中で高さが暴れないようにする。
 */
export const ICON_SIZES: IconSizeToken[] = [
  {
    token: "icon-16",
    px: 16,
    label: "行内アイコン",
    usage:
      "文章やラベルの行の中に混ぜるアイコン。外部リンクマーク、必須マーク、インラインの状態表示。",
    pairedText: "Body-14N-170 / Dns-14N-150",
  },
  {
    token: "icon-20",
    px: 20,
    label: "UIアイコン(既定)",
    usage:
      "ボタン・メニュー項目・タブ・入力欄の中のアイコン。もっとも使用頻度が高い。",
    pairedText: "UI-16M-100 / UI-14M-100",
  },
  {
    token: "icon-24",
    px: 24,
    label: "ブロックアイコン",
    usage:
      "ツールバー、ドック、アイコンのみのボタン。ラベルを持たず単独で意味を示す。",
    pairedText: "(ラベルなし。tooltip と aria-label を必須とする)",
  },
  {
    token: "icon-32",
    px: 32,
    label: "表示アイコン",
    usage: "空状態、エラー画面、セクションの見出しに添える大きなアイコン。",
    pairedText: "Head-20B-150 以上",
  },
];

/** アイコンの運用ルール。 */
export const ICON_RULES = [
  {
    title: "色は currentColor",
    body: "アイコンに固有の色を持たせず、親要素の文字色を継承する。これにより、ホバー・選択・無効の各状態でラベルとアイコンの色が必ず一致する。意味の色(エラーなど)は親要素側で指定する。",
  },
  {
    title: "行内アイコンは文字に合わせる",
    body: "行の中のアイコンは width/height を 1em にし、vertical-align: -0.15em で光学的にベースラインへ合わせる。テキストとの間隔は sp-1(4px)。",
  },
  {
    title: "クリック領域は最小 40×40",
    body: "アイコンのみのボタンは、見た目が 20px でもクリック/タップ領域を 40×40 以上確保する。アイコンを大きくするのではなく、パディングで領域を広げる。",
  },
  {
    title: "意味を色と形だけに持たせない",
    body: "アイコン単独で意味を伝えるのは、その意味が広く共通のもの(閉じる・検索・設定)に限る。それ以外は必ずラベルを併記する。",
  },
  {
    title: "支援技術への出し分け",
    body: "装飾目的のアイコンには aria-hidden=\"true\" を付けて読み上げから外す。アイコン自体が意味を持つ場合は role=\"img\" と aria-label を付け、ラベル文言は画面上の文言と一致させる。",
  },
  {
    title: "命名は動作か対象",
    body: "操作を表すものは動詞(reload / close / search)、対象を表すものは名詞(session / profile / rule)で命名する。見た目(arrow-down など)を名前にするのは、意味を持たない汎用の矢印だけにする。",
  },
];

export type IconSample = {
  key: string;
  label: string;
  /** SVG の内側マークアップ。共通仕様の属性は親の <svg> 側で与える。 */
  body: string;
};

/**
 * 標準アイコン。
 * SVG のパスは図形データであるため、マークアップ文字列としてここに置く
 * (規約 §2 のプロダクト情報を data に集約する方針に合わせる)。
 */
export const ICON_SAMPLES: IconSample[] = [
  {
    key: "reload",
    label: "再読み込み",
    body: '<path d="M16 10a6 6 0 1 1-2-4.47" /><path d="M16 3v4h-4" />',
  },
  {
    key: "settings",
    label: "設定",
    body: '<path d="M3 6h8.5M15.5 6H17M3 14h1.5M8.5 14H17" /><circle cx="13.5" cy="6" r="2" /><circle cx="6.5" cy="14" r="2" />',
  },
  {
    key: "search",
    label: "検索",
    body: '<circle cx="9" cy="9" r="5" /><path d="M12.8 12.8L17 17" />',
  },
  {
    key: "close",
    label: "閉じる",
    body: '<path d="M5 5l10 10M15 5L5 15" />',
  },
  {
    key: "chevron-right",
    label: "展開(右)",
    body: '<path d="M8 5l5 5-5 5" />',
  },
  {
    key: "chevron-down",
    label: "展開(下)",
    body: '<path d="M5 8l5 5 5-5" />',
  },
  {
    key: "external-link",
    label: "外部リンク",
    body: '<path d="M11 4h5v5" /><path d="M16 4l-7 7" /><path d="M15 12v3.5A1.5 1.5 0 0 1 13.5 17h-9A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5H8" />',
  },
  {
    key: "check",
    label: "完了",
    body: '<path d="M4 10.5l4 4 8-9" />',
  },
  {
    key: "warning",
    label: "警告",
    body: '<path d="M10 3.5L18 16.5H2z" /><path d="M10 8v3.5" /><circle cx="10" cy="14" r="0.6" fill="currentColor" stroke="none" />',
  },
  {
    key: "info",
    label: "情報",
    body: '<circle cx="10" cy="10" r="7" /><path d="M10 9.5V14" /><circle cx="10" cy="6.6" r="0.7" fill="currentColor" stroke="none" />',
  },
  {
    key: "session",
    label: "セッション",
    body: '<rect x="3" y="4" width="14" height="9" rx="1.5" /><path d="M7 13v3l4-3" />',
  },
  {
    key: "add",
    label: "追加",
    body: '<path d="M10 4v12M4 10h12" />',
  },
];
