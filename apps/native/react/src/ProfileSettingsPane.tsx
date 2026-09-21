import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router";
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
  onSettingsUpdated,
  renameProfile,
  updateSettings,
} from "./api";
import type {
  DeviceCodeDto,
  GithubAuthStatusDto,
  GithubProjectSummaryDto,
  ProfileSummaryDto,
  ProjectDto,
} from "./api";
import Tabs, { tabPanelProps } from "./Tabs";

// プロファイル1件分の設定ペイン(プロファイル名・名前変更・GitHub / Claude 等の
// タブとその中身)。/settings(`pages/SettingsPage.tsx`)とビューアの設定ビュー
// (`pages/SessionsPage.tsx`)の両方から使う(issue #299。二重実装しない)。
// `profileId` が `null` のときはアクティブプロファイルを対象にする(/settings)。
// 文字列のときはそのプロファイルに固定する(ビューア。1ウィンドウ = 1プロファイル)。
// プロファイルの一覧・追加・削除・切り替えはこのペインに含めない(/settings 側)。
type SettingsTab = "profiles" | "github" | "claude";

const SETTINGS_TABS: SettingsTab[] = ["profiles", "github", "claude"];

type ProfileSettingsPaneProps = {
  profileId: string | null;
  // 値が変わるたびに設定を取り直す(呼び出し側が自分の操作 = プロファイルの
  // 切り替え・作成・削除の直後に増やす)。他画面からの変更は `settings:updated`
  // で自分で追従する。
  refreshToken?: number;
  // このペインでプロファイル名を変えたとき(呼び出し側の一覧の取り直し用)。
  onProfileRenamed?: () => void;
};

function ProfileSettingsPane({
  profileId,
  refreshToken = 0,
  onProfileRenamed,
}: ProfileSettingsPaneProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: SettingsTab = SETTINGS_TABS.includes(tabParam as SettingsTab)
    ? (tabParam as SettingsTab)
    : "github";

  const handleChangeTab = (next: string) => {
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
  const [profile, setProfile] = useState<ProfileSummaryDto | null>(null);
  const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [repositoryPath, setRepositoryPath] = useState<string | null>(null);
  const [claudeProjectsDir, setClaudeProjectsDir] = useState<string | null>(null);
  const [githubOwner, setGithubOwner] = useState("");
  const [githubNumber, setGithubNumber] = useState("");
  const [folders, setFolders] = useState<ProjectDto[]>([]);
  const [folderQuery, setFolderQuery] = useState("");
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

  // 対象プロファイルの内容を取り直す。自分自身の操作(名前変更・保存)の直後と、
  // 他画面(dock等)からの変更(`settings:updated`)の両方で使う(issue #72)。
  const loadSettingsData = useCallback((): Promise<void> => {
    return getSettings(profileId)
      .then((settings) => {
        const targetId = profileId ?? settings.active_profile_id;
        setProfile(settings.profiles.find((p) => p.id === targetId) ?? null);
        setRepositoryPath(settings.repository_path);
        setClaudeProjectsDir(settings.claude_projects_dir);
        setGithubOwner(settings.github_project?.owner ?? "");
        setGithubNumber(
          settings.github_project ? String(settings.github_project.number) : "",
        );
        setSelectedProjectFolders(settings.selected_project_folders);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, [profileId]);

  useEffect(() => {
    loadSettingsData().finally(() => setLoading(false));
  }, [loadSettingsData, refreshToken]);

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
      .then(() => onProfileRenamed?.())
      .catch((e) => setProfileError(isAppError(e) ? e.message : String(e)));
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
    }, profileId)
      .then(() => setSaved(true))
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  const activeProfile = profile;


  // 対象フォルダ一覧のインクリメンタルサーチ(大文字・小文字を区別しない
  // 部分一致)。表示を絞るだけで選択状態には影響しない(絞り込みで見えなく
  // なったフォルダの選択も、保存時にそのまま残る)。
  const normalizedFolderQuery = folderQuery.trim().toLowerCase();
  const visibleFolders = normalizedFolderQuery
    ? folders.filter((f) => f.name.toLowerCase().includes(normalizedFolderQuery))
    : folders;

  // 保存ボタンと保存結果・エラーの表示。Claudeタブでは対象フォルダの一覧が
  // ペインの下端まで伸びてフォーム末尾が見えなくなるため、保存ボタンを
  // 「対象フォルダ」見出しの行の右端に、保存結果・エラーをその行の下に置く。
  // 他のタブではフォーム末尾に置く。
  const saveButton = (
    <button type="submit" className="settings-save" disabled={saving}>
      {saving ? "保存中…" : "保存"}
    </button>
  );
  const savedMessage = saved && <p className="settings-saved">保存しました。</p>;
  const errorMessage = error && <p className="error">{error}</p>;

  if (loading) {
    return (
      <div className="settings-page">
        <p>読み込み中…</p>
      </div>
    );
  }

  return (
    <div className={`settings-page ${tab === "claude" ? "is-fill" : ""}`}>
      {/* 表示中(アクティブ)のプロファイル名と名前変更ボタン。名前変更中は
          見出しがこの位置で入力欄に入れ替わる(Enter・欄の外で確定、Esc で
          取り消し)。 */}
      {activeProfile && (
        <div className="settings-profile-header">
          {renamingProfileId === activeProfile.id ? (
            <input
              type="text"
              className="settings-profile-rename-input"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => handleCommitRenameProfile(activeProfile.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCommitRenameProfile(activeProfile.id);
                if (e.key === "Escape") setRenamingProfileId(null);
              }}
              aria-label="プロファイル名"
              autoFocus
            />
          ) : (
            <>
              <h2 title={activeProfile.name}>{activeProfile.name}</h2>
              <button type="button" onClick={() => handleStartRenameProfile(activeProfile)}>
                名前変更
              </button>
            </>
          )}
        </div>
      )}
      {profileError && <p className="error">{profileError}</p>}
      <Tabs
        id="settings-tabs"
        aria-label="設定の切り替え"
        size="small"
        items={[
          {
            id: "profiles",
            label: activeProfile?.name ?? "プロファイル",
          },
          { id: "github", label: "GitHub" },
          { id: "claude", label: "Claude" },
        ]}
        value={tab}
        onChange={handleChangeTab}
      />

      <form
        className="settings-form"
        onSubmit={handleSave}
        {...tabPanelProps("settings-tabs", tab)}
      >
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

            <section className="settings-section settings-folder-section">
              <div className="settings-section-header">
                <h3>対象フォルダ</h3>
                {/* フォーム内のテキスト欄で Enter を押すと暗黙の送信(保存)に
                    なってしまうため、Enter は止める。 */}
                <input
                  type="search"
                  className="settings-folder-search"
                  value={folderQuery}
                  onChange={(e) => setFolderQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="フォルダ名で絞り込み"
                  aria-label="対象フォルダを絞り込む"
                />
                {saveButton}
              </div>
              {savedMessage}
              {errorMessage}
              {folders.length === 0 && <p>フォルダが見つかりません。</p>}
              {folders.length > 0 && visibleFolders.length === 0 && (
                <p>「{folderQuery.trim()}」に一致するフォルダはありません。</p>
              )}
              <ul className="settings-folder-list">
                {visibleFolders.map((f) => (
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

        {tab !== "claude" && (
          <>
            {errorMessage}
            {saveButton}
            {savedMessage}
          </>
        )}
      </form>
    </div>
  );
}

export default ProfileSettingsPane;
