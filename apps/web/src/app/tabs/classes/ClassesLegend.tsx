"use client";

import { ARCHITECTURE_LAYERS } from "@/data/classArchitecture";

/**
 * Classes 図の凡例。箱の色がクリーンアーキテクチャのどの層かを示す(内側から外側の順)。
 * 図の左下に重ねる。ドラッグやズームの邪魔にならないよう、クリックは通す。
 */
export default function ClassesLegend() {
  return (
    <div
      className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-col gap-1 rounded border px-3 py-2 text-xs"
      style={{
        borderColor: "var(--border-default)",
        backgroundColor: "var(--surface-base)",
        color: "var(--text-primary)",
      }}
      aria-label="クリーンアーキテクチャの層(箱の色)"
    >
      <div style={{ color: "var(--text-secondary)" }}>
        クリーンアーキテクチャの層(内側 → 外側)
      </div>
      {ARCHITECTURE_LAYERS.map((layer) => (
        <div key={layer.key} className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-4 rounded-sm border"
            style={{
              backgroundColor: layer.fill,
              borderColor: layer.border,
            }}
          />
          <span>{layer.label}</span>
        </div>
      ))}
    </div>
  );
}
