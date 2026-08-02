export const DEPLOYMENT_DATA = {
  nodes: [
    {
      type: "NODE",
      id: 1,
      label: { text: "YAOYOROZU", position: { x: 20, y: 20 } },
      size: { w: 500, h: 220 },
      position: { x: 0, y: 0 },
      children: [
        {
          type: "NODE",
          id: 2,
          label: { text: "Webアプリ", position: { x: 20, y: 20 } },
          size: { w: 200, h: 120 },
          position: { x: 30, y: 70 },
          children: [],
        },
        {
          type: "NODE",
          id: 3,
          label: { text: "ネイティブアプリ", position: { x: 20, y: 20 } },
          size: { w: 200, h: 120 },
          position: { x: 270, y: 70 },
          children: [],
        },
      ],
    },
    {
      type: "NODE",
      id: 4,
      label: { text: "claude", position: { x: 20, y: 20 } },
      size: { w: 500, h: 320 },
      position: { x: 0, y: 320 },
      children: [
        {
          type: "NODE",
          id: 5,
          label: { text: "claude code", position: { x: 20, y: 20 } },
          size: { w: 420, h: 220 },
          position: { x: 40, y: 70 },
          children: [
            {
              type: "NODE",
              id: 6,
              label: { text: "claude code app", position: { x: 20, y: 20 } },
              size: { w: 340, h: 100 },
              position: { x: 40, y: 90 },
              children: [],
            },
          ],
        },
      ],
    },
  ],
  edges: [],
};
