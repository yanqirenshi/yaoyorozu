"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import {
  TAB_ANATOMY,
  TAB_ANTIPATTERNS,
  TAB_BAR,
  TAB_COLORS,
  TAB_CONTRAST,
  TAB_FOCUS,
  TAB_INDICATOR,
  TAB_KEYBOARD,
  TAB_LABEL,
  TAB_RULES,
  TAB_SIZES,
  TAB_STATE_LABELS,
  type TabSize,
  type TabState,
} from "@/data/uiTab";
import Tabs, {
  TabLabel,
  tabStaticSx,
  type TabItem,
} from "@/components/parts/Tabs";
import { spacePx } from "@/components/tokens";
import FoundationPage, {
  Code,
  Note,
  Para,
  RuleList,
  Sample,
  TokenTable,
  type DocSection,
} from "./FoundationPage";
import ColorRef from "./ColorRef";
import { BORDER, SURFACE_RAISED, TEXT_SECONDARY, textStyle } from "./tokens";

const DEMO_ITEMS: TabItem[] = [
  { key: "diagram", label: "図" },
  { key: "wbs", label: "WBS" },
  { key: "settings", label: "設定" },
  { key: "history", label: "履歴", disabled: true },
];

const LONG_ITEMS: TabItem[] = [
  { key: "a", label: "CLAUDE.md" },
  { key: "b", label: "settings.json" },
  { key: "c", label: "settings.local.json" },
  { key: "d", label: "とても長い名前のタブはこのように末尾が省略される" },
  { key: "e", label: "rules" },
  { key: "f", label: "skills" },
  { key: "g", label: "agents" },
];

/** 実際に切り替えられるタブの作例。 */
function TabsDemo({
  items,
  size,
  label,
}: {
  items: TabItem[];
  size: TabSize;
  label: string;
}) {
  const [value, setValue] = useState(items[0].key);
  const current = items.find((i) => i.key === value);
  return (
    <div>
      <Tabs
        items={items}
        value={value}
        onChange={setValue}
        size={size}
        aria-label={label}
        idPrefix={"demo-" + size + "-" + items.length}
      />
      <Box
        role="tabpanel"
        id={"demo-" + size + "-" + items.length + "-panel-" + value}
        aria-labelledby={"demo-" + size + "-" + items.length + "-tab-" + value}
        sx={{ ...textStyle("Body-14N-170"), color: TEXT_SECONDARY, p: "16px" }}
      >
        「{current?.label}」の内容が表示される領域
      </Box>
    </div>
  );
}

const STATES: (TabState | "focus")[] = [
  "default",
  "hover",
  "active",
  "selected",
  "selectedHover",
  "focus",
  "disabled",
];

