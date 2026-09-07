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

export type TmInspectorTarget = {
  id: number;
  /** 物理名。レイアウト保存のキーでもある。 */
  key: string;
  name: string;
  type: string;
  description: string;
  position: { x: number; y: number };
};

type TmInspectorProps = {
  /** 表示対象。開いていないときは呼び出し側がこのコンポーネント自体を描かない。 */
  target: TmInspectorTarget;
  width: number;
  onApply: (position: { x: number; y: number }) => void;
  onClose: () => void;
};

type TabValue = "basic" | "description";

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
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

  // 対象が変わったら入力欄を差し替える。React の「props の変化に合わせて state を
  // 調整する」形(レンダー中の setState)で書く。effect で書くと余分な再レンダーに
  // なるため(react-hooks/set-state-in-effect)。
  // タブの選択は意図して保つ。説明を読み比べるとき、右クリックで対象を渡り歩いても
  // 「説明」タブに留まってほしいため。
  if (target.id !== shownId) {
    setShownId(target.id);
    setX(String(target.position.x));
    setY(String(target.position.y));
  }

  const nextX = toNumber(x, target.position.x);
  const nextY = toNumber(y, target.position.y);
  const changed = nextX !== target.position.x || nextY !== target.position.y;

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
          onClick={() => onApply({ x: nextX, y: nextY })}
          sx={{ textTransform: "none" }}
        >
          適用
        </Button>
      </div>
    </Box>
  );
}
