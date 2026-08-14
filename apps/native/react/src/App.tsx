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
import MessageText from "./MessageText";
import "./App.css";

function App() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setMessages([]);
    getLatestSession(selected)
      .then(setMessages)
      .catch((e) => setError(isAppError(e) ? e.message : String(e)));
  }, [selected]);

  useEffect(() => {
    const unlistenPromise = onSessionChanged(({ project }) => {
      listProjects()
        .then(setProjects)
        .catch((e) => setError(isAppError(e) ? e.message : String(e)));
      if (project === selected) {
        getLatestSession(project)
          .then(setMessages)
          .catch((e) => setError(isAppError(e) ? e.message : String(e)));
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [selected]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || sending || !draft.trim()) return;

    setSending(true);
    setError(null);
    sendMessage(selected, draft)
      .then(() => {
        setDraft("");
        return getLatestSession(selected);
      })
      .then(setMessages)
      .catch((e) => setError(isAppError(e) ? e.message : String(e)))
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
            disabled={!selected || sending}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="submit"
            className="message-send"
            disabled={!selected || sending || !draft.trim()}
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
        </div>
      </div>
    </div>
  );
}

export default App;
