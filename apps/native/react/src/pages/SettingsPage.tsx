import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DockItem } from "command-dock";
import type { ViewMode } from "@yanqirenshi/markdown.sitter";
import {
  createProfile,
  deleteProfile,
  getGithubAuthStatus,
  getRepositoryClaudeMd,
  getSettings,
  githubLoginStart,
  githubLogout,
  isAppError,
  listGithubProjects,
  listProjects,
  onGithubAuthFailed,
  onGithubAuthenticated,
  onGithubLoggedOut,
  onSettingsUpdated,
  renameProfile,
  saveRepositoryClaudeMd,
  switchProfile,
  updateSettings,
} from "../api";
import type {
  DeviceCodeDto,
  GithubAuthStatusDto,
  GithubProjectSummaryDto,
  ProfileSummaryDto,
  ProjectDto,
} from "../api";
import ClaudeMdEditor from "../ClaudeMdEditor";
import type { ClaudeMdEditorHandle } from "../ClaudeMdEditor";
import { createClaudeMdDockItems } from "../claudeMdDockItems";
import { usePageDirtyGuard, usePageDockItems } from "../DockItemsContext";
import PaneTabs from "../PaneTabs";

type SettingsTab = "profiles" | "github" | "claude" | "claude-md";

const SETTINGS_TABS: SettingsTab[] = ["profiles", "github", "claude", "claude-md"];

const DISCARD_CONFIRM_MESSAGE =
  "CLAUDE.mdの編集内容を破棄しますか?保存していない変更は失われます。";

