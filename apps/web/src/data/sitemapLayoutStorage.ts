// サイトマップの手調整の保存先。web.md §2 により、開発時専用の保存API経由で
// リポジトリ内ファイル(`src/data/layout/sitemap.json`)に保存する。
//
// 調整対象は3種類あり、TM(`tmLayoutStorage.ts`)・Classes と同じく1ファイルに
// まとめる(`{ nodes, ports, camera }`)。
//   - ノードの位置・サイズ(ドラッグ移動・インスペクタでの数値指定。ノード id がキー)
//   - 結線の端点の角度(結線がノードのどの向きから出入りするか。
//     `<結線 id>:<from|to>` がキー)
//   - 視点(パン/ズーム)。表示のための値なので、sitemap.ts へは書き写さない
import layoutFile from "./layout/sitemap.json";
import { saveLayoutToApi, type CameraTransform } from "./layoutSaveApi";
import { SITEMAP_DATA } from "./sitemap";

// 旧方式(localStorage)からの一時的な移行処理で使うキーとバージョン。
// 全環境の移行が済んだら READ_LEGACY 関連ごと削除してよい。
const LEGACY_STORAGE_KEY = "yaoyorozu:sitemap:layout";
const LEGACY_STORAGE_VERSION = 2;

export type NodeLayout = {
  // children の位置は「親からの相対座標」。SITEMAP_DATA と同じ座標系で持つ
  // (d3.sitemap の fitting() が描画時に親の絶対座標を加算するため)。
  position: { x: number; y: number };
  // サイズはインスペクタで指定したときだけ持つ。ドラッグでは変わらないうえ、
  // 描画データ上のサイズは fitting() が children を包含するよう拡張した後の
  // 値であり、保存してしまうと元データのサイズを上書きしてしまう。
  size?: { w: number; h: number };
};

export type LayoutOverrides = Record<number, NodeLayout>;

/** 結線のどちら側の端点か。 */
export type PortEnd = "from" | "to";

/**
 * `<結線 id>:<from|to>` → 角度。d3.sitemap の角度はノードの中心から見た向きで、
 * 0=下 / 90=左 / 180=上 / 270=右(中間の角度もそのまま使える)。
 */
export type PortOverrides = Record<string, number>;

type LegacyStoredLayout = {
  version: number;
  nodes: LayoutOverrides;
};

/** `sitemap.json` の中身。 */
export type SitemapLayoutFile = {
  nodes?: LayoutOverrides;
  ports?: PortOverrides;
  camera?: CameraTransform;
};

export function portOverrideKey(edgeId: number, end: PortEnd): string {
  return `${edgeId}:${end}`;
}

// 今の sitemap.ts に存在する結線の端点だけを角度の保存キーとして認める。
// 開いたままのページは読み込んだ時点の角度を丸ごと持ち、保存のたびにファイル
// 全体として書き戻すため、読み込み時だけでなく書き込み時(buildLayoutFile)にも
// 落とす(TM の buildLayoutFile と同じ理由)。実際、開発中の差し込み更新で
// 新旧のコードが混ざったページが視点 {x, y, k} を ports に書いたことがある。
const KNOWN_PORT_KEYS = new Set(
  SITEMAP_DATA.edges.flatMap((edge) => [
    portOverrideKey(edge.id, "from"),
    portOverrideKey(edge.id, "to"),
  ]),
);

function pickKnownPorts(ports: PortOverrides): PortOverrides {
  return Object.fromEntries(
    Object.entries(ports).filter(
      ([key, angle]) => KNOWN_PORT_KEYS.has(key) && Number.isFinite(angle),
    ),
  );
}

/**
 * ファイルを読む。視点を入れる前は素の `LayoutOverrides`(ノード id がキーの
 * 平らな形)で保存していたため、そちらも読めるようにしておく。
 * ノード id は数値なので、`nodes` / `ports` / `camera` キーの有無で判別できる。
 */
function readLayoutFile(): SitemapLayoutFile {
  const raw = layoutFile as SitemapLayoutFile | LayoutOverrides | null;
  if (!raw || typeof raw !== "object") return {};
  if ("nodes" in raw || "ports" in raw || "camera" in raw)
    return raw as SitemapLayoutFile;
  return { nodes: raw as LayoutOverrides };
}

