import { redirect } from "next/navigation";

// #589: /class-diagram は /{リポジトリ名}/class-diagram(いまは yaoyorozu 固定)へ移した。
// #544 の /wbs・#548 の /unchi・#588 の /sitemap と同じ扱い(navigation.ts を参照)。
export default function ClassDiagramPage() {
  redirect("/yaoyorozu/class-diagram");
}
