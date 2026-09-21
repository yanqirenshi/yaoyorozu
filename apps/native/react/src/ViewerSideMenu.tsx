import { useState } from "react";
import {
  CLAUDE_MD_ICON,
  GITHUB_PROJECT_ICON,
  RULES_ICON,
  SETTINGS_JSON_ICON,
  SIDEMENU_COLLAPSE_ICON,
  SIDEMENU_EXPAND_ICON,
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
//
// 最下部の開閉トグル(issue #266)で「アイコンのみ(既定)」と「アイコン+
// 項目名テキスト」を切り替える。開閉状態はこのウィンドウ内の UI 状態
// (`useState`)だけで、永続化しない(リロード・再オープンで既定の閉に戻る)。
// 閉のときだけツールチップを付ける(開のときはラベルが見えるため不要)。
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
  const [expanded, setExpanded] = useState(false);
  return (
    <nav
      className={`viewer-sidemenu${expanded ? " expanded" : ""}`}
      aria-label="ビューの切り替え"
    >
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`viewer-sidemenu-item${item.id === active ? " active" : ""}`}
          title={expanded ? undefined : item.label}
          aria-label={item.label}
          aria-current={item.id === active ? "page" : undefined}
          onClick={() => onChange(item.id)}
        >
          <span
            className="viewer-sidemenu-icon"
            dangerouslySetInnerHTML={{ __html: item.icon }}
          />
          {expanded && <span className="viewer-sidemenu-label">{item.label}</span>}
        </button>
      ))}
      <button
        type="button"
        className="viewer-sidemenu-item viewer-sidemenu-toggle"
        title={expanded ? undefined : "メニューを開く"}
        aria-label={expanded ? "メニューを閉じる" : "メニューを開く"}
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span
          className="viewer-sidemenu-icon"
          dangerouslySetInnerHTML={{
            __html: expanded ? SIDEMENU_COLLAPSE_ICON : SIDEMENU_EXPAND_ICON,
          }}
        />
        {expanded && <span className="viewer-sidemenu-label">閉じる</span>}
      </button>
    </nav>
  );
}

export default ViewerSideMenu;
