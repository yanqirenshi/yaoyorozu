use app::AppError;
use domain::Settings;
use infra::FileSettingsStore;
use std::path::PathBuf;

/// アプリの唯一の真実(SSoT)。`tauri::State<tokio::sync::Mutex<AppState>>` として
/// 管理する(native.md §2)。
pub struct AppState {
    pub settings: Settings,
    pub save_path: PathBuf,
}

/// [`AppState::load`] の結果。設定ファイルの破損から復旧した場合、呼び出し側
/// (`run()`)が `settings:corrupted` イベントを emit するかどうかの判断に使う。
pub struct LoadResult {
    pub state: AppState,
    pub recovered_from_corruption: bool,
}

impl AppState {
    /// 起動時に設定ファイルを読み込む。存在しない/壊れている場合のデフォルト値
    /// へのフォールバックは `FileSettingsStore` 側の責務。
    pub fn load(save_path: PathBuf) -> Result<LoadResult, AppError> {
        let store = FileSettingsStore::new(save_path.clone());
        let loaded = app::load_settings(&store)?;
        Ok(LoadResult {
            state: AppState {
                settings: loaded.settings,
                save_path,
            },
            recovered_from_corruption: loaded.recovered_from_corruption,
        })
    }
}
