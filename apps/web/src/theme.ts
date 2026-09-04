import { createTheme } from "@mui/material/styles";
import { COLOR_PALETTE, SEMANTIC_COLORS, roleColor } from "@/data/uiDesign";
import { FONT_FAMILIES } from "@/data/uiTypography";

const kyoMurasaki = COLOR_PALETTE.find((c) => c.name === "京紫")!.hex;
const kincha = COLOR_PALETTE.find((c) => c.name === "金茶")!.hex;
const kusaIro = COLOR_PALETTE.find((c) => c.name === "草色")!.hex;
const shinju = COLOR_PALETTE.find((c) => c.name === "真珠")!.hex;

const pickSemantic = (token: string) => {
  const found = SEMANTIC_COLORS.find((c) => c.token === token);
  if (!found) throw new Error("未定義のトークンです: " + token);
  return found;
};

const sansStack = FONT_FAMILIES.find((f) => f.token === "font.sans")!.stack;

export const theme = createTheme({
  typography: {
    fontFamily: sansStack,
  },
  palette: {
    primary: { main: kyoMurasaki },
    secondary: { main: kincha },
    info: { main: kusaIro },
    background: { default: shinju, paper: shinju },
    divider: roleColor("border.default"),
    text: {
      primary: roleColor("text.primary"),
      secondary: roleColor("text.secondary"),
      disabled: roleColor("text.disabled"),
    },
    success: { main: pickSemantic("semantic.success").border },
    warning: { main: pickSemantic("semantic.warning").border },
    error: { main: pickSemantic("semantic.error").border },
  },
  components: {
    MuiMenuItem: {
      styleOverrides: {
        root: {
          "&:hover": {
            backgroundColor: roleColor("state.hover"),
          },
          "&.Mui-selected": {
            backgroundColor: roleColor("state.selected"),
            "&:hover": {
              backgroundColor: roleColor("state.selected-hover"),
            },
          },
        },
      },
    },
  },
});
