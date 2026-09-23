/**
 * 基本デザイン「余白」のトークン。
 *
 * 基準単位は 4px。sp-1〜sp-8 はトークン名の数値が基準単位の倍数であり、
 * そのまま Tailwind のクラス番号(p-4 など)として使える。
 *
 * sp-11 / sp-22 / sp-33 は例外で、**トークン名の数値がそのまま px** である
 * (2026-09-23 ユーザー判断)。4px グリッドには乗らず、Tailwind のクラス番号とも
 * 一致しないため、Tailwind から使うときは任意値(p-[22px] など)で書く。
 * 名前の読み方が2通りある状態なので、新しいトークンを足すときは
 * どちらの規則に従うのかをここに明記すること。
 */

export const SPACING_BASE_PX = 4;

export type SpacingToken = {
  /** トークン名。sp-1〜sp-8 は基準単位の倍数、sp-11 以降は px そのもの。 */
  token: string;
  px: number;
  /** 対応する Tailwind クラス(パディングの例)。 */
  tailwind: string;
  usage: string;
};

/** 小さい順に並べる。 */
export const SPACING_SCALE: SpacingToken[] = [
  {
    token: "sp-1",
    px: 4,
    tailwind: "p-1 / gap-1",
    usage: "アイコンとラベルの間隔。分離してはいけないものの最小の隙間。",
  },
  {
    token: "sp-2",
    px: 8,
    tailwind: "p-2 / gap-2",
    usage: "同じ意味のまとまりの内側。ラベルと入力欄、バッジ内の余白。",
  },
  {
    token: "sp-11",
    px: 11,
    tailwind: "p-[11px] / gap-[11px]",
    usage:
      "用途は未定。sp-2(8px)と sp-3(12px)の間。sp-3 とは 1px しか違わないため、同じ画面で併用しない。",
  },
  {
    token: "sp-3",
    px: 12,
    tailwind: "p-3 / gap-3",
    usage: "一覧の行のパディング、ボタンの左右パディング。",
  },
  {
    token: "sp-4",
    px: 16,
    tailwind: "p-4 / gap-4",
    usage: "カード・パネルの内側パディング。関連する項目どうしの間隔。",
  },
  {
    token: "sp-22",
    px: 22,
    tailwind: "p-[22px] / gap-[22px]",
    usage:
      "用途は未定。sp-4(16px)と sp-6(24px)の間。sp-6 とは 2px しか違わないため、同じ画面で併用しない。",
  },
  {
    token: "sp-6",
    px: 24,
    tailwind: "p-6 / gap-6",
    usage: "セクション内のブロック間、グリッドのガター。",
  },
  {
    token: "sp-8",
    px: 32,
    tailwind: "p-8 / gap-8",
    usage: "セクションとセクションの間。",
  },
  {
    token: "sp-33",
    px: 33,
    tailwind: "p-[33px] / gap-[33px]",
    usage:
      "スケールの最大値。話題が変わる大きな区切り、見出し(第1階層)の上、ページの上下端。sp-8 とは 1px しか違わないため、同じ画面で併用しない。",
  },
];

/** 余白の使い分けルール。 */
export const SPACING_RULES = [
  {
    title: "近接で関連性を示す",
    body: "関連の強い要素どうしは小さい余白(sp-1〜sp-2)、弱い要素どうしは大きい余白(sp-6以上)で置く。見出しは、次に来る本文との余白を、前のブロックとの余白より小さくする。見出しがどちらの塊に属しているかは余白でしか伝わらない。",
  },
  {
    title: "階層は余白の大きさで表す",
    body: "階層が上がるほど周囲の余白を大きくする。第1階層の見出しの上は sp-33、第2階層は sp-8、第3階層は sp-6 のように、見出しのサイズと余白を連動させる。",
  },
  {
    title: "同種の要素には同じ値を使う",
    body: "一覧の行、カードの内側、フォームの行間など、同じ役割の余白には必ず同じトークンを使う。「なんとなく詰めた」値をその場で作らない。",
  },
  {
    title: "隣り合う値を並べない",
    body: "sp-3(12px)と sp-4(16px)のように差が小さい余白を隣接させても、階層としては読み取れない。階層をつけるときは1段以上飛ばす。とくに sp-11 と sp-3(1px 差)、sp-22 と sp-6(2px 差)、sp-33 と sp-8(1px 差)は、並べても差が見えない。",
  },
  {
    title: "狭い画面では1段下げる",
    body: "ビューポート幅が md(768px)未満のとき、sp-8 以上の余白は1段小さいトークンに落とす。余白よりコンテンツの表示面積を優先する。",
  },
];

/** 余白を持つ代表的な箇所の既定値。 */
export type SpacingApplication = {
  target: string;
  token: string;
  note: string;
};

export const SPACING_APPLICATIONS: SpacingApplication[] = [
  { target: "ページの内側(本文領域)", token: "sp-6", note: "狭い画面では sp-4。" },
  { target: "パネル・カードの内側", token: "sp-4", note: "入れ子のパネルは sp-3。" },
  { target: "一覧の行の上下", token: "sp-2", note: "高密度な一覧では sp-1。" },
  { target: "フォームの項目間", token: "sp-4", note: "ラベルと入力欄の間は sp-1。" },
  { target: "見出し(第1階層)の上", token: "sp-33", note: "見出しの下は sp-4。" },
  { target: "見出し(第2階層)の上", token: "sp-8", note: "見出しの下は sp-3。" },
  { target: "本文の段落間", token: "sp-4", note: "" },
  {
    target: "ボタンの左右",
    token: "sp-4",
    note: "medium の値。small は sp-3、large は sp-6。上下は高さで決める(部品「ボタン」)。",
  },
];
