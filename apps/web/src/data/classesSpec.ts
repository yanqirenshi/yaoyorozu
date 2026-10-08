/**
 * Classes 図(`/{リポジトリ名}/class-diagram`)のデータの形と、図へ渡す形への変換。
 *
 * データの一次資料は `{リポジトリ}/yyz/spec/classes.json`(#543 の最終段。issue #589)で、
 * 実行時に `GET /api/spec/{repo}/classes` で取る。判断の記録は隣の `classes.md`。
 * 移行前は `src/data/classes*.ts` に TypeScript として書いていた(`defineDiagram` が
 * id・層・ファイルパスを組み立てていた)が、その役目はこのファイルの `toDiagram` が継ぐ。
 *
 * JSON には、d3.classes が知らない項目(`group` / `section` / `layer` / `filePath` /
 * `notes`)が混ざっている。図へ渡す前にここで取り除く。
 */
import type { ClassInput, RelationshipInput } from "@yanqirenshi/d3.classes";

/**
 * クリーンアーキテクチャの層(定義と色は `classArchitecture.ts`)。
 * enterprise = 企業のビジネスルール / application = アプリケーションのビジネスルール /
 * adapter = インターフェイスアダプター / framework = フレームワークとドライバ。
 */
export type ArchitectureLayer =
  | "enterprise"
  | "application"
  | "adapter"
  | "framework";

/** 物理名 → 層。全クラスが持つ。 */
export type ClassLayers = Record<string, ArchitectureLayer>;

/** 物理名 → 実装ファイルのパス。実装済みのクラスの分だけ持つ。 */
export type ClassFilePaths = Record<string, string>;

/** 図の中の区切り(移行前の `// ==== … ====` の見出し)。 */
export type ClassesSpecSection = {
  /** 移行前のファイル(`domain` / `native-prototype` / `infra` / `tauri`)。 */
  group: string;
  title: string;
  /** その区切りの下にまとめて書いていた説明。 */
  notes?: string[];
};

export type ClassesSpecClass = ClassInput & {
  group: string;
  section?: string;
  layer: ArchitectureLayer;
  filePath?: string;
  /** その箱についての補足(移行前にクラスの定義へ添えていたコメント)。 */
  notes?: string[];
};

export type ClassesSpecRelationship = RelationshipInput & {
  /** その線についての補足。d3.classes の `RelationshipInput` には説明の欄が無い。 */
  notes?: string[];
};

export type ClassesSpec = {
  sections: ClassesSpecSection[];
  classes: ClassesSpecClass[];
  relationships: ClassesSpecRelationship[];
};

export type ClassesDiagram = {
  classes: ClassInput[];
  relationships: RelationshipInput[];
  layers: ClassLayers;
  filePaths: ClassFilePaths;
};

/** 仕様データを、描画に渡す形(と、インスペクタ用の対応表)へ分ける。 */
export function toDiagram(spec: ClassesSpec): ClassesDiagram {
  const classes: ClassInput[] = spec.classes.map((c) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 図へ渡さない項目を捨てるための分割代入
    const { group, section, layer, filePath, notes, ...rest } = c;
    return rest;
  });

  const relationships: RelationshipInput[] = spec.relationships.map((r) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 同上
    const { notes, ...rest } = r;
    return rest;
  });

  const layers: ClassLayers = Object.fromEntries(
    spec.classes.map((c) => [c.name.physical, c.layer]),
  );

  const filePaths: ClassFilePaths = Object.fromEntries(
    spec.classes
      .filter((c): c is ClassesSpecClass & { filePath: string } => c.filePath !== undefined)
      .map((c) => [c.name.physical, c.filePath]),
  );

  return { classes, relationships, layers, filePaths };
}
