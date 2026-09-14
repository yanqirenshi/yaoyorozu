"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import { normalizeAngle } from "@/data/classesLayoutStorage";

/**
 * Classes 図のインスペクタ。クラスのクリックで開く右端の詳細パネル。
 *
 * 以前は `@yanqirenshi/colonoscope` を使っていたが、結線の一覧を置く手段が無いため
 * MUI で作り直した。作りは TM のインスペクタ(`tabs/tm/TmInspector.tsx`)に揃えている
 * (基本 / 説明の2タブ、結線一覧、幅の伸縮)。
 * 結線の端点は、d3.classes 0.8.0 以降、TM と同じく角度で持てるようになった。
 * 部品を TM と共通化する余地はあるが、TM のインスペクタは TM の担当範囲なので分けたままにする。
 */

/**
 * 選択中クラスに繋がる関係線1本。`angle` はこのクラス側の端点の取り付け角度で、
 * 相手側は編集しない(相手のクラスを選べばそちらから編集できる)。
 */
export type ClassesInspectorPort = {
  /** 保存キー(`<関係線 id>:<from|to>`)。 */
  key: string;
  /** 相手のクラスの物理名。 */
  counterpart: string;
  /** 関係線のラベル。無い場合もある。 */
  label?: string;
  /** このクラスが関係線の起点側か終点側か。表示の向きに使う。 */
  outgoing: boolean;
  /** 0〜359。0=下 / 90=左 / 180=上 / 270=右。 */
  angle: number;
};

export type ClassesInspectorTarget = {
  /** 物理名。クラスの id・レイアウト保存のキーでもある。 */
  physical: string;
  stereotype: string;
  description: string;
  position: { x: number; y: number };
  ports: ClassesInspectorPort[];
};

type ClassesInspectorProps = {
  /** 表示対象。開いていないときは呼び出し側がこのコンポーネント自体を描かない。 */
  target: ClassesInspectorTarget;
  width: number;
  onApply: (values: {
    position: { x: number; y: number };
    /** 変更のあった端点だけ(保存キー → 角度)。 */
    ports: Record<string, number>;
  }) => void;
  onClose: () => void;
};

type TabValue = "basic" | "description";

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** 辺の中央に当たる角度なら、その辺の名前を添える。中間の角度もそのまま使える。 */
function angleHint(angle: number) {
  if (angle === 0) return "下";
  if (angle === 90) return "左";
  if (angle === 180) return "上";
  if (angle === 270) return "右";
  return "";
}

function initialAngles(ports: ClassesInspectorPort[]): Record<string, string> {
  return Object.fromEntries(ports.map((port) => [port.key, String(port.angle)]));
}

export default function ClassesInspector({
  target,
  width,
  onApply,
  onClose,
}: ClassesInspectorProps) {
  const [tab, setTab] = useState<TabValue>("basic");
  const [shownPhysical, setShownPhysical] = useState(target.physical);
  const [x, setX] = useState(String(target.position.x));
  const [y, setY] = useState(String(target.position.y));
  const [angles, setAngles] = useState<Record<string, string>>(() =>
    initialAngles(target.ports),
  );

  // 対象が変わったら入力欄を差し替える。レンダー中の setState で書く
  // (effect で書くと react-hooks/set-state-in-effect に当たる)。
  // タブの選択は TM と同じく意図して保つ(説明を読み比べられるように)。
  if (target.physical !== shownPhysical) {
    setShownPhysical(target.physical);
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
            {target.stereotype ? `«${target.stereotype}»` : "class"}
          </div>
          <div
            className="truncate text-base font-bold"
            style={{ color: "var(--text-primary)" }}
            title={target.physical}
          >
            {target.physical}
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
            value={target.physical}
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
              結線({target.ports.length}) — このクラス側の角度
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
