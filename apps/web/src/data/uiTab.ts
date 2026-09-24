/**
 * 部品「タブ」の仕様。
 *
 * 同じ領域の中で、表示する内容を切り替えるための部品。
 * 寸法・色はすべて基本デザインのトークン名で持ち(uiButton.ts と同じ方針)、
 * apps/web(MUI)と apps/native(素の CSS + tokens.css)の両方が同じ仕様から実装できる。
 * 色の参照は resolveColor()(uiDesign.ts)で値と CSS 変数名に解決する。
 */

export type TabSize = "small" | "medium";

export type TabSizeSpec = {
  key: TabSize;
  /** タブの高さ(CSS px)。タブ列の高さも同じになる。 */
  heightPx: number;
  /** タブの左右のパディング(余白トークン)。 */
  paddingX: string;
  /** ラベルのテキストスタイル。 */
  textStyle: string;
  usage: string;
};

export const TAB_SIZES: TabSizeSpec[] = [
  {
    key: "small",
    heightPx: 40,
    paddingX: "sp-3",
    textStyle: "UI-14M-100",
    usage:
      "ペインの中の切り替え(apps/native の設定画面・/claude 画面など)。領域が狭い箇所。",
  },
  {
    key: "medium",
    heightPx: 48,
    paddingX: "sp-4",
    textStyle: "UI-16M-100",
    usage:
      "既定値。画面の上部に置く切り替え(apps/web の「図 / WBS」など)。基本デザイン「レイアウト」のタブ列の高さ(48px)と同じ。",
  },
];

export type TabState =
  | "default"
  | "hover"
  | "active"
  | "selected"
  | "selectedHover"
  | "disabled";

export type TabColors = {
  /** 背景。 */
  bg: string;
  /** 文字。 */
  fg: string;
};

/**
 * 状態ごとの色。
 * 選択色は草色。文字は草色-800(草色-700 以下は本文の基準 4.5:1 に届かない)、
 * 下線(インジケータ)は草色-600 とする。
 * 太さは全状態で変えない(太字にするとタブの幅が変わり、並びが揺れる)。
 */
export const TAB_COLORS: Record<TabState, TabColors> = {
  default: { bg: "transparent", fg: "text.secondary" },
  hover: { bg: "草色-50", fg: "text.primary" },
  active: { bg: "草色-100", fg: "text.primary" },
  selected: { bg: "transparent", fg: "草色-800" },
  selectedHover: { bg: "草色-50", fg: "草色-800" },
  disabled: { bg: "transparent", fg: "text.disabled" },
};

export const TAB_STATE_LABELS: Record<TabState, string> = {
  default: "未選択",
  hover: "未選択・ホバー",
  active: "押下中",
  selected: "選択中",
  selectedHover: "選択中・ホバー",
  disabled: "無効",
};

/** 各状態の文字のコントラスト比(真珠または背景に対して)。 */
export const TAB_CONTRAST: Record<TabState, string> = {
  default: "6.45:1",
  hover: "11.26:1",
  active: "10.45:1",
  selected: "6.63:1",
  selectedHover: "6.50:1",
  disabled: "2.43:1(無効のため基準の対象外)",
};

/** 選択中を示す下線(インジケータ)。 */
export const TAB_INDICATOR = {
  color: "草色-600",
  heightPx: 3,
  contrast: "3.54:1(真珠に対して。図形の基準 3:1 を満たす)",
  note: "タブ列の下罫線に重ねて描く。2px では選択の手がかりとして弱いため 3px とする。",
};

/** タブ列(タブを並べる器)。 */
export const TAB_BAR = {
  border: "border.default",
  gap: "sp-1",
  paddingX: "sp-4",
  note: "下に 1px の罫線を引き、タブの下線はその上に重ねる。タブが収まらないときは折り返さず横スクロールにする。",
};

/** ラベルの扱い。 */
export const TAB_LABEL = {
  maxWidthPx: 200,
  note: "ラベルは1行で表示し、200px を超えるものは末尾を省略(…)する。省略しても全体が分かるよう、ラベル全体をツールチップ(title)に出す。",
};

