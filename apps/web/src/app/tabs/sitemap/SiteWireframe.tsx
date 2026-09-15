"use client";

import { useMemo } from "react";
import Box from "@mui/material/Box";
import D3Wireframe, { Rectum } from "@yanqirenshi/d3.wireframe";
import { roleColor } from "@/data/uiDesign";
import { TEXT_STYLE_GROUPS } from "@/data/uiTypography";
import type { Wireframe, WireframeElement } from "@/data/wireframes";

// ワイヤーフレームは取り出したときの表示サイズ(実寸)の座標で持つので、縮めて見せる。
// 図の中はホイールで拡大・ドラッグで移動できる(d3.wireframe の土台の d3.svg の機能)。
const SCALE = 0.7;

// 文字の大きさは基本デザイン「UI-14N-100」に合わせる(規約 §4)。
const LABEL_FONT_SIZE = TEXT_STYLE_GROUPS.flatMap((group) => group.styles).find(
  (style) => style.name === "UI-14N-100",
)!.sizePx;
// ラベルは要素の左上から 余白 sp-3(12px)離し、1行目のベースラインを置く。
const LABEL_POSITION = { x: 12, y: 12 + LABEL_FONT_SIZE };

// 色は役割カラーから引く(規約 §4)。d3.wireframe は色を SVG の属性で塗るため、
// CSS 変数ではなく値で渡す。文字色を渡さないとライブラリの既定(白)になって見えない。
const TEXT_COLOR = roleColor("text.primary");
const STROKE_COLOR = roleColor("border.strong");
const BACKGROUND_BY_TYPE: Record<WireframeElement["type"], string> = {
  frame: roleColor("surface.base"),
  image: roleColor("surface.sunken"),
  button: roleColor("surface.raised"),
  modal: roleColor("surface.raised"),
  dialog: roleColor("surface.raised"),
};

/** 自前の形(src/data/wireframes)を d3.wireframe の入力に変換する。 */
function toLibraryElements(
  elements: WireframeElement[],
  nextId: { value: number },
): unknown[] {
  return elements.map((element) => ({
    id: nextId.value++,
    element_type: element.type,
    rectangle: { w: element.rect.w, h: element.rect.h },
    position: { x: element.rect.x, y: element.rect.y, z: 0 },
    stroke: { color: STROKE_COLOR, width: 1 },
    background: { color: BACKGROUND_BY_TYPE[element.type] },
    labels: element.label
      ? [
          {
            text: element.label,
            position: LABEL_POSITION,
            font: { size: LABEL_FONT_SIZE, color: TEXT_COLOR },
          },
        ]
      : [],
    children: toLibraryElements(element.children ?? [], nextId),
  }));
}

/** サイトの詳細ページに描くワイヤーフレーム。 */
export default function SiteWireframe({ wireframe }: { wireframe: Wireframe }) {
  const { viewport } = wireframe.source;

  const rectum = useMemo(() => {
    const instance = new Rectum({
      // 初期の視点は倍率だけ指定する。d3.svg は x・y を倍率倍してしまうため 0 のままにする。
      transform: { k: SCALE, x: 0, y: 0 },
      grid: { draw: false, size: 10000, span: 100 },
      svg: { style: { background: roleColor("surface.base") } },
    });
    instance.data(toLibraryElements(wireframe.elements, { value: 1 }));
    return instance;
  }, [wireframe]);

  return (
    <Box
      sx={{
        width: "100%",
        maxWidth: viewport.w * SCALE,
        height: viewport.h * SCALE,
        border: "1px solid " + roleColor("border.default"),
      }}
    >
      <D3Wireframe rectum={rectum} />
    </Box>
  );
}
