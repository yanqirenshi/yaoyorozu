//! apps/web の開発サーバ(`npm run web:dev`)を、ビューアの「仕様」リンクから必要なら
//! 起動する(issue #530)。起動の作法は `claude` CLI の起動(`RunningSessionLauncher`)と同じ
//! 流儀: 実体(プロセスの起動・HTTP での確認)は `infra`、`app` はこの抽象(port)だけを扱う。
//!
//! Web アプリの実体は **yaoyorozu リポジトリに1つだけ**(issue #554)。「仕様」を押した
//! プロファイルの `repository_path` では起動しない(そのリポジトリが `web:dev` を持たない
//! ことがあるため。#543 で複数リポジトリの仕様管理に対応してから前提が変わった)。
//! 起動先は登録済みプロファイルから `web:dev` を持つものを探し([`find_web_app_repository`])、
//! 見るリポジトリは URL(`/{リポジトリ名}/wbs`)で切り替える([`web_app_spec_url`])。

use crate::{resolve_repository_dir, AppError};
use domain::Settings;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// apps/web の開発サーバが既定で使うポート。`npm run web:dev`(ルートの `package.json`)側の
/// 既定値と揃える(CLAUDE.md「開発コマンド」参照)。設定で変えられるようにするのは別issue。
pub const WEB_DEV_SERVER_PORT: u16 = 3000;

/// `npm run web:dev` を起動する port。
pub trait WebDevServerLauncher: Send + Sync {
    /// `repository_path`(モノレポのルート。apps/web を含む)で起動する。
    fn start(&self, repository_path: &Path) -> Result<Arc<dyn WebDevServerProcess>, AppError>;
}

/// 起動済みの `npm run web:dev` プロセス(port)。
pub trait WebDevServerProcess: Send + Sync {
    fn pid(&self) -> u32;
    /// プロセスを止める(app 終了時に、自分が起動したものだけを対象に呼ぶ)。
    fn stop(&self);
    /// プロセスがすでに終了していれば、原因の手がかりになる末尾の標準出力・標準エラーを
    /// 返す(issue #554。例: 登録を誤ったリポジトリに `web:dev` が無く即終了した場合)。
    /// まだ動いていれば `None`。
    fn exited_with_output(&self) -> Option<String>;
}

/// `repository_path` が Web アプリ(apps/web)を持つか(`package.json` の `scripts.web:dev`
/// の有無)を確かめる port(issue #554)。フォルダ名では判定しない(名前は変わりうる)。
pub trait WebAppRepositoryProbe: Send + Sync {
    fn has_web_dev_script(&self, repository_path: &Path) -> bool;
}

/// Web アプリ(apps/web の開発サーバ)が応答しているかを確かめる port。自分が起動したかに
/// 関係なく確かめる(利用者が手で `npm run web:dev` を起動していることもあり、その場合は
/// 二重に起動しない)。
pub trait WebAppProbe: Send + Sync {
    fn is_responding(&self) -> bool;
}

/// 「仕様」を開く前に、Web アプリの開発サーバをどうするかの判断(純粋。issue #530)。
/// `responding` は直前に確かめた応答の有無、`tracked` は app が自分で起動して追跡中の
/// プロセスを持っているか(`AppState` に1つだけ持つ。多重起動の防止)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebAppReadiness {
    /// すでに応答している(自分で起動したかに関係なく)。そのまま開いてよい。
    AlreadyResponding,
    /// 追跡中のプロセスが起動の途中(まだ応答していない)。重ねて起動せず、応答を待つだけでよい。
    Starting,
    /// まだ何も無い。起動する必要がある。
    NeedsStart,
}

pub fn web_app_readiness(responding: bool, tracked: bool) -> WebAppReadiness {
    if responding {
        WebAppReadiness::AlreadyResponding
    } else if tracked {
        WebAppReadiness::Starting
    } else {
        WebAppReadiness::NeedsStart
    }
}

/// Web アプリ(apps/web)の起動先(issue #554)。登録済みプロファイルの `repository_path` を
/// 順に見て、`web:dev` を持つ最初のリポジトリを使う(複数あっても1つでよい)。
/// 見つからなければ、その旨のエラー(呼び出し側は120秒待たずにこれを返すこと)。
pub fn find_web_app_repository(
    settings: &Settings,
    probe: &dyn WebAppRepositoryProbe,
) -> Result<PathBuf, AppError> {
    domain::repositories_from_profiles(&settings.profiles)
        .into_iter()
        .find(|repo| probe.has_web_dev_script(&repo.repository_path))
        .map(|repo| repo.repository_path)
        .ok_or_else(|| {
            AppError::NotFound(
                "Web アプリ(apps/web)を持つリポジトリが登録されていません。設定で yaoyorozu のリポジトリを登録してください"
                    .to_string(),
            )
        })
}

