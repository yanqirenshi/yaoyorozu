import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

export type InspectorField = { label: string; value: string };
export type InspectorAction = { label: string; onClick: () => void; disabled?: boolean };

// ハブのノード右クリックで表示するインスペクタの表示内容(issue #109)。
// ノード種別ごとの違いは呼び出し側(HubPage)で吸収し、このコンポーネント
// 自身はノード種別を意識しない汎用的な見出し+項目一覧+任意の入力欄+
// アクションボタンだけを描画する。
// `body` と `actions` は実行中セッションの操作(issue #408)で足した。`body` は
// 権限モードの選択・表示名の入力のような、ボタンを押す前の入力を置く場所で、
// 中身の組み立ては呼び出し側(HubPage)が行う。`action`(単数)は従来の
// 呼び出し(プロファイルの「前面化」等)のために残してある。
export type InspectorContent = {
  title: string;
  fields: InspectorField[];
  action: InspectorAction | null;
  body?: ReactNode;
  actions?: InspectorAction[];
};

type HubInspectorProps = {
  content: InspectorContent;
  width: number;
  onClose: () => void;
  onResizeStart: (e: ReactMouseEvent<HTMLDivElement>) => void;
};

// 画面右端に表示するパネル(issue #109)。グラフのオーバーレイとして
// 被せるだけで、グラフ自体のレイアウトには影響しない(App.css の
// `.hub-inspector` 参照)。幅は左端のハンドルをドラッグして変更できる
// (初期444px・最小222px・最大888pxはHubPage側でクランプする)。
function HubInspector({ content, width, onClose, onResizeStart }: HubInspectorProps) {
  // パネル内のクリックはグラフへ伝えない(issue #408)。`.hub-page` はノード
  // 以外のクリックでインスペクタを閉じるため、伝えると権限モードの選択や
  // 表示名の入力(`body`)のたびにパネルが閉じてしまう。閉じるのは ×・Esc・
  // グラフの空白部だけにする(グラフの調整の吹き出しと同じ流儀)。
  const stop = (e: ReactMouseEvent<HTMLDivElement>) => e.stopPropagation();
  return (
    <div
      className="hub-inspector"
      role="dialog"
      aria-label={content.title}
      style={{ width }}
      onClick={stop}
    >
      <div
        className="hub-inspector-resizer"
        onMouseDown={onResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="インスペクタの幅を変更"
      />
      <div className="hub-inspector-header">
        <h3>{content.title}</h3>
        <button
          type="button"
          className="hub-inspector-close"
          aria-label="閉じる"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <dl className="hub-inspector-fields">
        {content.fields.map((field) => (
          <div key={field.label} className="hub-inspector-field">
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      {content.body && <div className="hub-inspector-body">{content.body}</div>}
      {[...(content.action ? [content.action] : []), ...(content.actions ?? [])].map((action) => (
        <button
          key={action.label}
          type="button"
          className="hub-inspector-action"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

export default HubInspector;
