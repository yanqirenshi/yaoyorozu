"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  checkFolder,
  createYyzScaffold,
  getYyzScaffoldStatus,
  getSettings,
  isAppError,
  listProjects,
  onSettingsUpdated,
  renameProfile,
  updateSettings,
} from "@/api";
import type {
  FolderCheckDto,
  ProfileSummaryDto,
  ProjectDto,
  YyzScaffoldStatusDto,
} from "@/api";
import { holdReason } from "@/followActive";
import type { HoldReason } from "@/followActive";
import StaleNotice from "@/StaleNotice";
import Tabs, { tabPanelProps } from "@/Tabs";
import { useRefreshGuard } from "@/useRefreshGuard";

// プロファイル1件分の設定ペイン(プロファイル名・名前変更・Claude 等のタブとその中身)。
// 写し元: `apps/native/react/src/ProfileSettingsPane.tsx`。違い:
// - フォルダ選択(Tauri の dialog)は、パスの手入力 + `check_folder` の結果の表示に替えた
//   (ブラウザは絶対パスを取れない。フォルダの一覧を出す画面は作らない)。
// - GitHub 連携(認証・プロジェクト選択・かんばん)は出さない(段階 5)。保存のとき GitHub プロジェクトの
//   値は、読み込んだままを書き戻して変えない。
// - 仕様フォルダ(yyz/)を作る部分は Tauri 版どおりに出す(段階 2 C。保存済みのパスに対する状態)。
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
  // 「仕様フォルダ(yyz/)を作る」(issue #547)。保存済みの repository_path に対する状態なので、
  // フォーム入力中(未保存)の repositoryPath とは別に、`loadSettingsData` 側で取り直す
  // (保存前のパスに対して作成ボタンを有効にしない)。
  const [savedRepositoryPath, setSavedRepositoryPath] = useState<string | null>(null);
  const [yyzStatus, setYyzStatus] = useState<YyzScaffoldStatusDto | null>(null);
  const [yyzStatusError, setYyzStatusError] = useState<string | null>(null);
  const [yyzCreating, setYyzCreating] = useState(false);
  const [yyzCreateError, setYyzCreateError] = useState<string | null>(null);
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
  // 名前変更の送信中(確定の二重送信・送信中の再編集を防ぐ)。
  const [renaming, setRenaming] = useState(false);
  const savingRef = useRef(false);
  const renamingRef = useRef(false);
  const yyzCreatingRef = useRef(false);

  // 「入力中(未保存の変更がある)の欄は、取り直しで上書きしない」(`useRefreshGuard`)。
  // 未保存かどうかは、最後に読み込んだ(または保存した)値と、今の入力値の比較で持つ。
  type FormValues = {
    repositoryPath: string;
    claudeProjectsDir: string;
    restoreRunningSessions: boolean;
    folders: string;
  };
  const [baseline, setBaseline] = useState<FormValues | null>(null);
  const currentForm: FormValues = {
    repositoryPath,
    claudeProjectsDir,
    restoreRunningSessions,
    folders: [...selectedProjectFolders].sort().join("\n"),
  };
  const dirty =
    baseline !== null &&
    (baseline.repositoryPath !== currentForm.repositoryPath ||
      baseline.claudeProjectsDir !== currentForm.claudeProjectsDir ||
      baseline.restoreRunningSessions !== currentForm.restoreRunningSessions ||
      baseline.folders !== currentForm.folders);
  const { stale, shouldApply, clear: clearStale } = useRefreshGuard(dirty);
  // 取り直しの完了(非同期)が最新の dirty を見るための ref。
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // /settings(プロファイルを指定せず、アクティブへ追従する画面)で、入力中にアクティブが変わったとき、移さずに知らせる
  // ための、新しいアクティブのプロファイルの ID(`null` は知らせ無し)。保存先は、いつも表示しているプロファイル。
  const [holdNotice, setHoldNotice] = useState<HoldReason | null>(null);
  // 入力か保存の操作をしたか(利用者が「移る」を選ぶまで、アクティブが変わっても表示を移さない)。保存のあとも、
  // 自動では移らない(「保存しました」が、別のプロファイルへ移って出るのを防ぐ)。
  const touchedRef = useRef(false);
  if (dirty) touchedRef.current = true;
  // 最後に読み込んだ対象プロファイル。対象そのものが変わったとき(切替・削除)は、入力中の内容は
  // 別のプロファイルのものなので、取り直しの結果で置き換える。
  const loadedTargetRef = useRef<string | null>(null);
  // 入力の元にした設定の版。取り直して入力へ反映したときだけ更新する(未保存の入力を守って取り直しを
  // 見送ったときは更新しない。そのまま保存すると、サーバが 409 で断る)。
  const loadedRevisionRef = useRef<number | null>(null);
  // 同じく、全体の欄(`claude_projects_dir`・`restore_running_sessions`)の版。
  const loadedGlobalRevisionRef = useRef<number | null>(null);

  // 対象プロファイルの内容を取り直す。自分自身の操作(名前変更)の直後と、他画面からの変更
  // (`settings:updated`)・つなぎ直し(`refreshToken`)の両方で使う。
  // `force` が偽(既定)なら、未保存の入力がある欄は上書きせず、「ほかで変更されました」を出す
  // (表示専用の部分 = プロファイル名・仕様フォルダの状態は常に取り直す)。`force` が真なら
  // 入力を捨てて取り直す(「取り直す」ボタン)。
  const loadSettingsData = useCallback(
    (force = false): Promise<void> => {
    return getSettings(profileId)
      .then((settings) => {
        const targetId = profileId ?? settings.active_profile_id;
        setProfile(settings.profiles.find((p) => p.id === targetId) ?? null);
        // 入力中(未保存)にアクティブが変わったときは、表示を移さず、知らせる(`followActive.ts`)。
        const shown = loadedTargetRef.current;
        const hold = holdReason({
          followsActive: profileId == null,
          shownId: shown,
          activeId: targetId,
          dirty: dirtyRef.current,
          touched: touchedRef.current,
          force,
          shownStillExists: settings.profiles.some((p) => p.id === shown),
        });
        if (hold !== null) {
          setProfile(settings.profiles.find((p) => p.id === shown) ?? null);
          setHoldNotice(hold);
          return;
        }
        setHoldNotice(null);
        if (force || shown !== targetId) touchedRef.current = false;
        const targetChanged =
          loadedTargetRef.current !== null && loadedTargetRef.current !== targetId;
        loadedTargetRef.current = targetId;
        // 「ほかで変更されました」は、表示しているプロファイルの版か全体の版が、読み込んだものから変わったときだけ出す
        // (関係のない通知 = 別のプロファイルの保存・切替・作成・改名では、入力中でも出さない)。
        const versionsChanged =
          loadedRevisionRef.current === null ||
          loadedRevisionRef.current !== settings.revision ||
          loadedGlobalRevisionRef.current !== settings.global_revision;
        if (force || targetChanged || (versionsChanged && shouldApply())) {
          setRepositoryPath(settings.repository_path ?? "");
          setClaudeProjectsDir(settings.claude_projects_dir ?? "");
          setRestoreRunningSessions(settings.restore_running_sessions);
          setGithubProject(settings.github_project);
          setSelectedProjectFolders(settings.selected_project_folders);
          loadedRevisionRef.current = settings.revision;
          loadedGlobalRevisionRef.current = settings.global_revision;
          setBaseline({
            repositoryPath: settings.repository_path ?? "",
            claudeProjectsDir: settings.claude_projects_dir ?? "",
            restoreRunningSessions: settings.restore_running_sessions,
            folders: [...settings.selected_project_folders].sort().join("\n"),
          });
          clearStale();
          setError(null);
        }

        setSavedRepositoryPath(settings.repository_path);
        setYyzCreateError(null);
        if (!settings.repository_path) {
          setYyzStatus(null);
          setYyzStatusError(null);
          return;
        }
        return getYyzScaffoldStatus(profileId)
          .then((status) => {
            setYyzStatus(status);
            setYyzStatusError(null);
          })
          .catch((e) => {
            setYyzStatus(null);
            setYyzStatusError(isAppError(e) ? e.message : String(e));
          });
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
    },
    [profileId, shouldApply, clearStale],
  );

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

  const handleCreateYyzScaffold = () => {
    if (yyzCreating || yyzCreatingRef.current) return;
    yyzCreatingRef.current = true;
    setYyzCreating(true);
    setYyzCreateError(null);
    createYyzScaffold(profileId)
      .then((status) => {
        setYyzStatus(status);
        setYyzStatusError(null);
      })
      .catch((e) => setYyzCreateError(isAppError(e) ? e.message : String(e)))
      .finally(() => {
        yyzCreatingRef.current = false;
        setYyzCreating(false);
      });
  };

  const handleStartRenameProfile =(target: ProfileSummaryDto) => {
    setRenamingProfileId(target.id);
    setRenameDraft(target.name);
  };

  const handleCommitRenameProfile = (targetId: string) => {
    // 送信中の確定(Enter のあとの blur など)は無視する。
    if (renaming || renamingRef.current) return;
    const name = renameDraft.trim();
    setRenamingProfileId(null);
    if (!name) return;
    setProfileError(null);
    renamingRef.current = true;
    setRenaming(true);
    // 失敗(サーバ停止など)したときは、入力した名前を残したまま入力欄へ戻し、エラーを出す。
    renameProfile(targetId, name)
      .then(() => loadSettingsData())
      .then(() => onProfileRenamed?.())
      .catch((e) => {
        setRenamingProfileId(targetId);
        setRenameDraft(renameDraft);
        setProfileError(isAppError(e) ? e.message : String(e));
      })
      .finally(() => {
        renamingRef.current = false;
        setRenaming(false);
      });
  };

  const toggleProjectFolder = (name: string) => {
    setSelectedProjectFolders((prev) =>
      prev.includes(name) ? prev.filter((f) => f !== name) : [...prev, name],
    );
  };

  // 入力が残っているときに、別のプロファイルへ移る・取り直す操作には、確かめを 1 回はさむ(入力が消えるため)。
  const handleMoveToActive = () => {
    if (dirtyRef.current && !window.confirm("入力中の内容は失われます。新しいアクティブへ移りますか?")) return;
    touchedRef.current = false;
    void loadSettingsData(true);
  };
  const handleReloadDiscardingInput = () => {
    if (dirtyRef.current && !window.confirm("入力中の内容は失われます。取り直しますか?")) return;
    void loadSettingsData(true);
  };

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    // 保存中の再送信(Enter の連打・ダブルクリック)は無視する。
    // 状態(`saving`)は再描画までの間は古いままなので、同じ瞬間の 2 回目は ref で止める。
    if (saving || savingRef.current) return;
    // 保存先は、いま画面に読み込んでいるプロファイル(必ず ID で指す。アクティブへ保存する動きは無い)。
    const targetProfileId = loadedTargetRef.current;
    if (!targetProfileId) {
      setError("設定を読み込めていません。取り直してからやり直してください");
      return;
    }
    savingRef.current = true;
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
      targetProfileId,
      loadedRevisionRef.current ?? -1,
      loadedGlobalRevisionRef.current ?? -1,
    )
      .then((result) => {
        // 保存できた入力を「読み込んだ値」にする(未保存の変更ではなくなる。「ほかで変更されました」も消す)。
        // 失敗したとき(サーバ停止など)は、入力も未保存の状態もそのまま残し、エラーだけを出す。
        loadedRevisionRef.current = result.revision;
        loadedGlobalRevisionRef.current = result.global_revision;
        // 保存した。利用者が「移る」を選ぶまで、アクティブが変わっても表示を移さない(知らせは出す)。
        touchedRef.current = true;
        setBaseline(currentForm);
        clearStale();
        setSaved(true);
      })
      .catch((e) => {
        setError(isAppError(e) ? e.message : String(e));
        // ほかで変更されていた(古い版を元にした保存)ときは、入力は残したまま、取り直しを促す。
        if (isAppError(e) && (e.code === "settings_conflict" || e.code === "settings_global_conflict")) {
          shouldApply();
        }
      })
      .finally(() => {
        savingRef.current = false;
        setSaving(false);
      });
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
              <button
                type="button"
                onClick={() => handleStartRenameProfile(activeProfile)}
                disabled={renaming}
              >
                名前変更
              </button>
            </>
          )}
        </div>
      )}
      {profileError && <p className="error">{profileError}</p>}
      {/* 入力中(未保存)の欄は、ほかのタブの変更・つなぎ直しで上書きしない。代わりにこの知らせを出す。 */}
      {holdNotice !== null && (
        <StaleNotice
          message={
            holdNotice === "deleted"
              ? "表示していたプロファイルは、ほかで削除されました。入力中の内容は残してあります(このプロファイルへは保存できません)。"
              : "アクティブなプロファイルが変わりました。表示は、いまのプロファイルのまま残してあります(保存先も、表示しているプロファイルです)。"
          }
          actionLabel="新しいアクティブへ移る"
          onReload={handleMoveToActive}
        />
      )}
      {stale && <StaleNotice onReload={handleReloadDiscardingInput} />}
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

            <div className="settings-yyz-scaffold">
              <button
                type="button"
                onClick={handleCreateYyzScaffold}
                disabled={!savedRepositoryPath || yyzStatus?.complete === true || yyzCreating}
              >
                {yyzStatus?.complete ? "作成済み" : "仕様フォルダ(yyz/)を作る"}
              </button>
              {!savedRepositoryPath && (
                <p className="settings-hint">先に対象リポジトリを入力して保存してください。</p>
              )}
              {yyzStatusError && <p className="error">{yyzStatusError}</p>}
              {yyzCreateError && <p className="error">{yyzCreateError}</p>}
              {yyzStatus && yyzStatus.files.length > 0 && (
                <ul className="settings-yyz-scaffold-files">
                  {yyzStatus.files.map((file) => (
                    <li key={file.relative_path}>
                      {file.exists ? "✓" : "未作成"} {file.relative_path}
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
