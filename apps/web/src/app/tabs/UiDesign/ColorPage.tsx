"use client";

import Box from "@mui/material/Box";
import {
  COLOR_PALETTE,
  COLOR_SCALES,
  FUNCTIONAL_COLORS,
  KEY_COLORS,
  SEMANTIC_COLORS,
  SURFACE_BASE_HEX,
  SURFACE_COLORS,
  TEXT_COLORS,
  type RoleColor,
} from "@/data/uiDesign";
import FoundationPage, {
  Bullets,
  Code,
  Note,
  Para,
  Sample,
  TokenTable,
  type DocSection,
} from "./FoundationPage";
import { BORDER, TEXT_SECONDARY, textStyle } from "./tokens";

/** 色見本。 */
function Swatch({ value, size = 40 }: { value: string; size?: number }) {
  return (
    <Box
      sx={{
        width: size + "px",
        height: size + "px",
        flexShrink: 0,
        borderRadius: "4px",
        backgroundColor: value,
        border: "1px solid " + BORDER,
      }}
    />
  );
}

/** コントラスト比の判定バッジ。 */
function ContrastBadge({ ratio }: { ratio?: number }) {
  if (ratio === undefined) return <span>—</span>;
  const level =
    ratio >= 4.5 ? "本文可" : ratio >= 3 ? "大文字・UI可" : "文字には不可";
  return (
    <span>
      {ratio.toFixed(2)}:1
      <Box
        component="span"
        sx={{ ...textStyle("Body-14N-170"), color: TEXT_SECONDARY, ml: "4px" }}
      >
        ({level})
      </Box>
    </span>
  );
}

function roleRows(colors: RoleColor[]) {
  return colors.map((color) => ({
    swatch: <Swatch value={color.value} size={24} />,
    token: color.token,
    label: color.label,
    value: color.value,
    source: color.source,
    contrast: <ContrastBadge ratio={color.contrast} />,
    usage: color.usage,
  }));
}

const ROLE_COLUMNS = [
  { key: "swatch", label: "", width: "40px" },
  { key: "token", label: "トークン", mono: true, width: "190px" },
  { key: "label", label: "名称", width: "150px" },
  { key: "value", label: "値", mono: true, width: "180px" },
  { key: "source", label: "由来", width: "110px" },
  { key: "contrast", label: "真珠に対する比", width: "150px" },
  { key: "usage", label: "用途" },
];