/// 「仕様」で開く URL(issue #554)。`profile_id` は URL に載せるリポジトリ名
/// (`repository_path` 末尾のフォルダ名。#544 の読み取り API と同じ決め方。
/// `domain::repositories_from_profiles` を再利用する)を決めるためだけに使う。
/// 起動先のリポジトリとは別([`find_web_app_repository`]参照。Web アプリの実体は
/// 常に1つで、見るリポジトリは URL で切り替える)。
///
/// `repository_path` が未設定のプロファイルはエラー(issue #554 本文の判断: フロント側は
/// issue #547 の「仕様フォルダを作る」ボタンと同様、このプロファイルでは「仕様」を
/// 押せないようにする。未設定でも Web アプリ自身のリポジトリ名で開く案もあったが、
/// 見ている対象と無関係なリポジトリが開くのは分かりにくいため採らなかった)。
pub fn web_app_spec_url(settings: &Settings, profile_id: Option<&str>) -> Result<String, AppError> {
    let repository_path = resolve_repository_dir(settings, profile_id)?;
    let repository_name = domain::repositories_from_profiles(&settings.profiles)
        .into_iter()
        .find(|repo| repo.repository_path == repository_path)
        .map(|repo| repo.repository_name)
        .unwrap_or_else(|| repository_path.display().to_string());
    Ok(format!(
        "http://localhost:{WEB_DEV_SERVER_PORT}/{repository_name}/wbs"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responding_wins_regardless_of_tracking() {
        assert_eq!(
            web_app_readiness(true, true),
            WebAppReadiness::AlreadyResponding
        );
        assert_eq!(
            web_app_readiness(true, false),
            WebAppReadiness::AlreadyResponding
        );
    }

    #[test]
    fn not_responding_but_tracked_means_still_starting() {
        assert_eq!(web_app_readiness(false, true), WebAppReadiness::Starting);
    }

    #[test]
    fn not_responding_and_not_tracked_needs_a_start() {
        assert_eq!(web_app_readiness(false, false), WebAppReadiness::NeedsStart);
    }

    struct FakeRepositoryProbe {
        has_script: Vec<PathBuf>,
    }

    impl WebAppRepositoryProbe for FakeRepositoryProbe {
        fn has_web_dev_script(&self, repository_path: &Path) -> bool {
            self.has_script.iter().any(|p| p == repository_path)
        }
    }

    fn settings_with_profiles(entries: &[(&str, Option<&str>)]) -> Settings {
        let mut settings = Settings::default();
        settings.profiles = entries
            .iter()
            .map(|(id, path)| {
                let mut profile = domain::Profile::new(id.to_string(), id.to_string());
                profile.repository_path = path.map(PathBuf::from);
                profile
            })
            .collect();
        settings.active_profile_id = settings.profiles[0].id.clone();
        settings
    }

    #[test]
    fn find_web_app_repository_picks_the_first_profile_whose_repository_has_the_script() {
        let settings = settings_with_profiles(&[
            ("a", Some("/repo/without-web")),
            ("b", Some("/repo/with-web")),
        ]);
        let probe = FakeRepositoryProbe {
            has_script: vec![PathBuf::from("/repo/with-web")],
        };

        let found = find_web_app_repository(&settings, &probe).expect("should find");

        assert_eq!(found, PathBuf::from("/repo/with-web"));
    }

    #[test]
    fn find_web_app_repository_does_not_judge_by_folder_name() {
        // フォルダ名が "yaoyorozu" でも、package.json に web:dev が無ければ選ばない。
        let settings = settings_with_profiles(&[
            ("a", Some("/repo/yaoyorozu")),
            ("b", Some("/repo/renamed-but-has-the-script")),
        ]);
        let probe = FakeRepositoryProbe {
            has_script: vec![PathBuf::from("/repo/renamed-but-has-the-script")],
        };

        let found = find_web_app_repository(&settings, &probe).expect("should find");

        assert_eq!(found, PathBuf::from("/repo/renamed-but-has-the-script"));
    }

    #[test]
    fn find_web_app_repository_skips_profiles_without_a_repository_path() {
        let settings = settings_with_profiles(&[("a", None), ("b", Some("/repo/with-web"))]);
        let probe = FakeRepositoryProbe {
            has_script: vec![PathBuf::from("/repo/with-web")],
        };

        let found = find_web_app_repository(&settings, &probe).expect("should find");

        assert_eq!(found, PathBuf::from("/repo/with-web"));
    }

    #[test]
    fn find_web_app_repository_fails_fast_when_nothing_matches() {
        let settings = settings_with_profiles(&[("a", Some("/repo/without-web"))]);
        let probe = FakeRepositoryProbe { has_script: vec![] };

        let error = find_web_app_repository(&settings, &probe).expect_err("should fail");

        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[test]
    fn web_app_spec_url_uses_the_resolved_profiles_repository_name() {
        let settings = settings_with_profiles(&[
            ("a", Some(r"C:\repo\yaoyorozu")),
            ("b", Some(r"C:\repo\ukiyo")),
        ]);

        let url = web_app_spec_url(&settings, Some("b")).expect("should resolve");

        assert_eq!(url, "http://localhost:3000/ukiyo/wbs");
    }

    #[test]
    fn web_app_spec_url_fails_when_the_profiles_repository_path_is_unset() {
        let settings = settings_with_profiles(&[("a", None)]);

        let error = web_app_spec_url(&settings, Some("a")).expect_err("should fail");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }
}
