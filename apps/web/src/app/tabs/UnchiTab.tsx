"use client";

import { useMemo } from "react";
import D3Unchi, { Rectum } from "@yanqirenshi/d3.unchi";
import { UNCHI_DATA } from "@/data/unchi";

// 図全体が収まる初期倍率。図の中はホイールで拡大・ドラッグで移動できる。
const INITIAL_SCALE = 0.75;

export default function UnchiTab() {
  const rectum = useMemo(() => {
    // d3.svg は x・y を倍率倍してしまうため 0 のままにする。
    const instance = new Rectum({
      transform: { k: INITIAL_SCALE, x: 0, y: 0 },
    });
    instance.data(UNCHI_DATA);
    return instance;
  }, []);

  return (
    <div className="flex min-h-0 w-full flex-1">
      <D3Unchi rectum={rectum} />
    </div>
  );
}
