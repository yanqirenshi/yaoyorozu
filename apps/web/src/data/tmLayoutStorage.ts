/**
 * TM 図(`/tm`)のレイアウト手調整の保存先。
 *
 * web.md §2 により、開発時専用の保存API経由でリポジトリ内ファイル
 * (`src/data/layout/tm.json`)に保存する。モデルの本体は `tm.ts` が
 * 唯一の真実であり、調整結果が安定したら `tm.ts` の `position` へ
 * 反映してリポジトリへ戻すこと。
 *
 * TM は他の図と違い、調整対象が2種類ある。
 *   - エンティティの位置(物理名がキー)
 *   - 結線のポート角度(結線がエンティティのどの辺から出るか)
 * 図名ごとに1ファイルという規約に合わせ、どちらも `tm.json` に入れる
 * (`{ entities, ports }`)。
 *
 * キーはいずれも**物理名から組み立てる**。図から読めるのは配列順で採番された
 * `_id` だけだが、`tm.ts` の定義を並べ替えると `_id` がずれてしまうため、
 * `TM_ENTITY_KEY_BY_ID` / `TM_RELATIONSHIP_KEY_BY_ID` で変換してから保存する。
 */
import layoutFile from "./layout/tm.json";
import { saveLayoutToApi } from "./layoutSaveApi";

// 旧方式(localStorage)からの一時的な移行処理で使うキー。
// 全環境の移行が済んだら READ_LEGACY 関連ごと削除してよい。
const LEGACY_STORAGE_KEY = "yaoyorozu:tm:layout";

export type NodePosition = { x: number; y: number };

/** 物理名 → 手調整後の位置。 */
export type LayoutOverrides = Record<string, NodePosition>;

/** 結線のどちら側の端点か。 */
export type PortEnd = "from" | "to";

/** `<リレーションシップキー>:<from|to>` → 角度。 */
export type PortOverrides = Record<string, number>;

/** `tm.json` の中身。 */
export type TmLayoutFile = {
  entities?: LayoutOverrides;
  ports?: PortOverrides;
};

/**
 * ファイルを読む。ポート角度を入れる前は素の `LayoutOverrides`(エンティティ位置
 * だけの平坦な形)で保存していたため、そちらも読めるようにしておく。
 * TM のエンティティ物理名に `entities` / `ports` は無いので、キーの有無で判別できる。
 */
function readLayoutFile(): TmLayoutFile {
  const raw = layoutFile as TmLayoutFile | LayoutOverrides | null;
  if (!raw || typeof raw !== "object") return {};
  if ("entities" in raw || "ports" in raw) return raw as TmLayoutFile;
  return { entities: raw as LayoutOverrides };
}

const fileLayout = readLayoutFile();
const hasFileOverrides =
  Object.keys(fileLayout.entities ?? {}).length > 0 ||
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
  if (hasFileOverrides) return fileLayout.entities ?? {};
  return readLegacyOverrides() ?? {};
}

export function loadPortOverrides(): PortOverrides {
  return fileLayout.ports ?? {};
}

/** 保存APIへ渡す1つのオブジェクトにまとめる。 */
export function buildLayoutFile(
  entities: LayoutOverrides,
  ports: PortOverrides,
): TmLayoutFile {
  return { entities, ports };
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

  saveLayoutToApi("tm", buildLayoutFile(legacy, {})).then(({ ok }) => {
    if (ok) window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  });
}

type EntityLike = {
  id: number;
  position: { x: number; y: number; z: number };
};

/**
 * 保存済みの手調整を反映したエンティティ配列を返す。
 *
 * d3.ter の Entity は受け取った `position` を複製してから書き換えるが、こちらでも
 * 常に新しいオブジェクトを作り、`TM_DATA` を汚さないようにする。
 */
export function applyLayoutOverrides<T extends EntityLike>(
  entities: T[],
  keyById: Record<number, string>,
  overrides: LayoutOverrides,
): T[] {
  return entities.map((entity) => {
    const override = overrides[keyById[entity.id]];
    return {
      ...entity,
      position: {
        x: override?.x ?? entity.position.x,
        y: override?.y ?? entity.position.y,
        z: entity.position.z,
      },
    };
  });
}

export function portOverrideKey(relationshipKey: string, end: PortEnd): string {
  return `${relationshipKey}:${end}`;
}

type RelationshipLike = {
  id: number;
  from: { position: number };
  to: { position: number };
};

export function applyPortOverrides<T extends RelationshipLike>(
  relationships: T[],
  keyById: Record<number, string>,
  overrides: PortOverrides,
): T[] {
  return relationships.map((relationship) => {
    const key = keyById[relationship.id];
    if (!key) return relationship;

    const from = overrides[portOverrideKey(key, "from")];
    const to = overrides[portOverrideKey(key, "to")];
    if (from === undefined && to === undefined) return relationship;

    return {
      ...relationship,
      from: {
        ...relationship.from,
        position: from ?? relationship.from.position,
      },
      to: { ...relationship.to, position: to ?? relationship.to.position },
    };
  });
}
