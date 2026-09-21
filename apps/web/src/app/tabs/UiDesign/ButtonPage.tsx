"use client";

import Box from "@mui/material/Box";
import {
  BUTTON_ANATOMY,
  BUTTON_ANTIPATTERNS,
  BUTTON_FOCUS,
  BUTTON_KINDS,
  BUTTON_RULES,
  BUTTON_SIZES,
  type ButtonKind,
  type ButtonState,
} from "@/data/uiButton";
import { resolveColor } from "@/data/uiDesign";
import AddButton from "@/components/parts/AddButton";
import EditButton from "@/components/parts/EditButton";
import {
  ButtonContent,
  buttonStaticSx,
} from "@/components/parts/ActionButton";
import { radiusCss, spacePx } from "@/components/tokens";
import FoundationPage, {
  Code,
  Note,
  Para,
  RuleList,
  Sample,
  TokenTable,
  type DocSection,
} from "./FoundationPage";
import { BORDER, TEXT_SECONDARY, textStyle } from "./tokens";

const COMPONENTS: Record<ButtonKind, typeof AddButton> = {
  add: AddButton,
  edit: EditButton,
};

const STATES: { key: ButtonState | "focus"; label: string }[] = [
  { key: "default", label: "通常" },
  { key: "hover", label: "ホバー" },
  { key: "active", label: "押下中" },
  { key: "focus", label: "フォーカス" },
  { key: "disabled", label: "無効" },
];

/** 色の参照を「トークン名 / CSS 変数 / 値」で表示する。 */
function ColorRef({ refName }: { refName: string }) {
  const c = resolveColor(refName);
  return (
    <span className="inline-flex items-center gap-2">
      <Box
        component="span"
        sx={{
          display: "inline-block",
          width: "14px",
          height: "14px",
          borderRadius: "2px",
          border: "1px solid " + BORDER,
          backgroundColor: c.value,
          flexShrink: 0,
        }}
      />
      <span>
        {refName}
        <Box
          component="span"
          sx={{ color: TEXT_SECONDARY, display: "block", fontSize: "12px" }}
        >
          {c.cssVar}
        </Box>
      </span>
    </span>
  );
}

