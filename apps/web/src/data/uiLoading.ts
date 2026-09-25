/**
 * 部品「ローディングアイコン」の仕様。
 *
 * 図形と動きは自前で描かず、loading.dev(npm: loading-dev)の Ring をそのまま使う
 * (2026-09-25 ユーザー指示)。回るアイコンは、止まって見えない速さ・角度の刻み方の
 * 調整が要るわりに、見た目の独自性がほとんど価値にならないためである。
 *
 * 寸法・色は基本デザインのトークン名で持つ(uiButton.ts / uiTab.ts と同じ方針)。
 * apps/web も apps/native も React なので、同じライブラリを同じ設定で使える。
 */

/** 使うライブラリ。 */
export const LOADING_LIBRARY = {
  name: "loading.dev",
  package: "loading-dev",
  /** 採用時の版。上げるときは見た目が変わらないか確かめる。 */
  version: "0.3.4",
  license: "MIT",
  url: "https://loading.dev/",
  requires: "React 19 以上(peerDependencies)。ほかに依存パッケージを持たない。",
  note: "図形は SVG で、色は currentColor を継ぐ。大きさ・速さ・再生状態は props と CSS カスタムプロパティ(--ld-size / --ld-duration / --ld-play-state)で決まる。",
};

/**
 * 使う図形。loading.dev には27種類あるが、**Ring だけを使う**。
 * 画面ごとに違う図形が出ると、同じ「待っている」状態が別のものに見える。
 */
export const LOADING_VARIANT = {
  component: "Ring",
  url: "https://loading.dev/spinners/ring",
  description: "薄い円(不透明度 0.2)の上を、弧が1本回る。",
  /** 線端。基本デザイン「アイコン」と同じ丸い線端にそろえる。 */
  cap: "round",
  /** 回り方。等速で回す。 */
  easing: "linear",
  /** 1周にかける時間(ミリ秒)。Ring の既定値をそのまま使う。 */
  durationMs: 800,
  reason:
    "円弧だけの図形で、基本デザイン「アイコン」(線だけ・丸い線端・currentColor)と並べても浮かない。点や四角が跳ねる図形は、同じ画面にあるアイコンと語彙が合わない。",
};

export type LoadingSize = "small" | "medium" | "large";

export type LoadingSizeSpec = {
  key: LoadingSize;
  /** 大きさは基本デザイン「アイコン」のサイズトークンから採る。 */
  iconToken: string;
  usage: string;
};

/**
 * 大きさの与え方。値そのものより、実装で引っかかる点を残しておく。
 *
 * loading-dev の Ring は、size を省いても SVG の style 属性に
 * `--ld-size: 20px`(既定値)を**必ず**書く(0.3.4 の spinnerRoot。
 * `size = DEFAULT_SIZE` を既定引数にして、常に style へ入れている)。
 * そのため、CSS 側からトークンで大きさを決めたい場合は、
 * `--ld-size` を `!important` で上書きするしかない(スタイルシートの
 * !important は style 属性に勝つ)。
 */
export const LOADING_SIZING = {
  /** props で渡す方法。トークンの px を JS で引ける実装ではこちらが簡単。 */
  byProp: "Ring の size に、アイコンのサイズトークンから引いた px を渡す(apps/web)。",
  /** CSS で決める方法。px を JS で持てない実装ではこちら。 */
  byCss:
    "包む要素の中で `.ld-ring { --ld-size: var(--icon-20) !important; }` のように上書きする(apps/native)。Ring が inline style に --ld-size を必ず書くため、!important が要る。",
  note: "どちらで与えても結果は同じ。CSS で上書きする場合、ライブラリの class 名(ld-ring)に依存するので、loading-dev の版を上げたときは class 名と、size を省いても inline style に --ld-size が入るかを確かめること。",
};

export const LOADING_SIZES: LoadingSizeSpec[] = [
  {
    key: "small",
    iconToken: "icon-16",
    usage:
      "文章やラベルの行の中。行内アイコンと同じ大きさなので、文字と並べても行の高さが変わらない。",
  },
  {
    key: "medium",
    iconToken: "icon-20",
    usage:
      "既定値。パネルや一覧など、画面の一部を読み込んでいるとき。UIアイコンと同じ大きさ。",
  },
  {
    key: "large",
    iconToken: "icon-32",
    usage:
      "空状態の中央など、その領域の全体を読み込んでいるとき。1画面に1つまで。",
  },
];

/** 色。 */
export const LOADING_COLOR = {
  value: "inherit",
  note: "ローディングアイコン専用の色は持たない。置いた場所の文字色(多くは text.secondary)をそのまま継ぐ。読み込み中であることは動きが伝えるので、色で目立たせる必要がない。",
  forbidden:
    "機能カラー(エラーの蘇芳など)は使わない。失敗していないのに失敗したように見える。",
};

