/**
 * @yanqirenshi 系パッケージは型定義を同梱していない(d3.classes を除く)ため、
 * strict モードでも import できるよう緩い宣言を用意する。
 */
declare module "@yanqirenshi/d3.deployment" {
  import type { ComponentType } from "react";

  export class Rectum {
    constructor(params: Record<string, unknown>);
    data(value: Record<string, unknown>): unknown;
    selector(value: string): void;
  }

  const D3Deployment: ComponentType<{ rectum: Rectum }>;
  export default D3Deployment;
}

declare module "@yanqirenshi/d3.sitemap" {
  import type { ComponentType } from "react";

  export class Rectum {
    constructor(params: Record<string, unknown>);
    data(value: Record<string, unknown>): unknown;
    selector(value: string): void;
  }

  const D3Sitemap: ComponentType<{ rectum: Rectum }>;
  export default D3Sitemap;
}

declare module "@yanqirenshi/d3.ter" {
  import type { ComponentType } from "react";

  export class Rectum {
    constructor(params: Record<string, unknown>);
    data(value: Record<string, unknown>): unknown;
    selector(value: string): void;
  }

  const D3Ter: ComponentType<{ rectum: Rectum; id?: string }>;
  export default D3Ter;
}

declare module "@yanqirenshi/d3.wireframe" {
  import type { ComponentType } from "react";

  export class Rectum {
    constructor(params: Record<string, unknown>);
    data(value: Record<string, unknown>): unknown;
    selector(value: string): void;
  }

  const D3Wireframe: ComponentType<{ rectum: Rectum }>;
  export default D3Wireframe;
}

declare module "@yanqirenshi/wnqi.big.size" {
  export default class Asshole {
    build(params: {
      data: Record<string, unknown>;
      options?: Record<string, unknown>;
      start_id?: number | string | null;
      flatten?: boolean;
    }): Record<string, unknown>[];
  }
}

declare module "@yanqirenshi/table.wbs" {
  import type { ComponentType } from "react";

  const WBSTable: ComponentType<{
    columns: Record<string, unknown>[];
    source: Record<string, unknown>;
    options?: Record<string, unknown>;
    start_id?: number | string | null;
    download?: () => void;
    style?: Record<string, unknown>;
  }>;
  export default WBSTable;
}
