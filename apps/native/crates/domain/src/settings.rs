use crate::Profile;

/// `Settings` の現在のスキーマバージョン。マイグレーションが必要になったら
/// 上げ、infra 側のマイグレーション関数で旧バージョンからの変換を行う。
/// v1 -> v2: `claude_projects_dir` を追加(issue #25)。
/// v2 -> v3: `selected_session_ids`(セッションID配列)を
/// `selected_project_folders`(フォルダ名配列)に置き換え。
/// v3 -> v4: 対象リポジトリ/GitHubプロジェクト/対象フォルダの3項目を
/// 「プロファイル」(複数保存可)に包んだ(`profiles` + `active_profile_id`)。
/// `claude_projects_dir` はマシン設定のためグローバルのまま(issue #72)。
/// v4 -> v5: メインウィンドウのタブバー(issue #77)復元用に `open_tabs`
/// (開いているタブの最小限のスナップショット)を追加。
/// v5 -> v6: 「1ウィンドウ = 1プロファイル」への一本化(issue #91)でタブバーを
/// 廃止したため、`open_tabs` を削除。
pub const CURRENT_SETTINGS_VERSION: u32 = 6;

/// アプリの設定。複数の「プロファイル」(対象リポジトリ・GitHubプロジェクト・
/// 対象フォルダの組)と、そのうちどれがアクティブかに加え、マシン設定である
/// セッション一覧のルートディレクトリを持つ。永続化(JSON)は infra が担う
/// (issue #72)。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Settings {
    pub version: u32,
    pub profiles: Vec<Profile>,
    pub active_profile_id: String,
    /// セッション一覧が読むルートディレクトリ。`None` の場合は既定
    /// (`~/.claude/projects/`)を使う。プロファイルには含めないグローバル項目
    /// (issue #72)。`#[serde(default)]` は v1 のJSON(このフィールドを
    /// 持たない)を読めるようにするため。
    #[serde(default)]
    pub claude_projects_dir: Option<std::path::PathBuf>,
}

impl Default for Settings {
    fn default() -> Self {
        let profile = Profile::new("default".to_string(), "default".to_string());
        Self {
            active_profile_id: profile.id.clone(),
            version: CURRENT_SETTINGS_VERSION,
            profiles: vec![profile],
            claude_projects_dir: None,
        }
    }
}

impl Settings {
    /// `active_profile_id` に一致するプロファイルを返す。通常は必ず存在する
    /// (最後の1件は削除できない・切り替えは存在確認済みのIDにしか許さない
    /// ため)が、呼び出し側は破損データ等に備えて `None` も扱えるようにする。
    pub fn active_profile(&self) -> Option<&Profile> {
        self.profiles
            .iter()
            .find(|p| p.id == self.active_profile_id)
    }
}

/// セッション一覧の有効なルートディレクトリを決める。設定で明示的に
/// 指定されていればそれを、なければ `default`(呼び出し側が解決した
/// `~/.claude/projects/` 等)を使う。
pub fn effective_projects_dir(
    configured: Option<&std::path::Path>,
    default: &std::path::Path,
) -> std::path::PathBuf {
    configured
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| default.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_has_current_version_and_a_single_empty_profile() {
        let settings = Settings::default();
        assert_eq!(settings.version, CURRENT_SETTINGS_VERSION);
        assert_eq!(settings.profiles.len(), 1);
        assert_eq!(settings.active_profile_id, settings.profiles[0].id);
        assert_eq!(settings.profiles[0].repository_path, None);
        assert_eq!(settings.profiles[0].github_project, None);
        assert!(settings.profiles[0].selected_project_folders.is_empty());
        assert_eq!(settings.claude_projects_dir, None);
    }

    #[test]
    fn settings_active_profile_returns_the_matching_profile() {
        let settings = Settings::default();
        let active = settings
            .active_profile()
            .expect("should have an active profile");
        assert_eq!(active.id, settings.active_profile_id);
    }

    #[test]
    fn settings_active_profile_returns_none_when_id_matches_nothing() {
        let settings = Settings {
            active_profile_id: "missing".to_string(),
            ..Settings::default()
        };
        assert_eq!(settings.active_profile(), None);
    }

    #[test]
    fn effective_projects_dir_uses_configured_value_when_present() {
        let configured = std::path::Path::new(r"D:\custom\projects");
        let default = std::path::Path::new(r"C:\Users\yanqi\.claude\projects");
        assert_eq!(
            effective_projects_dir(Some(configured), default),
            configured.to_path_buf()
        );
    }

    #[test]
    fn effective_projects_dir_falls_back_to_default_when_unset() {
        let default = std::path::Path::new(r"C:\Users\yanqi\.claude\projects");
        assert_eq!(effective_projects_dir(None, default), default.to_path_buf());
    }
}
