import { redirect } from "next/navigation";

// 段階 1 は /settings だけ。ハブ(/)は段階 4。
export default function Home() {
  redirect("/settings");
}
