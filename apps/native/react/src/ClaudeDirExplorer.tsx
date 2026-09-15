import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { isAppError, listClaudeDir } from "./api";
import type { ClaudeDirEntryDto } from "./api";

// 1回の一覧取得で受け取る件数。`~/.claude/projects/` 配下などは件数が
// 多くなりうるため、全件を一度に取らず「さらに表示」で続きを取る
// (native.md §3.1 NEVER: 1回の invoke で全件を返す設計)。
const PAGE_SIZE = 200;

// ルート(`~/.claude` 自身)を表す相対パス。
const ROOT_PATH = "";

type DirState = {
  entries: ClaudeDirEntryDto[];
  total: number;
  loading: boolean;
  error: string | null;
};

const EMPTY_DIR: DirState = { entries: [], total: 0, loading: false, error: null };

export type ClaudeDirExplorerHandle = {
  reload: () => void;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

const MODIFIED_FORMAT = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatModified(ms: number): string {
  return ms > 0 ? MODIFIED_FORMAT.format(new Date(ms)) : "";
}

// ツリーの階層に応じた字下げはCSS変数 `--depth` で渡す(App.css 側で計算)。
function depthStyle(depth: number): CSSProperties {
  return { "--depth": depth } as CSSProperties;
}

// `~/.claude` 配下のフォルダ・ファイルをツリー表示する(表示専用。/claude の
// Explorerタブ)。ディレクトリは展開したときに初めて中身を取得する(遅延
// 読み込み)。保持するのは取得済みの表示用スナップショットと展開状態
// (UI状態)のみ(native.md §2)。
const ClaudeDirExplorer = forwardRef<ClaudeDirExplorerHandle>(
  function ClaudeDirExplorer(_props, ref) {
    const [dirs, setDirs] = useState<Record<string, DirState>>({});
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
    // 再読み込み前に発行した一覧取得の応答が、再読み込み後の状態を上書き
    // しないよう、世代番号で古い応答を捨てる。
    const generationRef = useRef(0);

    const loadDir = useCallback((path: string, offset: number) => {
      const generation = generationRef.current;
      setDirs((prev) => ({
        ...prev,
        [path]: { ...(prev[path] ?? EMPTY_DIR), loading: true, error: null },
      }));
      listClaudeDir(path, offset, PAGE_SIZE)
        .then((page) => {
          if (generation !== generationRef.current) return;
          setDirs((prev) => {
            const loaded = offset === 0 ? [] : (prev[path]?.entries ?? []);
            return {
              ...prev,
              [path]: {
                entries: [...loaded, ...page.entries],
                total: page.total,
                loading: false,
                error: null,
              },
            };
          });
        })
        .catch((e) => {
          if (generation !== generationRef.current) return;
          setDirs((prev) => ({
            ...prev,
            [path]: {
              ...(prev[path] ?? EMPTY_DIR),
              loading: false,
              error: isAppError(e) ? e.message : String(e),
            },
          }));
        });
    }, []);

    // 展開状態も含めて初期状態へ戻し、ルートから取り直す。
    const reload = useCallback(() => {
      generationRef.current += 1;
      setExpanded(new Set());
      setDirs({});
      loadDir(ROOT_PATH, 0);
    }, [loadDir]);

    useEffect(() => {
      reload();
    }, [reload]);

    useImperativeHandle(ref, () => ({ reload }), [reload]);

    const toggle = (path: string) => {
      if (expanded.has(path)) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
        return;
      }
      setExpanded((prev) => new Set(prev).add(path));
      // 一度取得したディレクトリは畳んでも中身を保持し、再展開では取り直さない
      // (失敗していた場合のみ再試行する)。
      const state = dirs[path];
      if (!state || state.error) {
        loadDir(path, 0);
      }
    };

    const renderEntry = (entry: ClaudeDirEntryDto, depth: number): ReactNode => {
      const isDirectory = entry.kind === "directory";
      const isOpen = isDirectory && expanded.has(entry.path);
      const label = (
        <>
          <span
            className={`claude-explorer-chevron${isOpen ? " open" : ""}`}
            aria-hidden="true"
          >
            {isDirectory ? "▸" : ""}
          </span>
          <span className={`claude-explorer-label ${entry.kind}`}>{entry.name}</span>
          {entry.kind === "symlink" && <span className="claude-explorer-tag">リンク</span>}
        </>
      );
      return (
        <Fragment key={entry.path}>
          <li className="claude-explorer-row" title={`~/.claude/${entry.path}`}>
            {isDirectory ? (
              <button
                type="button"
                className="claude-explorer-name"
                style={depthStyle(depth)}
                aria-expanded={isOpen}
                onClick={() => toggle(entry.path)}
              >
                {label}
              </button>
            ) : (
              <span className="claude-explorer-name" style={depthStyle(depth)}>
                {label}
              </span>
            )}
            <span className="claude-explorer-size">
              {entry.size_bytes !== null ? formatSize(entry.size_bytes) : ""}
            </span>
            <span className="claude-explorer-modified">
              {formatModified(entry.modified_at_ms)}
            </span>
          </li>
          {isOpen && renderChildren(entry.path, depth + 1)}
        </Fragment>
      );
    };

    const renderChildren = (path: string, depth: number): ReactNode => {
      const state = dirs[path];
      if (!state) return null;
      const remaining = state.total - state.entries.length;
      return (
        <>
          {state.entries.map((entry) => renderEntry(entry, depth))}
          {state.loading && (
            <li className="claude-explorer-status" style={depthStyle(depth)}>
              読み込み中…
            </li>
          )}
          {state.error && (
            <li className="claude-explorer-status error" style={depthStyle(depth)}>
              {state.error}
            </li>
          )}
          {!state.loading && !state.error && state.total === 0 && (
            <li className="claude-explorer-status" style={depthStyle(depth)}>
              (空)
            </li>
          )}
          {!state.loading && remaining > 0 && (
            <li className="claude-explorer-status" style={depthStyle(depth)}>
              <button
                type="button"
                className="claude-explorer-more"
                onClick={() => loadDir(path, state.entries.length)}
              >
                さらに表示(残り{remaining}件)
              </button>
            </li>
          )}
        </>
      );
    };

    return (
      <div className="claude-explorer">
        <div className="claude-explorer-header" aria-hidden="true">
          <span className="claude-explorer-name">名前</span>
          <span className="claude-explorer-size">サイズ</span>
          <span className="claude-explorer-modified">更新日時</span>
        </div>
        <ul className="claude-explorer-list">{renderChildren(ROOT_PATH, 0)}</ul>
      </div>
    );
  },
);

export default ClaudeDirExplorer;
