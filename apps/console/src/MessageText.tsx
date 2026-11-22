"use client";

import { viewOfText } from "./largeText";
import SafeMarkdownViewer from "./SafeMarkdownViewer";

// 会話メッセージ本文の Markdown 描画(issue #319)。markdown.sitter の markdown-viewer を、
// 無害化つきの共通部品(`SafeMarkdownViewer`。`safeMarkdown.ts`)で使う。
// `foldable` は false にする(コンポーネントの既定は true。短い発言が多い吹き出しでは見出しの
// 折り畳みが馴染まないため)。本文(`text`)が変わらない限り `.markdown` を再設定しない
// (issue #314 の差分反映で、変化の無いメッセージが再描画されないようにするため。部品の effect が
// `text` の変化でだけ動く)。
type MessageTextProps = {
  text: string;
};

function MessageText({ text }: MessageTextProps) {
  // とても大きい発言(目安 1MB 超)は、Markdown として描かず、先頭だけを素の文字で出す(`largeText.ts`)。
  const view = viewOfText(text);
  if (view.large) {
    return (
      <div className="message-text message-text-large">
        <pre className="message-text-large-body">{view.preview}</pre>
        <p className="message-text-large-note">{view.note}</p>
      </div>
    );
  }
  return <SafeMarkdownViewer text={text} foldable={false} className="message-text" />;
}

export default MessageText;
