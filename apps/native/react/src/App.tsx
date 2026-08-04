import { useEffect, useState } from "react";
import { getLatestSession, isAppError, listProjects } from "./api";
import type { MessageDto, ProjectDto } from "./api";
import "./App.css";

function App() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [error, setError] = useState<string | null>(null);

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
        <h2>セッションの会話</h2>
        {error && <p className="error">{error}</p>}
        <div className="messages">
          {messages.map((m, i) => (
            <div key={i} className={`message message-${m.role}`}>
              <div className="message-role">
                {m.role === "user" ? "User" : "Claude"}
              </div>
              <div className="message-text">{m.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
