"use client";

import { useCallback, useState } from "react";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import {
  saveLayoutToApi,
  type LayoutDiagram,
} from "@/data/layoutSaveApi";

type SaveState =
  | { open: false }
  | { open: true; severity: "success" | "error"; message: string };

/**
 * レイアウト保存APIの成否をさりげなく(成功)/はっきり(失敗)表示するための
 * 共通フック。サイトマップ・Classes・TM の3図で共用する。
 */
export function useLayoutSaveStatus(diagram: LayoutDiagram) {
  const [state, setState] = useState<SaveState>({ open: false });

  const save = useCallback(
    async (overrides: unknown) => {
      const result = await saveLayoutToApi(diagram, overrides);
      if (result.ok) {
        setState({ open: true, severity: "success", message: "レイアウトを保存しました" });
      } else if (result.status === 405) {
        setState({
          open: true,
          severity: "error",
          message: "本番では保存できません(開発サーバーで実行してください)",
        });
      } else {
        setState({ open: true, severity: "error", message: "保存に失敗しました" });
      }
      return result;
    },
    [diagram],
  );

  const close = useCallback(() => setState({ open: false }), []);

  return { state, save, close };
}

export function LayoutSaveStatusSnackbar({
  state,
  onClose,
}: {
  state: SaveState;
  onClose: () => void;
}) {
  return (
    <Snackbar
      open={state.open}
      autoHideDuration={state.open && state.severity === "success" ? 2000 : 4000}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
    >
      {state.open ? (
        <Alert onClose={onClose} severity={state.severity} variant="filled">
          {state.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  );
}
