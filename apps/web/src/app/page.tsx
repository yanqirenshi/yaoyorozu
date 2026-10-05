import { redirect } from "next/navigation";

export default function Home() {
  // #544: 二重リダイレクト(/ → /wbs → /yaoyorozu/wbs)を避けるため直接指定する。
  redirect("/yaoyorozu/wbs");
}
