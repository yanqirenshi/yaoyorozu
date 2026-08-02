import moment from "moment";

export const WBS_SOURCE = {
  projects: [{ _id: 1, _class: "PROJECT", name: "YAOYOROZU" }],
  wbs: [
    { _id: 10, _class: "WBS", name: "システム構成" },
    { _id: 11, _class: "WBS", name: "ネイティブアプリ" },
    { _id: 12, _class: "WBS", name: "Webアプリ" },
    { _id: 20, _class: "WBS", name: "画面" },
    { _id: 30, _class: "WBS", name: "Classes" },
    { _id: 40, _class: "WBS", name: "TM" },
    { _id: 41, _class: "WBS", name: "identifiers" },
    { _id: 42, _class: "WBS", name: "attributes" },
    { _id: 43, _class: "WBS", name: "entities" },
    { _id: 50, _class: "WBS", name: "デザイン" },
    { _id: 51, _class: "WBS", name: "カラー" },
    { _id: 52, _class: "WBS", name: "タイポグラフィ" },
    { _id: 53, _class: "WBS", name: "アイコン" },
    { _id: 54, _class: "WBS", name: "レイアウト" },
    { _id: 55, _class: "WBS", name: "リンクテキスト" },
    { _id: 56, _class: "WBS", name: "余白" },
    { _id: 57, _class: "WBS", name: "角の形状" },
    { _id: 58, _class: "WBS", name: "エヴェレーション" },
    { _id: 60, _class: "WBS", name: "コンポーネント" },
    { _id: 61, _class: "WBS", name: "レイアウト" },
    { _id: 611, _class: "WBS", name: "ページ" },
    { _id: 612, _class: "WBS", name: "フレーム" },
    { _id: 613, _class: "WBS", name: "パネル" },
    { _id: 62, _class: "WBS", name: "中間組立品" },
    { _id: 63, _class: "WBS", name: "部品" },
  ],
  workpackages: [
  ],
  edges: [
    { from_id: 1, from_class: "PROJECT", to_id: 10, to_class: "WBS" },
    { from_id: 1, from_class: "PROJECT", to_id: 20, to_class: "WBS" },
    { from_id: 1, from_class: "PROJECT", to_id: 30, to_class: "WBS" },
    { from_id: 1, from_class: "PROJECT", to_id: 40, to_class: "WBS" },
    { from_id: 1, from_class: "PROJECT", to_id: 50, to_class: "WBS" },
    { from_id: 1, from_class: "PROJECT", to_id: 60, to_class: "WBS" },
    { from_id: 10, from_class: "WBS", to_id: 11, to_class: "WBS" },
    { from_id: 10, from_class: "WBS", to_id: 12, to_class: "WBS" },
    { from_id: 40, from_class: "WBS", to_id: 41, to_class: "WBS" },
    { from_id: 40, from_class: "WBS", to_id: 42, to_class: "WBS" },
    { from_id: 40, from_class: "WBS", to_id: 43, to_class: "WBS" },
    { from_id: 50, from_class: "WBS", to_id: 51, to_class: "WBS" },
    { from_id: 50, from_class: "WBS", to_id: 52, to_class: "WBS" },
    { from_id: 50, from_class: "WBS", to_id: 53, to_class: "WBS" },
    { from_id: 50, from_class: "WBS", to_id: 54, to_class: "WBS" },
    { from_id: 50, from_class: "WBS", to_id: 55, to_class: "WBS" },
    { from_id: 50, from_class: "WBS", to_id: 56, to_class: "WBS" },
    { from_id: 50, from_class: "WBS", to_id: 57, to_class: "WBS" },
    { from_id: 50, from_class: "WBS", to_id: 58, to_class: "WBS" },
    { from_id: 60, from_class: "WBS", to_id: 61, to_class: "WBS" },
    { from_id: 60, from_class: "WBS", to_id: 62, to_class: "WBS" },
    { from_id: 60, from_class: "WBS", to_id: 63, to_class: "WBS" },
    { from_id: 61, from_class: "WBS", to_id: 611, to_class: "WBS" },
    { from_id: 61, from_class: "WBS", to_id: 612, to_class: "WBS" },
    { from_id: 61, from_class: "WBS", to_id: 613, to_class: "WBS" },
  ],
};

type WbsRecord = {
  _id: number;
  label: string;
  schedule: { start: moment.Moment; end: moment.Moment } | null;
};

function formatDate(date: moment.Moment | undefined | null) {
  return date ? date.format("YYYY-MM-DD") : "-";
}

export const WBS_COLUMNS = [
  {
    label: "ID",
    contents: (_column: unknown, row: WbsRecord) => row._id,
  },
  {
    label: "WBS",
    leveling: true,
    required: true,
    contents: (_column: unknown, row: WbsRecord) => row.label,
  },
  {
    label: "開始日",
    contents: (_column: unknown, row: WbsRecord) =>
      formatDate(row.schedule?.start),
  },
  {
    label: "終了日",
    contents: (_column: unknown, row: WbsRecord) =>
      formatDate(row.schedule?.end),
  },
];
