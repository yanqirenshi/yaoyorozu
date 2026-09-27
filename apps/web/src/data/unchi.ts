import type { UnchiData } from "@yanqirenshi/d3.unchi";
import { roleColor } from "@/data/uiDesign";

// アーキテクチャ図(ポンチ絵)のデータ。/unchi(d3.unchi)で表示する。
// 内容は CLAUDE.md の「目的・背景」「構成」に書かれた役割分担に沿わせている。
// 位置は親ノードの左上からの相対座標。

const LABEL_POSITION = { x: 20, y: 24 };
const EDGE_STROKE = { color: roleColor("border.strong"), width: 2 };

// エッジのポート角度(ノード中心から見て 0=真下・時計回り)
const PORT_BOTTOM = 0;
const PORT_TOP = 180;

// ノード ID
const YAOYOROZU_ID = 1;
const NATIVE_ID = 2;
const WEB_ID = 3;
const AGENTS_ID = 10;
const GITHUB_ID = 20;

export const UNCHI_DATA: UnchiData = {
  nodes: [
    {
      type: "NODE",
      id: YAOYOROZU_ID,
      label: { text: "YAOYOROZU", position: LABEL_POSITION },
      description: "AIを利用したITプロダクト開発をサポートするアプリ",
      size: { w: 860, h: 340 },
      position: { x: 0, y: 0 },
      children: [
        {
          type: "NODE",
          id: NATIVE_ID,
          label: { text: "ネイティブアプリ(apps/native)", position: LABEL_POSITION },
          description: "AIコーディングエージェントをラップし、GitHub でタスクを管理する",
          size: { w: 380, h: 240 },
          position: { x: 30, y: 70 },
          children: [
            {
              type: "NODE",
              id: 4,
              label: { text: "React(画面)", position: LABEL_POSITION },
              size: { w: 150, h: 100 },
              position: { x: 20, y: 90 },
            },
            {
              type: "NODE",
              id: 5,
              label: { text: "Tauri(Rust)", position: LABEL_POSITION },
              size: { w: 150, h: 100 },
              position: { x: 210, y: 90 },
            },
          ],
        },
        {
          type: "NODE",
          id: WEB_ID,
          label: { text: "Webアプリ(apps/web)", position: LABEL_POSITION },
          description: "プロダクトの情報(仕様など)を管理する。AIと人のコミュニケーションの場",
          size: { w: 380, h: 240 },
          position: { x: 450, y: 70 },
          children: [
            {
              type: "NODE",
              id: 6,
              label: { text: "Next.js", position: LABEL_POSITION },
              size: { w: 150, h: 100 },
              position: { x: 20, y: 90 },
            },
            {
              type: "NODE",
              id: 7,
              label: { text: "d3 ライブラリ群", position: LABEL_POSITION },
              description: "WBS・構成図・サイトマップ・Classes・TM を描く",
              size: { w: 150, h: 100 },
              position: { x: 210, y: 90 },
            },
          ],
        },
      ],
    },
    {
      type: "NODE",
      id: AGENTS_ID,
      label: { text: "AIコーディングエージェント", position: LABEL_POSITION },
      size: { w: 420, h: 200 },
      position: { x: 0, y: 440 },
      children: [
        {
          type: "NODE",
          id: 11,
          label: { text: "Claude Code", position: LABEL_POSITION },
          size: { w: 110, h: 80 },
          position: { x: 20, y: 90 },
        },
        {
          type: "NODE",
          id: 12,
          label: { text: "Gemini", position: LABEL_POSITION },
          size: { w: 110, h: 80 },
          position: { x: 155, y: 90 },
        },
        {
          type: "NODE",
          id: 13,
          label: { text: "Codex", position: LABEL_POSITION },
          size: { w: 110, h: 80 },
          position: { x: 290, y: 90 },
        },
      ],
    },
    {
      type: "NODE",
      id: GITHUB_ID,
      label: { text: "GitHub", position: LABEL_POSITION },
      size: { w: 380, h: 200 },
      position: { x: 480, y: 440 },
      children: [
        {
          type: "NODE",
          id: 21,
          label: { text: "Issue / Pull Request", position: LABEL_POSITION },
          size: { w: 170, h: 80 },
          position: { x: 20, y: 90 },
        },
        {
          type: "NODE",
          id: 22,
          label: { text: "Projects", position: LABEL_POSITION },
          size: { w: 140, h: 80 },
          position: { x: 220, y: 90 },
        },
      ],
    },
  ],
  edges: [
    {
      id: 100,
      from: { id: NATIVE_ID, position: PORT_BOTTOM },
      to: { id: AGENTS_ID, position: PORT_TOP },
      stroke: EDGE_STROKE,
      label: { text: "ラップして操作" },
    },
    {
      id: 101,
      from: { id: NATIVE_ID, position: PORT_BOTTOM },
      to: { id: GITHUB_ID, position: PORT_TOP },
      stroke: EDGE_STROKE,
      label: { text: "タスク管理" },
    },
  ],
};
