"use client";

import Box from "@mui/material/Box";
import {
  ICON_DRAWING_SPEC,
  ICON_RULES,
  ICON_SAMPLES,
  ICON_SIZES,
} from "@/data/uiIcon";
import FoundationPage, {
  Code,
  Note,
  Para,
  RuleList,
  Sample,
  TokenTable,
  type DocSection,
} from "./FoundationPage";
import { BORDER, BORDER_STRONG, TEXT_SECONDARY, textStyle } from "./tokens";

/**
 * アイコンの描画。
 * パスは src/data/uiIcon.ts が持つ図形データであり、
 * 共通仕様(ビューボックス・線幅・線端)はここで一括して与える。
 */
function Icon({ body, size = 20 }: { body: string; size?: number }) {
  return (
    <svg
      viewBox={ICON_DRAWING_SPEC.viewBox}
      width={size}
      height={size}
      fill={ICON_DRAWING_SPEC.fill}
      stroke={ICON_DRAWING_SPEC.stroke}
      strokeWidth={ICON_DRAWING_SPEC.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}

const RELOAD = ICON_SAMPLES.find((i) => i.key === "reload")!;
const EXTERNAL = ICON_SAMPLES.find((i) => i.key === "external-link")!;
const SETTINGS = ICON_SAMPLES.find((i) => i.key === "settings")!;

const SECTIONS: DocSection[] = [
  {
    id: "icon-spec",
    title: "作図の仕様",
    body: (
      <>
        <Para>
          アイコンは 20×20 のビューボックスに、線幅 1.7 の線で描く。塗りは持たず、色は
          <Code>currentColor</Code> で親から継承する。
          この仕様は apps/native のドック用アイコンと同一であり、ネイティブアプリと Webアプリで同じ図形をそのまま使い回せる。
        </Para>
        <TokenTable
          columns={[
            { key: "item", label: "項目", width: "200px" },
            { key: "value", label: "値", mono: true },
          ]}
          rows={[
            { item: "ビューボックス", value: ICON_DRAWING_SPEC.viewBox },
            { item: "線幅", value: String(ICON_DRAWING_SPEC.strokeWidth) },
            { item: "線端 / 線の結合", value: "round / round" },
            { item: "塗り", value: ICON_DRAWING_SPEC.fill },
            { item: "線の色", value: ICON_DRAWING_SPEC.stroke },
            { item: "図形を収める領域", value: ICON_DRAWING_SPEC.liveArea },
          ]}
        />
        <Sample caption="20×20 のビューボックスと、外周1pxを空けた 18×18 の描画領域。">
          <div className="flex items-center gap-6">
            <Box
              sx={{
                position: "relative",
                width: "160px",
                height: "160px",
                border: "1px solid " + BORDER,
                borderRadius: "4px",
              }}
            >
              <Box
                sx={{
                  position: "absolute",
                  inset: "8px",
                  border: "1px dashed " + BORDER_STRONG,
                }}
              />
              <Box sx={{ position: "absolute", inset: 0 }}>
                <svg
                  viewBox={ICON_DRAWING_SPEC.viewBox}
                  width="160"
                  height="160"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={ICON_DRAWING_SPEC.strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: SETTINGS.body }}
                />
              </Box>
            </Box>
            <Box sx={{ ...textStyle("Body-14N-170"), color: TEXT_SECONDARY }}>
              破線が 18×18 の描画領域。
              <br />
              線は領域の内側で閉じ、外周1pxには描かない。
            </Box>
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "icon-size",
    title: "種類の定義",
    body: (
      <>
        <Para>
          アイコンは「何と並ぶか」で4種類に分ける。サイズだけを決めても、隣に置く文字が変われば行の高さが揃わないため、
          併記するテキストスタイルまで含めて定義する。
        </Para>
        <TokenTable
          columns={[
            { key: "sample", label: "", width: "56px" },
            { key: "token", label: "トークン", mono: true },
            { key: "px", label: "サイズ", mono: true },
            { key: "label", label: "名称" },
            { key: "pairedText", label: "併記するテキスト", mono: true },
            { key: "usage", label: "用途" },
          ]}
          rows={ICON_SIZES.map((s) => ({
            sample: <Icon body={RELOAD.body} size={s.px} />,
            token: s.token,
            px: s.px + "px",
            label: s.label,
            pairedText: s.pairedText,
            usage: s.usage,
          }))}
        />
      </>
    ),
    children: [
      {
        id: "icon-inline",
        title: "行ボックスのアイコン",
        body: (
          <>
            <Para>
              文章やラベルの行の中に置くアイコン。大きさは <Code>1em</Code>{" "}
              とし、文字サイズに追従させる。ベースラインに対しては光学的に{" "}
              <Code>vertical-align: -0.15em</Code> で揃え、テキストとの間隔は sp-1(4px)を空ける。
            </Para>
            <Sample caption="行内アイコンの例。文字サイズが変わってもアイコンが追従する。">
              <div className="flex flex-col gap-3">
                {[16, 14].map((size) => (
                  <Box key={size} sx={{ fontSize: size + "px", lineHeight: "170%" }}>
                    デジタル庁デザインシステム
                    <Box
                      component="span"
                      sx={{
                        display: "inline-block",
                        width: "1em",
                        height: "1em",
                        verticalAlign: "-0.15em",
                        ml: "4px",
                      }}
                    >
                      <Icon body={EXTERNAL.body} size={size} />
                    </Box>
                    を参照する({size}px の行)。
                  </Box>
                ))}
              </div>
            </Sample>
          </>
        ),
      },
      {
        id: "icon-block",
        title: "ブロックレベルボックスのアイコン",
        body: (
          <>
            <Para>
              ラベルを持たず、単独で操作を表すアイコン。見た目は 20〜24px でも、クリック領域は 40×40 以上を確保する。
              領域はアイコンを大きくするのではなく、パディングで広げる。
            </Para>
            <Sample caption="左: クリック領域 40×40(適切)。右: アイコンの大きさのまま(領域が足りない)。">
              <div className="flex items-center gap-8">
                <Box
                  sx={{
                    width: "40px",
                    height: "40px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px dashed " + BORDER_STRONG,
                    borderRadius: "4px",
                  }}
                >
                  <Icon body={SETTINGS.body} size={20} />
                </Box>
                <Box
                  sx={{
                    width: "20px",
                    height: "20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px dashed " + BORDER_STRONG,
                  }}
                >
                  <Icon body={SETTINGS.body} size={20} />
                </Box>
              </div>
            </Sample>
          </>
        ),
      },
    ],
  },
  {
    id: "icon-set",
    title: "標準アイコン",
    body: (
      <>
        <Para>
          現在定義しているアイコン。新しいアイコンが必要になったら、既存のどれかで代用できないかを先に確認し、
          代用できない場合だけ同じ仕様で描き足してこのページに追加する。
        </Para>
        <Sample surface="base">
          <div className="flex flex-wrap gap-4">
            {ICON_SAMPLES.map((icon) => (
              <Box
                key={icon.key}
                sx={{
                  width: "120px",
                  border: "1px solid " + BORDER,
                  borderRadius: "8px",
                  p: "12px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "8px",
                  backgroundColor: "#ffffff",
                }}
              >
                <Icon body={icon.body} size={24} />
                <Box sx={{ ...textStyle("Dns-14N-150"), textAlign: "center" }}>
                  {icon.label}
                </Box>
                <Box
                  sx={{
                    ...textStyle("Mono-14N-150"),
                    fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                    color: TEXT_SECONDARY,
                    fontSize: "12px",
                  }}
                >
                  {icon.key}
                </Box>
              </Box>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "icon-rules",
    title: "運用ルール",
    body: (
      <>
        <RuleList rules={ICON_RULES} />
        <Note>
          アイコンの色は親から継承するため、無効状態のボタンの中では文字と一緒に薄くなる。
          アイコンだけに色を直接指定すると、状態が変わったときにラベルとアイコンの色がずれる。
        </Note>
      </>
    ),
  },
];

export default function IconPage() {
  return (
    <FoundationPage
      title="アイコン"
      lead={
        <>
          <Para>
            アイコンは文字の代わりではなく、文字を探す時間を短くするための目印である。
            意味が一目で通じるものだけをアイコンにし、通じないものはラベルで書く。
          </Para>
          <Para>
            YAOYOROZU では、線画のアイコンをひとつの仕様(20×20 / 線幅1.7 / currentColor)に統一している。
            仕様を揃えることで、ネイティブアプリと Webアプリのどちらに置いても同じ密度・同じ濃さで見える。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
