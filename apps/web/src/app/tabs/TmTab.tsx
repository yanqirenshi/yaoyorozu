"use client";

import { useMemo } from "react";
import D3Ter, { Rectum } from "@yanqirenshi/d3.ter";
import { TM_DATA } from "@/data/tm";

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