/**
 * 閉じられるタブの「×」。
 *
 * タブ列の中身を利用者が自分で決める場面(apps/native のビューアのセッションのタブなど)
 * だけに付ける任意の部位であり、既定では出さない。
 *
 * 線の色はタブの文字色を継承する(currentColor)。こうすると未選択では 墨-700、
 * 選択中では 草色-800 と、ラベルと同じ色に自動でそろう。
 * 状態で変わるのは背景だけとし、× 自身のホバーがタブのホバー(草色)と
 * 混ざらないよう、背景には墨の階調を使う。
 */
export const TAB_CLOSE = {
  /** 図形は基本デザイン「アイコン」の close をそのまま使う。 */
  icon: "close",
  /** 図形の大きさ。タブのサイズによらず同じ(行内アイコン)。 */
  iconToken: "icon-16",
  /** クリック領域。WCAG 2.2 の操作対象サイズ(24px 以上)を満たす。 */
  targetPx: 24,
  /** クリック領域の角の形状。 */
  radius: "radius-4",
  /** ラベルとの間隔。 */
  gap: "sp-1",
  /** 線の色。タブの文字色を継承する。 */
  color: "inherit",
  /** 背景(× 自身の状態)。 */
  bg: {
    default: "transparent",
    hover: "墨-100",
    active: "墨-200",
  },
  contrast:
    "線はタブの文字色のままなので、未選択(墨-700)は 墨-100 の上で 5.71:1、墨-200 の上で 4.83:1。選択中(草色-800)は 5.87:1 / 4.96:1。いずれも図形の基準(3:1)を満たす。",
  /** 支援技術に読み上げる名前。 */
  ariaLabel: "「{ラベル} を閉じる」のように、何を閉じるのかを含める。",
  note: "× は Tab キーの順序に入れない(tabindex=-1)。タブ列は全体で1つの停留点であり、× を順序に入れるとタブの数だけ Tab を押すことになるため。キーボードからは、タブにフォーカスした状態で Delete キーで閉じる。",
};

/** フォーカスの表示。タブは隣と接しているため、リングを内側に描く。 */
export const TAB_FOCUS = {
  color: "focus.ring",
  width: "2px",
  offset: "-2px",
  note: "キーボード操作のときだけ表示する(:focus-visible)。隣のタブに重ならないよう内側(offset -2px)に描く。",
};

export type TabKey = {
  key: string;
  action: string;
};

/** キーボード操作(WAI-ARIA の Tabs パターン、手動で選択する方式)。 */
export const TAB_KEYBOARD: TabKey[] = [
  { key: "Tab", action: "タブ列に入る(選択中のタブにフォーカスする)。もう一度押すとタブ列を出る" },
  { key: "← / →", action: "前 / 次のタブにフォーカスを移す(端では反対側に回る。無効のタブは飛ばす)" },
  { key: "Home / End", action: "最初 / 最後のタブにフォーカスを移す(無効のタブは飛ばす)" },
  { key: "Enter / Space", action: "フォーカスしているタブを選択する" },
  {
    key: "Delete",
    action:
      "フォーカスしているタブを閉じる(閉じられるタブのときだけ)。閉じたあとは隣のタブにフォーカスを移す",
  },
];

export type TabAnatomyPart = {
  no: number;
  name: string;
  description: string;
};

export const TAB_ANATOMY: TabAnatomyPart[] = [
  {
    no: 1,
    name: "タブ列",
    description:
      "タブを横に並べる器。role=\"tablist\" と、何を切り替えるかを表す aria-label を持つ。下に 1px の罫線を引く。",
  },
  {
    no: 2,
    name: "タブ",
    description:
      "1つの切り替え先。role=\"tab\" と aria-selected を持つ。クリック領域はタブ全体。",
  },
  {
    no: 3,
    name: "ラベル",
    description: "切り替え先の名前。アイコンは付けず、文字だけにする。",
  },
  {
    no: 4,
    name: "インジケータ",
    description: "選択中のタブの下線。草色-600 の 3px。",
  },
  {
    no: 5,
    name: "閉じる(×)",
    description:
      "そのタブをタブ列から外すボタン。閉じられるタブにだけ付く任意の部位で、既定では出さない。ラベルの右に置き、クリック領域は 24×24 とする。",
  },
];

