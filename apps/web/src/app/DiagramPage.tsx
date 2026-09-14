"use client";

import { Suspense, type ReactNode, type SyntheticEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import WbsTab from "./tabs/WbsTab";

const TAB_DIAGRAM = "diagram";
const TAB_WBS = "wbs";

/** その画面だけのタブ。「図」と「WBS」の間に並ぶ。key は URL の `?tab=` の値。 */
export type DiagramPageTab = {
  key: string;
  label: string;
  content: ReactNode;
};

type DiagramPageProps = {
  children: ReactNode;
  wbsStartId?: number;
  extraTabs?: DiagramPageTab[];
};

export default function DiagramPage(props: DiagramPageProps) {
  return (
    <Suspense>
      <DiagramPageContent {...props} />
    </Suspense>
  );
}

function DiagramPageContent({
  children,
  wbsStartId,
  extraTabs = [],
}: DiagramPageProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  // タブの並び順どおりの key。知らない値(や指定なし)は「図」にする。
  const keys = [TAB_DIAGRAM, ...extraTabs.map((t) => t.key), TAB_WBS];
  const value = Math.max(0, keys.indexOf(searchParams.get("tab") ?? TAB_DIAGRAM));
  const current = keys[value];
  const extra = extraTabs.find((t) => t.key === current);

  const handleChange = (_event: SyntheticEvent, newValue: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", keys[newValue]);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs value={value} onChange={handleChange} centered>
          <Tab label="図" sx={{ textTransform: "none" }} />
          {extraTabs.map((t) => (
            <Tab key={t.key} label={t.label} sx={{ textTransform: "none" }} />
          ))}
          <Tab label="WBS" sx={{ textTransform: "none" }} />
        </Tabs>
      </Box>
      <div className="flex min-h-0 flex-1 overflow-auto">
        {current === TAB_WBS ? (
          <WbsTab startId={wbsStartId} />
        ) : extra ? (
          extra.content
        ) : (
          children
        )}
      </div>
    </div>
  );
}
