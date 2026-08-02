"use client";

import "regenerator-runtime/runtime";
import moment from "moment";
import WBSTable from "@yanqirenshi/table.wbs";

const WBS_SOURCE = {
  projects: [{ _id: 1, _class: "PROJECT", name: "サイト構築プロジェクト" }],
  wbs: [
    { _id: 10, _class: "WBS", name: "要件定義" },
    { _id: 11, _class: "WBS", name: "設計" },
    { _id: 12, _class: "WBS", name: "実装" },
  ],
  workpackages: [
    {
      _id: 100,
      _class: "WORKPACKAGE",
      name: "要件ヒアリング",
      schedule: { start: moment("2026-08-01"), end: moment("2026-08-05") },
    },
    {
      _id: 101,
      _class: "WORKPACKAGE",
      name: "要件定義書作成",
      schedule: { start: moment("2026-08-06"), end: moment("2026-08-10") },
    },
    {
      _id: 110,
      _class: "WORKPACKAGE",
      name: "画面設計",
      schedule: { start: moment("2026-08-11"), end: moment("2026-08-15") },
    },
    {
      _id: 111,
      _class: "WORKPACKAGE",
      name: "DB設計",
      schedule: { start: moment("2026-08-11"), end: moment("2026-08-18") },
    },
    {
      _id: 120,
      _class: "WORKPACKAGE",
      name: "フロントエンド実装",
      schedule: { start: moment("2026-08-19"), end: moment("2026-08-29") },
    },
    {
      _id: 121,
      _class: "WORKPACKAGE",
      name: "バックエンド実装",
      schedule: { start: moment("2026-08-19"), end: moment("2026-09-02") },
    },
  ],
  edges: [
    { from_id: 1, from_class: "PROJECT", to_id: 10, to_class: "WBS" },
    { from_id: 1, from_class: "PROJECT", to_id: 11, to_class: "WBS" },
    { from_id: 1, from_class: "PROJECT", to_id: 12, to_class: "WBS" },
    { from_id: 10, from_class: "WBS", to_id: 100, to_class: "WORKPACKAGE" },
    { from_id: 10, from_class: "WBS", to_id: 101, to_class: "WORKPACKAGE" },
    { from_id: 11, from_class: "WBS", to_id: 110, to_class: "WORKPACKAGE" },
    { from_id: 11, from_class: "WBS", to_id: 111, to_class: "WORKPACKAGE" },
    { from_id: 12, from_class: "WBS", to_id: 120, to_class: "WORKPACKAGE" },
    { from_id: 12, from_class: "WBS", to_id: 121, to_class: "WORKPACKAGE" },
  ],
};

type WbsRecord = {
  label: string;
  schedule: { start: moment.Moment; end: moment.Moment } | null;
};

function formatDate(date: moment.Moment | undefined | null) {
  return date ? date.format("YYYY-MM-DD") : "-";
}

const WBS_COLUMNS = [
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

export default function WbsTab() {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6 overflow-auto p-4">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-500">
          @yanqirenshi/table.wbs
        </h2>
        <WBSTable columns={WBS_COLUMNS} source={WBS_SOURCE} start_id={1} />
      </section>
    </div>
  );
}
