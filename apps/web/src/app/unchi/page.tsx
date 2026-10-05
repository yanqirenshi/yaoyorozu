import { redirect } from "next/navigation";

// #548: /unchi は /{リポジトリ名}/unchi(いまは yaoyorozu 固定)へ移した。
// #544 の /wbs と同じ扱い(navigation.ts を参照)。
export default function UnchiPage() {
  redirect("/yaoyorozu/unchi");
}
