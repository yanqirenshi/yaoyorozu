"use client";

import { type ReactNode, type SyntheticEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import WbsTab from "./tabs/WbsTab";

const TAB_DIAGRAM = "diagram";
const TAB_WBS = "wbs";

export default function DiagramPage({
  children,
  wbsStartId,
}: {
  children: ReactNode;
  wbsStartId?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tab = searchParams.get("tab") === TAB_WBS ? TAB_WBS : TAB_DIAGRAM;
  const value = tab === TAB_WBS ? 1 : 0;

  const handleChange = (_event: SyntheticEvent, newValue: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", newValue === 1 ? TAB_WBS : TAB_DIAGRAM);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs value={value} onChange={handleChange} centered>
          <Tab label="図" sx={{ textTransform: "none" }} />
          <Tab label="WBS" sx={{ textTransform: "none" }} />
        </Tabs>
      </Box>
      <div className="flex min-h-0 flex-1 overflow-auto">
        {value === 0 ? children : <WbsTab startId={wbsStartId} />}
      </div>
    </div>
  );
}
