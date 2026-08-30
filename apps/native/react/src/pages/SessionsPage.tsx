import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DockItem } from "command-dock";
import {
  getGithubAuthStatus,
  getProjectClaudeMd,
  getSession,
  getSettings,
  isAppError,
  listGithubProjectItems,
  listSessions,
  onAppWarning,
  onSessionChanged,
  saveProjectClaudeMd,
  sendMessage,
} from "../api";
import type { AgentModeDto, MessageDto, ProjectItemDto, SessionSummaryDto } from "../api";
import ClaudeMdEditor from "../ClaudeMdEditor";
import { usePageDockItems } from "../DockItemsContext";
import { MODE_ICON, RELOAD_ICON } from "../icons";
import MessageText from "../MessageText";
import PaneTabs from "../PaneTabs";

const PAGE_SIZE = 50;

type PaneView = "chat" | "claude-md" | "github-project";

type SessionGroup = {
  folder: string;
  sessions: SessionSummaryDto[];
};

type ProjectItemGroup = {
  status: string;
  items: ProjectItemDto[];
};

const PROJECT_ITEM_KIND_LABEL: Record<ProjectItemDto["kind"], string> = {
  issue: "Issue",
  "pull-request": "PR",
  "draft-issue": "Draft",
};

const UNSET_STATUS_LABEL = "(未設定)";

const DISCARD_CONFIRM_MESSAGE =
  "CLAUDE.mdの編集内容を破棄しますか?保存していない変更は失われます。";

// フォルダ名(例: "C--Users-yanqi-prj-yaoyorozu")は末尾の要素が実際の
// リポジトリ名に対応することが多いため、末尾要素を目立たせて表示する。
function splitFolderNameForDisplay(name: string): { prefix: string; tail: string } {
  const idx = name.lastIndexOf("-");
  if (idx === -1) return { prefix: "", tail: name };
  return { prefix: name.slice(0, idx + 1), tail: name.slice(idx + 1) };
}

