"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  checkFolder,
  getSettings,
  isAppError,
  listProjects,
  onSettingsUpdated,
  renameProfile,
  updateSettings,
} from "@/api";
import type { FolderCheckDto, ProfileSummaryDto, ProjectDto } from "@/api";
import Tabs, { tabPanelProps } from "@/Tabs";

// プロファイル1件分の設定ペイン(プロファイル名・名前変更・Claude 等のタブとその中身)。
// 写し元: `apps/native/react/src/ProfileSettingsPane.tsx`。違い:
// - フォルダ選択(Tauri の dialog)は、パスの手入力 + `check_folder` の結果の表示に替えた
//   (ブラウザは絶対パスを取れない。フォルダの一覧を出す画面は作らない)。
// - GitHub 連携(認証・プロジェクト選択・かんばん)は出さない(段階 5)。保存のとき GitHub プロジェクトの
//   値は、読み込んだままを書き戻して変えない。
// - 仕様フォルダ(yyz/)を作る部分は出さない(ビューアの段階で足す)。
// - react-router の `useSearchParams` → next/navigation(`tab` クエリは `router.replace`)。
// `profileId` が `null` のときはアクティブプロファイルを対象にする(/settings)。
// 文字列のときはそのプロファイルに固定する(ビューア。1 タブ = 1 プロファイル)。
type SettingsTab = "profiles" | "claude";

const SETTINGS_TABS: SettingsTab[] = ["profiles", "claude"];

type ProfileSettingsPaneProps = {
  profileId: string | null;
  // 値が変わるたびに設定を取り直す(呼び出し側が自分の操作 = プロファイルの
  // 切り替え・作成・削除の直後、つなぎ直せたときに増やす)。他画面からの変更は
  // `settings:updated` で自分で追従する。
  refreshToken?: number;
  // このペインでプロファイル名を変えたとき(呼び出し側の一覧の取り直し用)。
  onProfileRenamed?: () => void;
};

// パスの確認結果の 1 行の文言。
function describeFolderCheck(check: FolderCheckDto): string {
  if (!check.exists) return "存在しません";
  if (!check.is_dir) return "フォルダではありません";
  return check.is_git_repository ? "フォルダです(Git リポジトリ)" : "フォルダです(Git リポジトリではありません)";
}

// パスの手入力欄と、サーバ側の確認(存在するか・フォルダか・リポジトリか)。
function FolderPathInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [check, setCheck] = useState<FolderCheckDto | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const handleCheck = () => {
    const path = value.trim();
    if (!path) return;
    setChecking(true);
    setCheckError(null);
    checkFolder(path)
      .then(setCheck)
      .catch((e) => {
        setCheck(null);
        setCheckError(isAppError(e) ? e.message : String(e));
      })
      .finally(() => setChecking(false));
  };

  return (
    <div className="settings-folder-picker settings-folder-picker-text">
      <input
        type="text"
        className="settings-folder-path-input"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => {
          onChange(e.target.value);
          setCheck(null);
          setCheckError(null);
        }}
        onKeyDown={(e) => {
          // フォーム内のテキスト欄の Enter は暗黙の送信(保存)になるため、確認に使う。
          if (e.key === "Enter") {
            e.preventDefault();
            handleCheck();
          }
        }}
      />
      <button type="button" onClick={handleCheck} disabled={checking || !value.trim()}>
        {checking ? "確認中…" : "確認"}
      </button>
      {check && (
        <span
          className={
            check.exists && check.is_dir ? "settings-folder-check" : "settings-folder-check error"
          }
        >
          {describeFolderCheck(check)}
        </span>
      )}
      {checkError && <span className="error">{checkError}</span>}
    </div>
  );
}

