import type { UnchiData, UnchiEdge, UnchiNodeInput } from "@yanqirenshi/d3.unchi";
import { roleColor } from "@/data/uiDesign";

/**
 * `{リポジトリ}/yyz/spec/unchi.json` の形(#548)。`UnchiData`(`@yanqirenshi/d3.unchi`
 * の入力形)とほぼ同じだが、エッジの線の色は生の色コードではなく、デザイントークンの
 * 役割名(`roleColor` のキー。`src/data/uiDesign.ts`)で持つ。デザイントークンが変わった
 * ときに追従できるようにするため、生の色コードを仕様データに焼き込まない。
 */
export type UnchiSpec = {
  nodes: UnchiNodeInput[];
  edges: (Omit<UnchiEdge, "stroke"> & {
    stroke?: { colorRole: string; width?: number } | null;
  })[];
};

/** `yyz/spec/unchi.json` を読んだ後、`UnchiData`(d3.unchi の入力形)へ組み立てる。 */
export function buildUnchiData(spec: UnchiSpec): UnchiData {
  return {
    nodes: spec.nodes,
    edges: spec.edges.map((edge) => {
      const { stroke, ...rest } = edge;
      return {
        ...rest,
        stroke: stroke ? { color: roleColor(stroke.colorRole), width: stroke.width } : undefined,
      };
    }),
  };
}
