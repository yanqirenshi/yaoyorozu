"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import MenuList from "@mui/material/MenuList";
import MenuItem from "@mui/material/MenuItem";
import ListItemText from "@mui/material/ListItemText";
import { Section } from "tion";
import { COLOR_PALETTE, COMPONENT_NAV, type NavItem } from "@/data/uiDesign";

type FlatNavItem = { item: NavItem; depth: number };

function flattenNav(items: NavItem[], depth = 0): FlatNavItem[] {
  return items.flatMap((item) => [
    { item, depth },
    ...(item.children ? flattenNav(item.children, depth + 1) : []),
  ]);
}

const FLAT_NAV = flattenNav(COMPONENT_NAV);

function NavMenu({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <MenuList>
      {FLAT_NAV.map((entry) => (
        <MenuItem
          key={entry.item.key}
          selected={entry.item.key === selected}
          onClick={() => onSelect(entry.item.key)}
          sx={{ pl: 2 + entry.depth * 2 }}
        >
          <ListItemText>{entry.item.label}</ListItemText>
        </MenuItem>
      ))}
    </MenuList>
  );
}

function ColorPaletteSwatches() {
  return (
    <div className="flex flex-col gap-4">
      {COLOR_PALETTE.map((color) => (
        <div key={color.name} className="flex items-center gap-4">
          <div
            className="h-12 w-12 shrink-0 rounded border border-black/10"
            style={{ backgroundColor: color.hex }}
          />
          <div className="flex flex-col">
            <span className="font-semibold">{color.name}</span>
            <span className="text-sm text-zinc-500">
              {color.hex}
              {color.ratio !== undefined
                ? ` / ${color.ratio}%`
                : color.usage
                  ? `(${color.usage})`
                  : ""}
            </span>
          </div>
        </div>
      ))}
    </div>
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
        <Section key={item.key} title={item.label} lev={level}>
          {item.key === "color" && <ColorPaletteSwatches />}
          {item.children && (
            <ContentSections items={item.children} level={level + 1} />
          )}
        </Section>
      ))}
    </>
  );
}

export default function UiDesignTab() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const selected = searchParams.get("item") ?? FLAT_NAV[0]?.item.key ?? "";
  const selectedItem =
    FLAT_NAV.find((entry) => entry.item.key === selected)?.item ??
    FLAT_NAV[0]?.item;

  const handleSelect = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("item", key);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex min-h-0 w-full flex-1">
      <div className="w-64 shrink-0 overflow-auto border-r border-zinc-400">
        <h2 className="px-4 pt-4 pb-2 text-lg font-bold">コンポーネント</h2>
        <NavMenu selected={selected} onSelect={handleSelect} />
      </div>
      <div className="flex-1 overflow-auto p-6">
        {selectedItem && <ContentSections items={[selectedItem]} />}
      </div>
    </div>
  );
}
