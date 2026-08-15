import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getProjectName,
  getSettings,
  isAppError,
  listSessions,
  updateSettings,
} from "../api";
import type { SessionSummaryDto } from "../api";

function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [repositoryPath, setRepositoryPath] = useState<string | null>(null);
  const [githubOwner, setGithubOwner] = useState("");
  const [githubNumber, setGithubNumber] = useState("");
  const [sessions, setSessions] = useState<SessionSummaryDto[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings()
      .then((settings) => {
        setRepositoryPath(settings.repository_path);
        setGithubOwner(settings.github_project?.owner ?? "");
        setGithubNumber(
          settings.github_project ? String(settings.github_project.number) : "",
        );
        setSelectedSessionIds(settings.selected_session_ids);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!repositoryPath) {
      setSessions([]);
      return;
    }
    getProjectName(repositoryPath)
      .then((project) => listSessions(project))
      .then(setSessions)
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, [repositoryPath]);

  const handleChooseFolder = async () => {
    const path = await open({ directory: true, multiple: false });
    if (typeof path === "string") {
      setRepositoryPath(path);
      // フォルダを変えたら、別リポジトリのセッションIDを持ち越さない。
      setSelectedSessionIds([]);
    }
  };

  const toggleSession = (id: string) => {
    setSelectedSessionIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const ownerInput = githubOwner.trim();
    const numberInput = Number(githubNumber);
    const githubProject = ownerInput
      ? { owner: ownerInput, number: Number.isNaN(numberInput) ? 0 : numberInput }
      : null;

    updateSettings({
      repository_path: repositoryPath,
      github_project: githubProject,
      selected_session_ids: selectedSessionIds,
    })
      .then(() => setSaved(true))
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  if (loading) {
    return (
      <div className="settings-page">
        <h2>設定</h2>
        <p>読み込み中…</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <h2>設定</h2>
      <form className="settings-form" onSubmit={handleSave}>
        <section className="settings-section">
          <h3>対象リポジトリ</h3>
          <div className="settings-folder-picker">
            <span className="settings-folder-path">{repositoryPath ?? "未選択"}</span>
            <button type="button" onClick={handleChooseFolder}>
              フォルダを選択
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>GitHubプロジェクト</h3>
          <label className="settings-field">
            owner
            <input
              type="text"
              value={githubOwner}
              onChange={(e) => setGithubOwner(e.target.value)}
              placeholder="例: yanqirenshi"
            />
          </label>
          <label className="settings-field">
            プロジェクト番号
            <input
              type="number"
              value={githubNumber}
              onChange={(e) => setGithubNumber(e.target.value)}
              placeholder="例: 51"
            />
          </label>
        </section>

        <section className="settings-section">
          <h3>対象セッション</h3>
          {!repositoryPath && <p>先にリポジトリを選択してください。</p>}
          {repositoryPath && sessions.length === 0 && (
            <p>このリポジトリのセッションが見つかりません。</p>
          )}
          <ul className="settings-session-list">
            {sessions.map((s) => (
              <li key={s.id}>
                <label className="settings-session-item">
                  <input
                    type="checkbox"
                    checked={selectedSessionIds.includes(s.id)}
                    onChange={() => toggleSession(s.id)}
                  />
                  {s.excerpt || "(本文なし)"}
                </label>
              </li>
            ))}
          </ul>
        </section>

        {error && <p className="error">{error}</p>}
        <button type="submit" className="settings-save" disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </button>
        {saved && <p className="settings-saved">保存しました。</p>}
      </form>
    </div>
  );
}

export default SettingsPage;
