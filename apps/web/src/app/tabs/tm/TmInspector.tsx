"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";

/**
 * TM 図のインスペクタ。エンティティの右クリックで開く右端の詳細パネル。
 *
 * Classes・サイトマップは `@yanqirenshi/colonoscope` を使っているが、こちらは
 * 使っていない。Colonoscope の項目は1枚の平らなリストで、タブに分ける手段が
 * 無いため(幅も 300px 固定で `!important` の上書きが要っていた)。
 * パッケージ側にタブと幅の受け口が入ったら、そちらへ戻すことを検討する
 * (幅については Foolsgolds/Assholes#21 で起票済み)。
 */

/**
 * 選択中エンティティに繋がる結線1本。`angle` はこのエンティティ側の端点の角度で、
 * 相手側は編集しない(相手を選べばそちらから編集できる)。
 */
export type TmInspectorPort = {
  /** 保存キー(`<リレーションシップキー>:<from|to>`)。 */
  key: string;
  /** 相手のエンティティ名。 */
  counterpart: string;
  /** 結線のラベル。無い場合もある。 */
  label?: string;
  /** このエンティティが結線の起点側か終点側か。表示の向きに使う。 */
  outgoing: boolean;
  angle: number;
};

export type TmInspectorTarget = {
  id: number;
  /** 物理名。レイアウト保存のキーでもある。 */
  key: string;
  name: string;
  type: string;
  description: string;
  position: { x: number; y: number };
  ports: TmInspectorPort[];
};

type TmInspectorProps = {
  /** 表示対象。開いていないときは呼び出し側がこのコンポーネント自体を描かない。 */
  target: TmInspectorTarget;
  width: number;
  onApply: (values: {
    position: { x: number; y: number };
    /** 変更のあったポートだけ(保存キー → 角度)。 */
    ports: Record<string, number>;
  }) => void;
  onClose: () => void;
};

type TabValue = "basic" | "description";

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** d3.ter は角度を 0-360 の範囲で扱う(`position % 360`)。負値も丸めておく。 */
function normalizeAngle(value: number) {
  return ((Math.round(value) % 360) + 360) % 360;
}

/** 0=下 / 90=左 / 180=上 / 270=右。中間の角度もそのまま使える。 */
function angleHint(angle: number) {
  if (angle === 0) return "下";
  if (angle === 90) return "左";
  if (angle === 180) return "上";
  if (angle === 270) return "右";
  return "";
}

function initialAngles(ports: TmInspectorPort[]): Record<string, string> {
  return Object.fromEntries(ports.map((port) => [port.key, String(port.angle)]));
}

