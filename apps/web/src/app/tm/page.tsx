import { redirect } from "next/navigation";

// #590: /tm は {リポジトリ名}/tm(いまは yaoyorozu 固定)へ移した。
// 旧 URL はここでリダイレクトして壊さないようにする(/wbs と同じ扱い。web.md §2)。
export default function TmPage() {
  redirect("/yaoyorozu/tm");
}