function SessionsPage() {
  const [targetFolders, setTargetFolders] = useState<string[]>([]);
  const [sessionGroups, setSessionGroups] = useState<SessionGroup[]>([]);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<AgentModeDto>("chat");
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get("view");
  const view: PaneView =
    viewParam === "claude-md" || viewParam === "github-project" ? viewParam : "chat";
  const projectParam = searchParams.get("project");
  const sessionParam = searchParams.get("session");
  const [claudeMdDirty, setClaudeMdDirty] = useState(false);
  const [githubAuthenticated, setGithubAuthenticated] = useState(false);
  const [githubProject, setGithubProject] = useState<{ owner: string; number: number } | null>(
    null,
  );
  const [projectItems, setProjectItems] = useState<ProjectItemDto[]>([]);
  const [projectItemsNextCursor, setProjectItemsNextCursor] = useState<string | null>(null);
  const [projectStatusOrder, setProjectStatusOrder] = useState<string[]>([]);
  const [projectItemsLoaded, setProjectItemsLoaded] = useState(false);
  const [projectItemsLoadingMore, setProjectItemsLoadingMore] = useState(false);
  const [projectItemsError, setProjectItemsError] = useState<string | null>(null);

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
    return getSettings()
      .then((settings) => {
        setTargetFolders(settings.selected_project_folders);
        setGithubProject(settings.github_project);
        return loadSessionGroups(settings.selected_project_folders);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, [loadSessionGroups]);

  const loadGithubAuthStatus = useCallback((): Promise<void> => {
    return getGithubAuthStatus()
      .then((status) => setGithubAuthenticated(status.authenticated))
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  const loadProjectItems = useCallback((cursor: string | null): Promise<void> => {
    setProjectItemsError(null);
    return listGithubProjectItems(cursor)
      .then((page) => {
        setProjectItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
        setProjectItemsNextCursor(page.next_cursor);
        setProjectStatusOrder(page.status_order);
        setProjectItemsLoaded(true);
      })
      .catch((e) => setProjectItemsError(isAppError(e) ? e.message : String(e)));
  }, []);

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
        loadSession(project, sessionParam);
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [targetFolders, projectParam, sessionParam, loadSessionGroups, loadSession]);

  useEffect(() => {
    const unlistenPromise = onAppWarning(({ project }) => {
      if (project !== projectParam || !sessionParam) return;
      setError(
        "メッセージが表示中とは別の会話に追記された可能性があります。再読み込みします。",
      );
      loadSession(project, sessionParam);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [projectParam, sessionParam, loadSession]);

  const handleLoadMoreProjectItems = () => {
    if (!projectItemsNextCursor || projectItemsLoadingMore) return;
    setProjectItemsLoadingMore(true);
    loadProjectItems(projectItemsNextCursor).finally(() => setProjectItemsLoadingMore(false));
  };

  const groupedProjectItems: ProjectItemGroup[] = useMemo(() => {
    const byStatus = new Map<string, ProjectItemDto[]>();
    for (const item of projectItems) {
      const key = item.status ?? "";
      const group = byStatus.get(key);
      if (group) {
        group.push(item);
      } else {
        byStatus.set(key, [item]);
      }
    }
    const orderedKeys = [...projectStatusOrder, ""];
    return orderedKeys
      .filter((key) => byStatus.has(key))
      .map((key) => ({ status: key || UNSET_STATUS_LABEL, items: byStatus.get(key) ?? [] }));
  }, [projectItems, projectStatusOrder]);

  const selectedSummary = sessionGroups
    .find((g) => g.folder === projectParam)
    ?.sessions.find((s) => s.id === sessionParam);
  const canSend = selectedSummary?.is_latest ?? false;

  const confirmDiscardClaudeMdIfDirty = (): boolean => {
    if (view === "claude-md" && claudeMdDirty) {
      return window.confirm(DISCARD_CONFIRM_MESSAGE);
    }
    return true;
  };

  const handleSelectSession = (project: string, id: string) => {
    if (!confirmDiscardClaudeMdIfDirty()) return;
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("project", project);
      params.set("session", id);
      return params;
    });
  };

  const handleSwitchView = (next: PaneView) => {
    if (next === view) return;
    if (!confirmDiscardClaudeMdIfDirty()) return;
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === "chat") {
        params.delete("view");
      } else {
        params.set("view", next);
      }
      return params;
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!projectParam || !sessionParam || !canSend || sending || !draft.trim()) return;

    setSending(true);
    setError(null);
    sendMessage(projectParam, sessionParam, draft, mode)
      .then(() => {
        setDraft("");
        loadSession(projectParam, sessionParam);
      })
      .catch((e) => {
        if (isAppError(e) && e.code === "session_stale") {
          setError("表示中の会話が最新ではありません。再読み込みします。");
          loadSession(projectParam, sessionParam);
          return;
        }
        setError(isAppError(e) ? e.message : String(e));
      })
      .finally(() => setSending(false));
  };

  const dockItems = useMemo<DockItem[]>(
    () => [
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
    ],
    [reload, mode],
  );
  usePageDockItems(dockItems);

  return (
    <>
      <div className="project-list">
        {targetFolders.length === 0 ? (
          <p>設定のClaudeタブで対象フォルダを選択してください。</p>
        ) : (
          sessionGroups.map((group) => {
            const { prefix, tail } = splitFolderNameForDisplay(group.folder);
            return (
              <div key={group.folder} className="session-group">
                <h3 className="session-group-heading" title={group.folder}>
                  <span className="session-group-heading-prefix">{prefix}</span>
                  <strong>{tail}</strong>
                </h3>
                {group.sessions.length === 0 && (
                  <p className="session-group-empty">セッションがありません。</p>
                )}
                {group.sessions.map((s) => (
                  <button
                    key={s.id}
                    className={`project-item ${
                      group.folder === projectParam && s.id === sessionParam
                        ? "selected"
                        : ""
                    }`}
                    onClick={() => handleSelectSession(group.folder, s.id)}
                  >
                    <span className="session-item-title">{s.title}</span>
                    <span className="session-item-updated">
                      {new Date(s.modified_at).toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            );
          })
        )}
      </div>
      <div className="session-conversation">
        <PaneTabs
          tabs={[
            { id: "chat", label: "会話" },
            { id: "claude-md", label: "CLAUDE.md" },
            { id: "github-project", label: "GitHub Project" },
          ]}
          active={view}
          onChange={(id) => handleSwitchView(id as PaneView)}
        />
        {view === "chat" ? (
          <>
            <form className="message-form" onSubmit={handleSubmit}>
              <input
                type="text"
                className="message-input"
                placeholder="AIにメッセージを送る"
                value={draft}
                disabled={!projectParam || !sessionParam || !canSend || sending}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button
                type="submit"
                className="message-send"
                disabled={
                  !projectParam || !sessionParam || !canSend || sending || !draft.trim()
                }
              >
                {sending ? "送信中…" : "送信"}
              </button>
            </form>
            {projectParam && sessionParam && !canSend && (
              <p className="message-form-notice">
                送信できるのは最新のセッションのみです。
              </p>
            )}
            <div className="conversation-scroll">
              {error && <p className="error">{error}</p>}
              {!projectParam || !sessionParam ? (
                <p>左の一覧からセッションを選択してください。</p>
              ) : (
                <>
                  <div className="messages">
                    {messages.map((m, i) => (
                      <div key={i} className={`message message-${m.role}`}>
                        <MessageText text={m.text} />
                      </div>
                    ))}
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
        ) : view === "claude-md" ? (
          projectParam ? (
            <div className="claude-md-pane">
              <ClaudeMdEditor
                load={() => getProjectClaudeMd(projectParam)}
                save={(content, expectedModifiedAtMs) =>
                  saveProjectClaudeMd(projectParam, content, expectedModifiedAtMs)
                }
                reloadKey={projectParam}
                onDirtyChange={setClaudeMdDirty}
              />
            </div>
          ) : (
            <p>先にセッションを選択してください。</p>
          )
        ) : (
          <div className="github-project-pane">
            {!githubAuthenticated ? (
              <p>設定のGitHubタブでログインしてください。</p>
            ) : !githubProject ? (
              <p>設定のGitHubタブでプロジェクトを選択してください。</p>
            ) : (
              <>
                {projectItemsError && <p className="error">{projectItemsError}</p>}
                {groupedProjectItems.map((group) => (
                  <div key={group.status} className="project-item-group">
                    <h3 className="project-item-group-heading">{group.status}</h3>
                    {group.items.map((item, i) => (
                      <button
                        key={`${item.kind}-${item.repository ?? ""}-${item.number ?? item.title}-${i}`}
                        type="button"
                        className="project-item-card"
                        disabled={!item.url}
                        onClick={() => item.url && openUrl(item.url)}
                      >
                        <span className="project-item-title">{item.title}</span>
                        <span className="project-item-meta">
                          {PROJECT_ITEM_KIND_LABEL[item.kind]}
                          {item.repository && item.number
                            ? ` ${item.repository}#${item.number}`
                            : ""}
                          {item.assignees.length > 0 ? ` · ${item.assignees.join(", ")}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
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
        )}
      </div>
    </>
  );
}

export default SessionsPage;
