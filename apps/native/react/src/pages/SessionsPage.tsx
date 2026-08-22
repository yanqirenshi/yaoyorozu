import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router";
import type { DockItem } from "command-dock";
import {
  getLatestSession,
  getProjectClaudeMd,
  getSettings,
  isAppError,
  listProjects,
  onAppWarning,
  onSessionChanged,
  saveProjectClaudeMd,
  sendMessage,
} from "../api";
import type { AgentModeDto, MessageDto, ProjectDto } from "../api";
import ClaudeMdEditor from "../ClaudeMdEditor";
import { usePageDockItems } from "../DockItemsContext";
import { MODE_ICON, RELOAD_ICON } from "../icons";
import MessageText from "../MessageText";

const PAGE_SIZE = 50;

type PaneView = "chat" | "claude-md";

const DISCARD_CONFIRM_MESSAGE =
  "CLAUDE.mdの編集内容を破棄しますか?保存していない変更は失われます。";

function SessionsPage() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectsRoot, setProjectsRoot] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<AgentModeDto>("chat");
  const [searchParams, setSearchParams] = useSearchParams();
  const view: PaneView = searchParams.get("view") === "claude-md" ? "claude-md" : "chat";
  const [claudeMdDirty, setClaudeMdDirty] = useState(false);

  const loadProjects = useCallback((): Promise<void> => {
    return listProjects()
      .then(setProjects)
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  const loadProjectsRoot = useCallback((): Promise<void> => {
    return getSettings()
      .then((settings) => setProjectsRoot(settings.effective_projects_dir))
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  const loadFirstPage = useCallback((project: string): Promise<void> => {
    setMessages([]);
    setSessionId(null);
    setHasMore(false);
    return getLatestSession(project, 0, PAGE_SIZE)
      .then((session) => {
        setSessionId(session.session_id);
        setMessages(session.messages);
        setHasMore(session.messages.length === PAGE_SIZE);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  const loadMore = useCallback(() => {
    if (!selected || loadingMore) return;
    setLoadingMore(true);
    getLatestSession(selected, messages.length, PAGE_SIZE)
      .then((session) => {
        setSessionId(session.session_id);
        setMessages((prev) => [...prev, ...session.messages]);
        setHasMore(session.messages.length === PAGE_SIZE);
      })
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
      .finally(() => setLoadingMore(false));
  }, [selected, loadingMore, messages.length]);

  const reload = useCallback((): Promise<void> => {
    const tasks = [loadProjects(), loadProjectsRoot()];
    if (selected) tasks.push(loadFirstPage(selected));
    return Promise.all(tasks).then(() => undefined);
  }, [selected, loadProjects, loadProjectsRoot, loadFirstPage]);

  useEffect(() => {
    loadProjects();
    loadProjectsRoot();
  }, [loadProjects, loadProjectsRoot]);

  useEffect(() => {
    if (!selected) return;
    loadFirstPage(selected);
  }, [selected, loadFirstPage]);

  useEffect(() => {
    const unlistenPromise = onSessionChanged(({ project }) => {
      loadProjects();
      if (project === selected) {
        loadFirstPage(project);
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [selected, loadProjects, loadFirstPage]);

  useEffect(() => {
    const unlistenPromise = onAppWarning(({ project }) => {
      if (project !== selected) return;
      setError(
        "メッセージが表示中とは別の会話に追記された可能性があります。再読み込みします。",
      );
      loadFirstPage(project);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [selected, loadFirstPage]);

  const confirmDiscardClaudeMdIfDirty = (): boolean => {
    if (view === "claude-md" && claudeMdDirty) {
      return window.confirm(DISCARD_CONFIRM_MESSAGE);
    }
    return true;
  };

  const handleSelectProject = (name: string) => {
    if (!confirmDiscardClaudeMdIfDirty()) return;
    setSelected(name);
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
    if (!selected || !sessionId || sending || !draft.trim()) return;

    setSending(true);
    setError(null);
    sendMessage(selected, sessionId, draft, mode)
      .then(() => {
        setDraft("");
        loadFirstPage(selected);
      })
      .catch((e) => {
        if (isAppError(e) && e.code === "session_stale") {
          setError("表示中の会話が最新ではありません。再読み込みします。");
          loadFirstPage(selected);
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
        <h2>
          {projectsRoot}
          <br />
          配下のフォルダ一覧
        </h2>
        {projects.map((p) => (
          <button
            key={p.name}
            className={`project-item ${p.name === selected ? "selected" : ""}`}
            onClick={() => handleSelectProject(p.name)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="session-conversation">
        <div className="pane-tabs">
          <button
            type="button"
            className={`pane-tab ${view === "chat" ? "active" : ""}`}
            onClick={() => handleSwitchView("chat")}
          >
            会話
          </button>
          <button
            type="button"
            className={`pane-tab ${view === "claude-md" ? "active" : ""}`}
            onClick={() => handleSwitchView("claude-md")}
          >
            CLAUDE.md
          </button>
        </div>
        {view === "chat" ? (
          <>
            <form className="message-form" onSubmit={handleSubmit}>
              <input
                type="text"
                className="message-input"
                placeholder="AIにメッセージを送る"
                value={draft}
                disabled={!selected || !sessionId || sending}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button
                type="submit"
                className="message-send"
                disabled={!selected || !sessionId || sending || !draft.trim()}
              >
                {sending ? "送信中…" : "送信"}
              </button>
            </form>
            <div className="conversation-scroll">
              {error && <p className="error">{error}</p>}
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
            </div>
          </>
        ) : selected ? (
          <div className="claude-md-pane">
            <ClaudeMdEditor
              load={() => getProjectClaudeMd(selected)}
              save={(content, expectedModifiedAtMs) =>
                saveProjectClaudeMd(selected, content, expectedModifiedAtMs)
              }
              reloadKey={selected}
              onDirtyChange={setClaudeMdDirty}
            />
          </div>
        ) : (
          <p>先にフォルダを選択してください。</p>
        )}
      </div>
    </>
  );
}

export default SessionsPage;
