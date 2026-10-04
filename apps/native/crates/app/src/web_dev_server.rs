//! apps/web の開発サーバ(`npm run web:dev`)を、ビューアの「仕様」リンクから必要なら
//! 起動する(issue #530)。起動の作法は `claude` CLI の起動(`RunningSessionLauncher`)と同じ
//! 流儀: 実体(プロセスの起動・HTTP での確認)は `infra`、`app` はこの抽象(port)だけを扱う。

use crate::AppError;
use std::path::Path;
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
}
