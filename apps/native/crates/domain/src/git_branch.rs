/// クラス図(`classes-domain.ts`)の `GitBranch`(オブジェクトモデル実装
/// 第3弾。issue #193)。TM上は「Gitブランチ(イベント)」であり、
/// ブランチの作成・削除という出来事を記録する。`GitRepository` に
/// コンポジションで所有される(`GitRepository.branches`)。
///
/// gitコマンド自体はブランチにID・作成時刻を持たないため、`branch_id` は
/// アプリが新規発行し(採番はapp層の責務。domainは受け取るだけ)、
/// `created_at_time` は「実際にブランチが作られた時刻」ではなく「アプリが
/// 初めてそのブランチ名を観測した時刻」である(台帳を初めて作る時は、
/// その時点で存在する全ブランチがまとめてこの時刻で記録される)。
///
/// レコードは削除されても消さず、`deleted_at_time` にその観測時刻を
/// 記録して残す(イベントは事実として不変。[`reconcile_branches`] 参照)。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GitBranch {
    pub branch_id: String,
    pub branch_name: String,
    /// 当面は空文字(編集機能は将来)。
    pub description: String,
    pub created_at_time: u64,
    pub deleted_at_time: Option<u64>,
}

/// 台帳(前回までの観測結果)と、今回の観測(現存するブランチ名一覧)を
/// 突き合わせ、新しい台帳を組み立てる純粋関数(issue #193)。
///
/// - 台帳になく新たに観測された名前 → 新規イベント(新しいID、
///   `created_at_time = now`)として追加する。
/// - 台帳にあり(未削除)、今回も観測された → そのまま(IDも作成時刻も
///   変えない)。
/// - 台帳にあり(未削除)、今回は観測されなかった → `deleted_at_time = now`
///   を記録する(レコード自体は消さない)。
/// - 既に削除済みのレコードは、同名が再び観測されても復活させない
///   (「一度消えて同名で再作成された場合は別イベント(新しいID)とする」
///   というissueの要求どおり、新規イベントとして別レコードを追加する)。
///
/// I/O(gitコマンドの実行)・現在時刻・ID生成はいずれもこの関数の外
/// (app層)から注入し、domainはロジックのみを持つ(native.md §1)。
pub fn reconcile_branches(
    ledger: &[GitBranch],
    observed_names: &[String],
    now: u64,
    generate_id: &mut dyn FnMut() -> String,
) -> Vec<GitBranch> {
    let mut result: Vec<GitBranch> = Vec::with_capacity(ledger.len() + observed_names.len());

    for existing in ledger {
        if existing.deleted_at_time.is_some() {
            result.push(existing.clone());
            continue;
        }
        if observed_names
            .iter()
            .any(|name| name == &existing.branch_name)
        {
            result.push(existing.clone());
        } else {
            let mut deleted = existing.clone();
            deleted.deleted_at_time = Some(now);
            result.push(deleted);
        }
    }

    for name in observed_names {
        let has_active_entry = result
            .iter()
            .any(|b| &b.branch_name == name && b.deleted_at_time.is_none());
        if !has_active_entry {
            result.push(GitBranch {
                branch_id: generate_id(),
                branch_name: name.clone(),
                description: String::new(),
                created_at_time: now,
                deleted_at_time: None,
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

    #[test]
    fn reconcile_branches_creates_new_entry_for_previously_unknown_name() {
        let mut generate_id = sequential_id_generator("id");

        let result = reconcile_branches(&[], &["main".to_string()], 100, &mut generate_id);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].branch_id, "id-1");
        assert_eq!(result[0].branch_name, "main");
        assert_eq!(result[0].created_at_time, 100);
        assert_eq!(result[0].deleted_at_time, None);
    }

    #[test]
    fn reconcile_branches_keeps_existing_entry_unchanged_when_still_observed() {
        let existing = GitBranch {
            branch_id: "id-1".to_string(),
            branch_name: "main".to_string(),
            description: String::new(),
            created_at_time: 10,
            deleted_at_time: None,
        };
        let mut generate_id = sequential_id_generator("id");

        let result = reconcile_branches(
            std::slice::from_ref(&existing),
            &["main".to_string()],
            999,
            &mut generate_id,
        );

        assert_eq!(result, vec![existing]);
    }

    #[test]
    fn reconcile_branches_marks_missing_entry_as_deleted_without_removing_it() {
        let existing = GitBranch {
            branch_id: "id-1".to_string(),
            branch_name: "feature-x".to_string(),
            description: String::new(),
            created_at_time: 10,
            deleted_at_time: None,
        };
        let mut generate_id = sequential_id_generator("id");

        let result = reconcile_branches(&[existing], &[], 500, &mut generate_id);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].branch_id, "id-1");
        assert_eq!(result[0].deleted_at_time, Some(500));
    }

    #[test]
    fn reconcile_branches_treats_reappearance_of_deleted_name_as_a_brand_new_event() {
        let deleted = GitBranch {
            branch_id: "id-1".to_string(),
            branch_name: "feature-x".to_string(),
            description: String::new(),
            created_at_time: 10,
            deleted_at_time: Some(20),
        };
        let mut generate_id = sequential_id_generator("id");

        let result = reconcile_branches(
            std::slice::from_ref(&deleted),
            &["feature-x".to_string()],
            999,
            &mut generate_id,
        );

        assert_eq!(result.len(), 2);
        assert_eq!(result[0], deleted, "古い削除済みレコードは残る");
        assert_eq!(result[1].branch_id, "id-1");
        assert_eq!(result[1].branch_name, "feature-x");
        assert_eq!(result[1].created_at_time, 999);
        assert_eq!(result[1].deleted_at_time, None);
    }

    #[test]
    fn reconcile_branches_does_not_call_generate_id_when_nothing_new() {
        let existing = GitBranch {
            branch_id: "id-1".to_string(),
            branch_name: "main".to_string(),
            description: String::new(),
            created_at_time: 10,
            deleted_at_time: None,
        };
        let mut calls = 0u32;
        let mut generate_id = || {
            calls += 1;
            calls.to_string()
        };

        reconcile_branches(&[existing], &["main".to_string()], 999, &mut generate_id);

        assert_eq!(calls, 0);
    }
}
