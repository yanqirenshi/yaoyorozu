"use client";

// ビューア(`/profiles/[[...profileId]]`)の本体。`apps/native/react/src/pages/SessionsPage.tsx` から、
// 閲覧と編集(セッション一覧・検索・会話表示・ページ送り・画像・生の行・CLAUDE.md / Rules / Skills /
// settings の閲覧と保存)に必要な部分だけを写した(段階 2 C)。
//
// 実行中セッションとの対話(入力欄・権限応答・中断・起動・停止・状態バー・新規セッション・名前変更・
// アーカイブ操作・利用状況。段階 3 B)は、native と同じ部品(`useRunningSession` など)で足した。
//
// 出していないもの(ボタンごと表示しない): GitHub 連携(かんばん。段階 5)、「仕様」ボタン(#620 の決定)、
// 複数ウィンドウの連携(`useReportWindowState`・`viewer:navigate`。段階 4 で BroadcastChannel で作る)、
// サブエージェントの表示(native でもハブの画面にあるもの。段階 4)。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import type { DockItem } from "command-dock";
import type { ViewMode } from "@yanqirenshi/markdown.sitter";
import {
  archiveSession,
  checkImageAttachment,
  getProjectClaudeMd,
  getProjectSettingsFile,
  getSession,
  getSettings,
  isAppError,
  listSessions,
  onReconnected,
  onSessionChanged,
  onSettingsUpdated,
  renameSession,
  saveProjectClaudeMd,
  saveProjectSettingsFile,
  startRunningSession,
  unarchiveSession,
} from "@/api";
import type {
  MessageDto,
  ProcessStateDto,
  RunningPermissionModeDto,
  RunningSessionSummaryDto,
  SessionSummaryDto,
  StartModelDto,
} from "@/api";
import { readImageFile } from "./attachedImage";
import type { AttachedImage } from "./attachedImage";
import LiveTurnView from "./LiveTurnView";
import NewSessionDialog from "./NewSessionDialog";
import type { NewSessionInput } from "./NewSessionDialog";
import PermissionRequestCard from "./PermissionRequestCard";
import RenameSessionDialog from "./RenameSessionDialog";
import RunningSessionBar from "./RunningSessionBar";
import {
  MAX_SESSION_NAME_CHARS,
  PERMISSION_MODE_LABELS,
  processStateLabel,
  selectableModeOf,
} from "./runningSessionLabels";
import { useClaudeUsage } from "./useClaudeUsage";
import { useRunningSession } from "./useRunningSession";
import { useRunningSessionList } from "./useRunningSessionList";
import { createCoalescedRunner } from "./coalescedRunner";
import ClaudeMdEditor from "./ClaudeMdEditor";
import type { ClaudeMdEditorHandle } from "./ClaudeMdEditor";
import { createClaudeMdDockItems } from "./claudeMdDockItems";
import { MODE_ICON, RELOAD_ICON } from "./icons";
import JsonFileEditor from "./JsonFileEditor";
import type { JsonFileEditorHandle } from "./JsonFileEditor";
import { formatTimestamp } from "./formatTimestamp";
import MessageImagesDialog from "./MessageImagesDialog";
import MessageText from "./MessageText";
import ProfileSettingsPane from "./ProfileSettingsPane";
import RawLineDialog from "./RawLineDialog";
import { SendErrorBody } from "./SendErrorBody";
import ViewerSideMenu from "./ViewerSideMenu";
import ViewerToolbar from "./ViewerToolbar";
import { createProjectSettingsDockItems } from "./projectSettingsDockItems";
import RulesPane from "./RulesPane";
import SkillsPane from "./SkillsPane";
import { PANE_VIEWS } from "./viewerNav";
import type { PaneView, ViewerNav } from "./viewerNav";

const PAGE_SIZE = 50;

// `session:changed` で取り直す最短の間隔(ミリ秒)。
const SESSION_CHANGED_MIN_INTERVAL_MS = 1000;

type SessionGroup = {
  folder: string;
  sessions: SessionSummaryDto[];
};

