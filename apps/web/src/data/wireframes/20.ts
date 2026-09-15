import type { Wireframe } from "./index";

/**
 * 構成図(/deployment-diagram)のワイヤーフレーム。サイトマップのサイト id 20。
 *
 * scripts/wireframe/extract-web.js で取り出したもの(1280×800 で開いて再読み込みし、
 * { siteId: 20, title: "構成図", imageLabel: "構成図(d3.deployment)" } を渡して実行)。
 * 画面の構成を変えたら、同じ手順で取り出し直す。
 */
const wireframe: Wireframe = {
  siteId: 20,
  source: {
    path: "/deployment-diagram",
    viewport: { w: 1280, h: 800 },
    capturedAt: "2026-09-15",
  },
  elements: [
    {
      type: "frame",
      label: "構成図",
      rect: { x: 0, y: 0, w: 1280, h: 800 },
      children: [
        {
          type: "frame",
          label: "YAOYOROZU",
          rect: { x: 1, y: 1, w: 256, h: 798 },
          children: [
            { type: "button", label: "WBS", rect: { x: 0, y: 72, w: 255, h: 36 } },
            { type: "button", label: "構成図(選択中)", rect: { x: 0, y: 108, w: 255, h: 36 } },
            { type: "button", label: "UI", rect: { x: 0, y: 144, w: 255, h: 36 } },
            { type: "button", label: "サイトマップ", rect: { x: 0, y: 180, w: 255, h: 36 } },
            { type: "button", label: "Classes", rect: { x: 0, y: 216, w: 255, h: 36 } },
            { type: "button", label: "TM", rect: { x: 0, y: 252, w: 255, h: 36 } },
          ],
        },
        {
          type: "frame",
          rect: { x: 257, y: 1, w: 1007, h: 798 },
          children: [
            {
              type: "frame",
              label: "タブ",
              rect: { x: 0, y: 0, w: 1007, h: 48 },
              children: [
                { type: "button", label: "図(選択中)", rect: { x: 414, y: 0, w: 90, h: 48 } },
                { type: "button", label: "WBS", rect: { x: 504, y: 0, w: 90, h: 48 } },
              ],
            },
            {
              type: "image",
              label: "構成図(d3.deployment)",
              rect: { x: 0, y: 49, w: 1007, h: 749 },
            },
          ],
        },
      ],
    },
  ],
};

export default wireframe;
