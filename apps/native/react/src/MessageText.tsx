import { useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import "@yanqirenshi/markdown.sitter";
import type { MarkdownViewer } from "@yanqirenshi/markdown.sitter";

// 会話メッセージ本文の Markdown 描画(issue #319)。以前は marked + DOMPurify の
// 自前描画だったが、markdown.sitter の markdown-viewer(閲覧専用の Web
// Component)に置き換えた。CLAUDE.md/Rules/Skills の各ビュー(RulesPane 等)と
// 同じ「sanitize フックを設定し、markdown プロパティに本文を渡す」流儀。
// `foldable` は明示的に false にする(コンポーネントの既定は true。短い発言が
// 多い吹き出しでは見出しの折り畳みが馴染まないため。実装時判断)。JSX の
// `foldable={false}` は効かない(要素が DOM に接続される際、コンポーネント
// 自身の connectedCallback が「属性が無ければ既定で足す」処理を先に行うため、
// 接続前に設定した false が接続直後に上書きされる。実機で確認)。接続後に
// 効く useEffect で明示的に設定し直す。0.1.4(issue #375)時点でも
// markdown-viewer.js の該当ロジック(connectedCallback)は変更されておらず、
// この回避策は引き続き必要(0.1.1→0.1.2はテーブルセルの padding、0.1.2→0.1.3は
// `marked.parse` の `breaks: true`=単独の改行を <br> にする、0.1.3→0.1.4は
// スタイルのテーブル幅 `width: auto; max-width: 100%`=内容に合わせた幅、のみ)。
type MessageTextProps = {
  text: string;
};

function MessageText({ text }: MessageTextProps) {
  const viewerRef = useRef<MarkdownViewer | null>(null);

  // sanitize は要素が生成されるたびに設定し直す必要がある(既定は素通しの
  // ため必須。RulesPane と同じ理由)。要素自体はこのコンポーネントの生存中
  // 不変なので、マウント時の1回でよい。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.sanitize = (html) => DOMPurify.sanitize(html);
    viewer.foldable = false;
  }, []);

  // text が変わらない限り `.markdown` の再設定をしない(issue #314 の差分
  // 反映で、変化の無いメッセージの Web Component が作り直されない・
  // 再描画されないようにするため)。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.markdown = text;
  }, [text]);

  return <markdown-viewer ref={viewerRef} className="message-text" />;
}

export default MessageText;
