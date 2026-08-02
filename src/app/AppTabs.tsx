"use client";

import { useState, type SyntheticEvent } from "react";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import WbsTab from "./tabs/WbsTab";
import DeploymentTab from "./tabs/DeploymentTab";
import SitemapTab from "./tabs/SitemapTab";
import ClassesTab from "./tabs/ClassesTab";
import TmTab from "./tabs/TmTab";

const TAB_LABELS = ["wbs", "構成図", "UIデザイン", "サイトマップ", "Classes", "TM"];

function TabContent({ index }: { index: number }) {
  switch (index) {
    case 0:
      return <WbsTab />;
    case 1:
      return <DeploymentTab />;
    case 3:
      return <SitemapTab />;
    case 4:
      return <ClassesTab />;
    case 5:
      return <TmTab />;
    default:
      return (
        <div className="flex h-full w-full items-center justify-center">
          {TAB_LABELS[index]}
        </div>
      );
  }
}

export default function AppTabs() {
  const [value, setValue] = useState(0);

  const handleChange = (_event: SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };

  return (
    <div className="flex flex-1 flex-col border border-zinc-400 font-sans">
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs value={value} onChange={handleChange}>
          {TAB_LABELS.map((label) => (
            <Tab key={label} label={label} sx={{ textTransform: "none" }} />
          ))}
        </Tabs>
      </Box>
      <div className="flex min-h-0 flex-1 overflow-auto">
        <TabContent index={value} />
      </div>
    </div>
  );
}
