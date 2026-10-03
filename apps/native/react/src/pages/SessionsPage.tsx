import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, FormEvent, KeyboardEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DockItem } from "command-dock";
import type { ViewMode } from "@yanqirenshi/markdown.sitter";
import {
  archiveSession,
  checkImageAttachment,
  getGithubAuthStatus,
  getProjectClaudeMd,
  getProjectSettingsFile,
  getSession,
  getSettings,
  isAppError,
  listGithubProjectItems,
  listSessions,
  onSessionChanged,
  onSettingsUpdated,
  onViewerNavigate,
  saveProjectClaudeMd,
  saveProjectSettingsFile,
  startRunningSession,
  unarchiveSession,
  updateGithubProjectItemStatus,
} from "../api";
import type {
  ProcessStateDto,
  RunningPermissionModeDto,
  RunningSessionSummaryDto,
  StartModelDto,
  MessageDto,
  ProjectItemDto,
  ProjectStatusOptionDto,
  SessionSummaryDto,
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
import RawLineDialog from "../RawLineDialog";
import { SendErrorBody } from "../SendErrorBody";
import Badge from "../Badge";
import LiveTurnView from "../LiveTurnView";
import NewSessionDialog from "../NewSessionDialog";
import type { NewSessionInput } from "../NewSessionDialog";
import PermissionRequestCard from "../PermissionRequestCard";
import RunningSessionBar from "../RunningSessionBar";
import { MAX_SESSION_NAME_CHARS } from "../runningSessionLabels";
import {
  PERMISSION_MODE_LABELS,
  processStateLabel,
  processStateTone,
  selectableModeOf,
} from "../runningSessionLabels";
import { useRunningSession } from "../useRunningSession";
import { useRunningSessionList } from "../useRunningSessionList";
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

// 左の一覧の行の色分け(issue #491)。ハブの sessionNodeCircleStyle(HubPage.tsx)と
// 同じ 3 状態 + 無色の考え方: いま動いている・人の操作を待っている(起動中・実行中)は
// 金茶、人の操作を待っている(権限待ち)は金茶の濃い方で強調、落ち着いている(待機)は墨、
// 実行中でない(未起動)は無色。`null`(実行中セッションが無い)も無色。
function sessionRowStateClass(state: ProcessStateDto | null): string {
  switch (state) {
    case "starting":
    case "running":
      return "session-list-item-running";
    case "awaiting_permission":
      return "session-list-item-awaiting";
    case "idle":
      return "session-list-item-idle";
    default:
      return "";
  }
}

/**
 * 吹き出しの横の見出し(role)。セッション間メッセージ(issue #437)は、通常の会話と見分けて
 * 「他セッションから(送り元)」「送信: 宛先」「送信の結果」と出す。
 */
function messageRoleLabel(m: MessageDto): string {
  switch (m.kind) {
    case "peer_received":
      return m.peer_name ? `他セッションから(${m.peer_name})` : "他セッションから";
    case "peer_sent":
      // 返信の宛先は名前ではなく受信口のアドレス(uds:…)になることがある。長いのでそのまま出さない。
      if (m.peer_name?.startsWith("uds:")) return "送信(返信)";
      return m.peer_name ? `送信: ${m.peer_name}` : "送信";
    case "peer_send_result":
      return m.peer_success === false ? "送信の結果(失敗)" : "送信の結果";
    default:
      return m.role;
  }
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
  // 左ペインの検索語(issue #487。インクリメンタル・大文字小文字を区別しない部分一致)。
  // 一覧は常に全セッションを表示し、この語で絞り込むだけ(選んだものだけを保存する
  // 仕組み(旧 viewerTabs)は廃止した)。
  const [sessionFilter, setSessionFilter] = useState("");
  // 一覧の区分トグル(issue #506。#495 の「アーカイブを表示」チェックボックスを置き換え)。
  // 区分は 1 セッション 1 つ: archived なら「アーカイブ」(実行中より優先)、そうでなく
  // 実行中(runningBySessionId にある。会話ファイルの無い新規セッションも含む)なら「起動」、
  // 残りが「未起動」。ON = 一覧に表示。UI 状態なので保存しない。既定はいまの見え方と同じ
  // (起動 ON・未起動 ON・アーカイブ OFF)。検索語とは AND。
  const [showRunningCategory, setShowRunningCategory] = useState(true);
  const [showIdleCategory, setShowIdleCategory] = useState(true);
  const [showArchivedCategory, setShowArchivedCategory] = useState(false);
  // 新規セッションのモーダル(issue #409)。
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  // 再開に付ける表示名(`--name`)の、ユーザーが入力欄を編集した値。編集していなければ `null`
  // で、入力欄にはその会話の現在の表示名(`custom_title`)を初期値として出す(issue #445。
  // 同じ値なら会話のタイトルは変わらず、CLI が既定の名前を付けない)。送信・会話の切り替えで戻す。
  const [resumeNameEdit, setResumeNameEdit] = useState<string | null>(null);
  // 次に起動する(再開する)ときのモデル(issue #445。`null` は既定 = --model を付けない)。
  // 別の会話へ移ったら、意図せず持ち越さないよう既定に戻す。
  const [startModel, setStartModel] = useState<StartModelDto | null>(null);
  useEffect(() => {
    setStartModel(null);
    setResumeNameEdit(null);
  }, [nav.session]);
  // このウィンドウで新規に作ったセッションの ID(会話ファイルができたら、URL を
  // `project` 付きの表示へ切り替える。issue #487 で「一覧(タブ)へ加える」役割は
  // 無くなったが、新規セッションから通常表示への遷移自体はまだ必要)。
  const newlyStartedRef = useRef<Set<string>>(new Set());
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
  // 複数行入力欄(issue #483)の自動リサイズ用。高さの再計算に使う。
  const draftInputRef = useRef<HTMLTextAreaElement>(null);
  // 次に起動する実行中セッションの権限モード(issue #392。Phase 1 は plan と default)。
  // 起動済みのプロセスには途中で反映しない(状態表示に、起動時のモードが出る)。
  const [mode, setMode] = useState<RunningPermissionModeDto>("default");
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

  // app が起動したまま持つ claude CLI との対話(issue #392。Phase 1)。状態はイベント →
  // Query で取り直す(楽観更新しない)。途中経過(返答中の表示)は確定した行(#314)が
  // 一覧に現れたら消える。`busy` は起動〜送信の書き込みが終わるまで(入力欄を止める)。
  const {
    running,
    live,
    busy: sending,
    switching,
    send: sendToSession,
    start: startRunning,
    starting,
    respond: respondToPermission,
    interrupt: interruptRunning,
    switchTo: switchRunning,
    stop: stopRunning,
  } = useRunningSession({
    sessionId: sessionParam ?? null,
    onTurnFinished: (target) => {
      if (projectParam && sessionParam && target && target.session_id === sessionParam) {
        return refreshSessionInPlace(projectParam, sessionParam);
      }
    },
    onError: (message) => setError(message),
    getMessageUuids: () => messagesRef.current.flatMap((m) => (m.uuid ? [m.uuid] : [])),
  });

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

  // 会話ファイルがまだ無い新規のセッション(issue #409)。app が起動して持っているセッションのうち、
  // 一覧(会話ファイルから作る)に無いもの。左の一覧に並べ、選ぶと空の会話として開く
  // (URL は `session` だけで `project` を持たない)。会話ファイルができたら通常の行になる。
  const runningList = useRunningSessionList();
  const knownSessionIds = new Set(allSessions.map(({ session }) => session.id));
  const pendingSummaries = runningList.filter(
    (s) => s.process_state !== "exited" && !knownSessionIds.has(s.session_id),
  );
  // session_id → 実行中セッション(issue #491)。一覧の行の色分け・バッジ・区分(#506)に使う。
  // ハブの runningBySessionId(HubPage.tsx)と同じ作り: 終了したもの(一覧には残る)は
  // 載せず、未起動と同じ扱いにする。
  const runningBySessionId = useMemo(() => {
    const map = new Map<string, RunningSessionSummaryDto>();
    runningList.forEach((summary) => {
      if (summary.process_state !== "exited") map.set(summary.session_id, summary);
    });
    return map;
  }, [runningList]);

  // 左ペインの縦一覧(issue #487)。選んだものだけを並べる方式(#353・#379)をやめ、
  // 全セッションを常に表示し、検索語(`sessionFilter`)で絞り込むだけにする。
  // 対象: タイトル。対象フォルダが複数のときはフォルダ名も対象に含める。
  // 区分トグル(issue #506)で表示 OFF の区分は除く。検索語とは AND。
  const normalizedSessionFilter = sessionFilter.trim().toLowerCase();
  const categoryFilteredSessions = allSessions.filter(({ session }) => {
    if (session.archived) return showArchivedCategory;
    if (runningBySessionId.has(session.id)) return showRunningCategory;
    return showIdleCategory;
  });
  const visibleSessions = (
    normalizedSessionFilter
      ? categoryFilteredSessions.filter(
          ({ folder, session }) =>
            session.title.toLowerCase().includes(normalizedSessionFilter) ||
            (targetFolders.length > 1 && folder.toLowerCase().includes(normalizedSessionFilter)),
        )
      : categoryFilteredSessions
  ).map(({ folder, session }) => ({ key: sessionTabKey(folder, session.id), folder, session }));
  // 会話ファイルの無い新規セッション(issue #409)も「起動」の区分として扱う(issue #506)。
  const visiblePendingSummaries = showRunningCategory ? pendingSummaries : [];
  const selectedSessionSummary = sessionGroups
    .find((g) => g.folder === projectParam)
    ?.sessions.find((s) => s.id === sessionParam);
  const selectedTabValue =
    projectParam && selectedSessionSummary
      ? sessionTabKey(projectParam, selectedSessionSummary.id)
      : "";

  const selectedSummary = sessionGroups
    .find((g) => g.folder === projectParam)
    ?.sessions.find((s) => s.id === sessionParam);
  // `--resume <ID>` 化(issue #345)により、一覧に出るセッションはすべて送信対象に
  // できる(表示中のセッション ID へ送る。旧「最新のみ送信可」の制約は撤廃)。
  // 表示中の会話の実行中セッションが動いているか(実行中セッションは会話ごとに複数持てる。
  // 別の会話が実行中でも、この会話へ送るときはそのまま新しく起動する。issue #407)。
  const runningAlive = running !== null && running.process_state !== "exited";

  const pendingSelected =
    !projectParam && sessionParam
      ? (pendingSummaries.find((s) => s.session_id === sessionParam) ?? null)
      : null;
  // 表示中の対象がある(会話ファイルのある会話、または新規のセッション)。
  const hasTarget = !!sessionParam && (!!projectParam || !!pendingSelected);
  // 選択を外した(hasTarget が false になった)ら、書きかけの下書き・添付を空にする
  // (issue #515)。入力欄自体を hasTarget のときだけ描くようにしたため、隠れたまま
  // 残ると、別の(または同じ)会話へ戻ったときに意図せず古い下書きが蘇ってしまう。
  // 対象を切り替えただけ(ある会話から別の会話へ)のときは、従来どおり保持したまま
  // (こちらは #515 の対象外。選択が無い状態を経由しない切り替えでは消さない)。
  useEffect(() => {
    if (!hasTarget) {
      setDraft("");
      setAttachments([]);
    }
  }, [hasTarget]);
  // `--resume <ID>` 化(issue #345)により、一覧に出るセッションはすべて送信対象にできる。新規の
  // セッション(会話ファイルがまだ無い)も、実行中なら送れる。
  const canSend = !!selectedSummary || !!pendingSelected;
  // 再開の表示名の入力欄の値(編集していなければ、その会話の現在の表示名)。
  // 表示名の上限(backend の `MAX_NAME_CHARS`)を超える表示名は、切り詰めるとタイトルが変わるので
  // 初期値にしない(空で始める)。
  const currentTitleAsName = selectedSummary?.custom_title ?? "";
  const resumeName =
    resumeNameEdit ?? ([...currentTitleAsName].length <= MAX_SESSION_NAME_CHARS ? currentTitleAsName : "");

  // 権限モードの選択: 起動中なら実行中のセッションを切り替え、未起動なら次の起動の値。
  const selectMode = (value: RunningPermissionModeDto) => {
    setMode(value);
    if (runningAlive) void switchRunning({ kind: "permission_mode", mode: value });
  };
  const selectModel = (model: string) => void switchRunning({ kind: "model", model });

  // 未起動のとき、メッセージ無しで起動だけする(issue #484)。送信時の自動起動
  // (useRunningSession の send)と同じ `ensureStarted` を使うため、引数(権限モード・
  // 表示名・モデル)は送信時と揃っている。`RunningSessionBar` の「起動」ボタンから呼ぶ
  // (出る条件は canConfigureResume と同じで、projectParam が確定していることが前提)。
  const handleStartRunning = () => {
    if (!projectParam || !sessionParam) return;
    void startRunning({
      profileId: resolvedProfileId,
      project: projectParam,
      sessionId: sessionParam,
      mode,
      name: resumeName,
      model: startModel,
    });
  };

  // アーカイブする(issue #495)。実行中のものは、止めてからアーカイブすることを確認する
  // (止めるのは共有層側。#494)。表示中の会話をアーカイブしたら、一覧から隠れる前に選択を外し
  // (`nav.clearProjectAndSession`)、0件の案内へ戻す。変更は `session:changed` で一覧へ反映される
  // (既存の購読。追加の取り直しは不要)。
  const archiveSessionWithConfirm = async (project: string, sessionId: string, alive: boolean) => {
    if (alive && !window.confirm("実行中です。止めてからアーカイブします。よろしいですか?")) {
      return;
    }
    try {
      await archiveSession(project, sessionId);
      if (project === projectParam && sessionId === sessionParam) {
        nav.clearProjectAndSession();
      }
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
    }
  };

  // 会話ペイン左下の「アーカイブ」/「戻す」から呼ぶ(issue #495・#510・#511)。表示中の
  // 会話が対象(projectParam/sessionParam が確定していることが前提)。一覧行のホバー
  // ボタン(#495)は会話を開くつもりで誤って押してしまう事故があったため #510 で廃止し、
  // いったん状態バーに集約したが、#511 で状態バーからも会話ペインの専用の行へ移した。
  // アーカイブ済みかどうかで呼び分ける(ボタンの表示もこの区別で切り替える。呼び出し側)。
  const handleArchiveToggleCurrentSession = () => {
    if (!projectParam || !sessionParam) return;
    if (selectedSummary?.archived) {
      void unarchiveSession(projectParam, sessionParam).catch((e) =>
        setError(isAppError(e) ? e.message : String(e)),
      );
      return;
    }
    void archiveSessionWithConfirm(projectParam, sessionParam, runningAlive);
  };

  // 会話ファイルができた新規セッションの表示中(URL が `session` だけ)を、通常の会話の
  // 表示(`project` 付き)へ移す(issue #487。一覧は全件表示になったため「タブへ加える」
  // 処理は不要になった)。
  useEffect(() => {
    const ids = new Set(newlyStartedRef.current);
    if (!projectParam && sessionParam) ids.add(sessionParam);
    for (const id of ids) {
      const hit = allSessions.find(({ session }) => session.id === id);
      if (!hit) continue;
      newlyStartedRef.current.delete(id);
      if (!projectParam && sessionParam === id) nav.setProjectAndSession(hit.folder, id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionGroups, projectParam, sessionParam]);

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

  // 他のウィンドウ(ハブなど)から、このウィンドウのビューアを指定セッションへ移動する要求
  // (`focus_window` に session を渡したとき。`viewer:navigate`。issue #422)。会話ビューへ切り替えて、
  // そのセッションを選択する(編集中の内容があれば、破棄の確認を挟む)。一覧(保存済みタブ)に
  // 無いセッションでも、選択・表示はできる(タブへの追加は、呼び出し側が事前に保存する)。
  const navigateRef = useRef((_project: string, _id: string) => {});
  navigateRef.current = (project, id) => {
    if (!confirmDiscardIfDirty()) return;
    nav.setView("chat");
    nav.setProjectAndSession(project, id);
  };
  useEffect(() => {
    const unlistenPromise = onViewerNavigate(({ project, session_id }) =>
      navigateRef.current(project, session_id),
    );
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

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

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    void addImageFiles(files);
  };

  // 複数行入力欄(issue #483)。行数に応じて高さを伸ばし(上限は CSS の max-height)、
  // 空になったら1行に戻す。いったん "auto" に戻してから scrollHeight を測ることで、
  // 削除時にも正しく縮む。
  useEffect(() => {
    const el = draftInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const handleFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // 同じファイルをもう一度選べるように、選択をリセットする。
    event.target.value = "";
    if (files.length > 0) void addImageFiles(files);
  };

  const canSubmit = !!draft.trim() || attachments.length > 0;

  // 送信(issue #392)。app が起動したままの claude 経由で送る: 未起動なら起動して、待機に
  // なってから送る(backend が、起動中の送信を断るため。#391)。別の会話の実行中セッションは
  // そのまま動かす(#407。同時数の上限を超えるときは backend が session_busy で止める)。
  // 外部(ターミナル・Desktop)で同じ会話が実行中なら、従来どおり backend が止める(#361。
  // エラー表示)。フォームの送信(ボタンクリック)と、入力欄での Enter キー(issue #483。
  // handleDraftKeyDown)の両方から呼べるよう、判定込みの本体をここに分離する。
  const submitMessage = async () => {
    if (!hasTarget || !sessionParam || !canSend || sending || !canSubmit) return;

    setError(null);
    const sent = await sendToSession({
      profileId: resolvedProfileId,
      project: projectParam,
      sessionId: sessionParam,
      mode,
      name: resumeName,
      model: startModel,
      text: draft,
      images: attachments.map((image) => image.base64),
    });
    if (sent) {
      setDraft("");
      setAttachments([]);
      setResumeNameEdit(null);
      setStartModel(null);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitMessage();
  };

  // Enter で送信、Shift+Enter で改行(issue #483)。IME の変換確定の Enter では
  // 送信しない: `isComposing` が取れないブラウザ向けに keyCode 229 もフォールバックで見る
  // (IME 確定時は Enter の keyCode が 229 になる古い挙動。念のため両方見る)。
  const handleDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void submitMessage();
  };

  // 新規セッションを作る(issue #409)。app が新しい会話(`--session-id`)を起動し、できたら
  // 左の一覧に加えて自動で開く(会話ファイルができるまでは空の会話)。失敗(同時数の上限など)は
  // 既存のバナーで理由を出す。
  const handleCreateNewSession = async (input: NewSessionInput) => {
    setNewDialogOpen(false);
    setError(null);
    try {
      const started = await startRunningSession(resolvedProfileId, {
        kind: "new",
        mode: input.mode,
        name: input.name,
        model: input.model,
      });
      newlyStartedRef.current.add(started.session_id);
      setMode(input.mode);
      if (confirmDiscardIfDirty()) nav.setProjectAndSession(null, started.session_id);
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
    }
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
        // 未起動なら次の起動から、起動中ならいまの実行中セッションを切り替える(結果は CLI が
        // 受け入れたあと、状態の取り直しで表示に反映される。issue #407)。
        title: runningAlive ? "権限モード(実行中のセッションを切り替え)" : "権限モード(次の起動から)",
        popup: (["default", "plan", "accept_edits", "auto"] as RunningPermissionModeDto[]).map(
          (value) => ({
            label: PERMISSION_MODE_LABELS[value],
            active:
              (runningAlive ? selectableModeOf(running.current_permission_mode) : mode) === value,
            onSelect: () => selectMode(value),
          }),
        ),
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
      {/* 全幅のヘッダは置かない(issue #379)。プロファイル名(#275)はウィンドウ
          タイトルへ移し(#348・#377)、操作のツールバーは画面下のフッターにあり、
          セッションのタブも無くなって中身が空になったため。サイドメニュー | 選んだ
          セッションの一覧 | コンテンツ を並べる。 */}
      {newDialogOpen && (
        <NewSessionDialog
          initialMode={mode}
          onCreate={handleCreateNewSession}
          onClose={() => setNewDialogOpen(false)}
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
          {/* 検索(issue #487。インクリメンタル・大文字小文字を区別しない部分一致)と
              「+」(issue #506。文字だけだと読みにくいので title / aria-label は
              「新しい会話を始める」「新規セッション」のまま残す)。一覧には常に
              全セッションを表示するため、旧「+ セッションを追加」(選んで一覧に
              加える方式)は廃止した。 */}
          <div className="session-list-actions">
            <input
              type="text"
              className="session-list-search"
              placeholder="セッションを検索"
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              aria-label="セッションを検索"
            />
            <button
              type="button"
              className="session-list-add"
              title="新しい会話を始める"
              aria-label="新規セッション"
              onClick={() => setNewDialogOpen(true)}
            >
              +
            </button>
          </div>
          {/* 一覧の区分トグル(issue #506。#495 の「アーカイブを表示」チェックボックスを
              置き換え)。ON = 一覧に表示。UI 状態なので保存しない。検索語とは AND
              (絞り込みと同時に効く)。 */}
          <div className="session-list-category-toggle" role="group" aria-label="表示する区分">
            <button
              type="button"
              className="session-list-category-button"
              aria-pressed={showRunningCategory}
              onClick={() => setShowRunningCategory((v) => !v)}
            >
              起動
            </button>
            <button
              type="button"
              className="session-list-category-button"
              aria-pressed={showIdleCategory}
              onClick={() => setShowIdleCategory((v) => !v)}
            >
              未起動
            </button>
            <button
              type="button"
              className="session-list-category-button"
              aria-pressed={showArchivedCategory}
              onClick={() => setShowArchivedCategory((v) => !v)}
            >
              アーカイブ
            </button>
          </div>
          {/* 会話ファイルがまだ無い新規のセッション(実行中のもの。issue #506 で「起動」区分の
              一部となり、区分トグルが OFF なら隠れる)。会話ファイルができたら通常の行になる。 */}
          {visiblePendingSummaries.map((summary) => (
            <div key={summary.session_id} className="session-list-row">
              <button
                type="button"
                className={`project-item session-list-item ${
                  pendingSelected?.session_id === summary.session_id ? "selected" : ""
                }`}
                onClick={() => {
                  if (confirmDiscardIfDirty()) nav.setProjectAndSession(null, summary.session_id);
                }}
              >
                <span className="session-item-title">{summary.name ?? "新規セッション"}</span>
                <span className="session-item-updated">
                  <Badge
                    tone={processStateTone(summary.process_state)}
                    label={processStateLabel(summary.process_state)}
                    size="small"
                  />
                </span>
              </button>
            </div>
          ))}
          {/* 全セッション(検索で絞り込み済み。issue #487)。一覧から外す操作(旧「×」・
              Delete キー)は、全件表示になったことで意味を持たなくなったため廃止した
              (会話ファイルの削除はこの画面では行わない)。実行中なら左端の帯と状態の
              バッジで色分けする(issue #491。未起動は今までどおり無色・バッジ無し)。 */}
          {visibleSessions.map(({ key, folder, session }) => {
            const sessionRunning = runningBySessionId.get(session.id) ?? null;
            return (
              <div key={key} className="session-list-row">
                <button
                  type="button"
                  className={`project-item session-list-item ${sessionRowStateClass(
                    sessionRunning?.process_state ?? null,
                  )} ${key === selectedTabValue ? "selected" : ""}`}
                  onClick={() => handleSelectSession(folder, session.id)}
                >
                  <span className="session-item-title">{session.title}</span>
                  <span className="session-item-updated">
                    {new Date(session.modified_at).toLocaleString()}
                    {sessionRunning && (
                      <Badge
                        tone={processStateTone(sessionRunning.process_state)}
                        label={processStateLabel(sessionRunning.process_state)}
                        size="small"
                      />
                    )}
                    {/* アーカイブ済みの印(issue #495。表示 ON のときだけこの行自体が
                        出る)。実行中セッションはアーカイブ時に止める(共有層側)ので、
                        上の実行中バッジと同時に出ることは無い。 */}
                    {session.archived && <Badge tone="idle" label="アーカイブ" size="small" />}
                  </span>
                  {targetFolders.length > 1 && (
                    <span className="session-item-folder" title={folder}>
                      {folder}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="session-conversation">
        {view === "chat" ? (
          <>
            {hasTarget && (
              <RunningSessionBar
                running={running}
                selectedMode={mode}
                onSelectMode={selectMode}
                onSelectModel={selectModel}
                selectedStartModel={startModel}
                onSelectStartModel={setStartModel}
                switching={switching}
                resumeName={resumeName}
                onResumeNameChange={setResumeNameEdit}
                canConfigureResume={!!projectParam && !!selectedSummary}
                onInterrupt={() => void interruptRunning()}
                onStop={() => void stopRunning()}
                onStart={handleStartRunning}
                starting={starting}
              />
            )}
            {/* メッセージ入力欄・添付サムネイルは、選んでいる対象があるときだけ描く
                (issue #515。従来は常に出して disabled にするだけだった)。選択を外した
                ときの下書き・添付のクリアは、上の useEffect(`[hasTarget]`)で行う。 */}
            {hasTarget && (
              <>
                <form className="message-form" onSubmit={handleSubmit}>
                  {/* 画像の添付(ファイル選択。貼り付けは入力欄の paste で受ける。issue #349) */}
                  <button
                    type="button"
                    className="message-attach"
                    title="画像を添付"
                    aria-label="画像を添付"
                    disabled={!canSend || sending}
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
                  <textarea
                    ref={draftInputRef}
                    className="message-input"
                    placeholder="AIにメッセージを送る(画像は貼り付けでも添付できます)"
                    rows={1}
                    value={draft}
                    disabled={!canSend || sending}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleDraftKeyDown}
                    onPaste={handlePaste}
                  />
                  <button
                    type="submit"
                    className="message-send"
                    disabled={!canSend || sending || !canSubmit}
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
              </>
            )}
            <div className="conversation-scroll">
              {error && <p className="error">{error}</p>}
              {!hasTarget ? (
                <p>
                  {targetFolders.length === 0
                    ? "設定のClaudeタブで対象フォルダを選択してください。"
                    : !showRunningCategory && !showIdleCategory && !showArchivedCategory
                      ? "表示する区分を選んでください。"
                      : normalizedSessionFilter && visibleSessions.length === 0
                        ? "該当するセッションがありません。"
                        : "左の一覧からセッションを選んでください。"}
                </p>
              ) : (
                <>
                  {rawLineUuid && projectParam && sessionParam && (
                    <RawLineDialog
                      project={projectParam}
                      sessionId={sessionParam}
                      uuid={rawLineUuid}
                      onClose={() => setRawLineUuid(null)}
                    />
                  )}
                  {imagesUuid && projectParam && sessionParam && (
                    <MessageImagesDialog
                      project={projectParam}
                      sessionId={sessionParam}
                      uuid={imagesUuid}
                      onClose={() => setImagesUuid(null)}
                    />
                  )}
                  {pendingSelected && messages.length === 0 && (
                    <p className="session-pending-note">
                      新しい会話です。最初のメッセージを送ると、会話ファイルができて一覧に加わります。
                    </p>
                  )}
                  <div className="messages">
                    {/* 権限の問い合わせと返答中の表示(issue #392)。新しい順なので先頭に置く。 */}
                    {runningAlive &&
                      running.permission_requests.map((request) => (
                        <PermissionRequestCard
                          key={request.request_id}
                          request={request}
                          respond={(requestId, behavior, options) =>
                            void respondToPermission(requestId, behavior, options)
                          }
                        />
                      ))}
                    {(runningAlive || sending) && (
                      <LiveTurnView live={live} messages={messages} />
                    )}
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
                            <span className="message-meta-role">
                              {isSendError ? "error" : messageRoleLabel(m)}
                            </span>
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
                            className={`message message-${m.role}${isSendError ? " message-send-error" : ""}${isFailedQuestion ? " message-failed-question" : ""}${m.kind !== "normal" ? " message-peer" : ""}`}
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
            {/* アーカイブ/戻す(issue #495・#510・#511)。状態バーの中断・終了とは分け、
                会話の表示(.conversation-scroll)・入力欄(.message-form)と重ならない、
                会話ペインの左下に置く。出る条件は旧 RunningSessionBar の「アーカイブ」
                ボタンと同じ(実行中、または対象が会話ファイルのある会話)。実行中のものは
                止めてからアーカイブすることを確認する(handleArchiveToggleCurrentSession)。 */}
            {hasTarget && (runningAlive || (!!projectParam && !!selectedSummary)) && (
              <div className="conversation-archive-bar">
                <button
                  type="button"
                  className="running-bar-button"
                  onClick={handleArchiveToggleCurrentSession}
                >
                  {selectedSummary?.archived ? "戻す" : "アーカイブ"}
                </button>
              </div>
            )}
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
            項目の中身・挙動は従来のまま(`dockItems`)。会話ビュー(chat)では出さない
            (issue #511。権限モードは状態バーに既にあり重複、再読み込みは会話ビューには
            不要と判断)。CLAUDE.md / Rules / Skills など他のビューでは保存・再読み込み等の
            操作がここにしか無いため、従来どおり出す。 */}
        {view !== "chat" && (
          <div className="viewer-footer">
            <ViewerToolbar items={dockItems} />
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

export default SessionsPage;
