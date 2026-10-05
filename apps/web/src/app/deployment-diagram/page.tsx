import { redirect } from "next/navigation";

// #548: /deployment-diagram は /{リポジトリ名}/deployment-diagram(いまは yaoyorozu
// 固定)へ移した。他の画面がまだ移っていないため、ナビゲーション(navigation.ts)は
// 構成図・ポンチ絵だけ新しい URL にし、旧 URL はここでリダイレクトして壊さないように
// する(#544 の /wbs と同じ扱い)。
export default function DeploymentDiagramPage() {
  redirect("/yaoyorozu/deployment-diagram");
}
