import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  getLatestSession,
  isAppError,
  listProjects,
  onSessionChanged,
  sendMessage,
} from "./api";
import type { MessageDto, ProjectDto } from "./api";
import AppDock from "./AppDock";
import MessageText from "./MessageText";
import "./App.css";

const PAGE_SIZE = 50;

function App() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const loadProjects = (): Promise<void> => {
    return listProjects()
      .then(setProjects)
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  };

  const loadFirstPage = (project: string): Promise<void> => {
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
  };

  const loadMore = () => {
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
  };

  const reload = (): Promise<void> => {
    const tasks = [loadProjects()];
    if (selected) tasks.push(loadFirstPage(selected));
    return Promise.all(tasks).then(() => undefined);
  };

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (!selected) return;
    loadFirstPage(selected);
  }, [selected]);

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
  }, [selected]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !sessionId || sending || !draft.trim()) return;

    setSending(true);
    setError(null);
    sendMessage(selected, sessionId, draft)
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

  return (
    <div className="app-shell">
      <div className="project-list">
        <h2>
          c:/Users/yanqi/.claude/projects/
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
      <AppDock onReload={reload} />
    </div>
  );
}

export default App;
