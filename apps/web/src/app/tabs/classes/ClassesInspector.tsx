"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import { PORT_SIDES, type PortSide } from "@/data/classesLayoutStorage";

/**
 * Classes 図のインスペクタ。クラスのクリックで開く右端の詳細パネル。
 *
 * 以前は `@yanqirenshi/colonoscope` を使っていたが、接続辺を選ぶ入力欄(選択肢)が
 * 無く、結線の一覧も置けないため MUI で作り直した。作りは TM のインスペクタ
 * (`tabs/tm/TmInspector.tsx`)に揃えている(基本 / 説明の2タブ、結線一覧、幅の伸縮)。
 * TM は結線の端点を角度で、Classes は辺で持つため、部品は共通化していない。
 */

/**
 * 選択中クラスに繋がる関係線1本。`side` はこのクラス側の端点の接続辺で、
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
  side: PortSide;
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
    /** 変更のあった端点だけ(保存キー → 接続辺)。 */
    ports: Record<string, PortSide>;
  }) => void;
  onClose: () => void;
};

type TabValue = "basic" | "description";

const SIDE_LABEL: Record<PortSide, string> = {
  top: "上",
  bottom: "下",
  left: "左",
  right: "右",
};

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function initialSides(ports: ClassesInspectorPort[]): Record<string, PortSide> {
  return Object.fromEntries(ports.map((port) => [port.key, port.side]));
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
  const [sides, setSides] = useState<Record<string, PortSide>>(() =>
    initialSides(target.ports),
  );

  // 対象が変わったら入力欄を差し替える。レンダー中の setState で書く
  // (effect で書くと react-hooks/set-state-in-effect に当たる)。
  // タブの選択は TM と同じく意図して保つ(説明を読み比べられるように)。
  if (target.physical !== shownPhysical) {
    setShownPhysical(target.physical);
    setX(String(target.position.x));
    setY(String(target.position.y));
    setSides(initialSides(target.ports));
  }

  const nextX = toNumber(x, target.position.x);
  const nextY = toNumber(y, target.position.y);

  const changedPorts: Record<string, PortSide> = {};
  for (const port of target.ports) {
    const next = sides[port.key] ?? port.side;
    if (next !== port.side) changedPorts[port.key] = next;
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
              結線({target.ports.length}) — このクラス側の接続辺
            </div>

            {target.ports.length === 0 ? (
              <div
                className="text-sm"
                style={{ color: "var(--text-placeholder)" }}
              >
                (結線なし)
              </div>
            ) : (
              target.ports.map((port) => (
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
                    select
                    label="辺"
                    value={sides[port.key] ?? port.side}
                    size="small"
                    sx={{ width: 96 }}
                    onChange={(event) =>
                      setSides((prev) => ({
                        ...prev,
                        [port.key]: event.target.value as PortSide,
                      }))
                    }
                  >
                    {PORT_SIDES.map((side) => (
                      <MenuItem key={side} value={side}>
                        {SIDE_LABEL[side]}
                      </MenuItem>
                    ))}
                  </TextField>
                </div>
              ))
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