const SECTIONS: DocSection[] = [
  {
    id: "tab-definition",
    title: "タブとは",
    body: (
      <>
        <Para>
          タブは、同じ領域の中に表示する内容を切り替える部品である。
          選んだタブの下に草色の下線が付き、その下の領域の内容が入れ替わる。
          画面そのものを移動するときはタブではなく、リンクやメニューを使う。
        </Para>
        <Sample caption="実際に切り替えられる。「履歴」は無効の例。キーボードでは ← → で移動し、Enter / Space で選択する。">
          <TabsDemo items={DEMO_ITEMS} size="medium" label="作例の切り替え" />
        </Sample>
      </>
    ),
  },
  {
    id: "tab-size",
    title: "サイズ",
    body: (
      <>
        <Para>
          サイズは small / medium の2段階。既定は medium である。
          apps/web の画面上部の切り替えは medium、apps/native のペインの中の切り替えは small を想定している。
        </Para>
        <TokenTable
          columns={[
            { key: "size", label: "サイズ", mono: true, width: "90px" },
            { key: "height", label: "高さ", mono: true, width: "70px" },
            { key: "paddingX", label: "左右の余白", mono: true },
            { key: "text", label: "ラベル", mono: true },
            { key: "usage", label: "使う場面" },
          ]}
          rows={TAB_SIZES.map((s) => ({
            size: s.key,
            height: s.heightPx + "px",
            paddingX: s.paddingX + " (" + spacePx(s.paddingX) + "px)",
            text: s.textStyle,
            usage: s.usage,
          }))}
        />
        <Sample surface="base" caption="small と medium。">
          <div className="flex flex-col gap-4">
            {(["small", "medium"] as TabSize[]).map((size) => (
              <Box
                key={size}
                sx={{ border: "1px solid " + BORDER, borderRadius: "8px", backgroundColor: SURFACE_RAISED }}
              >
                <TabsDemo items={DEMO_ITEMS.slice(0, 3)} size={size} label={size + " の作例"} />
              </Box>
            ))}
          </div>
        </Sample>
        <TokenTable
          columns={[
            { key: "item", label: "タブ列", width: "160px" },
            { key: "value", label: "値", mono: true, width: "220px" },
            { key: "note", label: "備考" },
          ]}
          rows={[
            { item: "下罫線", value: <ColorRef refName={TAB_BAR.border} />, note: "1px。" + TAB_BAR.note },
            { item: "タブの間隔", value: TAB_BAR.gap + " (" + spacePx(TAB_BAR.gap) + "px)", note: "" },
            { item: "左右の余白", value: TAB_BAR.paddingX + " (" + spacePx(TAB_BAR.paddingX) + "px)", note: "" },
          ]}
        />
      </>
    ),
  },
  {
    id: "tab-color",
    title: "色と状態",
    body: (
      <>
        <Para>
          選択色は草色。選択中のタブは、文字を草色-800、下線を草色-600 の {TAB_INDICATOR.heightPx}px で示す。
          草色-700 以下の明るい段階は、文字として本文の基準(4.5:1)に届かないため使わない。
          ホバーと押下中は、背景を草色のごく薄い段階(50 / 100)で塗る。
        </Para>
        <TokenTable
          columns={[
            { key: "state", label: "状態", width: "140px" },
            { key: "bg", label: "背景" },
            { key: "fg", label: "文字" },
            { key: "contrast", label: "文字のコントラスト", width: "200px" },
          ]}
          rows={(Object.keys(TAB_COLORS) as TabState[]).map((state) => ({
            state: TAB_STATE_LABELS[state],
            bg: <ColorRef refName={TAB_COLORS[state].bg} />,
            fg: <ColorRef refName={TAB_COLORS[state].fg} />,
            contrast: TAB_CONTRAST[state],
          }))}
        />
        <TokenTable
          columns={[
            { key: "item", label: "項目", width: "160px" },
            { key: "value", label: "値" },
            { key: "note", label: "備考" },
          ]}
          rows={[
            {
              item: "インジケータ",
              value: <ColorRef refName={TAB_INDICATOR.color} />,
              note: TAB_INDICATOR.heightPx + "px。" + TAB_INDICATOR.contrast + "。" + TAB_INDICATOR.note,
            },
            {
              item: "フォーカスリング",
              value: <ColorRef refName={TAB_FOCUS.color} />,
              note: TAB_FOCUS.width + "、offset " + TAB_FOCUS.offset + "。" + TAB_FOCUS.note,
            },
          ]}
        />
        <Sample surface="base" caption="状態を固定した見本。実際のタブはポインタとキーボードの操作で切り替わる。">
          <div className="flex flex-wrap items-end gap-4">
            {STATES.map((state) => (
              <div key={state} className="flex flex-col items-center gap-2">
                <Box
                  sx={{
                    boxShadow: "inset 0 -1px 0 " + BORDER,
                    backgroundColor: SURFACE_RAISED,
                    px: "4px",
                  }}
                >
                  <Box component="span" sx={tabStaticSx("medium", state)}>
                    <TabLabel label="設定" />
                  </Box>
                </Box>
                <Box sx={{ ...textStyle("Dns-14N-150"), color: TEXT_SECONDARY }}>
                  {state === "focus" ? "フォーカス" : TAB_STATE_LABELS[state]}
                </Box>
              </div>
            ))}
          </div>
        </Sample>
        <Note>
          太さは全状態で UI テキストの M(500)のまま変えない。選択中だけ太字にすると、タブの幅が変わって並びが揺れる。
        </Note>
      </>
    ),
  },
  {
    id: "tab-anatomy",
    title: "構成",
    body: (
      <TokenTable
        columns={[
          { key: "no", label: "", width: "40px" },
          { key: "name", label: "部位", width: "120px" },
          { key: "description", label: "説明" },
        ]}
        rows={TAB_ANATOMY.map((a) => ({
          no: String(a.no),
          name: a.name,
          description: a.description,
        }))}
      />
    ),
  },
  {
    id: "tab-label",
    title: "長いラベルと本数が多いとき",
    body: (
      <>
        <Para>
          {TAB_LABEL.note}
          タブが領域に収まらないときは、折り返さず横スクロールにする。
        </Para>
        <Sample caption="幅の狭い領域に7本のタブを置いた例。4本目は長いラベルが省略され、全体は横スクロールできる。">
          <Box sx={{ maxWidth: "480px", border: "1px solid " + BORDER, borderRadius: "8px" }}>
            <TabsDemo items={LONG_ITEMS} size="small" label="長いラベルの作例" />
          </Box>
        </Sample>
      </>
    ),
  },
  {
    id: "tab-keyboard",
    title: "キーボード操作",
    body: (
      <>
        <Para>
          WAI-ARIA の Tabs パターンに従う。矢印キーでフォーカスを移し、Enter / Space で選択する(フォーカスの移動だけでは選択しない)。
          切り替えに時間がかかる内容や、未保存の編集を持つ内容でも、意図しない切り替えが起きないようにするためである。
        </Para>
        <TokenTable
          columns={[
            { key: "key", label: "キー", mono: true, width: "160px" },
            { key: "action", label: "動作" },
          ]}
          rows={TAB_KEYBOARD.map((k) => ({ key: k.key, action: k.action }))}
        />
      </>
    ),
  },
  {
    id: "tab-rules",
    title: "規則",
    body: <RuleList rules={TAB_RULES} />,
  },
  {
    id: "tab-antipattern",
    title: "使わない書き方",
    body: (
      <TokenTable
        columns={[
          { key: "pattern", label: "使わない", width: "240px" },
          { key: "problem", label: "起きること" },
          { key: "instead", label: "代わりに" },
        ]}
        rows={TAB_ANTIPATTERNS.map((a) => ({
          pattern: a.pattern,
          problem: a.problem,
          instead: a.instead,
        }))}
      />
    ),
  },
  {
    id: "tab-implementation",
    title: "実装",
    body: (
      <>
        <Para>
          apps/web では <Code>src/components/parts/Tabs.tsx</Code> を使う。
          キーボード操作と ARIA 属性は MUI の Tabs が持ち、見た目は <Code>src/data/uiTab.ts</Code> の仕様だけから決まる。
          選択中の値は部品が持たず、親から受け取る。
        </Para>
        <Sample surface="sunken">
          <Box
            sx={{
              ...textStyle("Mono-14N-150"),
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              whiteSpace: "pre-wrap",
            }}
          >
            {'import Tabs from "@/components/parts/Tabs";\n\n' +
              "<Tabs\n" +
              '  aria-label="表示の切り替え"\n' +
              "  items={[{ key: \"diagram\", label: \"図\" }, { key: \"wbs\", label: \"WBS\" }]}\n" +
              "  value={tab}\n" +
              "  onChange={setTab}\n" +
              '  idPrefix="diagram"\n' +
              "/>"}
          </Box>
        </Sample>
        <TokenTable
          columns={[
            { key: "prop", label: "props", mono: true, width: "120px" },
            { key: "type", label: "型", mono: true, width: "260px" },
            { key: "note", label: "説明" },
          ]}
          rows={[
            { prop: "items", type: "{ key, label, disabled? }[]", note: "タブの並び。" },
            { prop: "value", type: "string", note: "選択中のタブの key。" },
            { prop: "onChange", type: "(key: string) => void", note: "タブが選ばれたとき。" },
            { prop: "size", type: '"small" | "medium"', note: "既定は medium。" },
            { prop: "aria-label", type: "string", note: "何を切り替えるタブか。必須。" },
            { prop: "idPrefix", type: "string", note: "指定するとタブとパネルを id で結ぶ(タブ: {idPrefix}-tab-{key} / パネル: {idPrefix}-panel-{key})。" },
          ]}
        />
        <Note>
          apps/native など MUI を使わない実装では、<Code>{'role="tablist"'}</Code> / <Code>{'role="tab"'}</Code> /{" "}
          <Code>aria-selected</Code> とキーボード操作を自前で持たせ、
          色は上の表の CSS 変数(tokens.css)で参照する。値を書き写さないこと。
        </Note>
      </>
    ),
  },
];

export default function TabPage() {
  return (
    <FoundationPage
      title="タブ"
      lead={
        <>
          <Para>
            タブは、限られた領域に複数の内容を重ねて置き、1つずつ見せるための部品である。
            どのタブが選ばれているかが一目で分かることと、キーボードでも同じように切り替えられることを満たすように定義する。
          </Para>
          <Para>選択色は草色とする。</Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