export const TAB_RULES = [
  {
    title: "同じ領域の中の切り替えにだけ使う",
    body: "タブは、同じ場所に表示する内容を切り替えるための部品である。別の画面へ移動するならリンクやメニューを使う。タブを押して画面全体が入れ替わるような使い方をしない。",
  },
  {
    title: "選択中は色だけで示さない",
    body: "選択中のタブは、文字の色(草色-800)と下線(草色-600)の2つで示す。下線という形があるので、色の判別が難しい環境でも選択中が分かる。",
  },
  {
    title: "太さを変えない",
    body: "選択中のタブだけ太字にすると、タブの幅が変わって並びが左右に揺れる。すべての状態で UI テキストの太さ(M)のままにする。",
  },
  {
    title: "ラベルは短く、名詞で",
    body: "ラベルは切り替え先の内容を表す短い名詞にする(「図」「WBS」「設定」)。長いものは省略表示されるので、先頭の数文字で区別がつくようにする。",
  },
  {
    title: "閉じられるかどうかは列全体でそろえる",
    body: "同じタブ列の中に、× が付くタブと付かないタブを混ぜない。どれが閉じられるのかを1つずつ確かめることになり、幅もそろわなくなる。タブ列の中身を利用者が決める画面(自分で開いて閉じる)では全部に付け、内容が固定の画面(設定の切り替えなど)では付けない。",
  },
  {
    title: "× は常に表示する",
    body: "ホバー中のタブだけに × を出さない。タブの幅が出し入れのたびに変わって並びが揺れるうえ、ホバーのないタッチ環境では押せなくなる。",
  },
  {
    title: "選択中の状態は URL に持たせる",
    body: "リロードやリンクの共有で同じタブを開けるよう、apps/web ではどのタブを選んでいるかを URL クエリ(?tab= など)に持たせる(規約 web.md §3)。",
  },
];

export const TAB_ANTIPATTERNS = [
  {
    pattern: "選択中を色だけで示す",
    problem: "色の判別が難しい環境で、どれが選ばれているか分からない。",
    instead: "下線(インジケータ)を必ず付ける。",
  },
  {
    pattern: "選択中だけ太字にする",
    problem: "タブの幅が変わり、選ぶたびに並びが揺れる。",
    instead: "太さは変えず、色と下線で示す。",
  },
  {
    pattern: "タブを折り返して2段にする",
    problem: "どの段のどのタブが選択中か追いにくく、段の順番も入れ替わって見える。",
    instead: "1段のまま横スクロールにする。本数が多いときは、そもそもタブ以外の部品(一覧・メニュー)を検討する。",
  },
  {
    pattern: "ホバー中のタブにだけ × を出す",
    problem:
      "マウスを動かすたびにタブの幅が変わり、並びが揺れる。タッチ環境では × に触れられない。",
    instead: "閉じられるタブには常に × を表示する。",
  },
  {
    pattern: "× を Tab キーの順序に入れる",
    problem:
      "タブ列を通り抜けるだけでタブの数だけ Tab を押すことになる。タブ列は全体で1つの停留点であるという約束も崩れる。",
    instead:
      "× は tabindex=-1 にして順序から外し、キーボードからはタブにフォーカスして Delete で閉じられるようにする。",
  },
  {
    pattern: "<div> に onClick を付けたタブ",
    problem: "キーボードで移動・選択できず、支援技術からもタブとして認識されない。",
    instead: "role=\"tablist\" / role=\"tab\" / aria-selected を持たせ、矢印キーで移動できるようにする。",
  },
];
