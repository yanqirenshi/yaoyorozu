"use client";

import { useState } from "react";
import MenuList from "@mui/material/MenuList";
import MenuItem from "@mui/material/MenuItem";
import ListItemText from "@mui/material/ListItemText";
import { Section } from "tion";
import { COMPONENT_NAV, type NavItem } from "@/data/uiDesign";

type FlatNavItem = { label: string; depth: number };

function flattenNav(items: NavItem[], depth = 0): FlatNavItem[] {
  return items.flatMap((item) => [
    { label: item.label, depth },
    ...(item.children ? flattenNav(item.children, depth + 1) : []),
  ]);
}

const FLAT_NAV = flattenNav(COMPONENT_NAV);

function NavMenu() {
  const [selected, setSelected] = useState(FLAT_NAV[0]?.label ?? "");

  return (
    <MenuList>
      {FLAT_NAV.map((entry) => (
        <MenuItem
          key={entry.label}
          selected={entry.label === selected}
          onClick={() => setSelected(entry.label)}
          sx={{ pl: 2 + entry.depth * 2 }}
        >
          <ListItemText>{entry.label}</ListItemText>
        </MenuItem>
      ))}
    </MenuList>
  );
}

function ContentSections({
  items,
  level = 3,
}: {
  items: NavItem[];
  level?: number;
}) {
  return (
    <>
      {items.map((item) => (
        <Section key={item.label} title={item.label} lev={level}>
          {item.children && (
            <ContentSections items={item.children} level={level + 1} />
          )}
        </Section>
      ))}
    </>
  );
}

export default function UiDesignTab() {
  return (
    <div className="flex min-h-0 w-full flex-1">
      <div className="w-64 shrink-0 overflow-auto border-r border-zinc-400">
        <h2 className="px-4 pt-4 pb-2 text-lg font-bold">コンポーネント</h2>
        <NavMenu />
      </div>
      <div className="flex-1 overflow-auto p-6">
        <ContentSections items={COMPONENT_NAV} />
      </div>
    </div>
  );
}
