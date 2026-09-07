import { NextResponse, type NextRequest } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { LAYOUT_DIAGRAMS, type LayoutDiagram } from "@/data/layoutSaveApi";

function isLayoutDiagram(value: string): value is LayoutDiagram {
  return (LAYOUT_DIAGRAMS as readonly string[]).includes(value);
}

// レイアウト保存APIは web.md §2 の「API・DBは導入しない」の唯一の例外であり、
// 開発時専用とする。本番ビルド(next start 等)では常に 405 を返す。
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ diagram: string }> },
) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "本番では保存できません" },
      { status: 405 },
    );
  }

  const { diagram } = await params;
  if (!isLayoutDiagram(diagram)) {
    return NextResponse.json({ error: "unknown diagram" }, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // 保存先パスはフロントから受け取らずサーバ側(許可リスト)で解決する。
  const filePath = path.join(
    process.cwd(),
    "src/data/layout",
    `${diagram}.json`,
  );
  await writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`, "utf-8");

  return NextResponse.json({ ok: true });
}
