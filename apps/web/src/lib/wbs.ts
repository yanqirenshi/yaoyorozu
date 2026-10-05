import moment from "moment";

/**
 * `{リポジトリ}/yyz/spec/wbs.json` の形(#544)。計算(日付の整形など)を含まない
 * 素の値だけを持つ。表示の定義(WBS_COLUMNS)はここではなく画面の設定として持つ
 * (このファイルの下部)。
 */
export type WbsSource = {
  projects: { _id: number; _class: string; name: string }[];
  wbs: { _id: number; _class: string; name: string }[];
  workpackages: {
    _id: number;
    _class: string;
    name: string;
    /** 開始日・終了日。JSON には moment.Moment を持てないので ISO 文字列で持つ。 */
    schedule?: { start?: string | null; end?: string | null } | null;
  }[];
  edges: {
    from_id: number;
    from_class: string;
    to_id: number;
    to_class: string;
  }[];
};

/** @yanqirenshi/table.wbs が各行に渡してくる形。label は name から table.wbs 側が作る。 */
type WbsRow = {
  _id: number;
  label: string;
  schedule?: { start?: string | null; end?: string | null } | null;
};

/**
 * 日付(JSON の素の文字列)を表示用に整形する。かつて `data/wbs.ts` がデータと
 * 一緒に持っていた計算(moment)はここへ移した(#544。JSON は値だけにするため)。
 */
function formatWbsDate(date: string | null | undefined): string {
  return date ? moment(date).format("YYYY-MM-DD") : "-";
}

/**
 * WBS 画面の表の列定義。どの列を・どう見せるかは仕様データではなく画面の設定
 * なので、JSON(yyz/spec/wbs.json)には入れず Web アプリ側に置く(#544)。
 */
export const WBS_COLUMNS = [
  {
    label: "ID",
    contents: (_column: unknown, row: WbsRow) => row._id,
  },
  {
    label: "WBS",
    leveling: true,
    required: true,
    contents: (_column: unknown, row: WbsRow) => row.label,
  },
  {
    label: "開始日",
    contents: (_column: unknown, row: WbsRow) => formatWbsDate(row.schedule?.start),
  },
  {
    label: "終了日",
    contents: (_column: unknown, row: WbsRow) => formatWbsDate(row.schedule?.end),
  },
];