function ProfileSettingsPane({
  profileId,
  refreshToken = 0,
  onProfileRenamed,
}: ProfileSettingsPaneProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: SettingsTab = SETTINGS_TABS.includes(tabParam as SettingsTab)
    ? (tabParam as SettingsTab)
    : "profiles";

  const handleChangeTab = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "profiles") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileSummaryDto | null>(null);
  const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  // パスの入力欄の値。空は未設定(保存のとき null にする)。
  const [repositoryPath, setRepositoryPath] = useState("");
  const [claudeProjectsDir, setClaudeProjectsDir] = useState("");
  // app の起動時に前回動かしていたセッションを再開するか(プロファイルごとではなくマシン設定)。
  const [restoreRunningSessions, setRestoreRunningSessions] = useState(true);
  // GitHub プロジェクトは、この段階では画面に出さない。読み込んだ値をそのまま書き戻す。
  const [githubProject, setGithubProject] = useState<{ owner: string; number: number } | null>(
    null,
  );
  const [folders, setFolders] = useState<ProjectDto[]>([]);
  const [folderQuery, setFolderQuery] = useState("");
  const [selectedProjectFolders, setSelectedProjectFolders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // 対象プロファイルの内容を取り直す。自分自身の操作(名前変更・保存)の直後と、
  // 他画面からの変更(`settings:updated`)の両方で使う。
  const loadSettingsData = useCallback((): Promise<void> => {
    return getSettings(profileId)
      .then((settings) => {
        const targetId = profileId ?? settings.active_profile_id;
        setProfile(settings.profiles.find((p) => p.id === targetId) ?? null);
        setRepositoryPath(settings.repository_path ?? "");
        setClaudeProjectsDir(settings.claude_projects_dir ?? "");
        setRestoreRunningSessions(settings.restore_running_sessions);
        setGithubProject(settings.github_project);
        setSelectedProjectFolders(settings.selected_project_folders);
        setError(null);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, [profileId]);

  useEffect(() => {
    void loadSettingsData().finally(() => setLoading(false));
  }, [loadSettingsData, refreshToken]);

  useEffect(() => {
    const unlistenPromise = onSettingsUpdated(() => {
      void loadSettingsData();
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [loadSettingsData]);

  // 対象フォルダの候補(セッションのルートディレクトリ直下のフォルダ)。つなぎ直したときも取り直す。
  useEffect(() => {
    listProjects()
      .then(setFolders)
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, [refreshToken]);

  const handleStartRenameProfile = (target: ProfileSummaryDto) => {
    setRenamingProfileId(target.id);
    setRenameDraft(target.name);
  };

  const handleCommitRenameProfile = (targetId: string) => {
    const name = renameDraft.trim();
    setRenamingProfileId(null);
    if (!name) return;
    setProfileError(null);
    renameProfile(targetId, name)
      .then(() => loadSettingsData())
      .then(() => onProfileRenamed?.())
      .catch((e) => setProfileError(isAppError(e) ? e.message : String(e)));
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

    updateSettings(
      {
        repository_path: repositoryPath.trim() || null,
        github_project: githubProject,
        selected_project_folders: selectedProjectFolders,
        claude_projects_dir: claudeProjectsDir.trim() || null,
        restore_running_sessions: restoreRunningSessions,
      },
      profileId,
    )
      .then(() => setSaved(true))
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  const activeProfile = profile;

  // 対象フォルダ一覧のインクリメンタルサーチ(大文字・小文字を区別しない部分一致)。
  // 表示を絞るだけで選択状態には影響しない(絞り込みで見えなくなったフォルダの選択も、
  // 保存時にそのまま残る)。
  const normalizedFolderQuery = folderQuery.trim().toLowerCase();
  const visibleFolders = normalizedFolderQuery
    ? folders.filter((f) => f.name.toLowerCase().includes(normalizedFolderQuery))
    : folders;

  // 保存ボタンと保存結果・エラーの表示。Claude タブでは対象フォルダの一覧がペインの下端まで
  // 伸びてフォーム末尾が見えなくなるため、保存ボタンを「対象フォルダ」見出しの行の右端に、
  // 保存結果・エラーをその行の下に置く。他のタブではフォーム末尾に置く。
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
          見出しがこの位置で入力欄に入れ替わる(Enter・欄の外で確定、Esc で取り消し)。 */}
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
        {/* プロファイル管理(一覧・追加・名前変更・削除)は左ペインにあるため、
            このタブには対象リポジトリの設定だけを置く。 */}
        {tab === "profiles" && (
          <section className="settings-section">
            <h3>対象リポジトリ</h3>
            <FolderPathInput
              label="対象リポジトリのパス"
              value={repositoryPath}
              placeholder="例: C:\Users\you\prj\repo(未設定なら空)"
              onChange={setRepositoryPath}
            />
          </section>
        )}

        {tab === "claude" && (
          <>
            <section className="settings-section">
              <h3>セッションのルートディレクトリ</h3>
              <FolderPathInput
                label="セッションのルートディレクトリのパス"
                value={claudeProjectsDir}
                placeholder="空なら既定(~/.claude/projects)を使用"
                onChange={setClaudeProjectsDir}
              />
              <div className="settings-folder-picker">
                <button
                  type="button"
                  onClick={() => setClaudeProjectsDir("")}
                  disabled={claudeProjectsDir === ""}
                >
                  既定に戻す
                </button>
              </div>
            </section>

            <section className="settings-section">
              <h3>起動時のセッション再開</h3>
              <label className="settings-checkbox-field">
                <input
                  type="checkbox"
                  checked={restoreRunningSessions}
                  onChange={(e) => setRestoreRunningSessions(e.target.checked)}
                />
                サーバの起動時に、前回動かしていたセッションを再開する
              </label>
              <p className="settings-hint">
                利用者が「停止」または「終了」したセッションは再開されません。また、再開のとき
                origin/main の最新化は行いません。
              </p>
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