/** 出す・消すの目安(ミリ秒)。 */
export const LOADING_TIMING = {
  /** これより短く終わる見込みなら出さない。 */
  minWaitMs: 300,
  /** これを超える見込みなら、文言を添える。 */
  longWaitMs: 5000,
  note: "300ms 未満で消えるアイコンは、点滅にしか見えず、かえって遅く感じさせる。5秒を超えるときは「セッションを読み込んでいます」のように、何を待っているかを文字で添える。",
};

/** 支援技術への伝え方。 */
export const LOADING_A11Y = {
  role: "status",
  ariaLive: "polite",
  label: "読み込み中",
  note: "loading-dev が描く SVG は aria-hidden であり、それ自体は読み上げられない。名前と役割は、包む要素(部品側)が持つ。読み込みが終わったら、アイコンを止めるのではなく要素ごと取り除く。残しておくと、終わったことが支援技術に伝わらない。",
  motion:
    "「視差効果を減らす」設定でも回転は止めない。進行中であることを示す唯一の手がかりであり、止めると壊れて見える。止める必要がある場面のために playState を渡せるようにしておく。",
};

export type LoadingAnatomyPart = {
  no: number;
  name: string;
  description: string;
};

export const LOADING_ANATOMY: LoadingAnatomyPart[] = [
  {
    no: 1,
    name: "枠",
    description:
      'role="status" と aria-live="polite" とアクセシブルな名前(「読み込み中」)を持つ要素。大きさはアイコンと同じで、余分な余白を持たない。',
  },
  {
    no: 2,
    name: "アイコン",
    description:
      "loading.dev の Ring。薄い円と、その上を回る弧。色は枠から継ぐ(currentColor)。",
  },
  {
    no: 3,
    name: "文言(任意)",
    description:
      "何を待っているかを表す短い文。長い待ちのときだけ添える。アイコンの右か下に sp-2 空けて置く。",
  },
];

export const LOADING_RULES = [
  {
    title: "図形は Ring だけを使う",
    body: "loading.dev には27種類の図形があるが、YAOYOROZU では Ring だけを使う。画面ごとに違う図形が出ると、同じ「待っている」状態が別のものに見える。ほかの図形を使いたくなったら、まずこの仕様を変える。",
  },
  {
    title: "読み込んでいる場所に置く",
    body: "アイコンは、いま読み込んでいる領域の中に置く。画面全体を覆う膜の上に出さない。どこが待っているのかが分からなくなり、覆われた部分の操作もできなくなる。",
  },
  {
    title: "すぐ終わる処理には出さない",
    body: "300ms 未満で終わる見込みの処理には出さない。出してすぐ消えるアイコンは点滅にしか見えず、かえって遅く感じさせる。",
  },
  {
    title: "1つの領域に1つ",
    body: "同じ領域に複数のローディングアイコンを出さない。読み込んでいる単位ごとに出すのではなく、その領域全体で1つにする。",
  },
  {
    title: "割合が分かるなら使わない",
    body: "進んだ割合が分かる処理(ファイルの転送など)には使わない。終わりの見えない回転は、待ち時間の見当を奪う。割合を表す部品が必要になった時点で別に定義する。",
  },
  {
    title: "終わったら取り除く",
    body: "読み込みが終わったら、アイコンを止めるのではなく要素ごと取り除く。止まったアイコンは、壊れたのか待っているのか区別がつかない。",
  },
];

export const LOADING_ANTIPATTERNS = [
  {
    pattern: "画面全体を覆って中央に置く",
    problem:
      "どこを読み込んでいるのか分からず、読み込みと関係のない操作までできなくなる。",
    instead: "読み込んでいる領域の中に置く。",
  },
  {
    pattern: "画面ごとに違う図形を使う",
    problem: "同じ「待っている」状態が、画面ごとに別のものに見える。",
    instead: "Ring にそろえる。",
  },
  {
    pattern: "読み込みが終わってもアイコンを残す(止めるだけ)",
    problem:
      "止まったアイコンは壊れたように見える。支援技術には終わったことが伝わらない。",
    instead: "要素ごと取り除く。",
  },
  {
    pattern: "色を機能カラー(蘇芳など)にする",
    problem: "失敗していないのに、失敗したように見える。",
    instead: "周囲の文字色を継ぐ(inherit)。",
  },
  {
    pattern: "名前を持たせずに置く",
    problem:
      "loading.dev の SVG は aria-hidden なので、そのまま置くと支援技術には何も存在しないことになる。",
    instead:
      'role="status" と aria-live="polite" と名前(「読み込み中」)を持つ要素で包む。',
  },
];
