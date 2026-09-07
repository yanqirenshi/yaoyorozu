export type InspectorField = { label: string; value: string };
export type InspectorAction = { label: string; onClick: () => void };

// ハブのノード右クリックで表示するインスペクタの表示内容(issue #109)。
// ノード種別ごとの違いは呼び出し側(HubPage)で吸収し、このコンポーネント
// 自身はノード種別を意識しない汎用的な見出し+項目一覧+任意のアクション
// ボタンだけを描画する。
export type InspectorContent = {
  title: string;
  fields: InspectorField[];
  action: InspectorAction | null;
};

type HubInspectorProps = {
  content: InspectorContent;
  onClose: () => void;
};

// 画面右端に固定幅で表示するパネル(issue #109)。グラフのオーバーレイと
// して被せるだけで、グラフ自体のレイアウトには影響しない(App.css の
// `.hub-inspector` 参照)。
function HubInspector({ content, onClose }: HubInspectorProps) {
  return (
    <div className="hub-inspector" role="dialog" aria-label={content.title}>
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
      {content.action && (
        <button type="button" className="hub-inspector-action" onClick={content.action.onClick}>
          {content.action.label}
        </button>
      )}
    </div>
  );
}

export default HubInspector;
