import type { DetailedHTMLProps, HTMLAttributes } from "react";
import type {
  MarkdownEditor,
  MarkdownViewer,
  MarkdownWorkspace,
} from "@yanqirenshi/markdown.sitter";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "markdown-workspace": DetailedHTMLProps<
        HTMLAttributes<MarkdownWorkspace>,
        MarkdownWorkspace
      > & {
        mode?: "editor" | "split" | "preview";
        live?: boolean;
      };
      "markdown-editor": DetailedHTMLProps<
        HTMLAttributes<MarkdownEditor>,
        MarkdownEditor
      > & {
        placeholder?: string;
      };
      "markdown-viewer": DetailedHTMLProps<
        HTMLAttributes<MarkdownViewer>,
        MarkdownViewer
      > & {
        foldable?: boolean;
      };
    }
  }
}