const fileLayout = readLayoutFile();
const hasFileOverrides =
  Object.keys(fileLayout.nodes ?? {}).length > 0 ||
  Object.keys(fileLayout.ports ?? {}).length > 0 ||
  fileLayout.camera !== undefined;

function readLegacyOverrides(): LayoutOverrides | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as LegacyStoredLayout;
    if (stored?.version !== LEGACY_STORAGE_VERSION) return null;
    return stored.nodes ?? null;
  } catch {
    return null;
  }
}

export function loadLayoutOverrides(): LayoutOverrides {
  if (hasFileOverrides) return fileLayout.nodes ?? {};
  return readLegacyOverrides() ?? {};
}

/** 保存済みの角度。存在しない結線の端点や数でない値の項目は使わない。 */
export function loadPortOverrides(): PortOverrides {
  return pickKnownPorts(fileLayout.ports ?? {});
}

/**
 * 保存済みの視点。ファイルを手で書き換えて、数でない値や 0 以下の倍率が入っていたら
 * 使わない(等倍・原点から始める)。
 */
export function loadCameraTransform(): CameraTransform | null {
  const camera = fileLayout.camera;
  if (!camera) return null;
  const { k, x, y } = camera;
  return [k, x, y].every(Number.isFinite) && k > 0 ? { k, x, y } : null;
}

/**
 * 保存APIへ渡す1つのオブジェクトにまとめる。サーバはファイルを丸ごと置き換えるので、
 * どの手調整を保存するときも、保存済みのほかの値(角度・視点を含む)を一緒に渡すこと。
 * 今の sitemap.ts に存在しない結線の端点の角度はここで落とす。
 */
export function buildLayoutFile(
  nodes: LayoutOverrides,
  ports: PortOverrides,
  camera?: CameraTransform,
): SitemapLayoutFile {
  const knownPorts = pickKnownPorts(ports);
  return camera
    ? { nodes, ports: knownPorts, camera }
    : { nodes, ports: knownPorts };
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

  saveLayoutToApi("sitemap", buildLayoutFile(legacy, {})).then(({ ok }) => {
    if (ok) window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  });
}

type SitemapNode = {
  id: number;
  position: { x: number; y: number };
  size: { w: number; h: number };
  children?: SitemapNode[];
};

export function applyLayoutOverrides<T extends SitemapNode>(
  nodes: T[],
  overrides: LayoutOverrides,
): T[] {
  return nodes.map((node) => {
    const override = overrides[node.id];
    return {
      ...node,
      position: override?.position ?? node.position,
      size: override?.size ?? node.size,
      children: node.children
        ? applyLayoutOverrides(node.children as T[], overrides)
        : node.children,
    };
  });
}

type EdgeLike = {
  id: number;
  from: { position: number };
  to: { position: number };
};

/**
 * 保存済みの角度を反映した結線の配列を返す。d3.sitemap は端点の角度を
 * 入力データ(`edge.from.position` / `edge.to.position`)からそのまま読むため、
 * 角度を変えた結線だけ新しいオブジェクトにして SITEMAP_DATA を汚さない。
 */
export function applyPortOverrides<T extends EdgeLike>(
  edges: T[],
  overrides: PortOverrides,
): T[] {
  return edges.map((edge) => {
    const from = overrides[portOverrideKey(edge.id, "from")];
    const to = overrides[portOverrideKey(edge.id, "to")];
    if (from === undefined && to === undefined) return edge;

    return {
      ...edge,
      from: { ...edge.from, position: from ?? edge.from.position },
      to: { ...edge.to, position: to ?? edge.to.position },
    };
  });
}

/**
 * ノードIDから親ノードIDを引くマップを作る。
 *
 * 描画データ(`<g class="node">` の `__data__`)の位置は children も絶対座標に
 * なっているため、保存時に親の絶対座標を引いて相対座標へ戻すのに使う。
 * ルートノードはマップに含めない(相対化の必要がない)。
 */
export function buildParentIdMap<T extends SitemapNode>(
  nodes: T[],
): Map<number, number> {
  const map = new Map<number, number>();
  const walk = (children: SitemapNode[], parentId: number) => {
    for (const child of children) {
      map.set(child.id, parentId);
      if (child.children) walk(child.children, child.id);
    }
  };
  for (const node of nodes) {
    if (node.children) walk(node.children, node.id);
  }
  return map;
}
