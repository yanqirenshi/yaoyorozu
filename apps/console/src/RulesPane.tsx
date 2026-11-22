"use client";

import SafeMarkdownViewer from "./SafeMarkdownViewer";
import { useEffect, useState } from "react";
import "./externalLinks";
import { getRule, isAppError, listRules } from "@/api";
import type { RuleSummaryDto } from "@/api";

type RulesPaneProps = {
  // 対象プロファイル(backend がそのリポジトリを解決する。issue #269)。
  profileId: string | null;
  selectedFileName: string | null;
  onSelectFile: (fileName: string) => void;
};

// `.claude/rules/*.md` の一覧+表示(issue #61)。表示のみで編集は行わない。
function RulesPane({ profileId, selectedFileName, onSelectFile }: RulesPaneProps) {
  const [rules, setRules] = useState<RuleSummaryDto[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);


  useEffect(() => {
    setLoadingList(true);
    setListError(null);
    listRules(profileId)
      .then(setRules)
      .catch((e) => setListError(isAppError(e) ? e.message : String(e)))
      .finally(() => setLoadingList(false));
  }, [profileId]);

  useEffect(() => {
    if (!selectedFileName) {
      setContent(null);
      setContentError(null);
      return;
    }
    setContent(null);
    setLoadingContent(true);
    setContentError(null);
    getRule(profileId, selectedFileName)
      .then((dto) => setContent(dto.content))
      .catch((e) => setContentError(isAppError(e) ? e.message : String(e)))
      .finally(() => setLoadingContent(false));
  }, [profileId, selectedFileName]);

  return (
    <div className="file-list-pane">
      <div className="file-list">
        {loadingList ? (
          <p>読み込み中…</p>
        ) : listError ? (
          <p className="error">{listError}</p>
        ) : rules.length === 0 ? (
          <p>ルールがありません。</p>
        ) : (
          rules.map((rule) => (
            <button
              key={rule.file_name}
              type="button"
              className={`file-list-item ${
                rule.file_name === selectedFileName ? "selected" : ""
              }`}
              onClick={() => onSelectFile(rule.file_name)}
            >
              <span className="file-list-item-name">{rule.file_name}</span>
              <span className="file-list-item-updated">
                {new Date(rule.modified_at_ms).toLocaleString()}
              </span>
            </button>
          ))
        )}
      </div>
      <div className="file-content-pane">
        {!selectedFileName ? (
          <p>ルールを選択してください。</p>
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

export default RulesPane;
