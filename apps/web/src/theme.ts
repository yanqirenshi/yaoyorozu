import { createTheme, alpha } from "@mui/material/styles";
import { COLOR_PALETTE } from "@/data/uiDesign";

const kyoMurasaki = COLOR_PALETTE.find((c) => c.name === "京紫")!.hex;
const kincha = COLOR_PALETTE.find((c) => c.name === "金茶")!.hex;
const kusaIro = COLOR_PALETTE.find((c) => c.name === "草色")!.hex;
const shinju = COLOR_PALETTE.find((c) => c.name === "真珠")!.hex;
const sumi = COLOR_PALETTE.find((c) => c.name === "墨")!.hex;

export const theme = createTheme({
  palette: {
    primary: { main: kyoMurasaki },
    secondary: { main: kincha },
    info: { main: kusaIro },
    background: { default: shinju, paper: shinju },
    text: { primary: sumi, secondary: alpha(sumi, 0.72) },
  },
  components: {
    MuiMenuItem: {
      styleOverrides: {
        root: {
          "&.Mui-selected": {
            backgroundColor: alpha(kyoMurasaki, 0.12),
            "&:hover": {
              backgroundColor: alpha(kyoMurasaki, 0.18),
            },
          },
        },
      },
    },
  },
});
