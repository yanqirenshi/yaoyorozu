export const DEPLOYMENT_DATA = {
  nodes: [
    {
      type: "NODE",
      id: 1,
      label: { text: "Webサーバー", position: { x: 20, y: 20 } },
      size: { w: 220, h: 140 },
      position: { x: 0, y: 0 },
      children: [],
    },
    {
      type: "NODE",
      id: 2,
      label: { text: "APIサーバー", position: { x: 20, y: 20 } },
      size: { w: 220, h: 140 },
      position: { x: 320, y: 0 },
      children: [],
    },
    {
      type: "NODE",
      id: 3,
      label: { text: "DBサーバー", position: { x: 20, y: 20 } },
      size: { w: 220, h: 140 },
      position: { x: 640, y: 0 },
      children: [],
    },
  ],
  edges: [
    {
      id: 100,
      from: { id: 1, position: 0 },
      to: { id: 2, position: 180 },
      port: 45,
    },
    {
      id: 101,
      from: { id: 2, position: 0 },
      to: { id: 3, position: 180 },
      port: 45,
    },
  ],
};
