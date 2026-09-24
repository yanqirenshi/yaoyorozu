import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DockItem } from "command-dock";
import type { ViewMode } from "@yanqirenshi/markdown.sitter";
import {
  checkImageAttachment,
  getGithubAuthStatus,
  getProjectClaudeMd,
  getProjectSettingsFile,
  getSession,
  getSettings,
  getViewerTabs,
  isAppError,
  listGithubProjectItems,
  listSessions,
  onSessionChanged,
  onSettingsUpdated,
  saveProjectClaudeMd,
  saveProjectSettingsFile,
  saveViewerTabs,
  sendMessage,
  updateGithubProjectItemStatus,
} from "../api";
import type {
  AgentModeDto,
  MessageDto,
  ProjectItemDto,
  ProjectStatusOptionDto,
  SessionSummaryDto,
  ViewerTabDto,
  WindowTabDto,
} from "../api";
import ClaudeMdEditor from "../ClaudeMdEditor";
import type { ClaudeMdEditorHandle } from "../ClaudeMdEditor";
import { readImageFile } from "../attachedImage";
import type { AttachedImage } from "../attachedImage";
import { createClaudeMdDockItems } from "../claudeMdDockItems";
import { MODE_ICON, RELOAD_ICON } from "../icons";
import JsonFileEditor from "../JsonFileEditor";
import type { JsonFileEditorHandle } from "../JsonFileEditor";
import { formatTimestamp } from "../formatTimestamp";
import MessageImagesDialog from "../MessageImagesDialog";
import MessageText from "../MessageText";
import ProfileSettingsPane from "../ProfileSettingsPane";
import SessionPickerDialog from "../SessionPickerDialog";
import type { SessionPickerCandidate } from "../SessionPickerDialog";
import RawLineDialog from "../RawLineDialog";
import { SendErrorBody } from "../SendErrorBody";
import ViewerSideMenu from "../ViewerSideMenu";
import ViewerToolbar from "../ViewerToolbar";
import { createProjectSettingsDockItems } from "../projectSettingsDockItems";
import RulesPane from "../RulesPane";
import SkillsPane from "../SkillsPane";
import { useReportWindowState } from "../useReportWindowState";
import { PANE_VIEWS } from "../viewerNav";
import type { PaneView, ViewerNav } from "../viewerNav";

const PAGE_SIZE = 50;

type SessionGroup = {
  folder: string;
  sessions: SessionSummaryDto[];
};

type KanbanColumn = {
  // Statusの `optionId`。「No status」カラムのみ `null`(issue #50)。
  optionId: string | null;
  name: string;
};

const PROJECT_ITEM_KIND_LABEL: Record<ProjectItemDto["kind"], string> = {
  issue: "Issue",
  "pull-request": "PR",
  "draft-issue": "Draft",
};

const NO_STATUS_COLUMN_NAME = "No status";

const SCOPE_INSUFFICIENT_MESSAGE =
  "設定のGitHubタブで再ログインしてください(権限の追加が必要です)";

const DISCARD_CONFIRM_MESSAGE = "編集内容を破棄しますか?保存していない変更は失われます。";

// 左ペインの「選んだセッション」の鍵(issue #348・#353・#369・#379)。「フォルダ|セッション ID」。
// 1行 = 1セッション(セッション ID = 会話ファイル)。フォークや圧縮で別の
// ID のファイルに分かれた会話は、別のセッション(別の行)として扱う。
// フォルダ名・セッション ID は英数字と `-` のみで、`|` は含まれない。
const SESSION_TAB_SEPARATOR = "|";

function sessionTabKey(folder: string, sessionId: string): string {
  return `${folder}${SESSION_TAB_SEPARATOR}${sessionId}`;
}

type SessionsPageProps = {
  // 画面状態はURLクエリを状態源とする `useUrlViewerNav`(`ViewerPage`)から
  // 渡される(issue #91。「1ウィンドウ=1プロファイル」への一本化でウィンドウ
  // 内タブバーを廃止したため、再びURL駆動に戻した。native.md §6)。
  nav: ViewerNav;
};

