import { redirect } from "next/navigation";

// #588: /sitemap は /{リポジトリ名}/sitemap(いまは yaoyorozu 固定)へ移した。
// #544 の /wbs・#548 の /unchi と同じ扱い(navigation.ts を参照)。
export default function SitemapPage() {
  redirect("/yaoyorozu/sitemap");
}
