use crate::ViewerTab;

/// `ViewerTabs` の現在のスキーマバージョン。まだ v1 のみでマイグレーションは
/// 無いが、他の永続化型(`HubLayout` 等)と同じ流儀で最初から持たせておく
/// (issue #353)。
pub const CURRENT_VIEWER_TABS_VERSION: u32 = 1;

/// ビューアで開いているセッションタブの並び(issue #353)。プロファイルごとに
/// 別ファイル(`app_data_dir/viewer-tabs/<プロファイルID>.json`)へ保存する。
/// `settings.json` には入れない(見た目の状態であり、`settings:updated` を無駄に
/// 発火させないため。`hub-layout.json` と同じ考え方)。選択中のタブは保存しない
/// (URL で持つ)。並びは追加した順。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ViewerTabs {
    pub version: u32,
    pub tabs: Vec<ViewerTab>,
}

impl Default for ViewerTabs {
    fn default() -> Self {
        Self {
            version: CURRENT_VIEWER_TABS_VERSION,
            tabs: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_empty_at_current_version() {
        let tabs = ViewerTabs::default();
        assert_eq!(tabs.version, CURRENT_VIEWER_TABS_VERSION);
        assert!(tabs.tabs.is_empty());
    }

    #[test]
    fn roundtrips_through_json() {
        let tabs = ViewerTabs {
            version: CURRENT_VIEWER_TABS_VERSION,
            tabs: vec![ViewerTab {
                project: "proj-a".to_string(),
                series_key: "root-1".to_string(),
            }],
        };
        let json = serde_json::to_string(&tabs).unwrap();
        assert_eq!(serde_json::from_str::<ViewerTabs>(&json).unwrap(), tabs);
    }
}