function SessionsPage({ nav }: SessionsPageProps) {
  const windowProfileId = nav.windowProfileId;
  // ウィンドウレジストリ(issue #83)への報告に使う、実際に表示中のプロファイル
  // ID。`windowProfileId` が `null`(`/profiles` に id 省略)の場合はアクティブ
  // プロファイルへフォールバックする(Rust側 `resolve_profile` と同じ規則)。
  const [resolvedProfileId, setResolvedProfileId] = useState<string | null>(null);
  const [targetFolders, setTargetFolders] = useState<string[]>([]);
  const [sessionGroups, setSessionGroups] = useState<SessionGroup[]>([]);
  // 左ペインに並べる「自分で選んだセッション」の並び(issue #353・#379。保存済みの全体)。`null` は読み込み前。
  // 一覧に見つからないもの(削除・対象フォルダから外れた等)は表示しないだけで、
  // ここには残す(戻ってきたら復活する。エラーにはしない)。
  const [viewerTabs, setViewerTabs] = useState<ViewerTabDto[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // 並びの保存は順序どおりに実行する(連続操作で古い並びが後勝ちしないように)。
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [messages, setMessages] = useState<MessageDto[]>([]);
  // `refreshSessionInPlace` が最新の読み込み件数を参照するための ref(issue #314)。
  // state をそのまま依存配列に入れると、追記のたびに購読(`onSessionChanged` 等)の
  // effect が再登録されてしまうため、ref 経由で読む。
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 「データ」ボタンで開いているメッセージの uuid(閉じていれば null。issue #313)。
  const [rawLineUuid, setRawLineUuid] = useState<string | null>(null);
  // 「画像 n 枚」で開いているメッセージの uuid(閉じていれば null。issue #349)。
  const [imagesUuid, setImagesUuid] = useState<string | null>(null);
  // 送信前の添付画像(issue #349。入力途中の UI 状態。送信で空に戻す)。
  const [attachments, setAttachments] = useState<AttachedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<AgentModeDto>("chat");
  const viewParam = nav.view;
  const view: PaneView = PANE_VIEWS.includes(viewParam as PaneView)
    ? (viewParam as PaneView)
    : "chat";
  const projectParam = nav.project;
  const sessionParam = nav.session;
  const ruleParam = nav.rule;
  const skillParam = nav.skill;
  const [claudeMdDirty, setClaudeMdDirty] = useState(false);
  const [claudeMdMode, setClaudeMdMode] = useState<ViewMode>("preview");
  const claudeMdEditorRef = useRef<ClaudeMdEditorHandle>(null);
  const [settingsJsonDirty, setSettingsJsonDirty] = useState(false);
  const settingsJsonEditorRef = useRef<JsonFileEditorHandle>(null);
  const [settingsLocalJsonDirty, setSettingsLocalJsonDirty] = useState(false);
  const settingsLocalJsonEditorRef = useRef<JsonFileEditorHandle>(null);
  // プロファイルの対象リポジトリ(`repository_path`。issue #269)。CLAUDE.md /
  // Rules / Skills / settings 系ビューはセッションではなくこのリポジトリが対象。
  // `undefined` は設定の読み込み前、`null` は未設定。
  const [repositoryPath, setRepositoryPath] = useState<string | null | undefined>(undefined);
  const [githubAuthenticated, setGithubAuthenticated] = useState(false);
  const [githubProject, setGithubProject] = useState<{ owner: string; number: number } | null>(
    null,
  );
  const [projectItems, setProjectItems] = useState<ProjectItemDto[]>([]);
  const [projectItemsNextCursor, setProjectItemsNextCursor] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectStatusFieldId, setProjectStatusFieldId] = useState<string | null>(null);
  const [projectStatusOptions, setProjectStatusOptions] = useState<ProjectStatusOptionDto[]>([]);
  const [projectItemsLoaded, setProjectItemsLoaded] = useState(false);
  const [projectItemsLoadingMore, setProjectItemsLoadingMore] = useState(false);
  const [projectItemsError, setProjectItemsError] = useState<string | null>(null);
  // ドラッグ中のカードのアイテムID。移動処理中はカードを busy 表示にし、
  // 他のカードのドラッグも受け付けない(楽観的更新をしないための直列化。
  // native.md §3.1。issue #50)。
  const [movingItemId, setMovingItemId] = useState<string | null>(null);
  const [dragOverColumnKey, setDragOverColumnKey] = useState<string | null>(null);

  const loadSessionGroups = useCallback((folders: string[]): Promise<void> => {
    return Promise.all(
      folders.map((folder) =>
        listSessions(folder)
          .then((sessions) => ({ folder, sessions }))
          .catch((e) => {
            setError(isAppError(e) ? e.message : String(e));
            return { folder, sessions: [] as SessionSummaryDto[] };
          }),
      ),
    ).then(setSessionGroups);
  }, []);

  const loadTargetFoldersAndSessions = useCallback((): Promise<void> => {
    return getSettings(windowProfileId)
      .then((settings) => {
        const profileId = windowProfileId ?? settings.active_profile_id;
        setResolvedProfileId(profileId);
        setRepositoryPath(settings.repository_path);
        setTargetFolders(settings.selected_project_folders);
        setGithubProject(settings.github_project);
        return loadSessionGroups(settings.selected_project_folders);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, [loadSessionGroups, windowProfileId]);

  const loadGithubAuthStatus = useCallback((): Promise<void> => {
    return getGithubAuthStatus()
      .then((status) => setGithubAuthenticated(status.authenticated))
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  const loadProjectItems = useCallback(
    (cursor: string | null): Promise<void> => {
      setProjectItemsError(null);
      return listGithubProjectItems(cursor, windowProfileId)
        .then((page) => {
          setProjectItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
          setProjectItemsNextCursor(page.next_cursor);
          setProjectId(page.project_id);
          setProjectStatusFieldId(page.status_field_id);
          setProjectStatusOptions(page.status_options);
          setProjectItemsLoaded(true);
        })
        .catch((e) => setProjectItemsError(isAppError(e) ? e.message : String(e)));
    },
    [windowProfileId],
  );

  // 切替(セッション識別子が変わる)・整合性が疑わしいとき用: 一旦クリアしてから
  // 1ページ目を取り直す(issue #314。従来はこの関数1つを全経路で使っていたため、
  // 同一セッションへの追記のたびに全消し→再構築になりチラついていた)。
  const loadSession = useCallback((project: string, id: string): Promise<void> => {
    setMessages([]);
    setHasMore(false);
    return getSession(project, id, 0, PAGE_SIZE)
      .then((session) => {
        setMessages(session.messages);
        setHasMore(session.messages.length === PAGE_SIZE);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  // 同一セッションへの追記の反映(issue #314)。クリアせず、今読み込んでいる件数を
  // そのまま `limit` にして offset 0 から取り直し、`setMessages` を1回だけ呼ぶ
  // (新着はその中に自然に含まれる)。読み込み中に0件なら PAGE_SIZE を使う
  // (初回読み込み前にこの経路が呼ばれることはない想定だが、保険として)。
  // `key={m.uuid}`(下記)と組み合わせて、既存の吹き出しの DOM は保持され、
  // 変化の無いメッセージは MessageText 内の useMemo によって Markdown の
  // 再パースも起きない。
  const refreshSessionInPlace = useCallback(
    (project: string, id: string): Promise<void> => {
      const limit = Math.max(messagesRef.current.length, PAGE_SIZE);
      return getSession(project, id, 0, limit)
        .then((session) => {
          setMessages(session.messages);
          setHasMore(session.messages.length === limit);
        })
        .catch((e) => setError(isAppError(e) ? e.message : String(e)));
    },
    [],
  );

  const loadMore = useCallback(() => {
    if (!projectParam || !sessionParam || loadingMore) return;
    setLoadingMore(true);
    getSession(projectParam, sessionParam, messages.length, PAGE_SIZE)
      .then((session) => {
        setMessages((prev) => [...prev, ...session.messages]);
        setHasMore(session.messages.length === PAGE_SIZE);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setLoadingMore(false));
  }, [projectParam, sessionParam, loadingMore, messages.length]);

  const reload = useCallback((): Promise<void> => {
    const tasks = [loadTargetFoldersAndSessions(), loadGithubAuthStatus()];
    if (projectParam && sessionParam) {
      tasks.push(loadSession(projectParam, sessionParam));
    }
    if (view === "github-project" && githubAuthenticated && githubProject) {
      tasks.push(loadProjectItems(null));
    }
    return Promise.all(tasks).then(() => undefined);
  }, [
    projectParam,
    sessionParam,
    view,
    githubAuthenticated,
    githubProject,
    loadTargetFoldersAndSessions,
    loadGithubAuthStatus,
    loadSession,
    loadProjectItems,
  ]);

  useEffect(() => {
    loadTargetFoldersAndSessions();
    loadGithubAuthStatus();
  }, [loadTargetFoldersAndSessions, loadGithubAuthStatus]);

  useEffect(() => {
    if (view !== "github-project" || projectItemsLoaded) return;
    if (!githubAuthenticated || !githubProject) return;
    loadProjectItems(null);
  }, [view, githubAuthenticated, githubProject, projectItemsLoaded, loadProjectItems]);

  useEffect(() => {
    if (!projectParam || !sessionParam) {
      setMessages([]);
      setHasMore(false);
      return;
    }
    loadSession(projectParam, sessionParam);
  }, [projectParam, sessionParam, loadSession]);

  useEffect(() => {
    const unlistenPromise = onSessionChanged(({ project }) => {
      if (targetFolders.includes(project)) {
        loadSessionGroups(targetFolders);
      }
      if (project === projectParam && sessionParam) {
        refreshSessionInPlace(project, sessionParam);
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [targetFolders, projectParam, sessionParam, loadSessionGroups, refreshSessionInPlace]);

  // 保存済みのセッションタブを読み込む(issue #353)。プロファイルが確定してから。
  useEffect(() => {
    if (!resolvedProfileId) return;
    getViewerTabs(resolvedProfileId)
      .then(setViewerTabs)
      .catch((e) => {
        setViewerTabs([]);
        setError(isAppError(e) ? e.message : String(e));
      });
  }, [resolvedProfileId]);

  // 設定の変更(設定画面でのプロファイル切り替え等)で対象フォルダ・GitHubプロジェクトが変わった
  // ことの通知。表示中のフォルダが新しいプロファイルの対象から外れた場合は
  // 選択を解除する(issue #72)。
  useEffect(() => {
    const unlistenPromise = onSettingsUpdated(() => {
      getSettings(windowProfileId)
        .then((settings) => {
          setRepositoryPath(settings.repository_path);
          setTargetFolders(settings.selected_project_folders);
          setGithubProject(settings.github_project);
          if (projectParam && !settings.selected_project_folders.includes(projectParam)) {
            nav.clearProjectAndSession();
          }
          return loadSessionGroups(settings.selected_project_folders);
        })
        .catch((e) => setError(isAppError(e) ? e.message : String(e)));
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [projectParam, loadSessionGroups, nav.clearProjectAndSession, windowProfileId]);

  const handleLoadMoreProjectItems = () => {
    if (!projectItemsNextCursor || projectItemsLoadingMore) return;
    setProjectItemsLoadingMore(true);
    loadProjectItems(projectItemsNextCursor).finally(() => setProjectItemsLoadingMore(false));
  };

  // 「No status」カラムを先頭に、以降は `ProjectV2SingleSelectField.options`
  // のカラム順(issue #50)。
  const kanbanColumns: KanbanColumn[] = useMemo(
    () => [
      { optionId: null, name: NO_STATUS_COLUMN_NAME },
      ...projectStatusOptions.map((option) => ({ optionId: option.id, name: option.name })),
    ],
    [projectStatusOptions],
  );

  const columnKeyForItem = useCallback(
    (item: ProjectItemDto): string => {
      const option = projectStatusOptions.find((o) => o.name === item.status);
      return option?.id ?? "";
    },
    [projectStatusOptions],
  );

  const itemsByColumnKey: Map<string, ProjectItemDto[]> = useMemo(() => {
    const map = new Map<string, ProjectItemDto[]>();
    for (const column of kanbanColumns) {
      map.set(column.optionId ?? "", []);
    }
    for (const item of projectItems) {
      const key = columnKeyForItem(item);
      (map.get(key) ?? map.get("")!).push(item);
    }
    return map;
  }, [projectItems, kanbanColumns, columnKeyForItem]);

  const handleDropOnColumn = (column: KanbanColumn) => (event: DragEvent) => {
    event.preventDefault();
    setDragOverColumnKey(null);
    if (movingItemId) return;

    const itemId = event.dataTransfer.getData("text/plain");
    const item = projectItems.find((i) => i.id === itemId);
    if (!item || !projectId || !projectStatusFieldId) return;
    if (columnKeyForItem(item) === (column.optionId ?? "")) return;

    setMovingItemId(itemId);
    setProjectItemsError(null);
    updateGithubProjectItemStatus(projectId, itemId, projectStatusFieldId, column.optionId)
      .then(() => loadProjectItems(null))
      .catch((e) => {
        if (isAppError(e) && e.code === "github_scope_insufficient") {
          setProjectItemsError(SCOPE_INSUFFICIENT_MESSAGE);
          return;
        }
        setProjectItemsError(isAppError(e) ? e.message : String(e));
      })
      .finally(() => setMovingItemId(null));
  };

  // 一覧の全セッション(新しい順。フォルダをまたぐ)。
  const allSessions = sessionGroups
    .flatMap((group) => group.sessions.map((session) => ({ folder: group.folder, session })))
    .sort((a, b) => b.session.modified_at - a.session.modified_at);
  const sessionByTabKey = new Map(
    allSessions.map(({ folder, session }) => [sessionTabKey(folder, session.id), { folder, session }]),
  );

  // 左ペインの縦一覧(issue #379。#348 のヘッダのタブから戻した)。自分で選んだ
  // セッションだけを、追加した順に並べる(#353 と同じ。初期は0件)。一覧に見つからない
  // もの(削除・対象フォルダから外れた等)は表示しないだけで、保存済みの並びには残す。
  // 1行は、タイトルと更新日時。対象フォルダが複数のときは見分けられるようフォルダ名も
  // 添える(フォルダごとの見出しは出さない)。
  const openTabs = (viewerTabs ?? []).flatMap((tab) => {
    const hit = sessionByTabKey.get(sessionTabKey(tab.project, tab.session_id));
    return hit ? [{ key: sessionTabKey(tab.project, tab.session_id), ...hit }] : [];
  });
  const selectedSessionSummary = sessionGroups
    .find((g) => g.folder === projectParam)
    ?.sessions.find((s) => s.id === sessionParam);
  const selectedTabValue =
    projectParam && selectedSessionSummary
      ? sessionTabKey(projectParam, selectedSessionSummary.id)
      : "";

  // タブの並びを更新して保存する(追加・閉じるのたびに自動保存)。
  const persistViewerTabs = (tabs: ViewerTabDto[]) => {
    setViewerTabs(tabs);
    if (!resolvedProfileId) return;
    saveQueueRef.current = saveQueueRef.current
      .then(() => saveViewerTabs(resolvedProfileId, tabs))
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  };

  // 「+」のモーダルで選んだセッションを、選んだ順に末尾へ足す。足したうちの最初の
  // 行を選択する。
  const handleAddSessionTabs = (keys: string[]) => {
    setPickerOpen(false);
    const added = keys.flatMap((key) => {
      const hit = sessionByTabKey.get(key);
      return hit ? [{ tab: { project: hit.folder, session_id: hit.session.id }, hit }] : [];
    });
    if (added.length === 0) return;
    persistViewerTabs([...(viewerTabs ?? []), ...added.map((a) => a.tab)]);
    handleSelectSession(added[0].hit.folder, added[0].hit.session.id);
  };

  // 行の「×」(または Delete キー)で一覧から外す。一覧から外すだけで会話ファイルは
  // 消さない。選択中の行を外したら隣の行(下、無ければ上)を選択し、最後の1つ
  // だったら選択を外して 0 件の案内へ戻る(#353 と同じ遷移)。
  const handleCloseSessionTab = (key: string) => {
    persistViewerTabs(
      (viewerTabs ?? []).filter((tab) => sessionTabKey(tab.project, tab.session_id) !== key),
    );
    if (key !== selectedTabValue) return;
    const index = openTabs.findIndex((tab) => tab.key === key);
    const neighbor = openTabs[index + 1] ?? openTabs[index - 1];
    if (neighbor) {
      handleSelectSession(neighbor.folder, neighbor.session.id);
    } else {
      nav.clearProjectAndSession();
    }
  };

  const pickerCandidates: SessionPickerCandidate[] = allSessions.map(({ folder, session }) => ({
    key: sessionTabKey(folder, session.id),
    folder,
    title: session.title,
    modifiedAt: session.modified_at,
  }));

  const selectedSummary = sessionGroups
    .find((g) => g.folder === projectParam)
    ?.sessions.find((s) => s.id === sessionParam);
  // `--resume <ID>` 化(issue #345)により、一覧に出るセッションはすべて送信対象に
  // できる(表示中のセッション ID へ送る。旧「最新のみ送信可」の制約は撤廃)。
  const canSend = !!selectedSummary;

  // ウィンドウレジストリ(issue #83)へこのウィンドウの表示状態を報告する。
  // 「1ウィンドウ=1プロファイル」への一本化(issue #91)でタブが無くなった
  // ため常に要素数1の配列になるが、DTO・ハブ側のグラフ描画は変えずそのまま
  // 使う。
  const selectedSessionTitle = selectedSummary?.title ?? null;
  const reportTabs: WindowTabDto[] = resolvedProfileId
    ? [
        {
          profile_id: resolvedProfileId,
          session_id: sessionParam,
          session_title: selectedSessionTitle,
        },
      ]
    : [];
  useReportWindowState(reportTabs, 0, reportTabs.length > 0);

  const confirmDiscardIfDirty = (): boolean => {
    if (view === "claude-md" && claudeMdDirty) {
      return window.confirm(DISCARD_CONFIRM_MESSAGE);
    }
    if (view === "settings-json" && settingsJsonDirty) {
      return window.confirm(DISCARD_CONFIRM_MESSAGE);
    }
    if (view === "settings-local-json" && settingsLocalJsonDirty) {
      return window.confirm(DISCARD_CONFIRM_MESSAGE);
    }
    return true;
  };

  const handleSelectSession = (project: string, id: string) => {
    if (!confirmDiscardIfDirty()) return;
    nav.setProjectAndSession(project, id);
  };

  const handleSwitchView = (next: PaneView) => {
    if (next === view) return;
    if (!confirmDiscardIfDirty()) return;
    nav.setView(next);
  };

  const handleSelectRule = (fileName: string) => {
    nav.setRule(fileName);
  };

  const handleSelectSkill = (name: string) => {
    nav.setSkill(name);
  };

  // 受け取った画像ファイル(貼り付け・ファイル選択)を1枚ずつ Rust で事前検証し、
  // 通ったものだけをサムネイルにする(形式・サイズ・枚数の規則は Rust の domain が
  // 唯一の判定元。違反は理由つきで表示して添付しない。issue #349)。
  const addImageFiles = async (files: File[]) => {
    setError(null);
    let count = attachments.length;
    for (const file of files) {
      try {
        const image = await readImageFile(file);
        await checkImageAttachment(image.base64, count);
        count += 1;
        setAttachments((prev) => [...prev, image]);
      } catch (e) {
        setError(isAppError(e) ? e.message : String(e));
      }
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    void addImageFiles(files);
  };

  const handleFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // 同じファイルをもう一度選べるように、選択をリセットする。
    event.target.value = "";
    if (files.length > 0) void addImageFiles(files);
  };

  const canSubmit = !!draft.trim() || attachments.length > 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!projectParam || !sessionParam || !canSend || sending || !canSubmit) return;

    setSending(true);
    setError(null);
    sendMessage(
      projectParam,
      sessionParam,
      draft,
      attachments.map((image) => image.base64),
      mode,
    )
      .then(() => {
        setDraft("");
        setAttachments([]);
        // 送信成功: 同一セッションへの追記(issue #314)。差分再読込でチラつかせない。
        refreshSessionInPlace(projectParam, sessionParam);
      })
      .catch((e) => {
        // `session_busy`(他プロセスで実行中。issue #345)を含め、Rust側の
        // エラーメッセージはそのままユーザー向けに表示できる文言になっている。
        setError(isAppError(e) ? e.message : String(e));
      })
      .finally(() => setSending(false));
  };

  // ビューアでは dock を表示しない(issue #257)ため、これらの操作は dock ではなく
  // ページ内の `ViewerToolbar` に出す(内容・挙動は dock 時代のまま)。
  const dockItems = useMemo<DockItem[]>(() => {
    const items: DockItem[] = [
      {
        id: "reload",
        label: RELOAD_ICON,
        title: "再読み込み",
        onClick: reload,
      },
      {
        id: "mode",
        label: MODE_ICON,
        title: "送信モード",
        popup: [
          {
            label: "会話のみ(chat)",
            active: mode === "chat",
            onSelect: () => setMode("chat"),
          },
          {
            label: "読み取り専用(read)",
            active: mode === "read",
            onSelect: () => setMode("read"),
          },
        ],
      },
    ];
    if (view === "claude-md") {
      items.push(
        ...createClaudeMdDockItems({
          mode: claudeMdMode,
          onModeChange: setClaudeMdMode,
          dirty: claudeMdDirty,
          onSave: () => claudeMdEditorRef.current?.save(),
          onReload: () => {
            if (claudeMdDirty && !window.confirm(DISCARD_CONFIRM_MESSAGE)) return;
            return claudeMdEditorRef.current?.reload();
          },
        }),
      );
    }
    if (view === "settings-json") {
      items.push(
        ...createProjectSettingsDockItems({
          dirty: settingsJsonDirty,
          onSave: () => settingsJsonEditorRef.current?.save(),
          onReload: () => {
            if (settingsJsonDirty && !window.confirm(DISCARD_CONFIRM_MESSAGE)) return;
            return settingsJsonEditorRef.current?.reload();
          },
        }),
      );
    }
    if (view === "settings-local-json") {
      items.push(
        ...createProjectSettingsDockItems({
          dirty: settingsLocalJsonDirty,
          onSave: () => settingsLocalJsonEditorRef.current?.save(),
          onReload: () => {
            if (settingsLocalJsonDirty && !window.confirm(DISCARD_CONFIRM_MESSAGE)) return;
            return settingsLocalJsonEditorRef.current?.reload();
          },
        }),
      );
    }
    return items;
  }, [
    reload,
    mode,
    view,
    claudeMdMode,
    claudeMdDirty,
    settingsJsonDirty,
    settingsLocalJsonDirty,
  ]);

  // CLAUDE.md / Rules / Skills / settings 系ビューの、リポジトリ未設定時の案内
  // (issue #269)。読み込み前(`undefined`)は何も出さない。
  const repositoryGuide =
    repositoryPath === null ? (
      <p>リポジトリが設定されていません。設定画面で対象リポジトリを指定してください。</p>
    ) : null;

  return (
    <div className="viewer-page">
      {/* 最上段は左端まで届く全幅のヘッダ(issue #291)。プロファイル名(#275)は
          ウィンドウタイトルへ移した(#348・#377)ため、今は中身が無い(操作の
          ツールバーは画面下のフッター)。その下に サイドメニュー | 選んだセッションの
          一覧 | コンテンツ を並べる。 */}
      <div className="session-conversation-head" />
      {pickerOpen && (
        <SessionPickerDialog
          candidates={pickerCandidates}
          openKeys={new Set(openTabs.map((tab) => tab.key))}
          showFolder={targetFolders.length > 1}
          onAdd={handleAddSessionTabs}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <div className="viewer-body">
      {/* ビュー切り替えは上部のタブではなく、画面の最左端のサイドメニュー
          (issue #263)。切り替えの挙動(`handleSwitchView`)は従来のまま。 */}
      <ViewerSideMenu active={view} onChange={handleSwitchView} />
      {/* セッション一覧ペインは「会話」ビューのときだけ表示する(issue #279)。
          CLAUDE.md / Rules / Skills / settings 系は #269 でセッション不要になり、
          GitHub Project も元々プロファイル基準のため、それ以外のビューでは
          一覧を出さずコンテンツ領域を広げる。選択中のセッション・会話の表示は
          このコンポーネントの状態と URL(`project`/`session`)に持っており、
          一覧を出し入れしても破棄されない(会話に戻ればそのまま)。 */}
      {view === "chat" && (
        <div className="project-list">
          {/* 「+」(issue #353・#379)。押すとモーダルで追加するセッションを選ぶ。
              0件のときはこれだけが見える。 */}
          <button
            type="button"
            className="session-list-add"
            title="セッションを追加"
            aria-label="セッションを追加"
            onClick={() => setPickerOpen(true)}
          >
            + セッションを追加
          </button>
          {openTabs.map(({ key, folder, session }) => (
            <div key={key} className="session-list-row">
              <button
                type="button"
                className={`project-item session-list-item ${
                  key === selectedTabValue ? "selected" : ""
                }`}
                onClick={() => handleSelectSession(folder, session.id)}
                onKeyDown={(event) => {
                  // キーボードからは Delete で外す(× は Tab キーの順序に入れない。#353 と同じ)。
                  if (event.key !== "Delete") return;
                  event.preventDefault();
                  handleCloseSessionTab(key);
                }}
              >
                <span className="session-item-title">{session.title}</span>
                <span className="session-item-updated">
                  {new Date(session.modified_at).toLocaleString()}
                </span>
                {targetFolders.length > 1 && (
                  <span className="session-item-folder" title={folder}>
                    {folder}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="session-list-close"
                tabIndex={-1}
                title={`${session.title} を外す`}
                aria-label={`${session.title} を一覧から外す`}
                onClick={() => handleCloseSessionTab(key)}
              >
                {/* 基本デザイン「アイコン」の close(uiIcon.ts)。色は currentColor。 */}
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="session-conversation">
        {view === "chat" ? (
          <>
            <form className="message-form" onSubmit={handleSubmit}>
              {/* 画像の添付(ファイル選択。貼り付けは入力欄の paste で受ける。issue #349) */}
              <button
                type="button"
                className="message-attach"
                title="画像を添付"
                aria-label="画像を添付"
                disabled={!projectParam || !sessionParam || !canSend || sending}
                onClick={() => fileInputRef.current?.click()}
              >
                画像
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={handleFilesSelected}
              />
              <input
                type="text"
                className="message-input"
                placeholder="AIにメッセージを送る(画像は貼り付けでも添付できます)"
                value={draft}
                disabled={!projectParam || !sessionParam || !canSend || sending}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={handlePaste}
              />
              <button
                type="submit"
                className="message-send"
                disabled={
                  !projectParam || !sessionParam || !canSend || sending || !canSubmit
                }
              >
                {sending ? "送信中…" : "送信"}
              </button>
            </form>
            {attachments.length > 0 && (
              <div className="message-attachments">
                {attachments.map((image, i) => (
                  <div key={image.id} className="message-attachment">
                    <img
                      className="message-attachment-thumb"
                      src={image.dataUrl}
                      alt={`添付画像 ${i + 1}`}
                    />
                    <button
                      type="button"
                      className="message-attachment-remove"
                      title="この画像を外す"
                      aria-label={`添付画像 ${i + 1} を外す`}
                      disabled={sending}
                      onClick={() =>
                        setAttachments((prev) => prev.filter((a) => a.id !== image.id))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="conversation-scroll">
              {error && <p className="error">{error}</p>}
              {!projectParam || !sessionParam ? (
                <p>
                  {targetFolders.length === 0
                    ? "設定のClaudeタブで対象フォルダを選択してください。"
                    : openTabs.length === 0
                      ? "左の「+」からセッションを追加してください。"
                      : "左の一覧からセッションを選択してください。"}
                </p>
              ) : (
                <>
                  {rawLineUuid && (
                    <RawLineDialog
                      project={projectParam}
                      sessionId={sessionParam}
                      uuid={rawLineUuid}
                      onClose={() => setRawLineUuid(null)}
                    />
                  )}
                  {imagesUuid && (
                    <MessageImagesDialog
                      project={projectParam}
                      sessionId={sessionParam}
                      uuid={imagesUuid}
                      onClose={() => setImagesUuid(null)}
                    />
                  )}
                  <div className="messages">
                    {messages.map((m, i) => {
                      // uuid をキーにして、追記のたびの DOM の作り直しを避ける
                      // (issue #314)。行に uuid が無ければ従来どおり位置キー。
                      const key = m.uuid ?? `i-${i}`;
                      // 吹き出しの横に、種類(role)と日時を小さく淡く出す
                      // (issue #258)。timestamp が空・不正なら日時は出さない。
                      const time = formatTimestamp(m.timestamp);
                      // 送信に失敗したことの見分け(issue #364)。エラー行は普通の返事と、
                      // 答えのない質問は普通の質問と見分けがつくようにする。
                      const isSendError = m.status === "error" || m.status === "error_for_question";
                      const isFailedQuestion = m.status === "failed_question";
                      return (
                        <div
                          key={key}
                          className={`message-row message-row-${m.role}${isSendError ? " message-row-send-error" : ""}`}
                        >
                          <div className={`message-meta message-meta-${m.role}`}>
                            <span className="message-meta-role">{isSendError ? "error" : m.role}</span>
                            {time && <span className="message-meta-time">{time}</span>}
                            {isFailedQuestion && (
                              <span className="message-meta-failed">送信に失敗</span>
                            )}
                            {/* 元の jsonl 行をモーダルで見る(issue #313)。uuid の無い行は出さない。 */}
                            {m.uuid && (
                              <button
                                type="button"
                                className="message-meta-data"
                                onClick={() => setRawLineUuid(m.uuid)}
                              >
                                データ
                              </button>
                            )}
                          </div>
                          <div
                            className={`message message-${m.role}${isSendError ? " message-send-error" : ""}${isFailedQuestion ? " message-failed-question" : ""}`}
                          >
                            {isSendError ? (
                              <SendErrorBody text={m.text} status={m.status} />
                            ) : (
                              m.text && <MessageText text={m.text} />
                            )}
                            {/* 画像は本体を載せず件数だけ。押すとその行の画像を取りに行く(issue #349)。
                                uuid の無い行は取得できないので件数だけ出す。 */}
                            {m.image_count > 0 &&
                              (m.uuid ? (
                                <button
                                  type="button"
                                  className="message-images-button"
                                  onClick={() => setImagesUuid(m.uuid)}
                                >
                                  画像 {m.image_count} 枚
                                </button>
                              ) : (
                                <span className="message-images-count">画像 {m.image_count} 枚</span>
                              ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {hasMore && (
                    <button
                      type="button"
                      className="load-more"
                      disabled={loadingMore}
                      onClick={loadMore}
                    >
                      {loadingMore ? "読み込み中…" : "もっと読み込む(過去の会話)"}
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        ) : view === "profile-settings" ? (
          // /settings と同じプロファイル設定(共有コンポーネント)を、このウィンドウの
          // プロファイルに固定して表示する(issue #299)。
          <ProfileSettingsPane profileId={nav.windowProfileId} />
        ) : view === "claude-md" ? (
          repositoryPath ? (
            <div className="claude-md-pane">
              <ClaudeMdEditor
                ref={claudeMdEditorRef}
                load={() => getProjectClaudeMd(windowProfileId)}
                save={(content, expectedModifiedAtMs) =>
                  saveProjectClaudeMd(windowProfileId, content, expectedModifiedAtMs)
                }
                reloadKey={repositoryPath}
                mode={claudeMdMode}
                onDirtyChange={setClaudeMdDirty}
                onCreate={() => setClaudeMdMode("split")}
              />
            </div>
          ) : (
            repositoryGuide
          )
        ) : view === "github-project" ? (
          <div className="github-project-pane">
            {!githubAuthenticated ? (
              <p>設定のGitHubタブでログインしてください。</p>
            ) : !githubProject ? (
              <p>設定のGitHubタブでプロジェクトを選択してください。</p>
            ) : (
              <>
                {projectItemsError && <p className="error">{projectItemsError}</p>}
                <div className="kanban-board">
                  {kanbanColumns.map((column) => {
                    const key = column.optionId ?? "";
                    const items = itemsByColumnKey.get(key) ?? [];
                    return (
                      <div
                        key={key}
                        className={
                          "kanban-column" + (dragOverColumnKey === key ? " is-drop-target" : "")
                        }
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDragOverColumnKey(key);
                        }}
                        onDragLeave={() =>
                          setDragOverColumnKey((prev) => (prev === key ? null : prev))
                        }
                        onDrop={handleDropOnColumn(column)}
                      >
                        <h3 className="kanban-column-heading">
                          {column.name}
                          <span className="kanban-column-count">{items.length}</span>
                        </h3>
                        <div className="kanban-column-body">
                          {items.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={
                                "project-item-card" +
                                (movingItemId === item.id ? " is-busy" : "")
                              }
                              draggable={!movingItemId}
                              onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", item.id);
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onClick={() => item.url && openUrl(item.url)}
                            >
                              <span className="project-item-title">{item.title}</span>
                              <span className="project-item-meta">
                                {PROJECT_ITEM_KIND_LABEL[item.kind]}
                                {item.repository && item.number
                                  ? ` ${item.repository}#${item.number}`
                                  : ""}
                                {item.assignees.length > 0
                                  ? ` · ${item.assignees.join(", ")}`
                                  : ""}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {projectItemsNextCursor && (
                  <button
                    type="button"
                    className="load-more"
                    disabled={projectItemsLoadingMore}
                    onClick={handleLoadMoreProjectItems}
                  >
                    {projectItemsLoadingMore ? "読み込み中…" : "もっと読み込む"}
                  </button>
                )}
              </>
            )}
          </div>
        ) : view === "rules" ? (
          repositoryPath ? (
            <RulesPane
              profileId={windowProfileId}
              selectedFileName={ruleParam}
              onSelectFile={handleSelectRule}
            />
          ) : (
            repositoryGuide
          )
        ) : view === "skills" ? (
          repositoryPath ? (
            <SkillsPane
              profileId={windowProfileId}
              selectedName={skillParam}
              onSelectSkill={handleSelectSkill}
            />
          ) : (
            repositoryGuide
          )
        ) : view === "settings-json" ? (
          repositoryPath ? (
            <div className="json-settings-pane">
              <JsonFileEditor
                ref={settingsJsonEditorRef}
                load={() => getProjectSettingsFile(windowProfileId, "settings")}
                save={(content, expectedModifiedAtMs) =>
                  saveProjectSettingsFile(
                    windowProfileId,
                    "settings",
                    content,
                    expectedModifiedAtMs,
                  )
                }
                reloadKey={repositoryPath}
                emptyMessage="settings.jsonがありません。"
                onDirtyChange={setSettingsJsonDirty}
              />
            </div>
          ) : (
            repositoryGuide
          )
        ) : repositoryPath ? (
          <div className="json-settings-pane">
            <JsonFileEditor
              ref={settingsLocalJsonEditorRef}
              load={() => getProjectSettingsFile(windowProfileId, "settings_local")}
              save={(content, expectedModifiedAtMs) =>
                saveProjectSettingsFile(
                  windowProfileId,
                  "settings_local",
                  content,
                  expectedModifiedAtMs,
                )
              }
              reloadKey={repositoryPath}
              emptyMessage="settings.local.jsonがありません。"
              onDirtyChange={setSettingsLocalJsonDirty}
            />
          </div>
        ) : (
          repositoryGuide
        )}
        {/* コンテンツ領域の下端のフッター(ユーザー指示)。表示の切り替え・
            再読み込み・保存などの操作をここにまとめる。サイドメニューや
            セッション一覧の下には回り込ませない(ページ全体のフッターにはしない)。
            項目の中身・挙動は従来のまま(`dockItems`)。 */}
        <div className="viewer-footer">
          <ViewerToolbar items={dockItems} />
        </div>
      </div>
      </div>
    </div>
  );
}

export default SessionsPage;
