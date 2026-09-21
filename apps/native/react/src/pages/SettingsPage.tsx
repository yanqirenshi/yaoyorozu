import AddButton from "../AddButton";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  createProfile,
  deleteProfile,
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
import PaneTabs from "../PaneTabs";

type SettingsTab = "profiles" | "github" | "claude";

const SETTINGS_TABS: SettingsTab[] = ["profiles", "github", "claude"];

// プロファイルの削除ボタンのアイコン。Material Icons の「HighlightOff」
// (ユーザー指示。MUI の `@mui/icons-material` v9.4.0 の
// `material-icons/highlight_off_24px.svg` のパスをそのまま使う。MIT ライセンス)。
// viewBox は MUI の 24×24 のまま。色は文字色(currentColor)を継承する。
function HighlightOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
    </svg>
  );
}

// プロファイル削除の確認ダイアログ。`<dialog>` の showModal() で開くため、表示中は
// 後ろの画面を操作できない(モーダル)。Esc・キャンセル・ダイアログの外側の
// クリックで取り消す。誤操作で消さないよう、最初はキャンセルにフォーカスを置く
// (DOM 上で先に置くと showModal がそこへフォーカスする)。
function DeleteProfileDialog({
  profileName,
  onConfirm,
  onCancel,
}: {
  profileName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    // 開発時の StrictMode では effect が2回走るため、開いていなければ開く。
    // (後始末で close すると close イベントで取り消し扱いになるため、しない)
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    // 閉じるときは close() を呼ばず、親の状態を戻して(アンマウントして)閉じる。
    // close イベントは閉じた後に遅れて届くため、それに頼ると届かなかったときに
    // 閉じたダイアログが残って二度と開けなくなる(確認中に実際に起きた)。
    // onClose は、ほかの経路で閉じた場合の保険として残す。
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby="delete-profile-dialog-title"
      onCancel={(e) => {
        // Esc。ブラウザ既定の閉じ方を止め、親の状態で閉じる。
        e.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
      onClick={(e) => {
        // 外側(背景)のクリックは、中身ではなくダイアログ要素そのものに届く。
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="settings-dialog-body">
        <h3 id="delete-profile-dialog-title">プロファイルを削除</h3>
        <p>プロファイル「{profileName}」を削除しますか?この操作は取り消せません。</p>
        <div className="settings-dialog-actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" className="settings-dialog-danger" onClick={onConfirm}>
            削除する
          </button>
        </div>
      </div>
    </dialog>
  );
}

function SettingsPage() {
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
  const [profiles, setProfiles] = useState<ProfileSummaryDto[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  // 削除の確認ダイアログを開いている対象(開いていなければ null)。
  const [deleteTarget, setDeleteTarget] = useState<ProfileSummaryDto | null>(null);
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

  // 確認ダイアログ(DeleteProfileDialog)で「削除する」が押されてから呼ぶ。
  // window.confirm はアプリのウィンドウ上で確認を出さずに削除が進んでしまった
  // ため使わない。
  const handleDeleteProfile = (profileId: string) => {
    setDeleteTarget(null);
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
    setProfileError(null);
    switchProfile(profileId)
      .then(() => loadSettingsData())
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
    })
      .then(() => setSaved(true))
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;

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
    <>
      {/* 左ペイン: プロファイル一覧+追加。ビューア(`/`)の「左: 一覧 / 右: 内容」と
          同じ画面骨格に揃える(issue #74)。削除は全行に並べるとノイズになるため、
          アクティブな行にだけ、名前の右(行の右端)にアイコンで出す。名前変更は
          右ペインのプロファイル名の横に置く。 */}
      <div className="settings-profile-pane">
        <h2>プロファイル</h2>
        <ul className="settings-profile-list">
          {profiles.map((p) => (
            <li key={p.id} className="settings-profile-row">
              <button
                type="button"
                className={`project-item ${p.id === activeProfileId ? "selected" : ""}`}
                onClick={() => handleSwitchProfileFromList(p.id)}
              >
                <span className="settings-profile-name">{p.name}</span>
              </button>
              {/* 行全体が切り替えボタンで入れ子にできないため、行の右端に重ねて置く。 */}
              {p.id === activeProfileId && (
                <button
                  type="button"
                  className="settings-profile-delete"
                  onClick={() => setDeleteTarget(p)}
                  disabled={profiles.length <= 1}
                  title="削除"
                  aria-label={`${p.name} を削除`}
                >
                  <HighlightOffIcon />
                </button>
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
          <AddButton size="small" onClick={handleCreateProfile} />
        </div>
        {profileError && <p className="error">{profileError}</p>}
      </div>

      {deleteTarget && (
        <DeleteProfileDialog
          profileName={deleteTarget.name}
          onConfirm={() => handleDeleteProfile(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

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
        <PaneTabs
          tabs={[
            {
              id: "profiles",
              label: activeProfile?.name ?? "プロファイル",
            },
            { id: "github", label: "GitHub" },
            { id: "claude", label: "Claude" },
          ]}
          active={tab}
          onChange={handleChangeTab}
        />

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
    </>
  );
}

export default SettingsPage;
