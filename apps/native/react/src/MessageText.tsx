import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ breaks: true });

type MessageTextProps = {
  text: string;
};

function MessageText({ text }: MessageTextProps) {
  const html = useMemo(() => {
    const rawHtml = marked.parse(text, { async: false });
    return DOMPurify.sanitize(rawHtml);
  }, [text]);

  return <div className="message-text" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default MessageText;
