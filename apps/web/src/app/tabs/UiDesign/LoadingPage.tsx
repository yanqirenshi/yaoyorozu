"use client";

import Box from "@mui/material/Box";
import {
  LOADING_A11Y,
  LOADING_ANATOMY,
  LOADING_ANTIPATTERNS,
  LOADING_COLOR,
  LOADING_LIBRARY,
  LOADING_RULES,
  LOADING_SIZES,
  LOADING_TIMING,
  LOADING_VARIANT,
  type LoadingSize,
} from "@/data/uiLoading";
import LoadingIcon, { loadingPx } from "@/components/parts/LoadingIcon";
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
import { BORDER, TEXT_SECONDARY, textStyle } from "./tokens";

/** 読み込み中の領域の作例。 */
function PaneSample({
  size,
  message,
}: {
  size: LoadingSize;
  message?: string;
}) {
  return (
    <Box
      sx={{
        width: "260px",
        height: "140px",
        border: "1px solid " + BORDER,
        borderRadius: "8px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: spacePx("sp-2") + "px",
        color: TEXT_SECONDARY,
      }}
    >
      <LoadingIcon size={size} label={message} />
      {message && (
        <Box sx={{ ...textStyle("Body-14N-170") }}>{message}</Box>
      )}
    </Box>
  );
}

