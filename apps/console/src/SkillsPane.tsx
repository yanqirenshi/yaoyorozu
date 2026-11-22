"use client";

import SafeMarkdownViewer from "./SafeMarkdownViewer";
import { useEffect, useState } from "react";
import "./externalLinks";
import { getSkill, isAppError, listSkills } from "@/api";
import type { SkillSummaryDto } from "@/api";

type SkillsPaneProps = {
  // 対象プロファイル(backend がそのリポジトリを解決する。issue #269)。
  profileId: string | null;
  selectedName: string | null;
  onSelectSkill: (name: string) => void;
};

// `.claude/skills/<name>/SKILL.md` の一覧+表示(issue #65)。RulesPane
// (issue #61)と同じ流儀。表示のみで編集は行わない。
function SkillsPane({ profileId, selectedName, onSelectSkill }: SkillsPaneProps) {
  const [skills, setSkills] = useState<SkillSummaryDto[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);


  useEffect(() => {
    setLoadingList(true);
    setListError(null);
    listSkills(profileId)
      .then(setSkills)
      .catch((e) => setListError(isAppError(e) ? e.message : String(e)))
      .finally(() => setLoadingList(false));
  }, [profileId]);

  useEffect(() => {
    if (!selectedName) {
      setContent(null);
      setContentError(null);
      return;
    }
    setContent(null);
    setLoadingContent(true);
    setContentError(null);
    getSkill(profileId, selectedName)
      .then((dto) => setContent(dto.content))
      .catch((e) => setContentError(isAppError(e) ? e.message : String(e)))
      .finally(() => setLoadingContent(false));
  }, [profileId, selectedName]);

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
            <SafeMarkdownViewer text={content ?? ""} className="file-content-viewer" />
          </>
        )}
      </div>
    </div>
  );
}

export default SkillsPane;
