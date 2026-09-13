/**
 * Classes 図(`/class-diagram`)のレイアウト手調整の保存先。
 *
 * web.md §2 により、開発時専用の保存API経由でリポジトリ内ファイル
 * (`src/data/layout/classes.json`)に保存する。モデルの本体は
 * 図ごとのデータファイル(`classes-*.ts`)が唯一の真実であり、調整結果が安定したら
 * そちらの `position` や `rel(...)` の接続辺へ反映してリポジトリへ戻すこと。
 *
 * 調整対象は2種類あり、TM(`tmLayoutStorage.ts`)と同じく1ファイルにまとめる
 * (`{ classes, ports }`)。
 *   - クラスの位置(物理名がキー)
 *   - 関係線の接続辺(端点がクラスのどの辺につくか。`<関係線 id>:<from|to>` がキー)
 * クラスの id は物理名、関係線の id は `<起点>-><終点>` で、どちらも物理名から
 * 組み立てている(`classDiagram.ts` の `defineDiagram`)。配列を並べ替えてもキーはずれない。
 */
import type { RelationshipInput } from "@yanqirenshi/d3.classes";
import layoutFile from "./layout/classes.json";
import { saveLayoutToApi } from "./layoutSaveApi";

// 旧方式(localStorage)からの一時的な移行処理で使うキー。
// 全環境の移行が済んだら READ_LEGACY 関連ごと削除してよい。
const LEGACY_STORAGE_KEY = "yaoyorozu:classes:layout";

export type NodePosition = { x: number; y: number };

/** 物理名 → 手調整後の位置。 */
export type LayoutOverrides = Record<string, NodePosition>;

/** 関係線の端点がつくクラスの辺(d3.classes の `ConnectionSide` と同じ値)。 */
export type PortSide = "top" | "bottom" | "left" | "right";
export const PORT_SIDES: readonly PortSide[] = ["top", "bottom", "left", "right"];

/** 関係線のどちら側の端点か。 */
export type PortEnd = "from" | "to";

/** `<関係線 id>:<from|to>` → 接続辺。 */
export type PortOverrides = Record<string, PortSide>;

/** `classes.json` の中身。 */
export type ClassesLayoutFile = {
  classes?: LayoutOverrides;
  ports?: PortOverrides;
};

function isPortSide(value: unknown): value is PortSide {
  return (PORT_SIDES as readonly unknown[]).includes(value);
}

/**
 * ファイルを読む。接続辺を入れる前は素の `LayoutOverrides`(クラス位置だけの
 * 平らな形)で保存していたため、そちらも読めるようにしておく。
 * クラスの物理名に `classes` / `ports` は無いので、キーの有無で判別できる。
 */
function readLayoutFile(): ClassesLayoutFile {
  const raw = layoutFile as ClassesLayoutFile | LayoutOverrides | null;
  if (!raw || typeof raw !== "object") return {};
  if ("classes" in raw || "ports" in raw) return raw as ClassesLayoutFile;
  return { classes: raw as LayoutOverrides };
}

const fileLayout = readLayoutFile();
const hasFileOverrides =
  Object.keys(fileLayout.classes ?? {}).length > 0 ||
  Object.keys(fileLayout.ports ?? {}).length > 0;

function readLegacyOverrides(): LayoutOverrides | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LayoutOverrides) : null;
  } catch {
    return null;
  }
}

export function loadLayoutOverrides(): LayoutOverrides {
  if (hasFileOverrides) return fileLayout.classes ?? {};
  return readLegacyOverrides() ?? {};
}

/** 接続辺の手調整。ファイルを手で書き換えて4辺以外の値が入っていたら無視する。 */
export function loadPortOverrides(): PortOverrides {
  return Object.fromEntries(
    Object.entries(fileLayout.ports ?? {}).filter(([, side]) => isPortSide(side)),
  );
}

/** 保存APIへ渡す1つのオブジェクトにまとめる。 */
export function buildLayoutFile(
  classes: LayoutOverrides,
  ports: PortOverrides,
): ClassesLayoutFile {
  return { classes, ports };
}

/**
 * 旧方式(localStorage)からの一時的な自己移行。全環境の移行が済んだら削除してよい。
 *
 * レイアウトファイルが空で、かつ localStorage に旧データが残っている場合、
 * それを保存APIへ送ってファイル化し、成功したら旧キーを削除する。
 */
export function migrateLegacyLayoutIfNeeded(): void {
  if (hasFileOverrides) return;
  const legacy = readLegacyOverrides();
  if (!legacy || Object.keys(legacy).length === 0) return;

  saveLayoutToApi("classes", buildLayoutFile(legacy, {})).then(({ ok }) => {
    if (ok) window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  });
}

type ClassLike = {
  name: { physical: string };
  position: NodePosition;
};

export function applyLayoutOverrides<T extends ClassLike>(
  classes: T[],
  overrides: LayoutOverrides,
): T[] {
  return classes.map((c) => {
    const override = overrides[c.name.physical];
    return {
      ...c,
      // d3.classes は position オブジェクトを in-place で書き換えるため、
      // 元データ(SESSION_LINE_CLASS_DATA 等)を汚染しないよう常に複製する。
      position: { x: override?.x ?? c.position.x, y: override?.y ?? c.position.y },
    };
  });
}

export function portOverrideKey(relationshipId: string, end: PortEnd): string {
  return `${relationshipId}:${end}`;
}

/**
 * 接続辺の手調整を反映した関係線の配列を返す。座標で指定した端点(クラスに
 * つかない端点)には接続辺が無いので、そのままにする。
 * 端点は常に複製し、d3.classes に渡しても元データを汚さないようにする。
 */
export function applyPortOverrides(
  relationships: RelationshipInput[],
  overrides: PortOverrides,
): RelationshipInput[] {
  return relationships.map((rel) => {
    const sideOf = (end: PortEnd) =>
      rel.id ? overrides[portOverrideKey(rel.id, end)] : undefined;
    const withSide = (
      connection: RelationshipInput["from"],
      side: PortSide | undefined,
    ): RelationshipInput["from"] =>
      "classId" in connection
        ? { ...connection, point: side ?? connection.point }
        : { ...connection };

    return {
      ...rel,
      from: withSide(rel.from, sideOf("from")),
      to: withSide(rel.to, sideOf("to")),
    };
  });
}
