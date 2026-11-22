"use client";

// ビューア(`/profiles/[[...profileId]]`)の本体。`apps/native/react/src/pages/SessionsPage.tsx` から、
// 閲覧と編集(セッション一覧・検索・会話表示・ページ送り・画像・生の行・CLAUDE.md / Rules / Skills /
// settings の閲覧と保存)に必要な部分だけを写した(段階 2 C)。
//
// 出していないもの(ボタンごと表示しない): 実行中セッションとの対話(入力欄・権限応答・中断・起動・
// 状態バー・サブエージェント表示・新規セッション・名前変更・アーカイブ操作。段階 3)、利用状況、
// GitHub 連携(かんばん。段階 5)、「仕様」ボタン(#620 の決定)、複数ウィンドウの連携
// (`useReportWindowState`・`viewer:navigate`。段階 4 で BroadcastChannel で作る)。
// アーカイブ済みの印(`archived`)は、表示だけする。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DockItem } from "command-dock";
import type { ViewMode } from "@yanqirenshi/markdown.sitter";
import {
  getProjectClaudeMd,
  getProjectSettingsFile,
  getSession,
  getSettings,
  isAppError,
  listSessions,
  onReconnected,
  onSessionChanged,
  onSettingsUpdated,
  saveProjectClaudeMd,
  saveProjectSettingsFile,
} from "@/api";
import type { MessageDto, SessionSummaryDto } from "@/api";
import { createCoalescedRunner } from "./coalescedRunner";
import ClaudeMdEditor from "./ClaudeMdEditor";
import type { ClaudeMdEditorHandle } from "./ClaudeMdEditor";
import { createClaudeMdDockItems } from "./claudeMdDockItems";
import { RELOAD_ICON } from "./icons";
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
  const [targetFolders, setTargetFolders] = useState<string[]>([]);
  const [sessionGroups, setSessionGroups] = useState<SessionGroup[]>([]);
  // 左ペインの検索語(issue #487。インクリメンタル・大文字小文字を区別しない部分一致)。
  const [sessionFilter, setSessionFilter] = useState("");
  // アーカイブ済みを一覧に出すか(UI 状態なので保存しない。既定は出さない)。実行中の区分(起動・未起動)は
  // 実行中セッションを持つ段階 3 で足す。
  const [showArchivedCategory, setShowArchivedCategory] = useState(false);
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
        setProfileName(
          settings.profiles.find((p) => p.id === (windowProfileId ?? settings.active_profile_id))
            ?.name ?? null,
        );
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
          setProfileName(
            settings.profiles.find((p) => p.id === (windowProfileId ?? settings.active_profile_id))
              ?.name ?? null,
          );
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

  // 左ペインの縦一覧(issue #487)。全セッションを常に表示し、検索語で絞り込むだけにする。
  // 対象: タイトル。対象フォルダが複数のときはフォルダ名も対象に含める。アーカイブ済みは
  // 「アーカイブ」を ON にしたときだけ出す(検索語とは AND)。
  const normalizedSessionFilter = sessionFilter.trim().toLowerCase();
  const categoryFilteredSessions = allSessions.filter(
    ({ session }) => showArchivedCategory || !session.archived,
  );
  const visibleSessions = (
    normalizedSessionFilter
      ? categoryFilteredSessions.filter(
          ({ folder, session }) =>
            session.title.toLowerCase().includes(normalizedSessionFilter) ||
            (targetFolders.length > 1 && folder.toLowerCase().includes(normalizedSessionFilter)),
        )
      : categoryFilteredSessions
  ).map(({ folder, session }) => ({ key: sessionTabKey(folder, session.id), folder, session }));
  const selectedSummary = sessionGroups
    .find((g) => g.folder === projectParam)
    ?.sessions.find((s) => s.id === sessionParam);
  const selectedTabValue =
    projectParam && selectedSummary ? sessionTabKey(projectParam, selectedSummary.id) : "";

  // 表示中の対象がある(会話ファイルのある会話)。
  const hasTarget = !!sessionParam && !!projectParam;

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

  // ビューアでは dock を表示しない(issue #257)ため、これらの操作は dock ではなくページ内の
  // `ViewerToolbar` に出す(内容・挙動は dock 時代のまま)。権限モードの切り替えは実行中セッションの
  // 操作なので、段階 3 で足す。
  const dockItems = useMemo<DockItem[]>(() => {
    const items: DockItem[] = [
      {
        id: "reload",
        label: RELOAD_ICON,
        title: "再読み込み",
        onClick: reload,
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
  }, [reload, view, claudeMdMode, claudeMdDirty, settingsJsonDirty, settingsLocalJsonDirty]);

  // CLAUDE.md / Rules / Skills / settings 系ビューの、リポジトリ未設定時の案内(issue #269)。
  // 読み込み前(`undefined`)は何も出さない。
  const repositoryGuide =
    repositoryPath === null ? (
      <p>リポジトリが設定されていません。設定画面で対象リポジトリを指定してください。</p>
    ) : null;

  return (
    <div className="viewer-page">
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
              </div>
              <div className="session-list-category-toggle" role="group" aria-label="表示する区分">
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
              {visibleSessions.map(({ key, folder, session }) => {
                // 更新日時・状態は、行ではなくホバーの title に残す(issue #519)。
                const rowTitle = `${session.title} / ${new Date(session.modified_at).toLocaleString()}${
                  session.archived ? " / アーカイブ" : ""
                }`;
                return (
                  <div key={key} className="session-list-row">
                    <button
                      type="button"
                      className={`project-item session-list-item ${
                        key === selectedTabValue ? "selected" : ""
                      }`}
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
            <div className="conversation-scroll">
              {error && <p className="error">{error}</p>}
              {!hasTarget ? (
                <p>
                  {targetFolders.length === 0
                    ? "設定のClaudeタブで対象フォルダを選択してください。"
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
                  <div className="messages">
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
