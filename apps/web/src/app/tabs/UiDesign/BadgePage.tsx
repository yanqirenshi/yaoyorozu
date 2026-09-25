"use client";

import Box from "@mui/material/Box";
import {
  BADGE_ANATOMY,
  BADGE_ANTIPATTERNS,
  BADGE_RULES,
  BADGE_SHAPE,
  BADGE_SIZES,
  BADGE_TONES,
  type BadgeSize,
} from "@/data/uiBadge";
import Badge from "@/components/parts/Badge";
import EditButton from "@/components/parts/EditButton";
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
import ColorRef from "./ColorRef";
import { BORDER, textStyle } from "./tokens";

const SECTIONS: DocSection[] = [
  {
    id: "badge-definition",
    title: "バッジとは",
    body: (
      <>
        <Para>
          バッジは、対象がいまどの状態にあるかを短い文字で示す部品である。
          押すと何かが起きるものではないので、境界を持たず塗りだけで描く。境界を持つボタンとは形で区別する。
        </Para>
        <Sample caption="4つのトーン。色だけでなく、必ず文字を持たせる。">
          <div className="flex flex-wrap items-center gap-3">
            {BADGE_TONES.map((t) => (
              <Badge key={t.key} tone={t.key} label={t.label} />
            ))}
          </div>
        </Sample>
        <Sample
          surface="base"
          caption="左がバッジ、右がボタン。塗りだけのものは押せない、境界を持つものは押せる、と読み分けられる。"
        >
          <div className="flex flex-wrap items-center gap-4">
            <Badge tone="running" label="実行中" />
            <EditButton size="small" />
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "badge-tone",
    title: "状態の種類と色",
    body: (
      <>
        <Para>
          この部品のいちばんの仕事は、状態の意味と色の対応を1か所で決めることである。
          色は見た目で選ばず、下の「意味」で選ぶ。当てはまるものがなければ待機(墨)にする。
          色を増やすほど、色そのものの意味が薄れる。
        </Para>
        <TokenTable
          columns={[
            { key: "sample", label: "", width: "90px" },
            { key: "tone", label: "トーン", mono: true, width: "90px" },
            { key: "meaning", label: "意味" },
            { key: "examples", label: "例" },
          ]}
          rows={BADGE_TONES.map((t) => ({
            sample: <Badge tone={t.key} label={t.label} />,
            tone: t.key,
            meaning: t.meaning,
            examples: t.examples,
          }))}
        />
        <TokenTable
          columns={[
            { key: "tone", label: "トーン", mono: true, width: "90px" },
            { key: "bg", label: "背景" },
            { key: "fg", label: "文字" },
            { key: "contrast", label: "コントラスト", width: "120px" },
          ]}
          rows={BADGE_TONES.map((t) => ({
            tone: t.key,
            bg: <ColorRef refName={t.bg} />,
            fg: <ColorRef refName={t.fg} />,
            contrast: t.contrast,
          }))}
        />
        <Note>
          組み合わせは基本デザイン「カラー」のセマンティックカラーと同じものを使っている。
          進行中に金茶を当てているのは、金茶の定義が「警告、進行中の状態」だからである。
          草色は完了(成功)の色なので、実行中には使わない。
        </Note>
      </>
    ),
  },
  {
    id: "badge-size",
    title: "サイズと形",
    body: (
      <>
        <Para>
          サイズは small / medium の2段階。既定は medium である。
          文字の太さはどちらも通常(N)で、トーンによって変えない。
        </Para>
        <TokenTable
          columns={[
            { key: "sample", label: "", width: "90px" },
            { key: "size", label: "サイズ", mono: true, width: "90px" },
            { key: "height", label: "高さ", mono: true, width: "70px" },
            { key: "paddingX", label: "左右の余白", mono: true, width: "120px" },
            { key: "text", label: "ラベル", mono: true, width: "120px" },
            { key: "usage", label: "使う場面" },
          ]}
          rows={BADGE_SIZES.map((s) => ({
            sample: <Badge tone="running" label="実行中" size={s.key} />,
            size: s.key,
            height: s.heightPx + "px",
            paddingX: s.paddingX + " (" + spacePx(s.paddingX) + "px)",
            text: s.textStyle,
            usage: s.usage,
          }))}
        />
        <TokenTable
          columns={[
            { key: "item", label: "項目", width: "120px" },
            { key: "value", label: "値", mono: true, width: "160px" },
            { key: "note", label: "備考" },
          ]}
          rows={[
            {
              item: "角の形状",
              value: BADGE_SHAPE.radius + " (" + radiusCss(BADGE_SHAPE.radius) + ")",
              note: BADGE_SHAPE.note,
            },
            { item: "境界", value: BADGE_SHAPE.border, note: "" },
          ]}
        />
        <Sample
          surface="base"
          caption="一覧の行に置いた small。行の高さを変えず、幅は文字に合わせる。"
        >
          <Box sx={{ width: "420px", border: "1px solid " + BORDER, borderRadius: "8px" }}>
            {[
              { name: "認証まわりの実装", tone: "running" as const, label: "実行中" },
              { name: "タブの仕様を決める", tone: "done" as const, label: "完了" },
              { name: "リリース作業", tone: "idle" as const, label: "未起動" },
              { name: "依存の更新", tone: "error" as const, label: "失敗" },
            ].map((row, index) => (
              <Box
                key={row.name}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  px: "12px",
                  py: "8px",
                  borderTop: index === 0 ? undefined : "1px solid " + BORDER,
                  ...textStyle("Dns-14N-150"),
                }}
              >
                <span>{row.name}</span>
                <Badge tone={row.tone} label={row.label} size="small" />
              </Box>
            ))}
          </Box>
        </Sample>
      </>
    ),
  },
  {
    id: "badge-anatomy",
    title: "構成",
    body: (
      <TokenTable
        columns={[
          { key: "no", label: "", width: "40px" },
          { key: "name", label: "部位", width: "120px" },
          { key: "description", label: "説明" },
        ]}
        rows={BADGE_ANATOMY.map((a) => ({
          no: String(a.no),
          name: a.name,
          description: a.description,
        }))}
      />
    ),
  },
  {
    id: "badge-rules",
    title: "規則",
    body: <RuleList rules={BADGE_RULES} />,
  },
  {
    id: "badge-antipattern",
    title: "使わない書き方",
    body: (
      <TokenTable
        columns={[
          { key: "pattern", label: "使わない", width: "240px" },
          { key: "problem", label: "起きること" },
          { key: "instead", label: "代わりに" },
        ]}
        rows={BADGE_ANTIPATTERNS.map((a) => ({
          pattern: a.pattern,
          problem: a.problem,
          instead: a.instead,
        }))}
      />
    ),
  },
  {
    id: "badge-implementation",
    title: "実装",
    body: (
      <>
        <Para>
          apps/web では <Code>src/components/parts/Badge.tsx</Code> を使う。
          見た目は <Code>src/data/uiBadge.ts</Code> の仕様だけから決まり、コンポーネントは値を持たない。
        </Para>
        <Sample surface="sunken">
          <Box
            sx={{
              ...textStyle("Mono-14N-150"),
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              whiteSpace: "pre-wrap",
            }}
          >
            {'import Badge from "@/components/parts/Badge";\n\n' +
              '<Badge tone="running" label="実行中" />\n' +
              '<Badge tone="idle" label="未起動" size="small" />'}
          </Box>
        </Sample>
        <TokenTable
          columns={[
            { key: "prop", label: "props", mono: true, width: "100px" },
            { key: "type", label: "型", mono: true, width: "260px" },
            { key: "note", label: "説明" },
          ]}
          rows={[
            {
              prop: "tone",
              type: '"idle" | "running" | "done" | "error"',
              note: "意味で選ぶ。既定値は持たない(必ず指定する)。",
            },
            { prop: "label", type: "string", note: "状態を表す短い名詞。" },
            {
              prop: "size",
              type: '"small" | "medium"',
              note: "既定は medium。一覧の行やツールバーは small。",
            },
          ]}
        />
        <Note>
          状態が変わったことを支援技術にも伝えるため、バッジを含む領域に{" "}
          <Code>{'role="status"'}</Code> を持たせるか、変化を別途知らせる。
          色が変わっただけでは何も伝わらない。
        </Note>
      </>
    ),
  },
];

export default function BadgePage() {
  const sizes: BadgeSize[] = BADGE_SIZES.map((s) => s.key);
  return (
    <FoundationPage
      title="バッジ"
      lead={
        <>
          <Para>
            バッジは、対象の状態を一目で読み取らせるための部品である。
            状態は画面をまたいで現れる(一覧、ヘッダ、ノード、インスペクタ)ため、
            同じ状態が場所によって違う色になると、色から意味を読み取れなくなる。
          </Para>
          <Para>
            そのため、この部品では「どの状態にどの色を当てるか」を{sizes.length}
            段階のサイズより先に決める。色の選択は見た目の好みではなく、意味で行う。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
