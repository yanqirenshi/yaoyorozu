/**
 * TM 図(`/tm`)のレイアウト手調整を localStorage に保存する。
 *
 * web.md §2 の例外規定に従う。localStorage に置いてよいのは「レイアウトの手調整」
 * のような表示補助情報のみで、モデルの本体は `tm.ts` が唯一の真実である。
 * 調整結果が安定したら `tm.ts` の `position` へ反映してリポジトリに戻すこと。
 *
 * キーはエンティティの**物理名**にする。図から読めるのは配列順で採番された `_id`
 * だけだが、`tm.ts` のエンティティ定義を並べ替えると `_id` がずれてしまうため、
 * `TM_ENTITY_KEY_BY_ID` で物理名に変換してから保存する(Classes と同じ流儀)。
 */

const STORAGE_KEY = "yaoyorozu:tm:layout";

export type NodePosition = { x: number; y: number };

/** 物理名 → 手調整後の位置。 */
export type LayoutOverrides = Record<string, NodePosition>;

export function loadLayoutOverrides(): LayoutOverrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LayoutOverrides) : {};
  } catch {
    return {};
  }
}

export function saveLayoutOverrides(overrides: LayoutOverrides): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
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