const SECTIONS: DocSection[] = [
  {
    id: "button-definition",
    title: "ボタンとは",
    body: (
      <>
        <Para>
          ボタンは、押すとその場で何かが起きる操作要素である。画面を移動させるものはボタンではなくリンクとして作る。
        </Para>
        <Para>
          いまは「追加」と「変更」の2種類を定義している。
          どちらもアイコンを付けず文字だけのラベルで構成し、強調の度合いだけが違う。
        </Para>
        <Sample caption="追加ボタン(塗り)と変更ボタン(線)。実際に押せる。">
          <div className="flex flex-wrap items-center gap-4">
            <AddButton />
            <EditButton />
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "button-kind",
    title: "種類",
    body: (
      <Para>
        追加は画面の主要な操作として塗りで描き、変更は既存の対象への副次的な操作として線で描く。
        並べたときに「どちらを先に押すべきか」が強調の差だけで読み取れるようにしている。
      </Para>
    ),
    children: BUTTON_KINDS.map((kind) => {
      const Component = COMPONENTS[kind.key];
      return {
        id: "button-kind-" + kind.key,
        title: kind.label + "(" + kind.component + ")",
        body: (
          <>
            <Para>{kind.usage}</Para>
            <Sample surface="base" caption={"small / medium / large の " + kind.label + "。"}>
              <div className="flex flex-wrap items-center gap-4">
                {BUTTON_SIZES.map((size) => (
                  <Component key={size.key} size={size.key} />
                ))}
              </div>
            </Sample>
            <TokenTable
              columns={[
                { key: "state", label: "状態", width: "100px" },
                { key: "bg", label: "背景" },
                { key: "fg", label: "文字" },
                { key: "border", label: "境界" },
              ]}
              rows={(["default", "hover", "active", "disabled"] as ButtonState[]).map(
                (state) => ({
                  state: STATES.find((s) => s.key === state)!.label,
                  bg: <ColorRef refName={kind.colors[state].bg} />,
                  fg: <ColorRef refName={kind.colors[state].fg} />,
                  border: <ColorRef refName={kind.colors[state].border} />,
                }),
              )}
            />
            <Note>
              {kind.contrast}
            </Note>
          </>
        ),
      };
    }),
  },
  {
    id: "button-size",
    title: "サイズ",
    body: (
      <>
        <Para>
          サイズは small / medium / large の3段階。既定は medium である。
          寸法はすべて基本デザインのトークンから採っており、ボタン専用の値は持たない。
        </Para>
        <TokenTable
          columns={[
            { key: "size", label: "サイズ", mono: true, width: "90px" },
            { key: "height", label: "高さ", mono: true, width: "70px" },
            { key: "paddingX", label: "左右の余白", mono: true },
            { key: "text", label: "ラベル", mono: true },
            { key: "radius", label: "角丸", mono: true },
          ]}
          rows={BUTTON_SIZES.map((s) => ({
            size: s.key,
            height: s.heightPx + "px",
            paddingX: s.paddingX + " (" + spacePx(s.paddingX) + "px)",
            text: s.textStyle,
            radius: s.radius + " (" + radiusCss(s.radius) + ")",
          }))}
        />
        <TokenTable
          columns={[
            { key: "size", label: "サイズ", mono: true, width: "90px" },
            { key: "usage", label: "使う場面" },
          ]}
          rows={BUTTON_SIZES.map((s) => ({ size: s.key, usage: s.usage }))}
        />
        <Note>
          small(32px)は、基本デザイン「レイアウト」の操作要素の最小高さ(40px)より低い。
          表やツールバーなど高密度な領域に限って使い、WCAG 2.2 の操作対象サイズ(24px 以上)は満たしている。
        </Note>
      </>
    ),
  },
  {
    id: "button-anatomy",
    title: "構成",
    body: (
      <>
        <Para>ボタンは2つの部位でできている。アイコンは付けない。</Para>
        <Sample caption="番号は下の表と対応する。">
          <div className="flex items-center gap-6">
            <Box sx={{ position: "relative", display: "inline-block" }}>
              <Box component="span" sx={buttonStaticSx("add", "large", "default")}>
                <ButtonContent kind="add" />
              </Box>
              {[
                { no: 1, left: "-10px", top: "-10px" },
                { no: 2, left: "34px", top: "-22px" },
              ].map((mark) => (
                <Box
                  key={mark.no}
                  component="span"
                  sx={{
                    position: "absolute",
                    left: mark.left,
                    top: mark.top,
                    width: "20px",
                    height: "20px",
                    borderRadius: "9999px",
                    backgroundColor: resolveColor("金茶-600").value,
                    color: resolveColor("text.inverse").value,
                    ...textStyle("UI-14M-100"),
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {mark.no}
                </Box>
              ))}
            </Box>
          </div>
        </Sample>
        <TokenTable
          columns={[
            { key: "no", label: "", width: "40px" },
            { key: "name", label: "部位", width: "120px" },
            { key: "description", label: "説明" },
          ]}
          rows={BUTTON_ANATOMY.map((a) => ({
            no: String(a.no),
            name: a.name,
            description: a.description,
          }))}
        />
      </>
    ),
  },
  {
    id: "button-state",
    title: "状態",
    body: (
      <>
        <Para>
          状態は5つ。ホバーと押下中は色を1段ずつ変える(追加は文字が暗いため背景を明るく、変更は境界を濃くする)。無効は墨の階調に落とす。
          フォーカスは{BUTTON_FOCUS.note}
        </Para>
        <Sample surface="base" caption="状態を固定した見本。実際のボタンはポインタとキーボードの操作で切り替わる。">
          <div className="flex flex-col gap-4">
            {BUTTON_KINDS.map((kind) => (
              <div key={kind.key} className="flex flex-wrap items-center gap-4">
                <Box
                  sx={{
                    ...textStyle("Dns-14B-150"),
                    width: "88px",
                    color: TEXT_SECONDARY,
                  }}
                >
                  {kind.label}
                </Box>
                {STATES.map((state) => (
                  <div key={state.key} className="flex flex-col items-center gap-2">
                    <Box
                      component="span"
                      sx={buttonStaticSx(kind.key, "medium", state.key)}
                    >
                      <ButtonContent kind={kind.key} />
                    </Box>
                    <Box
                      sx={{ ...textStyle("Dns-14N-150"), color: TEXT_SECONDARY }}
                    >
                      {state.label}
                    </Box>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Sample>
        <Sample caption="実際に disabled にしたボタン。押しても反応せず、カーソルは操作不可の形になる。">
          <div className="flex flex-wrap items-center gap-4">
            <AddButton disabled />
            <EditButton disabled />
          </div>
        </Sample>
        <TokenTable
          columns={[
            { key: "item", label: "項目", width: "160px" },
            { key: "value", label: "値" },
          ]}
          rows={[
            { item: "フォーカスリングの色", value: <ColorRef refName={BUTTON_FOCUS.color} /> },
            { item: "線の太さ / 離す距離", value: BUTTON_FOCUS.width + " / " + BUTTON_FOCUS.offset },
          ]}
        />
      </>
    ),
  },
  {
    id: "button-rules",
    title: "規則",
    body: <RuleList rules={BUTTON_RULES} />,
  },
  {
    id: "button-antipattern",
    title: "使わない書き方",
    body: (
      <TokenTable
        columns={[
          { key: "pattern", label: "使わない", width: "240px" },
          { key: "problem", label: "起きること" },
          { key: "instead", label: "代わりに" },
        ]}
        rows={BUTTON_ANTIPATTERNS.map((a) => ({
          pattern: a.pattern,
          problem: a.problem,
          instead: a.instead,
        }))}
      />
    ),
  },
  {
    id: "button-implementation",
    title: "実装",
    body: (
      <>
        <Para>
          apps/web では <Code>src/components/parts/</Code> のコンポーネントを使う。
          見た目は <Code>src/data/uiButton.ts</Code> の仕様だけから決まり、コンポーネントは値を持たない。
        </Para>
        <Sample surface="sunken">
          <Box
            sx={{
              ...textStyle("Mono-14N-150"),
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              whiteSpace: "pre-wrap",
            }}
          >
            {'import AddButton from "@/components/parts/AddButton";\n' +
              'import EditButton from "@/components/parts/EditButton";\n\n' +
              '<AddButton label="プロファイルを追加" onClick={add} />\n' +
              '<EditButton size="small" onClick={edit} />'}
          </Box>
        </Sample>
        <TokenTable
          columns={[
            { key: "prop", label: "props", mono: true, width: "120px" },
            { key: "type", label: "型", mono: true, width: "240px" },
            { key: "note", label: "説明" },
          ]}
          rows={[
            { prop: "size", type: '"small" | "medium" | "large"', note: "既定は medium。" },
            { prop: "label", type: "string", note: "既定は「追加」「変更」。対象が周囲から分からないときは対象を含めて書く。" },
            { prop: "disabled", type: "boolean", note: "操作できないとき。disabled 属性として出力する。" },
            { prop: "type", type: '"button" | "submit"', note: "既定は button。フォームの送信だけ submit にする。" },
            { prop: "onClick", type: "(event) => void", note: "" },
          ]}
        />
        <Note>
          apps/native など MUI を使わない実装では、上の「種類」の表にある CSS 変数(tokens.css)を参照して同じ見た目を作る。
          値を書き写さず、変数名で参照すること。
        </Note>
      </>
    ),
  },
];

export default function ButtonPage() {
  return (
    <FoundationPage
      title="ボタン"
      lead={
        <>
          <Para>
            ボタンは、画面の中で最も多く押される部品である。
            同じ操作が画面ごとに違う見た目をしていると、押す前に確かめる時間が毎回かかる。
          </Para>
          <Para>
            そのため、操作の種類ごとに見た目を1つに決める。
            追加は塗り、変更は線、という対応を全画面で守る。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
