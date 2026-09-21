import {
  CLAUDE_MD_ICON,
  GITHUB_PROJECT_ICON,
  RULES_ICON,
  SETTINGS_JSON_ICON,
  SETTINGS_LOCAL_JSON_ICON,
  SKILLS_ICON,
  VIEWER_ICON,
} from "./icons";
import type { PaneView } from "./viewerNav";

type ViewerSideMenuProps = {
  active: PaneView;
  onChange: (view: PaneView) => void;
};

// ビューア(`/profiles/:id`)のビュー切り替え(issue #263)。上部のタブ
// (`PaneTabs`)をやめ、画面の最左端(セッション一覧のさらに左)の縦の
// サイドメニューにした。アイコンのみで幅を取らず、項目名はツールチップ
// (`title`)とスクリーンリーダー用の `aria-label` で示す。切り替えの挙動・
// 各ビューの中身は変えない(見た目と置き場所だけ)。アイコンは icons.ts の
// 固定の SVG 文字列(dock・ViewerToolbar と同様に innerHTML で描く)。
const ITEMS: { id: PaneView; label: string; icon: string }[] = [
  { id: "chat", label: "会話", icon: VIEWER_ICON },
  { id: "github-project", label: "GitHub Project", icon: GITHUB_PROJECT_ICON },
  { id: "claude-md", label: "CLAUDE.md", icon: CLAUDE_MD_ICON },
  { id: "rules", label: "Rules", icon: RULES_ICON },
  { id: "skills", label: "Skills", icon: SKILLS_ICON },
  { id: "settings-json", label: "settings.json", icon: SETTINGS_JSON_ICON },
  { id: "settings-local-json", label: "settings.local.json", icon: SETTINGS_LOCAL_JSON_ICON },
];

function ViewerSideMenu({ active, onChange }: ViewerSideMenuProps) {
  return (
    <nav className="viewer-sidemenu" aria-label="ビューの切り替え">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`viewer-sidemenu-item${item.id === active ? " active" : ""}`}
          title={item.label}
          aria-label={item.label}
          aria-current={item.id === active ? "page" : undefined}
          onClick={() => onChange(item.id)}
          dangerouslySetInnerHTML={{ __html: item.icon }}
        />
      ))}
    </nav>
  );
}

export default ViewerSideMenu;
