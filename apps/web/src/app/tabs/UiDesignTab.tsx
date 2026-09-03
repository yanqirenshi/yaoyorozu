"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import MenuList from "@mui/material/MenuList";
import MenuItem from "@mui/material/MenuItem";
import ListItemText from "@mui/material/ListItemText";
import Box from "@mui/material/Box";
import { COMPONENT_NAV, type NavItem } from "@/data/uiDesign";
import BasicIndexPage from "./UiDesign/BasicIndexPage";
import ColorPage from "./UiDesign/ColorPage";
import CornerPage from "./UiDesign/CornerPage";
import ElevationPage from "./UiDesign/ElevationPage";
import IconPage from "./UiDesign/IconPage";
import LayoutPage from "./UiDesign/LayoutPage";
import LinkTextPage from "./UiDesign/LinkTextPage";
import SpacingPage from "./UiDesign/SpacingPage";
import TypographyPage from "./UiDesign/TypographyPage";
import FoundationPage, { Para } from "./UiDesign/FoundationPage";
import { BORDER, textStyle } from "./UiDesign/tokens";

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
          <ListItemText
            slotProps={{ primary: { sx: textStyle("UI-16M-100") } }}
          >
            {entry.item.label}
          </ListItemText>
        </MenuItem>
      ))}
    </MenuList>
  );
}

/** 未定義の項目。基本デザインが固まるまでは、ここに何を書くかだけを示す。 */
function PlaceholderPage({ item }: { item: NavItem }) {
  return (
    <FoundationPage
      title={item.label}
      lead={
        <Para>
          このページはまだ定義していない。基本デザイン(色・文字・余白・角・高さ)が固まったあと、
          その値を使って組み立てたコンポーネントとして定義する。
        </Para>
      }
      sections={[]}
    />
  );
}

function Content({
  item,
  onSelect,
}: {
  item: NavItem;
  onSelect: (key: string) => void;
}) {
  switch (item.key) {
    case "basic":
      return <BasicIndexPage onSelect={onSelect} />;
    case "color":
      return <ColorPage />;
    case "typography":
      return <TypographyPage />;
    case "icon":
      return <IconPage />;
    case "basic-layout":
      return <LayoutPage />;
    case "link-text":
      return <LinkTextPage />;
    case "spacing":
      return <SpacingPage />;
    case "corner":
      return <CornerPage />;
    case "elevation":
      return <ElevationPage />;
    default:
      return <PlaceholderPage item={item} />;
  }
}

export default function UiDesignTab() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const selected = searchParams.get("item") ?? "basic";
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
      <Box
        className="w-64 shrink-0 overflow-auto"
        sx={{ borderRight: "1px solid " + BORDER }}
      >
        <Box sx={{ ...textStyle("Head-16B-150"), px: "16px", pt: "16px", pb: "8px" }}>
          コンポーネント
        </Box>
        <NavMenu selected={selected} onSelect={handleSelect} />
      </Box>
      <div className="flex-1 overflow-auto px-6 py-8">
        {selectedItem && (
          <Content item={selectedItem} onSelect={handleSelect} />
        )}
      </div>
    </div>
  );
}