export default function TmInspector({
  target,
  width,
  onApply,
  onClose,
}: TmInspectorProps) {
  const [tab, setTab] = useState<TabValue>("basic");
  const [shownId, setShownId] = useState(target.id);
  const [x, setX] = useState(String(target.position.x));
  const [y, setY] = useState(String(target.position.y));
  const [angles, setAngles] = useState<Record<string, string>>(() =>
    initialAngles(target.ports),
  );

  // 対象が変わったら入力欄を差し替える。React の「props の変化に合わせて state を
  // 調整する」形(レンダー中の setState)で書く。effect で書くと余分な再レンダーに
  // なるため(react-hooks/set-state-in-effect)。
  // タブの選択は意図して保つ。説明を読み比べるとき、右クリックで対象を渡り歩いても
  // 「説明」タブに留まってほしいため。
  if (target.id !== shownId) {
    setShownId(target.id);
    setX(String(target.position.x));
    setY(String(target.position.y));
    setAngles(initialAngles(target.ports));
  }

  const nextX = toNumber(x, target.position.x);
  const nextY = toNumber(y, target.position.y);

  const changedPorts: Record<string, number> = {};
  for (const port of target.ports) {
    const next = normalizeAngle(toNumber(angles[port.key] ?? "", port.angle));
    if (next !== port.angle) changedPorts[port.key] = next;
  }

  const changed =
    nextX !== target.position.x ||
    nextY !== target.position.y ||
    Object.keys(changedPorts).length > 0;

  return (
    <Box
      className="absolute top-0 right-0 bottom-0 z-10 flex flex-col overflow-hidden border-l"
      style={{ width }}
      sx={{
        borderColor: "var(--border-default)",
        backgroundColor: "var(--surface-base)",
      }}
    >
      <div
        className="flex items-start justify-between gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--border-default)" }}
      >
        <div className="min-w-0">
          <div
            className="text-xs tracking-wide"
            style={{ color: "var(--text-secondary)" }}
          >
            {target.type}
          </div>
          <div
            className="truncate text-base font-bold"
            style={{ color: "var(--text-primary)" }}
            title={target.name}
          >
            {target.name}
          </div>
        </div>
        <IconButton size="small" aria-label="閉じる" onClick={onClose}>
          ✕
        </IconButton>
      </div>

      <Tabs
        value={tab}
        onChange={(_event, value: TabValue) => setTab(value)}
        variant="fullWidth"
        sx={{ borderBottom: 1, borderColor: "divider", minHeight: 40 }}
      >
        <Tab value="basic" label="基本" sx={{ textTransform: "none" }} />
        <Tab value="description" label="説明" sx={{ textTransform: "none" }} />
      </Tabs>

      {tab === "basic" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4">
          <TextField
            label="物理名"
            value={target.key}
            size="small"
            fullWidth
            slotProps={{ input: { readOnly: true } }}
          />
          <div className="flex gap-3">
            <TextField
              label="X"
              type="number"
              value={x}
              size="small"
              fullWidth
              onChange={(event) => setX(event.target.value)}
            />
            <TextField
              label="Y"
              type="number"
              value={y}
              size="small"
              fullWidth
              onChange={(event) => setY(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div
              className="text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              結線({target.ports.length}) — このエンティティ側の角度
              <span className="ml-1">0=下 / 90=左 / 180=上 / 270=右</span>
            </div>

            {target.ports.length === 0 ? (
              <div
                className="text-sm"
                style={{ color: "var(--text-placeholder)" }}
              >
                (結線なし)
              </div>
            ) : (
              target.ports.map((port) => {
                const value = angles[port.key] ?? String(port.angle);
                const hint = angleHint(
                  normalizeAngle(toNumber(value, port.angle)),
                );
                return (
                  <div
                    key={port.key}
                    className="flex items-center gap-2 rounded border px-2 py-1.5"
                    style={{ borderColor: "var(--border-default)" }}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-sm"
                        style={{ color: "var(--text-primary)" }}
                        title={port.counterpart}
                      >
                        {port.outgoing ? "→ " : "← "}
                        {port.counterpart}
                      </div>
                      {port.label && (
                        <div
                          className="truncate text-xs"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {port.label}
                        </div>
                      )}
                    </div>
                    <TextField
                      type="number"
                      value={value}
                      size="small"
                      slotProps={{
                        htmlInput: {
                          "aria-label": `${port.counterpart}${
                            port.label ? `(${port.label})` : ""
                          } への結線の角度`,
                        },
                      }}
                      sx={{ width: 96 }}
                      helperText={hint}
                      onChange={(event) =>
                        setAngles((prev) => ({
                          ...prev,
                          [port.key]: event.target.value,
                        }))
                      }
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-auto px-4 py-4 text-sm leading-relaxed whitespace-pre-wrap"
          style={{ color: "var(--text-primary)" }}
        >
          {target.description || "(説明なし)"}
        </div>
      )}

      <div
        className="flex justify-end border-t px-4 py-3"
        style={{ borderColor: "var(--border-default)" }}
      >
        <Button
          variant="contained"
          size="small"
          disabled={!changed}
          onClick={() =>
            onApply({
              position: { x: nextX, y: nextY },
              ports: changedPorts,
            })
          }
          sx={{ textTransform: "none" }}
        >
          適用
        </Button>
      </div>
    </Box>
  );
}
