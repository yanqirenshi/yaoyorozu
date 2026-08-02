"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import MenuList from "@mui/material/MenuList";
import MenuItem from "@mui/material/MenuItem";
import ListItemText from "@mui/material/ListItemText";
import { NAV_MENU_ITEMS } from "@/data/navigation";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex flex-1 border border-zinc-400 font-sans">
      <div className="w-64 shrink-0 border-r border-zinc-400">
        <MenuList>
          {NAV_MENU_ITEMS.map((item) => (
            <MenuItem
              key={item.path}
              component={Link}
              href={item.path}
              selected={pathname === item.path}
            >
              <ListItemText>{item.label}</ListItemText>
            </MenuItem>
          ))}
        </MenuList>
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
