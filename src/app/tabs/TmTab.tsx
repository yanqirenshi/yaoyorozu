"use client";

import { useMemo } from "react";
import D3Ter, { Rectum } from "@yanqirenshi/d3.ter";

const TM_DATA = {
  identifiers: [
    { id: 1, name: { physical: "顧客番号", logical: "顧客番号" } },
    { id: 2, name: { physical: "受注番号", logical: "受注番号" } },
  ],
  attributes: [
    { id: 10, name: { physical: "顧客名", logical: "顧客名" } },
    { id: 11, name: { physical: "受注日", logical: "受注日" } },
    { id: 12, name: { physical: "金額", logical: "金額" } },
  ],
  entities: [
    {
      id: 100,
      type: "RESOURCE",
      name: "顧客",
      description: "",
      position: { x: 0, y: 0, z: 0 },
      size: { w: 0, h: 0 },
      identifiers: [{ id: 1000, identifier: 1 }],
      attributes: [{ id: 2000, attribute: 10 }],
    },
    {
      id: 101,
      type: "EVENT",
      name: "受注",
      description: "",
      position: { x: 400, y: 0, z: 0 },
      size: { w: 0, h: 0 },
      identifiers: [{ id: 1001, identifier: 2 }],
      attributes: [
        { id: 2001, attribute: 11 },
        { id: 2002, attribute: 12 },
      ],
    },
  ],
  relationships: [
    {
      id: 500,
      from: { entity: 100, position: 0, cardinality: 1, optionality: 1 },
      to: { entity: 101, position: 180, cardinality: 3, optionality: 0 },
    },
  ],
};

export default function TmTab() {
  const rectum = useMemo(() => {
    const instance = new Rectum({ callbacks: {} });
    instance.data(TM_DATA);
    return instance;
  }, []);

  return (
    <div className="flex min-h-0 w-full flex-1">
      <D3Ter id="d3-ter-graph" rectum={rectum} />
    </div>
  );
}
