use crate::ObservedWorktree;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// クラス図(`classes-domain.ts`)の `GitWorktree`(オブジェクトモデル実装
/// 第3弾。issue #193)。TM上は「ワーキングツリー(イベント)」であり、
/// worktreeの作成・削除という出来事を記録する。`GitRepository` に
/// コンポジションで所有される(`GitRepository.worktrees`)。個体指定子は
/// `worktree_folder_path`(同じフォルダに存在できるworktreeは1つ)。
///
/// `checked_out_branch` はクラス図上のアソシエーション(`GitBranch` への
/// 単方向参照。コンポジションではない)で、値は `GitBranch.branch_id`。
/// worktreeの識別子(フォルダパス)はメイン作業ツリーと違い変わらないが、
/// チェックアウト中のブランチは同じworktreeのまま切り替わりうるため、
/// [`reconcile_worktrees`] は既存レコードでもこの項目だけは観測結果で
/// 更新する([`GitBranch`](crate::GitBranch)本体と違い、worktreeの
/// 「作成」イベントとしての同一性には影響しない可変フィールド)。
///
/// ID・作成/削除時刻の考え方は [`GitBranch`](crate::GitBranch) と同じ
/// (アプリが観測時刻をもとに新規発行する。実際の作成時刻ではない)。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GitWorktree {
    pub worktree_id: String,
    pub worktree_name: String,
    /// 当面は空文字(編集機能は将来)。
    pub description: String,
    pub worktree_folder_path: PathBuf,
    pub worktree_git_file_path: PathBuf,
    pub created_at_time: u64,
    pub deleted_at_time: Option<u64>,
    pub checked_out_branch: Option<String>,
}

/// パス末尾のフォルダ名を取り出す。`GitRepository` の
/// `repository_name_from_path`(issue #189)と同じ発想。末尾が取れない
/// (ルート等)場合はパス全体の文字列表現にフォールバックする。
fn worktree_name_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.display().to_string())
}

