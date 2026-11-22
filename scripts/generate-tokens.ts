/**
 * デザイントークン(apps/web/src/data/ui*.ts)から CSS カスタムプロパティを生成する。
 *
 *   node scripts/generate-tokens.ts
 *
 * 出力先は apps/web と apps/native の2か所。生成物はコミットする。
 * apps/native は npm workspace として apps/web に依存しないため、
 * パッケージを新設せずファイルを配る方式を採っている(規約 web.md §7)。
 *
 * Node は 24 以上を前提とし、TypeScript のまま実行する(型注釈は実行時に取り除かれる)。
 * 読み込む data ファイルは、拡張子付きの相対 import しか解決できない点に注意する。
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COLOR_SCALES,
  FUNCTIONAL_COLORS,
  KEY_COLORS,
  SEMANTIC_COLORS,
  SURFACE_COLORS,
  TEXT_COLORS,
  type RoleColor,
} from "../apps/web/src/data/uiDesign.ts";
import {
  FONT_FAMILIES,
  FONT_WEIGHTS,
  TEXT_STYLE_GROUPS,
} from "../apps/web/src/data/uiTypography.ts";
import { SPACING_SCALE } from "../apps/web/src/data/uiSpacing.ts";
import { CORNER_SCALE } from "../apps/web/src/data/uiCorner.ts";
import { ELEVATION_SCALE } from "../apps/web/src/data/uiElevation.ts";
import { ICON_SIZES } from "../apps/web/src/data/uiIcon.ts";
import { CONTENT_WIDTHS } from "../apps/web/src/data/uiLayout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const OUTPUTS = [
  join(ROOT, "apps", "web", "src", "app", "tokens.css"),
  join(ROOT, "apps", "native", "react", "src", "tokens.css"),
];

/** 役割トークン名(color.primary)を CSS 変数名(--color-primary)にする。 */
function cssName(token: string): string {
  return "--" + token.replace(/\./g, "-");
}

/** テキストスタイル名(Body-16N-170)を CSS 変数の接頭辞にする。 */
function textName(name: string): string {
  return "--text-" + name.toLowerCase();
}

const lines: string[] = [];

function section(title: string) {
  lines.push("", "  /* " + title + " */");
}

function decl(name: string, value: string) {
  lines.push("  " + name + ": " + value + ";");
}

/**
 * 役割カラーを出力する。
 * color.background だけは、Tailwind の @theme が使う --color-background と
 * 名前が衝突するため出力しない(同じ値の surface.base を使う)。
 */
function roleColors(colors: RoleColor[]) {
  for (const color of colors) {
    if (color.token === "color.background") continue;
    decl(cssName(color.token), color.value);
  }
}

lines.push(
  "/*",
  " * このファイルは scripts/generate-tokens.ts が生成する。直接編集しないこと。",
  " *",
  " * 生成元: apps/web/src/data/ui*.ts",
  " * 生成:   npm run tokens",
  " *",
  " * 値の変更は生成元の TypeScript を編集し、再生成して両方をコミットする。",
  " * 定義の意味と使い分けは /ui(基本デザイン)を参照。",
  " */",
  "",
  ":root {",
);

section("プリミティブカラー(トーンスケール)");
for (const scale of COLOR_SCALES) {
  lines.push("");
  lines.push("  /* " + scale.name + "(" + scale.reading + ") */");
  for (const t of scale.tones) {
    decl("--color-" + scale.slug + "-" + t.step, t.hex);
  }
}

section("キーカラー");
roleColors(KEY_COLORS);

section("面と境界");
roleColors(SURFACE_COLORS);

section("文字色");
roleColors(TEXT_COLORS);

section("機能カラー");
roleColors(FUNCTIONAL_COLORS);

section("セマンティックカラー(前景 / 背景 / 境界)");
for (const color of SEMANTIC_COLORS) {
  const base = cssName(color.token);
  decl(base + "-fg", color.fg);
  decl(base + "-bg", color.bg);
  decl(base + "-border", color.border);
}

// Tailwind v4 のテーマ変数(--font-sans / --font-mono)と名前が衝突すると
// 自己参照になってしまうため、font.sans は --font-family-sans として出力する。
section("フォントファミリー");
for (const family of FONT_FAMILIES) {
  decl("--font-family-" + family.token.replace("font.", ""), family.stack);
}

section("書体の太さ");
for (const weight of FONT_WEIGHTS) {
  decl("--font-weight-" + weight.label.toLowerCase(), String(weight.value));
}

section("テキストスタイル");
for (const group of TEXT_STYLE_GROUPS) {
  lines.push("");
  lines.push("  /* " + group.label + " */");
  for (const style of group.styles) {
    const base = textName(style.name);
    decl(base + "-size", style.sizePx + "px");
    const weight = FONT_WEIGHTS.find((w) => w.level === style.weight);
    decl(base + "-weight", String(weight ? weight.value : 400));
    decl(base + "-line-height", style.lineHeight);
    decl(base + "-tracking", style.tracking);
  }
}

section("余白");
for (const space of SPACING_SCALE) {
  decl("--space-" + space.token.replace("sp-", ""), space.px + "px");
}

section("角の形状");
for (const corner of CORNER_SCALE) {
  decl(
    "--" + corner.token,
    corner.px >= 9999 ? "9999px" : corner.px + "px",
  );
}

section("エヴェレーション(高さ)");
for (const elevation of ELEVATION_SCALE) {
  decl("--" + elevation.token, elevation.shadow);
}

section("アイコンのサイズ");
for (const icon of ICON_SIZES) {
  decl("--" + icon.token, icon.px + "px");
}

section("コンテンツの最大幅");
for (const width of CONTENT_WIDTHS) {
  if (width.maxWidthPx === null) continue;
  decl(cssName(width.token), width.maxWidthPx + "px");
}

// ブレークポイントは、CSS カスタムプロパティをメディアクエリの条件に使えないため
// 出力しない。値は /ui の「レイアウト」と Tailwind の既定値を参照する。

lines.push("}", "");

const css = lines.join("\n");

for (const output of OUTPUTS) {
  writeFileSync(output, css, "utf8");
  console.log("生成: " + output.replace(ROOT, "."));
}
