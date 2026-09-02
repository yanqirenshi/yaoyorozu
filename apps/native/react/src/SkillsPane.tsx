import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import "@yanqirenshi/markdown.sitter";
import type { MarkdownViewer } from "@yanqirenshi/markdown.sitter";
import { getSkill, isAppError, listSkills } from "./api";
import type { SkillSummaryDto } from "./api";

type SkillsPaneProps = {
  project: string;
  selectedName: string | null;
  onSelectSkill: (name: string) => void;
};

// `.claude/skills/<name>/SKILL.md` の一覧+表示(issue #65)。RulesPane
// (issue #61)と同じ流儀。表示のみで編集は行わない。
function SkillsPane({ project, selectedName, onSelectSkill }: SkillsPaneProps) {
  const [skills, setSkills] = useState<SkillSummaryDto[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const viewerRef = useRef<MarkdownViewer | null>(null);

  useEffect(() => {
    setLoadingList(true);
    setListError(null);
    listSkills(project)
      .then(setSkills)
      .catch((e) => setListError(isAppError(e) ? e.message : String(e)))
      .finally(() => setLoadingList(false));
  }, [project]);

  useEffect(() => {
    if (!selectedName) {
      setContent(null);
      setContentError(null);
      return;
    }
    setContent(null);
    setLoadingContent(true);
    setContentError(null);
    getSkill(project, selectedName)
      .then((dto) => setContent(dto.content))
      .catch((e) => setContentError(isAppError(e) ? e.message : String(e)))
      .finally(() => setLoadingContent(false));
  }, [project, selectedName]);

  // viewerは選択中スキルがある間だけDOMに存在するため、その都度sanitize
  // フックを設定し直す。既定は素通しのため必須設定(issue #57と同じ理由)。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.sanitize = (html) => DOMPurify.sanitize(html);
  }, [selectedName]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.markdown = content ?? "";
  }, [content]);

  return (
    <div className="file-list-pane">
      <div className="file-list">
        {loadingList ? (
          <p>読み込み中…</p>
        ) : listError ? (
          <p className="error">{listError}</p>
        ) : skills.length === 0 ? (
          <p>スキルがありません。</p>
        ) : (
          skills.map((skill) => (
            <button
              key={skill.name}
              type="button"
              className={`file-list-item ${skill.name === selectedName ? "selected" : ""}`}
              onClick={() => onSelectSkill(skill.name)}
            >
              <span className="file-list-item-name">{skill.name}</span>
              <span className="file-list-item-updated">
                {new Date(skill.modified_at_ms).toLocaleString()}
              </span>
            </button>
          ))
        )}
      </div>
      <div className="file-content-pane">
        {!selectedName ? (
          <p>スキルを選択してください。</p>
        ) : (
          <>
            {loadingContent && <p>読み込み中…</p>}
            {contentError && <p className="error">{contentError}</p>}
            <markdown-viewer ref={viewerRef} foldable className="file-content-viewer" />
          </>
        )}
      </div>
    </div>
  );
}

export default SkillsPane;