function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: SettingsTab = SETTINGS_TABS.includes(tabParam as SettingsTab)
    ? (tabParam as SettingsTab)
    : "github";

  const [claudeMdDirty, setClaudeMdDirty] = useState(false);
  const [claudeMdMode, setClaudeMdMode] = useState<ViewMode>("preview");
  const claudeMdEditorRef = useRef<ClaudeMdEditorHandle>(null);

  const confirmDiscardClaudeMdIfDirty = (): boolean => {
    if (tab === "claude-md" && claudeMdDirty) {
      return window.confirm(DISCARD_CONFIRM_MESSAGE);
    }
    return true;
  };

  const handleChangeTab = (next: string) => {
    if (!confirmDiscardClaudeMdIfDirty()) return;
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === "github") {
        params.delete("tab");
      } else {
        params.set("tab", next);
      }
      return params;
    });
  };

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<ProfileSummaryDto[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
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

  // プロファイル一覧・アクティブプロファイルの内容の両方をまとめて取り直す。
  // 自分自身の操作(作成・削除・名前変更・切り替え・保存)の直後と、他画面
  // (dock等)からのプロファイル切り替え(`settings:updated`)の両方で使う
  // (issue #72)。
  const loadSettingsData = useCallback((): Promise<void> => {
    return getSettings()
      .then((settings) => {
        setProfiles(settings.profiles);
        setActiveProfileId(settings.active_profile_id);
        setRepositoryPath(settings.repository_path);
        setClaudeProjectsDir(settings.claude_projects_dir);
        setGithubOwner(settings.github_project?.owner ?? "");
        setGithubNumber(
          settings.github_project ? String(settings.github_project.number) : "",
        );
        setSelectedProjectFolders(settings.selected_project_folders);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  useEffect(() => {
    loadSettingsData().finally(() => setLoading(false));
  }, [loadSettingsData]);

  useEffect(() => {
    const unlistenPromise = onSettingsUpdated(() => {
      loadSettingsData();
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [loadSettingsData]);

  useEffect(() => {
    listProjects()
      .then(setFolders)
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  useEffect(() => {
    getGithubAuthStatus()
      .then(setAuthStatus)
      .catch((e) => setAuthError(isAppError(e) ? e.message : String(e)));
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

  const handleCreateProfile = () => {
    setProfileError(null);
    createProfile(newProfileName.trim() || undefined)
      .then(() => {
        setNewProfileName("");
        return loadSettingsData();
      })
      .catch((e) => setProfileError(isAppError(e) ? e.message : String(e)));
  };

  const handleDeleteProfile = (profileId: string) => {
    if (!window.confirm("このプロファイルを削除しますか?")) return;
    setProfileError(null);
    deleteProfile(profileId)
      .then(() => loadSettingsData())
      .catch((e) => setProfileError(isAppError(e) ? e.message : String(e)));
  };

  const handleStartRenameProfile = (profile: ProfileSummaryDto) => {
    setRenamingProfileId(profile.id);
    setRenameDraft(profile.name);
  };

  const handleCommitRenameProfile = (profileId: string) => {
    const name = renameDraft.trim();
    setRenamingProfileId(null);
    if (!name) return;
    setProfileError(null);
    renameProfile(profileId, name)
      .then(() => loadSettingsData())
      .catch((e) => setProfileError(isAppError(e) ? e.message : String(e)));
  };

  const handleSwitchProfileFromList = (profileId: string) => {
    if (profileId === activeProfileId) return;
    if (!confirmDiscardClaudeMdIfDirty()) return;
    setProfileError(null);
    switchProfile(profileId)
      .then(() => loadSettingsData())
      .catch((e) => setProfileError(isAppError(e) ? e.message : String(e)));
  };

  // プロファイル切り替え(dockの吹き出しトリガー)前に、このページの未保存の
  // CLAUDE.md編集を確認できるようにする(issue #72)。
  usePageDirtyGuard(confirmDiscardClaudeMdIfDirty);

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

  const dockItems = useMemo<DockItem[]>(() => {
    if (tab !== "claude-md") return [];
    return createClaudeMdDockItems({
      mode: claudeMdMode,
      onModeChange: setClaudeMdMode,
      dirty: claudeMdDirty,
      onSave: () => claudeMdEditorRef.current?.save(),
      onReload: () => {
        if (claudeMdDirty && !window.confirm(DISCARD_CONFIRM_MESSAGE)) return;
        return claudeMdEditorRef.current?.reload();
      },
    });
  }, [tab, claudeMdMode, claudeMdDirty]);
  usePageDockItems(dockItems);

  if (loading) {
    return (
      <div className="settings-page">
        <p>読み込み中…</p>
      </div>
    );
  }

  return (
    <>
      {/* 左ペイン: プロファイル一覧+追加。ビューア(`/`)の「左: 一覧 / 右: 内容」と
          同じ画面骨格に揃える(issue #74)。名前変更・削除は全行に並べるとノイズに
          なるため、アクティブな行にだけ出す。 */}
      <div className="settings-profile-pane">
        <h2>プロファイル</h2>
        <ul className="settings-profile-list">
          {profiles.map((p) => (
            <li key={p.id}>
              {renamingProfileId === p.id ? (
                <input
                  type="text"
                  className="settings-profile-rename-input"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => handleCommitRenameProfile(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCommitRenameProfile(p.id);
                    if (e.key === "Escape") setRenamingProfileId(null);
                  }}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className={`project-item ${p.id === activeProfileId ? "selected" : ""}`}
                  onClick={() => handleSwitchProfileFromList(p.id)}
                >
                  <span className="settings-profile-name">{p.name}</span>
                </button>
              )}
              {p.id === activeProfileId && renamingProfileId !== p.id && (
                <div className="settings-profile-actions">
                  <button type="button" onClick={() => handleStartRenameProfile(p)}>
                    名前変更
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteProfile(p.id)}
                    disabled={profiles.length <= 1}
                  >
                    削除
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="settings-profile-add">
          <input
            type="text"
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            placeholder="新しいプロファイル名(省略可)"
          />
          <button type="button" onClick={handleCreateProfile}>
            追加
          </button>
        </div>
        {profileError && <p className="error">{profileError}</p>}
      </div>

      <div className="settings-page">
        <PaneTabs
          tabs={[
            {
              id: "profiles",
              label: profiles.find((p) => p.id === activeProfileId)?.name ?? "プロファイル",
            },
            { id: "github", label: "GitHub" },
            { id: "claude", label: "Claude" },
            { id: "claude-md", label: "CLAUDE.md" },
          ]}
          active={tab}
          onChange={handleChangeTab}
        />

        {tab === "claude-md" ? (
          <section className="settings-section settings-claude-md-section">
            <h3>CLAUDE.md</h3>
            {repositoryPath ? (
              <ClaudeMdEditor
                ref={claudeMdEditorRef}
                load={getRepositoryClaudeMd}
                save={saveRepositoryClaudeMd}
                reloadKey={repositoryPath}
                mode={claudeMdMode}
                onDirtyChange={setClaudeMdDirty}
              />
            ) : (
              <p>先にリポジトリを選択してください。</p>
            )}
          </section>
        ) : (
          <form className="settings-form" onSubmit={handleSave}>
            {/* プロファイル管理(一覧・追加・名前変更・削除)は左ペインへ移した
                ため、このタブには対象リポジトリの設定だけを残す(issue #74)。 */}
            {tab === "profiles" && (
              <section className="settings-section">
                <h3>対象リポジトリ</h3>
                <div className="settings-folder-picker">
                  <span className="settings-folder-path">
                    {repositoryPath ?? "未選択"}
                  </span>
                  <button type="button" onClick={handleChooseFolder}>
                    フォルダを選択
                  </button>
                </div>
              </section>
            )}

            {tab === "github" && (
              <>
                <section className="settings-section">
                  <h3>GitHub認証</h3>
                  {authStatus.authenticated ? (
                    <div className="settings-github-auth">
                      <span>
                        {authStatus.login
                          ? `${authStatus.login} としてログイン中`
                          : "ログイン確認中…"}
                      </span>
                      <button type="button" onClick={handleGithubLogout}>
                        ログアウト
                      </button>
                    </div>
                  ) : deviceCode ? (
                    <div className="settings-github-auth">
                      <p>
                        以下のコードをブラウザで入力してください:
                        <br />
                        <strong className="settings-user-code">
                          {deviceCode.user_code}
                        </strong>
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
                      <button
                        type="button"
                        onClick={handleGithubLogin}
                        disabled={authenticating}
                      >
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
              </>
            )}

            {tab === "claude" && (
              <>
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
              </>
            )}

            {error && <p className="error">{error}</p>}
            <button type="submit" className="settings-save" disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </button>
            {saved && <p className="settings-saved">保存しました。</p>}
          </form>
        )}
      </div>
    </>
  );
}

export default SettingsPage;
