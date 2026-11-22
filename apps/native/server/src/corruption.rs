//! 壊れた控え・台帳の退避を、黙って済ませない(利用者が気づけるようにする)。
//!
//! `running-sessions.json`・`archived-sessions.json`・`git-ledger.json` は、読めない・壊れているとき、共有クレート
//! (`infra`)が `*.corrupt.<時刻>` へ退避して、空から始める(起動は止めない)。退避そのものは `infra` のままにし、
//! サーバは、読む処理の前後で「退避したファイルが増えたか」を見て、ログと保留中の警告(画面に出るもの)に出す。
//! 文面には、フルパスではなく**退避先のファイル名だけ**を入れる。

use crate::AppContext;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// 退避を見張る(読む処理の前に作り、あとで [`Watch::evacuated`] で増えたものを調べる)。
pub struct Watch {
    dir: PathBuf,
    base: &'static str,
    before: HashSet<String>,
}

fn evacuated_names(dir: &Path, base: &str) -> HashSet<String> {
    let prefix = format!("{base}.corrupt.");
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|name| name.starts_with(&prefix))
                .collect()
        })
        .unwrap_or_default()
}

impl Watch {
    /// `dir`(データフォルダ)の `base`(例: `running-sessions.json`)の退避ファイルを、いまの状態で控える。
    pub fn start(dir: &Path, base: &'static str) -> Self {
        Self {
            dir: dir.to_path_buf(),
            base,
            before: evacuated_names(dir, base),
        }
    }

    /// 見張りを始めてから増えた、退避ファイルの名前(古い順)。
    pub fn evacuated(&self) -> Vec<String> {
        let mut now: Vec<String> = evacuated_names(&self.dir, self.base)
            .difference(&self.before)
            .cloned()
            .collect();
        now.sort();
        now
    }

    /// 警告の文面(退避先はファイル名だけ。フルパスは入れない)。
    pub fn message(&self, evacuated: &str) -> String {
        message(self.base, evacuated)
    }

    /// 増えた退避があれば、ログと保留中の警告に出す。
    pub async fn report(&self, ctx: &AppContext) {
        for name in self.evacuated() {
            crate::running::warn(ctx, self.message(&name)).await;
        }
    }
}

/// 退避したことの知らせの文面。
pub fn message(base: &str, evacuated: &str) -> String {
    let effect = match base {
        "running-sessions.json" => {
            "前回の実行中セッションは、自動では再開されません。必要なら手で起動してください"
        }
        "archived-sessions.json" => "アーカイブした会話が、一覧に戻ることがあります",
        "git-ledger.json" => {
            "worktree の ID が振り直され、worktree の会話が自動で再開されないことがあります"
        }
        _ => "",
    };
    format!("「{base}」が壊れていたため、退避して空から始めました(退避先: {evacuated})。{effect}")
}
