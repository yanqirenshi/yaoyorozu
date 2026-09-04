"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Box from "@mui/material/Box";
import MenuList from "@mui/material/MenuList";
import MenuItem from "@mui/material/MenuItem";
import ListItemText from "@mui/material/ListItemText";
import { NAV_MENU_ITEMS } from "@/data/navigation";
import { COLOR_PALETTE, roleColor } from "@/data/uiDesign";

const kyoMurasaki = COLOR_PALETTE.find((c) => c.name === "京紫")!.hex;
// ペインの区切りは1pxの罫線(基本デザイン「レイアウト」)。
const border = "1px solid " + roleColor("border.default");

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <Box className="flex min-h-0 flex-1 font-sans" sx={{ border }}>
      <Box className="w-64 shrink-0 overflow-auto" sx={{ borderRight: border }}>
        <div className="px-4 pt-4 pb-3">
          <h1
            className="text-xl font-bold tracking-wide"
            style={{ color: kyoMurasaki }}
          >
            YAOYOROZU
          </h1>
          <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full">
            {COLOR_PALETTE.filter((color) => color.ratio !== undefined).map(
              (color) => (
                <div
                  key={color.name}
                  style={{
                    backgroundColor: color.hex,
                    width: `${color.ratio}%`,
                  }}
                />
              ),
            )}
          </div>
        </div>
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
      </Box>
      <div className="flex min-h-0 flex-1 overflow-auto">{children}</div>
    </Box>
  );
}
