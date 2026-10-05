import { redirect } from "next/navigation";

// #544: /wbs は {リポジトリ名}/wbs(いまは yaoyorozu 固定)へ移した。他の画面が
// まだ移っていないため、ナビゲーション(navigation.ts)は WBS だけ新しい URL にし、
// 旧 URL はここでリダイレクトして壊さないようにする。
export default function WbsPage() {
  redirect("/yaoyorozu/wbs");
}
