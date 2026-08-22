type PaneTabDef = {
  id: string;
  label: string;
};

type PaneTabsProps = {
  tabs: PaneTabDef[];
  active: string;
  onChange: (id: string) => void;
};

function PaneTabs({ tabs, active, onChange }: PaneTabsProps) {
  return (
    <div className="pane-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`pane-tab ${tab.id === active ? "active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default PaneTabs;
export type { PaneTabDef };
