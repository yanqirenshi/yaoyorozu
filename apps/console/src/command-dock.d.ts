import type { DetailedHTMLProps, HTMLAttributes } from "react";
import type { CommandDock } from "command-dock";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "command-dock": DetailedHTMLProps<
        HTMLAttributes<CommandDock>,
        CommandDock
      >;
    }
  }
}
