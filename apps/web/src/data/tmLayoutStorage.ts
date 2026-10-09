/**
 * TM 図(`/tm`)のレイアウト手調整の保存先。
 *
 * web.md §2 により、開発時専用の保存API経由でリポジトリ内ファイル
 * (`src/data/layout/tm.json`)に保存する。モデルの本体は
 * `{リポジトリ}/yyz/spec/tm.json` が唯一の真実であり、調整結果が安定したら
 * そちらの `position` へ反映してリポジトリへ戻すこと。
 *
 * **レイアウトは #543 の移行対象ではない**(#587 の判断)。モデルを yyz/spec へ
 * 移したあともこのファイルは `apps/web/src/data/layout/tm.json` に書く。保存API
 * (`/api/layout/[diagram]`)が apps/web 配下に書く作りで、移すと「どのリポジトリの
 * レイアウトをどこに置くか」という別の設計が要るため。いま図を持つのは yaoyorozu
 * だけなので、実害が出てから考える。
 *
 * TM は他の図と違い、調整対象が2種類ある。
 *   - エンティティの位置(物理名がキー)
 *   - 結線のポート角度(結線がエンティティのどの辺から出るか)
 * 図名ごとに1ファイルという規約に合わせ、どちらも `tm.json` に入れる
 * (`{ entities, ports }`)。
 *
 * キーはいずれも**物理名から組み立てる**。図から読めるのは配列順で採番された
 * `_id` だけだが、`tm.json` の定義を並べ替えると `_id` がずれてしまうため、
 * `lib/tm.ts` が組み立てる対応表(`entityKeyById` / `relationshipKeyById`)で
 * 変換してから保存する。
 *
 * 保存のたびに、今の定義に存在しないエンティティ・結線の項目を落とす
 * (`buildLayoutFile`)。開いたままのページは読み込んだ時点の配置を丸ごと持ち、
 * 保存のたびにファイル全体として書き戻すため、定義から消したものが何度でも
 * 戻ってくるからである(作業中に何度も戻った)。移行前は `tm.ts` を import して
 * いたが、定義が実行時に読む JSON になったため、**有効なキーの一覧を呼び出し側から
 * 受け取る**形にした(`buildLayoutFile` の `known`)。
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

/** 視点(パン/ズーム)。d3-zoom の transform と同じ {k, x, y}。 */
export type CameraTransform = { k: number; x: number; y: number };

/** `tm.json` の中身。 */
export type TmLayoutFile = {
  entities?: LayoutOverrides;
  ports?: PortOverrides;
  camera?: CameraTransform;
};

/**
 * ファイルを読む。ポート角度を入れる前は素の `LayoutOverrides`(エンティティ位置
 * だけの平坦な形)で保存していたため、そちらも読めるようにしておく。
 * TM のエンティティ物理名に `entities` / `ports` は無いので、キーの有無で判別できる。
 */
function readLayoutFile(): TmLayoutFile {
  const raw = layoutFile as TmLayoutFile | LayoutOverrides | null;
  if (!raw || typeof raw !== "object") return {};
  if ("entities" in raw || "ports" in raw || "camera" in raw)
    return raw as TmLayoutFile;
  return { entities: raw as LayoutOverrides };
}

const fileLayout = readLayoutFile();
const hasFileOverrides =
  Object.keys(fileLayout.entities ?? {}).length > 0 ||
  Object.keys(fileLayout.ports ?? {}).length > 0 ||
  fileLayout.camera !== undefined;

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

export function loadCameraTransform(): CameraTransform | null {
  return fileLayout.camera ?? null;
}

/** 今の定義に存在する保存キー。`lib/tm.ts` の対応表から呼び出し側が渡す。 */
export type KnownLayoutKeys = {
  entityKeys: string[];
  relationshipKeys: string[];
};

/**
 * 保存APIへ渡す1つのオブジェクトにまとめる。今の定義に存在しないエンティティの
 * 位置と結線のポート角度はここで落とす(冒頭のコメントを参照)。
 * 視点(camera)はエンティティに依らないのでそのまま残す。
 */
export function buildLayoutFile(
  known: KnownLayoutKeys,
  entities: LayoutOverrides,
  ports: PortOverrides,
  camera?: CameraTransform,
): TmLayoutFile {
  const knownEntities = new Set(known.entityKeys);
  const knownPorts = new Set(
    known.relationshipKeys.flatMap((key) => [
      portOverrideKey(key, "from"),
      portOverrideKey(key, "to"),
    ]),
  );
  const file = {
    entities: pickKnown(entities, knownEntities),
    ports: pickKnown(ports, knownPorts),
  };
  return camera ? { ...file, camera } : file;
}

function pickKnown<T>(
  record: Record<string, T>,
  known: ReadonlySet<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => known.has(key)),
  );
}

/**
 * 旧方式(localStorage)からの一時的な自己移行。全環境の移行が済んだら削除してよい。
 *
 * レイアウトファイルが空で、かつ localStorage に旧データが残っている場合、
 * それを保存APIへ送ってファイル化し、成功したら旧キーを削除する。
 */
export function migrateLegacyLayoutIfNeeded(known: KnownLayoutKeys): void {
  if (hasFileOverrides) return;
  const legacy = readLegacyOverrides();
  if (!legacy || Object.keys(legacy).length === 0) return;

  saveLayoutToApi("tm", buildLayoutFile(known, legacy, {})).then(({ ok }) => {
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
