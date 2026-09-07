/**
 * TM 図(`/tm`)のレイアウト手調整の保存先。
 *
 * web.md §2 により、開発時専用の保存API経由でリポジトリ内ファイル
 * (`src/data/layout/tm.json`)に保存する。モデルの本体は `tm.ts` が
 * 唯一の真実であり、調整結果が安定したら `tm.ts` の `position` へ
 * 反映してリポジトリへ戻すこと。
 *
 * キーはエンティティの**物理名**にする。図から読めるのは配列順で採番された `_id`
 * だけだが、`tm.ts` のエンティティ定義を並べ替えると `_id` がずれてしまうため、
 * `TM_ENTITY_KEY_BY_ID` で物理名に変換してから保存する(Classes と同じ流儀)。
 */
import layoutFile from "./layout/tm.json";
import { saveLayoutToApi } from "./layoutSaveApi";

// 旧方式(localStorage)からの一時的な移行処理で使うキー。
// 全環境の移行が済んだら READ_LEGACY 関連ごと削除してよい。
const LEGACY_STORAGE_KEY = "yaoyorozu:tm:layout";

export type NodePosition = { x: number; y: number };

/** 物理名 → 手調整後の位置。 */
export type LayoutOverrides = Record<string, NodePosition>;

const fileOverrides = (layoutFile as LayoutOverrides) ?? {};
const hasFileOverrides = Object.keys(fileOverrides).length > 0;

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
  if (hasFileOverrides) return fileOverrides;
  return readLegacyOverrides() ?? {};
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

  saveLayoutToApi("tm", legacy).then(({ ok }) => {
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
