// Classesページの手調整(クラスのドラッグ移動・インスペクタでの数値指定)の
// 保存先。web.md §2 により、開発時専用の保存API経由でリポジトリ内ファイル
// (`src/data/layout/classes.json`)に保存する。
import layoutFile from "./layout/classes.json";
import { saveLayoutToApi } from "./layoutSaveApi";

// 旧方式(localStorage)からの一時的な移行処理で使うキー。
// 全環境の移行が済んだら READ_LEGACY 関連ごと削除してよい。
const LEGACY_STORAGE_KEY = "yaoyorozu:classes:layout";

export type NodePosition = { x: number; y: number };

// 物理名(name.physical)をキーにする。d3.classes の class-N は配列順の自動採番で
// 並べ替えに弱いため、位置の保存キーには使わない。
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

  saveLayoutToApi("classes", legacy).then(({ ok }) => {
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