/// 台帳(前回までの観測結果)と、今回の観測(現存するworktree一覧)を
/// 突き合わせ、新しい台帳を組み立てる純粋関数(issue #193)。個体指定子は
/// `folder_path`。作成・削除・再作成の扱いは
/// [`reconcile_branches`](crate::reconcile_branches)と同じだが、
/// 既存レコードが観測でも見つかった場合、`checked_out_branch`(可変)と
/// `worktree_git_file_path`は観測結果で上書きする(worktree自体の同一性=
/// フォルダパスは変わらないため新規イベントにはしない)。
///
/// `branch_id_by_name` は現在アクティブな([`GitBranch`](crate::GitBranch)の
/// `deleted_at_time`が`None`の)ブランチの名前→ID対応表で、呼び出し元が
/// `reconcile_branches`の結果から作って渡す(ブランチの台帳を先に確定させて
/// からworktreeを解決する順序を、呼び出し元に強制する形)。観測された
/// ブランチ名がこの対応表に無い(detached、または直前まで解決できていない)
/// 場合は`checked_out_branch`を`None`にする。
pub fn reconcile_worktrees(
    ledger: &[GitWorktree],
    observed: &[ObservedWorktree],
    branch_id_by_name: &HashMap<String, String>,
    now: u64,
    generate_id: &mut dyn FnMut() -> String,
) -> Vec<GitWorktree> {
    let resolve_branch_id = |name: &Option<String>| {
        name.as_ref()
            .and_then(|n| branch_id_by_name.get(n).cloned())
    };

    let mut result: Vec<GitWorktree> = Vec::with_capacity(ledger.len() + observed.len());

    for existing in ledger {
        if existing.deleted_at_time.is_some() {
            result.push(existing.clone());
            continue;
        }
        match observed
            .iter()
            .find(|o| o.folder_path == existing.worktree_folder_path)
        {
            Some(observation) => {
                let mut updated = existing.clone();
                updated.worktree_git_file_path = observation.git_file_path.clone();
                updated.checked_out_branch =
                    resolve_branch_id(&observation.checked_out_branch_name);
                result.push(updated);
            }
            None => {
                let mut deleted = existing.clone();
                deleted.deleted_at_time = Some(now);
                result.push(deleted);
            }
        }
    }

    for observation in observed {
        let has_active_entry = result.iter().any(|w| {
            w.worktree_folder_path == observation.folder_path && w.deleted_at_time.is_none()
        });
        if !has_active_entry {
            result.push(GitWorktree {
                worktree_id: generate_id(),
                worktree_name: worktree_name_from_path(&observation.folder_path),
                description: String::new(),
                worktree_folder_path: observation.folder_path.clone(),
                worktree_git_file_path: observation.git_file_path.clone(),
                created_at_time: now,
                deleted_at_time: None,
                checked_out_branch: resolve_branch_id(&observation.checked_out_branch_name),
            });
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sequential_id_generator(prefix: &'static str) -> impl FnMut() -> String {
        let mut counter = 0u32;
        move || {
            counter += 1;
            format!("{prefix}-{counter}")
        }
    }

    fn observed(folder: &str, branch: Option<&str>) -> ObservedWorktree {
        ObservedWorktree {
            folder_path: PathBuf::from(folder),
            git_file_path: PathBuf::from(folder).join(".git"),
            checked_out_branch_name: branch.map(str::to_string),
        }
    }

    #[test]
    fn reconcile_worktrees_creates_new_entry_with_name_derived_from_path_tail() {
        let mut generate_id = sequential_id_generator("id");
        let branch_ids = HashMap::from([("feature-x".to_string(), "b-1".to_string())]);

        let result = reconcile_worktrees(
            &[],
            &[observed(r"C:\repo\worktrees\feature-x", Some("feature-x"))],
            &branch_ids,
            100,
            &mut generate_id,
        );

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].worktree_id, "id-1");
        assert_eq!(result[0].worktree_name, "feature-x");
        assert_eq!(result[0].created_at_time, 100);
        assert_eq!(result[0].deleted_at_time, None);
        assert_eq!(result[0].checked_out_branch, Some("b-1".to_string()));
    }

    #[test]
    fn reconcile_worktrees_updates_checked_out_branch_on_existing_entry_without_new_id() {
        let existing = GitWorktree {
            worktree_id: "wt-1".to_string(),
            worktree_name: "feature-x".to_string(),
            description: String::new(),
            worktree_folder_path: PathBuf::from(r"C:\repo\worktrees\feature-x"),
            worktree_git_file_path: PathBuf::from(r"C:\repo\worktrees\feature-x\.git"),
            created_at_time: 10,
            deleted_at_time: None,
            checked_out_branch: Some("b-old".to_string()),
        };
        let mut generate_id = sequential_id_generator("id");
        let branch_ids = HashMap::from([("feature-y".to_string(), "b-new".to_string())]);

        let result = reconcile_worktrees(
            &[existing],
            &[observed(r"C:\repo\worktrees\feature-x", Some("feature-y"))],
            &branch_ids,
            999,
            &mut generate_id,
        );

        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0].worktree_id, "wt-1",
            "同一worktreeのIDは変わらない"
        );
        assert_eq!(result[0].created_at_time, 10, "作成時刻も変わらない");
        assert_eq!(result[0].checked_out_branch, Some("b-new".to_string()));
    }

    #[test]
    fn reconcile_worktrees_marks_missing_entry_as_deleted_without_removing_it() {
        let existing = GitWorktree {
            worktree_id: "wt-1".to_string(),
            worktree_name: "feature-x".to_string(),
            description: String::new(),
            worktree_folder_path: PathBuf::from(r"C:\repo\worktrees\feature-x"),
            worktree_git_file_path: PathBuf::from(r"C:\repo\worktrees\feature-x\.git"),
            created_at_time: 10,
            deleted_at_time: None,
            checked_out_branch: None,
        };
        let mut generate_id = sequential_id_generator("id");

        let result = reconcile_worktrees(&[existing], &[], &HashMap::new(), 500, &mut generate_id);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].worktree_id, "wt-1");
        assert_eq!(result[0].deleted_at_time, Some(500));
    }

    #[test]
    fn reconcile_worktrees_treats_reappearance_of_deleted_path_as_a_brand_new_event() {
        let deleted = GitWorktree {
            worktree_id: "wt-1".to_string(),
            worktree_name: "feature-x".to_string(),
            description: String::new(),
            worktree_folder_path: PathBuf::from(r"C:\repo\worktrees\feature-x"),
            worktree_git_file_path: PathBuf::from(r"C:\repo\worktrees\feature-x\.git"),
            created_at_time: 10,
            deleted_at_time: Some(20),
            checked_out_branch: None,
        };
        let mut generate_id = sequential_id_generator("id");

        let result = reconcile_worktrees(
            std::slice::from_ref(&deleted),
            &[observed(r"C:\repo\worktrees\feature-x", None)],
            &HashMap::new(),
            999,
            &mut generate_id,
        );

        assert_eq!(result.len(), 2);
        assert_eq!(result[0], deleted);
        assert_eq!(result[1].worktree_id, "id-1");
        assert_eq!(result[1].created_at_time, 999);
        assert_eq!(result[1].deleted_at_time, None);
    }

    #[test]
    fn reconcile_worktrees_leaves_checked_out_branch_none_when_detached() {
        let mut generate_id = sequential_id_generator("id");

        let result = reconcile_worktrees(
            &[],
            &[observed(r"C:\repo\worktrees\detached-one", None)],
            &HashMap::new(),
            100,
            &mut generate_id,
        );

        assert_eq!(result[0].checked_out_branch, None);
    }
}
