"use client";

import Box from "@mui/material/Box";
import {
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_WEIGHTS,
  LINE_HEIGHTS,
  TEXT_STYLE_GROUPS,
  TYPOGRAPHY_RULES,
} from "@/data/uiTypography";
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

const SECTIONS: DocSection[] = [
  {
    id: "typo-family",
    title: "フォントファミリー",
    body: (
      <>
        <Para>
          欧文は Geist、和文は OS 標準の日本語ゴシックにフォールバックする。
          和文フォントを Web フォントとして読み込まないのは、YAOYOROZU が長時間ひらいたままにする作業ツールであり、初期表示の速さと再描画のちらつきのなさを優先するためである。
        </Para>
        <TokenTable
          columns={[
            { key: "token", label: "トークン", mono: true },
            { key: "label", label: "名称" },
            { key: "stack", label: "font-family", mono: true },
            { key: "usage", label: "用途" },
          ]}
          rows={FONT_FAMILIES.map((f) => ({
            token: f.token,
            label: f.label,
            stack: f.stack,
            usage: f.usage,
          }))}
        />
        <Sample>
          <Box sx={{ ...textStyle("Body-16N-170"), mb: "8px" }}>
            サンセリフ(既定) — YAOYOROZU は八百万のプロダクト情報をひとつの場に集める。
            Design system 2026.
          </Box>
          <Box
            sx={{
              ...textStyle("Mono-16N-150"),
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
            }}
          >
            等幅 — apps/web/src/data/uiTypography.ts / 0123456789
          </Box>
        </Sample>
      </>
    ),
  },
  {
    id: "typo-weight",
    title: "書体の太さ",
    body: (
      <>
        <Para>
          太さは3段階に限定する。テキストスタイル名では N / M / B の記号で表す。
        </Para>
        <TokenTable
          columns={[
            { key: "level", label: "太さレベル", mono: true },
            { key: "value", label: "font-weight", mono: true },
            { key: "label", label: "名称" },
            { key: "usage", label: "用途" },
          ]}
          rows={FONT_WEIGHTS.map((w) => ({
            level: w.level,
            value: String(w.value),
            label: w.label,
            usage: w.usage,
          }))}
        />
        <Sample>
          <div className="flex flex-col gap-2">
            {FONT_WEIGHTS.map((w) => (
              <Box
                key={w.level}
                sx={{ fontSize: "20px", fontWeight: w.value, lineHeight: "150%" }}
              >
                {w.label}({w.value}) — セッションの構成と役割
              </Box>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "typo-size",
    title: "書体の大きさ",
    body: (
      <>
        <Para>
          本文と UI の基準は 16px、下限は 14px とする。14px 未満は使わない。
          領域に収まらないときに文字を小さくするのは、情報の優先順位づけを先送りしているだけであり、まず情報を減らすか領域を広げることを検討する。
        </Para>
        <TokenTable
          columns={[
            { key: "px", label: "大きさ(CSS px)", mono: true, width: "140px" },
            { key: "usage", label: "主な用途" },
          ]}
          rows={FONT_SIZES.map((s) => ({
            px: String(s.px),
            usage: s.usage,
          }))}
        />
        <Sample>
          <div className="flex flex-col gap-3">
            {FONT_SIZES.map((s) => (
              <div key={s.px} className="flex items-baseline gap-4">
                <Box
                  sx={{
                    ...textStyle("Mono-14N-150"),
                    fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                    color: TEXT_SECONDARY,
                    width: "48px",
                    flexShrink: 0,
                  }}
                >
                  {s.px}
                </Box>
                <Box sx={{ fontSize: s.px + "px", lineHeight: "140%" }}>
                  八百万のプロダクト情報
                </Box>
              </div>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "typo-line-height",
    title: "行ボックスの高さ",
    body: (
      <>
        <Para>
          行高は用途で決める。読み物は 170%、一覧・表は 150%、折り返さない UI テキストは 100%。
          同じページの中でも、本文と一覧で行高が違うのは正しい。
        </Para>
        <TokenTable
          columns={[
            { key: "value", label: "line-height", mono: true, width: "140px" },
            { key: "usage", label: "主な用途" },
          ]}
          rows={LINE_HEIGHTS.map((l) => ({ value: l.value, usage: l.usage }))}
        />
        <Sample caption="同じ 16px の文章に、150% と 170% の行高を適用した比較。">
          <div className="flex flex-wrap gap-6">
            {["150%", "170%"].map((lh) => (
              <Box
                key={lh}
                sx={{
                  width: "280px",
                  fontSize: "16px",
                  lineHeight: lh,
                  border: "1px solid " + BORDER,
                  borderRadius: "8px",
                  p: "12px",
                }}
              >
                <Box
                  sx={{
                    ...textStyle("Dns-14B-150"),
                    color: TEXT_SECONDARY,
                    mb: "4px",
                  }}
                >
                  {lh}
                </Box>
                ネイティブアプリはAIコーディングエージェントをラップし、GitHubを使ったタスク管理を行う。Webアプリはプロダクトの情報を管理し、AIと人とのコミュニケーションに利用する。
              </Box>
            ))}
          </div>
        </Sample>
      </>
    ),
  },
  {
    id: "typo-style-name",
    title: "テキストスタイル名の構成",
    body: (
      <>
        <Para>
          テキストスタイル名は <Code>&lt;カテゴリ&gt;-&lt;大きさ&gt;&lt;太さレベル&gt;-&lt;行高&gt;</Code>{" "}
          で構成する。名前を見れば値が分かり、値からも名前が引ける。
        </Para>
        <Sample surface="sunken">
          <Box
            sx={{
              ...textStyle("Mono-16N-150"),
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
            }}
          >
            Body-16N-170
            <br />
            └ Body: カテゴリ / 16: 大きさ(px) / N: 太さレベル / 170: 行高(%)
          </Box>
        </Sample>
        <Para>
          カテゴリは、その文字が置かれる文脈を表す。同じ 16px でも、読ませる本文(Body)と、
          1行で折り返さないボタンのラベル(UI)では行高が違うため、別のスタイルとして扱う。
        </Para>
      </>
    ),
  },
  {
    id: "typo-styles",
    title: "テキストスタイルの種類",
    body: (
      <Para>
        画面で使えるテキストスタイルは以下がすべてである。ここにない組み合わせが必要になった場合は、
        その場で指定するのではなく、このページに追加してから使う。
      </Para>
    ),
    children: TEXT_STYLE_GROUPS.map((group) => ({
      id: "typo-styles-" + group.key,
      title: group.label,
      body: (
        <>
          <Para>{group.description}</Para>
          <TokenTable
            columns={[
              { key: "name", label: "テキストスタイル名", mono: true },
              { key: "size", label: "大きさ", mono: true },
              { key: "weight", label: "太さ", mono: true },
              { key: "lineHeight", label: "行高", mono: true },
              { key: "tracking", label: "文字間隔", mono: true },
              { key: "usage", label: "用途" },
            ]}
            rows={group.styles.map((s) => ({
              name: s.name,
              size: String(s.sizePx),
              weight: s.weight,
              lineHeight: s.lineHeight,
              tracking: s.tracking,
              usage: s.usage,
            }))}
          />
          <Sample>
            <div className="flex flex-col gap-3">
              {group.styles.map((s) => (
                <div key={s.name}>
                  <Box
                    sx={{
                      ...textStyle("Mono-14N-150"),
                      fontFamily:
                        "var(--font-geist-mono), ui-monospace, monospace",
                      color: TEXT_SECONDARY,
                    }}
                  >
                    {s.name}
                  </Box>
                  <Box
                    sx={{
                      ...textStyle(s.name),
                      fontFamily:
                        group.key === "mono"
                          ? "var(--font-geist-mono), ui-monospace, monospace"
                          : undefined,
                    }}
                  >
                    セッションの役割を分けてプロダクトを組み立てる
                  </Box>
                </div>
              ))}
            </div>
          </Sample>
        </>
      ),
    })),
  },
  {
    id: "typo-rules",
    title: "運用ルール",
    body: (
      <>
        <Bullets items={TYPOGRAPHY_RULES} />
        <Note>
          このページ自身も、ここで定義したテキストスタイルだけで組んでいる。見出しは Head-24B-150 / Head-20B-150、
          本文は Body-16N-170、表は Dns-14N-150 を使っている。
        </Note>
      </>
    ),
  },
];

export default function TypographyPage() {
  return (
    <FoundationPage
      title="タイポグラフィ"
      lead={
        <>
          <Para>
            YAOYOROZU が扱うのは、仕様・設計・セッションの記録といった「読む情報」である。
            文字は装飾ではなく機能であり、どの画面でも同じ規則で組まれていることが、情報を断片化させないための前提になる。
          </Para>
          <Para>
            そのため、フォントサイズや太さをその場で決めることはしない。
            使ってよい組み合わせを「テキストスタイル」として名前付きで定義し、画面はその名前を選ぶだけにする。
          </Para>
        </>
      }
      sections={SECTIONS}
    />
  );
}
