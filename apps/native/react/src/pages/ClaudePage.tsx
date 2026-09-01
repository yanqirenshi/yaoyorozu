import { getClaudeSettingsFile, saveClaudeSettingsFile } from "../api";
import ClaudeMdEditor from "../ClaudeMdEditor";

// `~/.claude` の内容を管理する画面(issue #53)。初版は settings.json の
// 表示・編集のみ。将来のセクション追加(容量マップ、ログ掃除等)に備え、
// 1機能=1 `<section>` の構成にしておく。
function ClaudePage() {
  return (
    <div className="settings-page">
      <section className="settings-section settings-claude-md-section">
        <h3>settings.json</h3>
        <ClaudeMdEditor
          load={getClaudeSettingsFile}
          save={saveClaudeSettingsFile}
          reloadKey="claude-settings"
          emptyMessage="settings.jsonがありません。"
          initialContent="{}"
        />
      </section>
    </div>
  );
}

export default ClaudePage;
