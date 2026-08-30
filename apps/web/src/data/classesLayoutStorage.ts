const STORAGE_KEY = "yaoyorozu:classes:layout";

export type NodePosition = { x: number; y: number };

// 物理名(name.physical)をキーにする。d3.classes の class-N は配列順の自動採番で
// 並べ替えに弱いため、位置の保存キーには使わない。
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
