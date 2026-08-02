export const SITEMAP_DATA = {
  nodes: [
    {
      type: "NODE",
      id: 1,
      label: { contents: "Home", position: { x: 20, y: 20 } },
      size: { w: 220, h: 100 },
      position: { x: 0, y: 0 },
      children: [],
    },
    {
      type: "NODE",
      id: 2,
      label: { contents: "About", position: { x: 20, y: 20 } },
      size: { w: 220, h: 100 },
      position: { x: 0, y: 260 },
      children: [],
    },
    {
      type: "NODE",
      id: 3,
      label: { contents: "Products", position: { x: 20, y: 20 } },
      size: { w: 220, h: 100 },
      position: { x: 320, y: 260 },
      children: [],
    },
    {
      type: "NODE",
      id: 4,
      label: { contents: "Contact", position: { x: 20, y: 20 } },
      size: { w: 220, h: 100 },
      position: { x: 640, y: 260 },
      children: [],
    },
  ],
  edges: [
    {
      id: 100,
      from: { id: 1, position: 0 },
      to: { id: 2, position: 180 },
      stroke: { color: "#333333", width: 1.5 },
    },
    {
      id: 101,
      from: { id: 1, position: 0 },
      to: { id: 3, position: 180 },
      stroke: { color: "#333333", width: 1.5 },
    },
    {
      id: 102,
      from: { id: 1, position: 0 },
      to: { id: 4, position: 180 },
      stroke: { color: "#333333", width: 1.5 },
    },
  ],
};