const SECTIONS: DocSection[] = [
  {
    id: "loading-definition",
    title: "ローディングアイコンとは",
    body: (
      <>
        <Para>
          ローディングアイコンは、いま処理を待っていることを示す部品である。
          終わりの見えない回転そのものが「動いている・止まっていない」という意味を持つ。
        </Para>
        <Sample caption="既定の大きさ(medium)。文字色を継ぐので、置いた場所の色になる。">
          <div className="flex items-center gap-6">
            <LoadingIcon />
            <Box sx={{ color: TEXT_SECONDARY, display: "inline-flex" }}>
              <LoadingIcon />
            </Box>
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "loading-library",
    title: "図形は loading.dev を使う",
    body: (
      <>
        <Para>
          図形と動きは自前で描かず、<Code>{LOADING_LIBRARY.package}</Code>(
          {LOADING_LIBRARY.name})の <Code>{LOADING_VARIANT.component}</Code>{" "}
          をそのまま使う(2026-09-25 決定)。
          回るアイコンは、止まって見えない速さや角度の刻み方の調整が要るわりに、見た目の独自性がほとんど価値にならない。
        </Para>
        <TokenTable
          columns={[
            { key: "item", label: "項目", width: "180px" },
            { key: "value", label: "値" },
          ]}
          rows={[
            { item: "ライブラリ", value: LOADING_LIBRARY.name + "(" + LOADING_LIBRARY.url + ")" },
            { item: "パッケージ", value: LOADING_LIBRARY.package + "@" + LOADING_LIBRARY.version },
            { item: "ライセンス", value: LOADING_LIBRARY.license },
            { item: "前提", value: LOADING_LIBRARY.requires },
            { item: "使う図形", value: LOADING_VARIANT.component + "(" + LOADING_VARIANT.description + ")" },
            { item: "線端", value: LOADING_VARIANT.cap },
            { item: "回り方", value: LOADING_VARIANT.easing },
            { item: "1周の時間", value: LOADING_VARIANT.durationMs + "ms" },
          ]}
        />
        <Note>{LOADING_VARIANT.reason}</Note>
        <Note>{LOADING_LIBRARY.note}</Note>
        <Para>
          loading.dev には27種類の図形があるが、YAOYOROZU で使うのは{" "}
          <Code>{LOADING_VARIANT.component}</Code> だけとする。
          画面ごとに違う図形が出ると、同じ「待っている」状態が別のものに見える。
        </Para>
      </>
    ),
  },
  {
    id: "loading-size",
    title: "サイズ",
    body: (
      <>
        <Para>
          大きさは基本デザイン「アイコン」のサイズトークンから採り、ローディング専用の値を持たない。
          隣に置く文字やアイコンと高さがそろう。
        </Para>
        <TokenTable
          columns={[
            { key: "sample", label: "", width: "56px" },
            { key: "size", label: "サイズ", mono: true, width: "90px" },
            { key: "token", label: "トークン", mono: true, width: "110px" },
            { key: "px", label: "大きさ", mono: true, width: "70px" },
            { key: "usage", label: "使う場面" },
          ]}
          rows={LOADING_SIZES.map((s) => ({
            sample: <LoadingIcon size={s.key} />,
            size: s.key,
            token: s.iconToken,
            px: loadingPx(s.key) + "px",
            usage: s.usage,
          }))}
        />
        <Sample
          surface="base"
          caption="行の中に置いた small。行内アイコンと同じ大きさなので、行の高さが変わらない。"
        >
          <Box sx={{ ...textStyle("Body-14N-170"), color: TEXT_SECONDARY }}>
            セッションを読み込んでいます
            <Box component="span" sx={{ mx: "4px", verticalAlign: "-0.15em" }}>
              <LoadingIcon size="small" />
            </Box>
            しばらくお待ちください。
          </Box>
        </Sample>
      </>
    ),
  },
  {
    id: "loading-color",
    title: "色",
    body: (
      <>
        <Para>{LOADING_COLOR.note}</Para>
        <Note>{LOADING_COLOR.forbidden}</Note>
        <Sample surface="base" caption="左から、本文の色・補足の色・無効の色の上に置いたもの。部品側は色を持たない。">
          <div className="flex items-center gap-8">
            {[
              { label: "text.primary", color: "var(--text-primary)" },
              { label: "text.secondary", color: "var(--text-secondary)" },
              { label: "text.disabled", color: "var(--text-disabled)" },
            ].map((c) => (
              <div key={c.label} className="flex flex-col items-center gap-2">
                <Box sx={{ color: c.color, display: "inline-flex" }}>
                  <LoadingIcon size="large" />
                </Box>
                <Box sx={{ ...textStyle("Dns-14N-150"), color: TEXT_SECONDARY }}>
                  {c.label}
                </Box>
              </div>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "loading-place",
    title: "置き場所と待ち時間",
    body: (
      <>
        <Para>
          アイコンは、いま読み込んでいる領域の中に置く。画面全体を覆う膜の上には出さない。
          どこが待っているのかが分からなくなり、覆われた部分の操作もできなくなる。
        </Para>
        <Sample
          surface="base"
          caption={
            "左: 短い待ち(" +
            LOADING_TIMING.longWaitMs / 1000 +
            "秒未満)はアイコンだけ。右: 長い待ちは何を待っているかを文字で添える。"
          }
        >
          <div className="flex flex-wrap items-start gap-6">
            <PaneSample size="large" />
            <PaneSample size="large" message="セッションを読み込んでいます" />
          </div>
        </Sample>
        <TokenTable
          columns={[
            { key: "item", label: "目安", width: "220px" },
            { key: "value", label: "値", mono: true, width: "110px" },
            { key: "note", label: "扱い" },
          ]}
          rows={[
            {
              item: "これより短いなら出さない",
              value: LOADING_TIMING.minWaitMs + "ms",
              note: "出してすぐ消えるアイコンは点滅にしか見えず、かえって遅く感じさせる。",
            },
            {
              item: "これを超えるなら文言を添える",
              value: LOADING_TIMING.longWaitMs + "ms",
              note: "「セッションを読み込んでいます」のように、何を待っているかを書く。",
            },
          ]}
        />
      </>
    ),
  },
  {
    id: "loading-anatomy",
    title: "構成",
    body: (
      <TokenTable
        columns={[
          { key: "no", label: "", width: "40px" },
          { key: "name", label: "部位", width: "120px" },
          { key: "description", label: "説明" },
        ]}
        rows={LOADING_ANATOMY.map((a) => ({
          no: String(a.no),
          name: a.name,
          description: a.description,
        }))}
      />
    ),
  },
  {
    id: "loading-a11y",
    title: "支援技術への伝え方",
    body: (
      <>
        <Para>{LOADING_A11Y.note}</Para>
        <TokenTable
          columns={[
            { key: "item", label: "項目", width: "180px" },
            { key: "value", label: "値", mono: true, width: "160px" },
            { key: "note", label: "備考" },
          ]}
          rows={[
            { item: "役割", value: LOADING_A11Y.role, note: "処理の状態を表す領域として扱われる。" },
            { item: "読み上げ方", value: LOADING_A11Y.ariaLive, note: "いま読んでいる内容を遮らずに伝える。" },
            { item: "名前", value: LOADING_A11Y.label, note: "何を待っているかが周囲から分からないときは、対象を含めて書く。" },
          ]}
        />
        <Note>{LOADING_A11Y.motion}</Note>
      </>
    ),
  },
  {
    id: "loading-rules",
    title: "規則",
    body: <RuleList rules={LOADING_RULES} />,
  },
  {
    id: "loading-antipattern",
    title: "使わない書き方",
    body: (
      <TokenTable
        columns={[
          { key: "pattern", label: "使わない", width: "260px" },
          { key: "problem", label: "起きること" },
          { key: "instead", label: "代わりに" },
        ]}
        rows={LOADING_ANTIPATTERNS.map((a) => ({
          pattern: a.pattern,
          problem: a.problem,
          instead: a.instead,
        }))}
      />
    ),
  },
  {
    id: "loading-implementation",
    title: "実装",
    body: (
      <>
        <Para>
          apps/web では <Code>src/components/parts/LoadingIcon.tsx</Code> を使う。
          大きさ・色・速さは仕様だけから決まり、コンポーネントは値を持たない。
        </Para>
        <Sample surface="sunken">
          <Box
            sx={{
              ...textStyle("Mono-14N-150"),
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              whiteSpace: "pre-wrap",
            }}
          >
            {'import LoadingIcon from "@/components/parts/LoadingIcon";\n\n' +
              "{loading && <LoadingIcon />}\n" +
              '{loading && <LoadingIcon size="large" label="セッションを読み込んでいます" />}'}
          </Box>
        </Sample>
        <TokenTable
          columns={[
            { key: "prop", label: "props", mono: true, width: "120px" },
            { key: "type", label: "型", mono: true, width: "220px" },
            { key: "note", label: "説明" },
          ]}
          rows={[
            { prop: "size", type: '"small" | "medium" | "large"', note: "既定は medium。" },
            { prop: "label", type: "string", note: "既定は「読み込み中」。何を待っているかが周囲から分からないときに渡す。" },
            {
              prop: "playState",
              type: '"paused" | "running"',
              note: "止める必要がある場面のためだけに渡す。通常は渡さない。",
            },
          ]}
        />
        <Note>
          apps/native でも同じ <Code>{LOADING_LIBRARY.package}</Code> を使う。どちらも React なので、
          同じ図形・同じ設定にできる。CSS を書き写して自前で描かないこと。
        </Note>
      </>
    ),
  },
];

export default function LoadingPage() {
  return (
    <FoundationPage
      title="ローディング"
      lead={
        <>
          <Para>
            待たせること自体は避けられない。避けられるのは「止まっているのか、動いているのか分からない」状態である。
            ローディングアイコンは、その区別だけを担う部品とする。
          </Para>
          <Para>
            図形と動きは loading.dev のものをそのまま使い、こちらで決めるのは
            「どの図形を使うか」「どの大きさで」「どこに」「いつ出して、いつ消すか」に絞る。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
