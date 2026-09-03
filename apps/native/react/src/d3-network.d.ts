// `@yanqirenshi/d3.network` は型定義を同梱していないため、strict モードでも
// import できるよう緩い宣言を用意する(apps/web の yanqirenshi.d.ts と同じ
// 流儀。issue #84)。実際に使うAPI(Rectumのコンストラクタ・data・
// node.clickコールバック)のみ宣言し、それ以外は any 相当のままにする。
declare module "@yanqirenshi/d3.network" {
  import type { ComponentType } from "react";

  export type NodeDatum = {
    id: string;
    x: number;
    y: number;
    _core: Record<string, unknown>;
    [key: string]: unknown;
  };

  export type NodeClickHandler = (node: NodeDatum, event: MouseEvent) => void;
  // d3.drag() のイベント(d3-dragのD3DragEvent)。詳細な型までは使わないため
  // 緩く宣言する。
  export type NodeDragHandler = (node: NodeDatum, event: unknown) => void;

  export class Rectum {
    constructor(params: {
      callbacks?: {
        node?: {
          click?: NodeClickHandler;
          dblclick?: NodeClickHandler;
          mouseOver?: NodeClickHandler;
          mouseOut?: NodeClickHandler;
          dragStarted?: NodeDragHandler;
          dragged?: NodeDragHandler;
          dragEnded?: NodeDragHandler;
        };
      };
    });
    data(value: {
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    }): unknown;
  }

  const D3Network: ComponentType<{ rectum: Rectum }>;
  export default D3Network;
}
