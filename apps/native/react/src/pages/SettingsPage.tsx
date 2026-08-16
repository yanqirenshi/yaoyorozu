import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  getGithubAuthStatus,
  getSettings,
  githubLoginStart,
  githubLogout,
  isAppError,
  listGithubProjects,
  listProjects,
  onGithubAuthFailed,
  onGithubAuthenticated,
  onGithubLoggedOut,
  updateSettings,
} from "../api";
import type {
  DeviceCodeDto,
  GithubAuthStatusDto,
  GithubProjectSummaryDto,
  ProjectDto,
} from "../api";

function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [repositoryPath, setRepositoryPath] = useState<string | null>(null);
  const [claudeProjectsDir, setClaudeProjectsDir] = useState<string | null>(null);
  const [githubOwner, setGithubOwner] = useState("");
  const [githubNumber, setGithubNumber] = useState("");
  const [folders, setFolders] = useState<ProjectDto[]>([]);
  const [selectedProjectFolders, setSelectedProjectFolders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [authStatus, setAuthStatus] = useState<GithubAuthStatusDto>({
    authenticated: false,
    login: null,
  });
  const [deviceCode, setDeviceCode] = useState<DeviceCodeDto | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [githubProjects, setGithubProjects] = useState<GithubProjectSummaryDto[]>([]);

  useEffect(() => {
    getSettings()
      .then((settings) => {
        setRepositoryPath(settings.repository_path);
        setClaudeProjectsDir(settings.claude_projects_dir);
        setGithubOwner(settings.github_project?.owner ?? "");
        setGithubNumber(
          settings.github_project ? String(settings.github_project.number) : "",
        );
        setSelectedProjectFolders(settings.selected_project_folders);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    listProjects()
      .then(setFolders)
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  useEffect(() => {
    getGithubAuthStatus().then(setAuthStatus);
  }, []);

  useEffect(() => {
    if (!authStatus.authenticated) {
      setGithubProjects([]);
      return;
    }
    listGithubProjects()
      .then(setGithubProjects)
      .catch((e) => setAuthError(isAppError(e) ? e.message : String(e)));
  }, [authStatus.authenticated]);

  useEffect(() => {
    const unlistenPromise = onGithubAuthenticated(({ login }) => {
      setAuthStatus({ authenticated: true, login });
      setDeviceCode(null);
      setAuthenticating(false);
      setAuthError(null);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const unlistenPromise = onGithubAuthFailed(({ message }) => {
      setDeviceCode(null);
      setAuthenticating(false);
      setAuthError(message);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const unlistenPromise = onGithubLoggedOut(() => {
      setAuthStatus({ authenticated: false, login: null });
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const handleGithubLogin = () => {
    setAuthenticating(true);
    setAuthError(null);
    githubLoginStart()
      .then(setDeviceCode)
      .catch((e) => {
        setAuthenticating(false);
        setAuthError(isAppError(e) ? e.message : String(e));
      });
  };

  const handleGithubLogout = () => {
    githubLogout().catch((e) => setAuthError(isAppError(e) ? e.message : String(e)));
  };

  const handleCopyUserCode = () => {
    if (!deviceCode) return;
    navigator.clipboard.writeText(deviceCode.user_code).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  };

  const handleOpenVerificationUri = () => {
    if (!deviceCode) return;
    void openUrl(deviceCode.verification_uri);
  };

  const handleSelectGithubProject = (numberValue: string) => {
    setGithubNumber(numberValue);
    if (numberValue && authStatus.login) {
      setGithubOwner(authStatus.login);
    }
  };

  const handleChooseFolder = async () => {
    const path = await open({ directory: true, multiple: false });
    if (typeof path === "string") {
      setRepositoryPath(path);
    }
  };

  const handleChooseProjectsDir = async () => {
    const path = await open({ directory: true, multiple: false });
    if (typeof path === "string") {
      setClaudeProjectsDir(path);
    }
  };

  const handleResetProjectsDir = () => {
    setClaudeProjectsDir(null);
  };

  const toggleProjectFolder = (name: string) => {
    setSelectedProjectFolders((prev) =>
      prev.includes(name) ? prev.filter((f) => f !== name) : [...prev, name],
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
      selected_project_folders: selectedProjectFolders,
      claude_projects_dir: claudeProjectsDir,
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
          <h3>セッションのルートディレクトリ</h3>
          <div className="settings-folder-picker">
            <span className="settings-folder-path">
              {claudeProjectsDir ?? "既定を使用"}
            </span>
            <button type="button" onClick={handleChooseProjectsDir}>
              フォルダを選択
            </button>
            <button
              type="button"
              onClick={handleResetProjectsDir}
              disabled={claudeProjectsDir === null}
            >
              既定に戻す
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>GitHub認証</h3>
          {authStatus.authenticated ? (
            <div className="settings-github-auth">
              <span>{authStatus.login} としてログイン中</span>
              <button type="button" onClick={handleGithubLogout}>
                ログアウト
              </button>
            </div>
          ) : deviceCode ? (
            <div className="settings-github-auth">
              <p>
                以下のコードをブラウザで入力してください:
                <br />
                <strong className="settings-user-code">{deviceCode.user_code}</strong>
              </p>
              <button type="button" onClick={handleCopyUserCode}>
                {codeCopied ? "コピーしました" : "コードをコピー"}
              </button>
              <button type="button" onClick={handleOpenVerificationUri}>
                ブラウザで開く
              </button>
            </div>
          ) : (
            <div className="settings-github-auth">
              <button type="button" onClick={handleGithubLogin} disabled={authenticating}>
                {authenticating ? "開始中…" : "GitHubでログイン"}
              </button>
            </div>
          )}
          {authError && <p className="error">{authError}</p>}
        </section>

        <section className="settings-section">
          <h3>GitHubプロジェクト</h3>
          {authStatus.authenticated ? (
            <label className="settings-field">
              プロジェクト
              <select
                value={githubNumber}
                onChange={(e) => handleSelectGithubProject(e.target.value)}
              >
                <option value="">未選択</option>
                {githubProjects.map((p) => (
                  <option key={p.number} value={String(p.number)}>
                    {p.title}
                    {p.closed ? "(closed)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
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
            </>
          )}
        </section>

        <section className="settings-section">
          <h3>対象フォルダ</h3>
          {folders.length === 0 && <p>フォルダが見つかりません。</p>}
          <ul className="settings-folder-list">
            {folders.map((f) => (
              <li key={f.name}>
                <label
                  className={`settings-folder-item ${
                    selectedProjectFolders.includes(f.name) ? "selected" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedProjectFolders.includes(f.name)}
                    onChange={() => toggleProjectFolder(f.name)}
                  />
                  {f.name}
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
