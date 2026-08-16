import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { DockItem } from "command-dock";
import {
  getLatestSession,
  getSettings,
  isAppError,
  listProjects,
  onAppWarning,
  onSessionChanged,
  sendMessage,
} from "../api";
import type { AgentModeDto, MessageDto, ProjectDto } from "../api";
import { usePageDockItems } from "../DockItemsContext";
import { MODE_ICON, RELOAD_ICON } from "../icons";
import MessageText from "../MessageText";

const PAGE_SIZE = 50;

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
            onClick={() => setSelected(p.name)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="session-conversation">
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
      </div>
    </>
  );
}

export default SessionsPage;
