import { NAV_MENU_ITEMS } from "./navigation";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 100;
const GAP_X = 100;
const ROOT_ID = 1;

export const SITEMAP_DATA = {
  nodes: [
    {
      type: "NODE",
      id: ROOT_ID,
      label: { contents: "YAOYOROZU", position: { x: 20, y: 20 } },
      size: { w: NODE_WIDTH, h: NODE_HEIGHT },
      position: {
        x: ((NAV_MENU_ITEMS.length - 1) * (NODE_WIDTH + GAP_X)) / 2,
        y: 0,
      },
      children: [],
    },
    ...NAV_MENU_ITEMS.map((item, index) => ({
      type: "NODE",
      id: ROOT_ID + index + 1,
      label: { contents: item.label, position: { x: 20, y: 20 } },
      size: { w: NODE_WIDTH, h: NODE_HEIGHT },
      position: { x: index * (NODE_WIDTH + GAP_X), y: 260 },
      children: [],
    })),
  ],
  edges: NAV_MENU_ITEMS.map((_, index) => ({
    id: 100 + index,
    from: { id: ROOT_ID, position: 0 },
    to: { id: ROOT_ID + index + 1, position: 180 },
    stroke: { color: "#333333", width: 1.5 },
  })),
};
