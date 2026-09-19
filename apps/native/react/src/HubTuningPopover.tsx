import type { MouseEvent as ReactMouseEvent } from "react";

// ハブのグラフ(d3.network の force シミュレーション)の調整値(issue #246)。
// 調整値は永続化しない(リロードで既定値に戻る)。
export type HubTuning = {
  linkDistance: number;
  // `null` は d3-force の既定(リンクの両端の次数に応じた値。定数ではない)。
  // スライダーに触れるまでは既定のまま動かす。
  linkStrength: number | null;
  chargeStrength: number;
  collideRadius: number;
};

// 初期値は d3.network 0.6.1 の `Simulation.js`(`DEFAULT_OPTIONS`)と、それが
// 既定のまま使う d3-force の既定値による。
// - link.distance: null → d3-force の forceLink の既定 30
// - link.strength: null → d3-force の既定(1 / min(両端の次数)。定数ではない)
// - charge.strength: null → d3-force の forceManyBody の既定 -30
// - collide.radius: 111(d3.network の既定)
export const DEFAULT_HUB_TUNING: HubTuning = {
  linkDistance: 30,
  linkStrength: null,
  chargeStrength: -30,
  collideRadius: 111,
};

type SliderSpec = {
  key: keyof HubTuning;
  label: string;
  min: number;
  max: number;
  step: number;
};

// レンジは既定値の前後を十分に振れる範囲にした(ノード間の距離は格子の
// 間隔 240px、collide.radius は既定 111 の約3倍まで)。
const SLIDERS: SliderSpec[] = [
  { key: "linkDistance", label: "link.distance", min: 0, max: 300, step: 5 },
  { key: "linkStrength", label: "link.strength", min: 0, max: 1, step: 0.05 },
  { key: "chargeStrength", label: "charge.strength", min: -500, max: 0, step: 10 },
  { key: "collideRadius", label: "collide.radius", min: 0, max: 300, step: 5 },
];

// `link.strength` を動かす前(`null`)のスライダーの位置。表示は「既定」のまま。
const LINK_STRENGTH_PLACEHOLDER = 0.5;

type HubTuningPopoverProps = {
  values: HubTuning;
  onChange: (key: keyof HubTuning, value: number) => void;
};

// dock の「グラフ調整」アイコンから開く吹き出し。command-dock の吹き出しは
// テキストの項目リストしか持てず(`PopupItem`)スライダーを置けないため、
// dock 側は即アクション型のアイコンにして、吹き出し自体はここで描く。
function HubTuningPopover({ values, onChange }: HubTuningPopoverProps) {
  // ハブ画面のクリック(インスペクタ等を閉じる処理)へ伝えない。
  const stop = (e: ReactMouseEvent) => e.stopPropagation();

  return (
    <div className="hub-tuning" role="dialog" aria-label="グラフの調整" onClick={stop}>
      {SLIDERS.map(({ key, label, min, max, step }) => {
        const value = values[key];
        return (
          <label key={key} className="hub-tuning-row">
            <span className="hub-tuning-label">{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value ?? LINK_STRENGTH_PLACEHOLDER}
              onChange={(e) => onChange(key, Number(e.target.value))}
            />
            <span className="hub-tuning-value">{value === null ? "既定" : value}</span>
          </label>
        );
      })}
    </div>
  );
}

export default HubTuningPopover;