const SECTIONS: DocSection[] = [
  {
    id: "color-key",
    title: "キーカラー",
    body: (
      <>
        <Para>
          サービスの性格を決める4色。日本の伝統色から採っており、京紫を主色、金茶を副色、草色を第3色、真珠を地の色とする。
          この4色の関係を崩さないことが、YAOYOROZU の見た目の一貫性を保つ最低条件となる。
        </Para>
        <TokenTable columns={ROLE_COLUMNS} rows={roleRows(KEY_COLORS)} />
        <Sample caption="配色比率の目安。京紫35% / 金茶10% / 草色5% / 真珠50%。">
          <Box
            className="flex h-6 w-full overflow-hidden rounded"
            sx={{ border: "1px solid " + BORDER }}
          >
            {COLOR_PALETTE.filter((color) => color.ratio !== undefined).map(
              (color) => (
                <div
                  key={color.name}
                  style={{
                    backgroundColor: color.hex,
                    width: color.ratio + "%",
                  }}
                />
              ),
            )}
          </Box>
        </Sample>
        <Note>
          比率は「塗る面積」ではなく「印象の量」の目安である。実際の画面では真珠が地としてほとんどの面積を占め、京紫は選択状態や見出しの下線など、視線が向かう箇所に集中して現れる。
        </Note>
      </>
    ),
  },
  {
    id: "color-primitive",
    title: "プリミティブカラー",
    body: (
      <>
        <Para>
          キーカラーの色相と彩度を保ったまま明度を10段階に割り当てたもの。役割カラーはすべてこのスケールから選ぶ。
          スケールにない色を新たに持ち込まないことで、画面が増えても配色が発散しない。
        </Para>
        <Para>
          段階の数値が大きいほど暗い。ブランドカラーそのものは、もっとも明度の近い段階に配置している(表の
          <Code>基準</Code> 印)。比率は地の色である真珠 <Code>{SURFACE_BASE_HEX}</Code>{" "}
          に対するコントラスト比で、4.5:1 以上が本文に、3:1 以上が大きな文字・境界・アイコンに使える。
        </Para>
      </>
    ),
    children: COLOR_SCALES.map((scale) => ({
      id: "color-primitive-" + scale.name,
      title: scale.name + "(" + scale.reading + ") / " + scale.role,
      body: (
        <>
          <Para>{scale.description}</Para>
          <Sample surface="base">
            <div className="flex w-full overflow-hidden rounded">
              {scale.tones.map((t) => (
                <div
                  key={t.step}
                  className="flex h-16 flex-1 items-end justify-center pb-1"
                  style={{ backgroundColor: t.hex }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      color: t.contrast >= 4.5 ? "#ffffff" : "#373737",
                    }}
                  >
                    {t.step}
                  </span>
                </div>
              ))}
            </div>
          </Sample>
          <TokenTable
            columns={[
              { key: "swatch", label: "", width: "40px" },
              { key: "step", label: "段階", mono: true },
              { key: "hex", label: "値", mono: true },
              { key: "contrast", label: "真珠に対する比" },
              { key: "note", label: "" },
            ]}
            rows={scale.tones.map((t) => ({
              swatch: <Swatch value={t.hex} size={24} />,
              step: scale.name + "-" + t.step,
              hex: t.hex,
              contrast: <ContrastBadge ratio={t.contrast} />,
              note: t.isBase ? "基準(ブランドカラー)" : "",
            }))}
          />
        </>
      ),
    })),
  },
  {
    id: "color-text",
    title: "文字色",
    body: (
      <>
        <Para>
          文字はすべて墨のスケールから採る。彩度を持たないため、どの面の上でも色が濁らない。
          本文は墨-900、補足は墨-700 の2段階で足りる。3段階目を足したくなったときは、色ではなく余白か配置で階層を作れないかを先に検討する。
        </Para>
        <TokenTable columns={ROLE_COLUMNS} rows={roleRows(TEXT_COLORS)} />
        <Sample>
          <Box sx={{ ...textStyle("Body-16N-170"), mb: "8px" }}>
            本文(墨-900)。読ませることを目的とした文章に使う。
          </Box>
          <Box
            sx={{
              ...textStyle("Body-14N-170"),
              color: TEXT_SECONDARY,
              mb: "8px",
            }}
          >
            副次テキスト(墨-700)。補足・キャプション・メタ情報。
          </Box>
          <Box
            sx={{
              ...textStyle("Body-14N-170"),
              color: TEXT_COLORS.find((c) => c.token === "text.disabled")!
                .value,
            }}
          >
            無効(墨-400)。操作できないことを示すが、色だけに意味を持たせない。
          </Box>
        </Sample>
      </>
    ),
  },
  {
    id: "color-surface",
    title: "面と境界",
    body: (
      <>
        <Para>
          面の高低は、影ではなく明るさで表す。地の面は真珠、その上に浮く面は白。逆に、奥に沈めたい領域(入力欄・コードブロック)は墨-50 を使う。
          境界は「区切るための線」と「要素の存在を伝える線」で強さを分ける。
        </Para>
        <TokenTable columns={ROLE_COLUMNS} rows={roleRows(SURFACE_COLORS)} />
        <Sample surface="base" caption="地の面(真珠)の上に、浮いた面(白)と沈んだ面(墨-50)を置いた状態。">
          <div className="flex flex-wrap gap-4">
            <Box
              sx={{
                backgroundColor: "#ffffff",
                border: "1px solid " + BORDER,
                borderRadius: "8px",
                p: "16px",
                ...textStyle("Body-14N-170"),
              }}
            >
              浮いた面(surface.raised)
            </Box>
            <Box
              sx={{
                backgroundColor: SURFACE_COLORS.find(
                  (c) => c.token === "surface.sunken",
                )!.value,
                border: "1px solid " + BORDER,
                borderRadius: "8px",
                p: "16px",
                ...textStyle("Body-14N-170"),
              }}
            >
              沈んだ面(surface.sunken)
            </Box>
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "color-functional",
    title: "機能カラー",
    body: (
      <>
        <Para>
          リンク・フォーカス・ホバー・選択など、操作に対する反応を表す色。
          ホバーと選択は京紫の透過で表現し、下地の色を問わず同じ見え方になるようにしている。
        </Para>
        <TokenTable columns={ROLE_COLUMNS} rows={roleRows(FUNCTIONAL_COLORS)} />
        <Sample caption="メニュー項目の3状態。左から通常・ホバー・選択中。">
          <div className="flex flex-col gap-1" style={{ width: "240px" }}>
            {[
              { label: "通常", bg: "transparent" },
              {
                label: "ホバー",
                bg: FUNCTIONAL_COLORS.find((c) => c.token === "state.hover")!
                  .value,
              },
              {
                label: "選択中",
                bg: FUNCTIONAL_COLORS.find((c) => c.token === "state.selected")!
                  .value,
              },
            ].map((row) => (
              <Box
                key={row.label}
                sx={{
                  ...textStyle("UI-16M-100"),
                  backgroundColor: row.bg,
                  borderRadius: "4px",
                  px: "12px",
                  py: "10px",
                }}
              >
                {row.label}
              </Box>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "color-semantic",
    title: "セマンティックカラー",
    body: (
      <>
        <Para>
          状態を伝える色。前景(文字・アイコン)、背景、境界の3点を組にして定義し、単体の色として使わない。
          前景は真珠に対して 4.5:1 以上、境界は 3:1 以上を満たしている。
        </Para>
        <TokenTable
          columns={[
            { key: "token", label: "トークン", mono: true },
            { key: "label", label: "名称" },
            { key: "fg", label: "前景", mono: true },
            { key: "bg", label: "背景", mono: true },
            { key: "border", label: "境界", mono: true },
            { key: "contrast", label: "前景の比" },
            { key: "usage", label: "用途" },
          ]}
          rows={SEMANTIC_COLORS.map((color) => ({
            token: color.token,
            label: color.label,
            fg: color.fg,
            bg: color.bg,
            border: color.border,
            contrast: <ContrastBadge ratio={color.contrast} />,
            usage: color.usage,
          }))}
        />
        <Sample surface="base" caption="3点セットで組み立てた通知の作例。">
          <div className="flex flex-col gap-3">
            {SEMANTIC_COLORS.map((color) => (
              <Box
                key={color.token}
                sx={{
                  ...textStyle("Body-14N-170"),
                  color: color.fg,
                  backgroundColor: color.bg,
                  border: "1px solid " + color.border,
                  borderRadius: "8px",
                  px: "16px",
                  py: "12px",
                }}
              >
                <strong>{color.label}</strong>: {color.usage}
              </Box>
            ))}
          </div>
        </Sample>
        <Note>
          蘇芳(エラー)は京紫と色相が近い。色の判別が難しい環境では区別できないため、エラーは必ずアイコンと文言を伴わせる。
        </Note>
      </>
    ),
  },
  {
    id: "color-accessibility",
    title: "コントラストの確保",
    body: (
      <>
        <Para>
          コントラスト比はすべて地の色である真珠に対して算出している。白の上ではこれよりわずかに高くなるため、真珠で満たしていれば白でも満たす。
        </Para>
        <Bullets
          items={[
            "本文・14pxのテキストは 4.5:1 以上(WCAG 2.2 達成基準 1.4.3)。",
            "24px 以上、または 18.5px 以上の太字は 3:1 以上。",
            "入力欄の境界、アイコン、グラフの線など、意味を持つ図形は 3:1 以上(達成基準 1.4.11)。",
            "無効状態の要素はコントラスト要件の対象外だが、無効であることを色以外(カーソル形状・文言)でも伝える。",
            "情報を色だけで伝えない(達成基準 1.4.1)。状態には必ずアイコン・文言・形状のいずれかを添える。",
          ]}
        />
        <Para>
          金茶-600(3.15:1)と草色-600(3.54:1)は、本文の文字色としては使えない。
          文字に使う場合は金茶-700 以上、草色-800 以上を選ぶ。
        </Para>
      </>
    ),
  },
];

export default function ColorPage() {
  return (
    <FoundationPage
      title="カラー"
      lead={
        <>
          <Para>
            YAOYOROZU の配色は、日本の伝統色から採った5色を基準とする。
            5色をそのまま使うのではなく、明度を10段階に展開したトーンスケールを作り、そこから役割ごとの色(文字・面・境界・状態・意味)を割り当てる。
          </Para>
          <Para>
            画面に色を足したくなったときは、まずこのページのスケールに該当する色がないかを探す。
            スケールにない色を持ち込むのは、意味が既存のどれとも重ならないと確認できたときだけとする。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