const DISCARD_CONFIRM_MESSAGE = "編集内容を破棄しますか?保存していない変更は失われます。";

// 左ペインの「選んだセッション」の鍵(issue #348・#353・#369・#379)。「フォルダ|セッション ID」。
// 1 行 = 1 セッション(セッション ID = 会話ファイル)。フォルダ名・セッション ID は英数字と `-` のみで、
// `|` は含まれない。
const SESSION_TAB_SEPARATOR = "|";

function sessionTabKey(folder: string, sessionId: string): string {
  return `${folder}${SESSION_TAB_SEPARATOR}${sessionId}`;
}

// 左の一覧の行の色分け(issue #491)。実行中(起動中・実行中)は金茶、権限待ちは濃い金茶、
// 待機は墨、未起動・実行中セッションなしは無色。
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
  // 画面状態は URL クエリを状態源とする `useUrlViewerNav`(`ViewerPage`)から渡される(native.md §6)。
  nav: ViewerNav;
};

function SessionsPage({ nav }: SessionsPageProps) {
  const windowProfileId = nav.windowProfileId;
  // タブのタイトル(Tauri 版のウィンドウタイトル)に出すプロファイル名。読み込み前は null。
  const [profileName, setProfileName] = useState<string | null>(null);
  // このタブが開いているプロファイルの ID(`/profiles` に id が無いときはアクティブ)。実行中セッションの
  // 起動には、省略に頼らず必ずこの ID を渡す。読み込み前は null。
  const [resolvedProfileId, setResolvedProfileId] = useState<string | null>(null);
  const [targetFolders, setTargetFolders] = useState<string[]>([]);
  const [sessionGroups, setSessionGroups] = useState<SessionGroup[]>([]);
  // 左ペインの検索語(issue #487。インクリメンタル・大文字小文字を区別しない部分一致)。
  const [sessionFilter, setSessionFilter] = useState("");
  // 一覧の区分トグル(issue #506)。区分は 1 セッション 1 つ: archived なら「アーカイブ」(実行中より優先)、
  // そうでなく実行中(会話ファイルの無い新規セッションも含む)なら「起動」、残りが「未起動」。ON = 一覧に表示。
  // UI 状態なので保存しない。既定は 起動 ON・未起動 ON・アーカイブ OFF。検索語とは AND。
  const [showRunningCategory, setShowRunningCategory] = useState(true);
  const [showIdleCategory, setShowIdleCategory] = useState(true);
  const [showArchivedCategory, setShowArchivedCategory] = useState(false);
  // 新規セッションのモーダル(issue #409)。
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  // セッション名を変えるモーダル(issue #524)。
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  // 再開に付ける表示名の、ユーザーが入力欄を編集した値(未編集は null = その会話の現在の表示名を出す)。
  const [resumeNameEdit, setResumeNameEdit] = useState<string | null>(null);
  // 次に起動する(再開する)ときのモデル(null は CLI の既定)。別の会話へ移ったら既定に戻す。
  const [startModel, setStartModel] = useState<StartModelDto | null>(null);
  useEffect(() => {
    setStartModel(null);
    setResumeNameEdit(null);
  }, [nav.session]);
  // このタブで新規に作ったセッションの ID(会話ファイルができたら、URL を `project` 付きの表示へ切り替える)。
  const newlyStartedRef = useRef<Set<string>>(new Set());
  const [messages, setMessages] = useState<MessageDto[]>([]);
  // `refreshSessionInPlace` が最新の読み込み件数を参照するための ref(issue #314)。
  // state をそのまま依存配列に入れると、追記のたびに購読の effect が再登録されてしまうため、
  // ref 経由で読む。
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 接続が切れている間の案内(会話のページ送りなどが失敗する理由を見分けるため)は AppShell が出す。
  // 「データ」ボタンで開いているメッセージの uuid(閉じていれば null。issue #313)。
  const [rawLineUuid, setRawLineUuid] = useState<string | null>(null);
  // 「画像 n 枚」で開いているメッセージの uuid(閉じていれば null。issue #349)。
  const [imagesUuid, setImagesUuid] = useState<string | null>(null);
  // 送信前の添付画像・入力欄の下書き(入力途中の UI 状態。サーバから取り直した値で上書きしない。送信で空に戻す)。
  const [attachments, setAttachments] = useState<AttachedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  // 複数行入力欄(issue #483)の自動リサイズ用。
  const draftInputRef = useRef<HTMLTextAreaElement>(null);
  // 次に起動する実行中セッションの権限モード。
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
  // プロファイルの対象リポジトリ(`repository_path`。issue #269)。CLAUDE.md / Rules / Skills /
  // settings 系ビューはセッションではなくこのリポジトリが対象。
  // `undefined` は設定の読み込み前、`null` は未設定。
  const [repositoryPath, setRepositoryPath] = useState<string | null | undefined>(undefined);
  // つなぎ直したときに右ペイン(プロファイル設定)へ取り直しを促す。
  const [reconnectToken, setReconnectToken] = useState(0);

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
        setProfileName(settings.profiles.find((p) => p.id === profileId)?.name ?? null);
        setRepositoryPath(settings.repository_path);
        setTargetFolders(settings.selected_project_folders);
        return loadSessionGroups(settings.selected_project_folders);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, [loadSessionGroups, windowProfileId]);

  // 切替(セッション識別子が変わる)・整合性が疑わしいとき用: 一旦クリアしてから 1 ページ目を
  // 取り直す(issue #314。従来はこの関数 1 つを全経路で使っていたため、同一セッションへの追記の
  // たびに全消し→再構築になりチラついていた)。
  const loadSession = useCallback((project: string, id: string): Promise<void> => {
    setMessages([]);
    setHasMore(false);
    return getSession(project, id, 0, PAGE_SIZE)
      .then((session) => {
        setMessages(session.messages);
        setHasMore(session.messages.length === PAGE_SIZE);
        setError(null);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  // 同一セッションへの追記の反映(issue #314)。クリアせず、今読み込んでいる件数をそのまま
  // `limit` にして offset 0 から取り直し、`setMessages` を 1 回だけ呼ぶ(新着はその中に自然に
  // 含まれる)。`key={m.uuid}`(下記)と組み合わせて、既存の吹き出しの DOM は保持され、変化の無い
  // メッセージは MessageText 内の useMemo によって Markdown の再パースも起きない。
  const refreshSessionInPlace = useCallback((project: string, id: string): Promise<void> => {
    const limit = Math.max(messagesRef.current.length, PAGE_SIZE);
    return getSession(project, id, 0, limit)
      .then((session) => {
        setMessages(session.messages);
        setHasMore(session.messages.length === limit);
        setError(null);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  // app が起動したまま持つ claude CLI との対話。状態はイベント → Query で取り直す(楽観更新しない)。
  // 途中経過(返答中の表示)は、確定した行が一覧に現れたら消える。`busy` は起動〜送信の書き込みが終わるまで。
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
    const tasks = [loadTargetFoldersAndSessions()];
    if (projectParam && sessionParam) {
      tasks.push(loadSession(projectParam, sessionParam));
    }
    return Promise.all(tasks).then(() => undefined);
  }, [projectParam, sessionParam, loadTargetFoldersAndSessions, loadSession]);

  useEffect(() => {
    void loadTargetFoldersAndSessions();
  }, [loadTargetFoldersAndSessions]);

  useEffect(() => {
    if (!projectParam || !sessionParam) {
      setMessages([]);
      setHasMore(false);
      return;
    }
    void loadSession(projectParam, sessionParam);
  }, [projectParam, sessionParam, loadSession]);

  // 会話ファイルが増えた・変わったとき(`session:changed`)。一覧と、表示中の会話を取り直す。
  // 画面を離れたとき・unmount のときに必ず購読を外す。
  useEffect(() => {
    // 書き込みが続く会話では、通知が 0.1 秒ごとに来る。取り直し中に来た通知はまとめて 1 回にし、
    // 取り直しの開始は最短 1 秒あける(`coalescedRunner.ts`)。
    const runner = createCoalescedRunner<string>(async (projects) => {
      const jobs: Promise<unknown>[] = [];
      if ([...projects].some((p) => targetFolders.includes(p))) {
        jobs.push(loadSessionGroups(targetFolders));
      }
      if (projectParam && sessionParam && projects.has(projectParam)) {
        jobs.push(refreshSessionInPlace(projectParam, sessionParam));
      }
      await Promise.all(jobs);
    }, SESSION_CHANGED_MIN_INTERVAL_MS);
    const unlistenPromise = onSessionChanged(({ project }) => runner.trigger(project));
    return () => {
      runner.cancel();
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [targetFolders, projectParam, sessionParam, loadSessionGroups, refreshSessionInPlace]);

  // 設定の変更(設定画面でのプロファイル切り替え等)で対象フォルダが変わったことの通知。表示中の
  // フォルダが新しいプロファイルの対象から外れた場合は選択を解除する(issue #72)。
  useEffect(() => {
    const unlistenPromise = onSettingsUpdated(() => {
      getSettings(windowProfileId)
        .then((settings) => {
          const profileId = windowProfileId ?? settings.active_profile_id;
          setResolvedProfileId(profileId);
          setProfileName(settings.profiles.find((p) => p.id === profileId)?.name ?? null);
          setRepositoryPath(settings.repository_path);
          setTargetFolders(settings.selected_project_folders);
          if (projectParam && !settings.selected_project_folders.includes(projectParam)) {
            nav.clearProjectAndSession();
          }
          return loadSessionGroups(settings.selected_project_folders);
        })
        .catch((e) => setError(isAppError(e) ? e.message : String(e)));
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectParam, loadSessionGroups, nav.clearProjectAndSession, windowProfileId]);

  // つなぎ直せたとき: 切れている間の `session:changed` は失われているので、一覧と表示中の会話を
  // 取り直す(段階 1 の README の手本)。会話は読み込み済みの件数のまま差し替える(チラつかない)。
  // CLAUDE.md などの編集中の内容は、各エディタが持つので失われない。
  useEffect(() => {
    const unlistenPromise = onReconnected(() => {
      void loadTargetFoldersAndSessions();
      if (projectParam && sessionParam) {
        void refreshSessionInPlace(projectParam, sessionParam);
      }
      setReconnectToken((n) => n + 1);
      // 表示中の編集画面(CLAUDE.md・設定ファイル)も取り直す。未保存の入力があるものは上書きせず、
      // エディタが「ほかで変更されました」と「取り直す」ボタンを出す(開いていないものは null)。
      void claudeMdEditorRef.current?.refresh();
      void settingsJsonEditorRef.current?.refresh();
      void settingsLocalJsonEditorRef.current?.refresh();
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [loadTargetFoldersAndSessions, refreshSessionInPlace, projectParam, sessionParam]);


  // タブのタイトルは、プロファイル名だけにする(Tauri 版の viewerWindowTitle。issue #348・#377)。
  useEffect(() => {
    document.title = profileName ?? "YAOYOROZU";
  }, [profileName]);

  // 一覧の全セッション(新しい順。フォルダをまたぐ)。
  const allSessions = sessionGroups
    .flatMap((group) => group.sessions.map((session) => ({ folder: group.folder, session })))
    .sort((a, b) => b.session.modified_at - a.session.modified_at);

  // 会話ファイルがまだ無い新規のセッション(issue #409)。app が起動して持っているセッションのうち、
  // 一覧(会話ファイルから作る)に無いもの。左の一覧に並べ、選ぶと空の会話として開く
  // (URL は `session` だけで `project` を持たない)。会話ファイルができたら通常の行になる。
  const runningList = useRunningSessionList();
  // Claude.ai の利用状況(アカウント単位の値。状態バーに出す)。
  const claudeUsage = useClaudeUsage();
  const claudeCliAlive = runningList.some((s) => s.process_state !== "exited");
  const knownSessionIds = new Set(allSessions.map(({ session }) => session.id));
  // 一覧に出す側だけ、このプロファイルのリポジトリのセッションに絞る(issue #618)。実行中セッションの
  // 一覧は他プロファイルのものも含むので、絞らないと混ざる。`repository_path` が空・一致しないものは出さない。
  const pendingSummaries = runningList.filter(
    (s) =>
      s.process_state !== "exited" &&
      !knownSessionIds.has(s.session_id) &&
      !!repositoryPath &&
      s.repository_path === repositoryPath,
  );
  // session_id → 実行中セッション。一覧の行の色分け・区分に使う。終了したものは載せない(未起動と同じ扱い)。
  const runningBySessionId = useMemo(() => {
    const map = new Map<string, RunningSessionSummaryDto>();
    runningList.forEach((summary) => {
      if (summary.process_state !== "exited") map.set(summary.session_id, summary);
    });
    return map;
  }, [runningList]);

  // 左ペインの縦一覧(issue #487)。全セッションを常に表示し、検索語で絞り込むだけにする。
  // 対象: タイトル。対象フォルダが複数のときはフォルダ名も対象に含める。区分トグルで OFF の区分は除く。
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
  // 会話ファイルの無い新規セッションも「起動」の区分として扱う。
  const visiblePendingSummaries = showRunningCategory ? pendingSummaries : [];
  const selectedSummary = sessionGroups
    .find((g) => g.folder === projectParam)
    ?.sessions.find((s) => s.id === sessionParam);
  const selectedTabValue =
    projectParam && selectedSummary ? sessionTabKey(projectParam, selectedSummary.id) : "";
  // 表示中の会話の実行中セッションが動いているか(実行中セッションは会話ごとに複数持てる)。
  const runningAlive = running !== null && running.process_state !== "exited";

  const pendingSelected =
    !projectParam && sessionParam
      ? (pendingSummaries.find((s) => s.session_id === sessionParam) ?? null)
      : null;
  // 表示中の対象がある(会話ファイルのある会話、または新規のセッション)。
  const hasTarget = !!sessionParam && (!!projectParam || !!pendingSelected);
  // 選択を外した(hasTarget が false になった)ら、書きかけの下書き・添付を空にする(issue #515)。
  // 対象を切り替えただけ(選択が無い状態を経由しない)のときは保持する。
  useEffect(() => {
    if (!hasTarget) {
      setDraft("");
      setAttachments([]);
    }
  }, [hasTarget]);
  // 一覧に出るセッションはすべて送信対象にできる。新規のセッション(会話ファイルがまだ無い)も、実行中なら送れる。
  const canSend = !!selectedSummary || !!pendingSelected;
  // 再開の表示名の入力欄の値(編集していなければ、その会話の現在の表示名)。上限を超える表示名は
  // 切り詰めるとタイトルが変わるので初期値にしない。
  const currentTitleAsName = selectedSummary?.custom_title ?? "";
  const resumeName =
    resumeNameEdit ??
    ([...currentTitleAsName].length <= MAX_SESSION_NAME_CHARS ? currentTitleAsName : "");

  // 権限モードの選択: 起動中なら実行中のセッションを切り替え、未起動なら次の起動の値。
  const selectMode = (value: RunningPermissionModeDto) => {
    setMode(value);
    if (runningAlive) void switchRunning({ kind: "permission_mode", mode: value });
  };
  const selectModel = (model: string) => void switchRunning({ kind: "model", model });

  // 未起動のとき、メッセージ無しで起動だけする(issue #484)。送信時の自動起動と同じ `ensureStarted` を使う。
  const handleStartRunning = () => {
    if (!projectParam || !sessionParam || !resolvedProfileId) return;
    void startRunning({
      profileId: resolvedProfileId,
      project: projectParam,
      sessionId: sessionParam,
      mode,
      name: resumeName,
      model: startModel,
    });
  };

  // アーカイブする(issue #495)。実行中のものは、止めてからアーカイブすることを確認する。表示中の会話を
  // アーカイブしたら、選択を外して 0 件の案内へ戻す。一覧への反映は `session:changed`(既存の購読)。
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

  // 会話ペイン左下の「アーカイブ」/「戻す」から呼ぶ(表示中の会話が対象)。
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

  // 状態バーの「セッション名」ボタンのモーダルでの確定(issue #524)。表示は `session:changed` で反映される。
  const handleRenameSession = async (title: string) => {
    if (!projectParam || !sessionParam) return;
    try {
      await renameSession(projectParam, sessionParam, title);
      setRenameDialogOpen(false);
    } catch (e) {
      setError(isAppError(e) ? e.message : String(e));
    }
  };

  // 会話ファイルができた新規セッションの表示中(URL が `session` だけ)を、通常の会話の表示(`project` 付き)へ移す。
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

  // 受け取った画像ファイル(貼り付け・ファイル選択)を 1 枚ずつサーバで事前検証し、通ったものだけを
  // サムネイルにする(形式・サイズ・枚数の規則はサーバの domain が唯一の判定元。issue #349)。
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

  // 複数行入力欄(issue #483)。行数に応じて高さを伸ばし、空になったら 1 行に戻す。
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

  // 送信。app が起動したままの claude 経由で送る: 未起動なら起動して、待機になってから送る。
  // 外部(ターミナル・Desktop)で同じ会話が実行中なら、サーバが止める(エラー表示)。
  // フォームの送信と、入力欄での Enter(issue #483)の両方から呼ぶ。
  const submitMessage = async () => {
    if (!hasTarget || !sessionParam || !canSend || sending || !canSubmit || !resolvedProfileId) {
      return;
    }
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

  // Enter で送信、Shift+Enter で改行(issue #483)。IME の変換確定の Enter では送信しない。
  const handleDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void submitMessage();
  };

  // 新規セッションを作る(issue #409)。app が新しい会話を起動し、できたら自動で開く(会話ファイルができる
  // までは空の会話)。失敗(同時数の上限など)はバナーで理由を出す。
  const handleCreateNewSession = async (input: NewSessionInput) => {
    setNewDialogOpen(false);
    setError(null);
    if (!resolvedProfileId) return;
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

  // ビューアでは dock を表示しない(issue #257)ため、これらの操作は dock ではなくページ内の
  // `ViewerToolbar` に出す(内容・挙動は dock 時代のまま)。
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
        // 未起動なら次の起動から、起動中ならいまの実行中セッションを切り替える(結果は CLI が受け入れたあと、
        // 状態の取り直しで表示に反映される)。
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
  }, [reload, mode, view, claudeMdMode, claudeMdDirty, settingsJsonDirty, settingsLocalJsonDirty]);

  // CLAUDE.md / Rules / Skills / settings 系ビューの、リポジトリ未設定時の案内(issue #269)。
  // 読み込み前(`undefined`)は何も出さない。
  const repositoryGuide =
    repositoryPath === null ? (
      <p>リポジトリが設定されていません。設定画面で対象リポジトリを指定してください。</p>
    ) : null;

  return (
    <div className="viewer-page">
      {newDialogOpen && (
        <NewSessionDialog
          initialMode={mode}
          onCreate={handleCreateNewSession}
          onClose={() => setNewDialogOpen(false)}
        />
      )}
      {renameDialogOpen && selectedSummary && (
        <RenameSessionDialog
          initialTitle={selectedSummary.title}
          onRename={(title) => void handleRenameSession(title)}
          onClose={() => setRenameDialogOpen(false)}
        />
      )}
      <div className="viewer-body">
        {/* ビュー切り替えは上部のタブではなく、画面の最左端のサイドメニュー(issue #263)。 */}
        <ViewerSideMenu active={view} onChange={handleSwitchView} />
        {/* セッション一覧ペインは「会話」ビューのときだけ表示する(issue #279)。選択中のセッション・
            会話の表示は、このコンポーネントの状態と URL(`project`/`session`)に持っており、一覧を
            出し入れしても破棄されない。 */}
        {view === "chat" && (
          <div className="project-list">
            {/* 上部(検索・区分トグル)は固定し、行の一覧だけをスクロールさせる(issue #531)。 */}
            <div className="project-list-top">
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
                  disabled={!resolvedProfileId || !repositoryPath}
                  onClick={() => setNewDialogOpen(true)}
                >
                  +
                </button>
              </div>
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
            </div>
            <div className="project-list-rows">
              {/* 会話ファイルがまだ無い新規のセッション(実行中のもの。「起動」の区分)。会話ファイルができたら通常の行になる。 */}
              {visiblePendingSummaries.map((summary) => {
                const title = summary.name ?? "新規セッション";
                const rowTitle = `${title} / ${processStateLabel(summary.process_state)}`;
                return (
                  <div key={summary.session_id} className="session-list-row">
                    <button
                      type="button"
                      className={`project-item session-list-item ${
                        pendingSelected?.session_id === summary.session_id ? "selected" : ""
                      }`}
                      title={rowTitle}
                      onClick={() => {
                        if (confirmDiscardIfDirty()) nav.setProjectAndSession(null, summary.session_id);
                      }}
                    >
                      <span className="session-item-title">{title}</span>
                    </button>
                  </div>
                );
              })}
              {visibleSessions.map(({ key, folder, session }) => {
                const sessionRunning = runningBySessionId.get(session.id) ?? null;
                // 更新日時・状態は、行ではなくホバーの title に残す(issue #519)。
                const statusLabel = session.archived
                  ? "アーカイブ"
                  : sessionRunning
                    ? processStateLabel(sessionRunning.process_state)
                    : "未起動";
                const rowTitle = `${session.title} / ${new Date(session.modified_at).toLocaleString()} / ${statusLabel}`;
                return (
                  <div key={key} className="session-list-row">
                    <button
                      type="button"
                      className={`project-item session-list-item ${sessionRowStateClass(
                        sessionRunning?.process_state ?? null,
                      )} ${key === selectedTabValue ? "selected" : ""}`}
                      title={rowTitle}
                      onClick={() => handleSelectSession(folder, session.id)}
                    >
                      <span className="session-item-title">{session.title}</span>
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
                sessionTitle={selectedSummary?.title ?? ""}
                onRenameSession={() => setRenameDialogOpen(true)}
                claudeUsage={claudeUsage}
                claudeCliAlive={claudeCliAlive}
              />
            )}
            {/* メッセージ入力欄・添付サムネイルは、選んでいる対象があるときだけ描く(issue #515)。
                下書き・添付はこのコンポーネントの状態なので、サーバから取り直しても上書きされない。 */}
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
                    disabled={!canSend || sending || !canSubmit || !resolvedProfileId}
                  >
                    {sending ? "送信中…" : "送信"}
                  </button>
                </form>
                {attachments.length > 0 && (
                  <div className="message-attachments">
                    {attachments.map((image, i) => (
                      <div key={image.id} className="message-attachment">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
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
                    {(runningAlive || sending) && <LiveTurnView live={live} messages={messages} />}
                    {messages.map((m, i) => {
                      // uuid をキーにして、追記のたびの DOM の作り直しを避ける(issue #314)。
                      // 行に uuid が無ければ従来どおり位置キー。
                      const key = m.uuid ?? `i-${i}`;
                      // 吹き出しの横に、種類(role)と日時を小さく淡く出す(issue #258)。
                      // timestamp が空・不正なら日時は出さない。
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
            {/* アーカイブ/戻す(issue #495・#510・#511)。会話の表示・入力欄と重ならない、会話ペインの左下。
                実行中のものは、止めてからアーカイブすることを確認する。 */}
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
            // /settings と同じプロファイル設定(共有コンポーネント)を、このタブのプロファイルに
            // 固定して表示する(issue #299)。
            <ProfileSettingsPane profileId={nav.windowProfileId} refreshToken={reconnectToken} />
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
                  key="settings"
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
                key="settings_local"
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
          {/* コンテンツ領域の下端のフッター(ユーザー指示)。表示の切り替え・再読み込み・保存などの操作を
              ここにまとめる。会話ビュー(chat)では出さない(issue #511)。 */}
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
