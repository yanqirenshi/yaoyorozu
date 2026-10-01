//! app の起動時に、前回動かしていた実行中セッションを再開するための覚え書き(issue #459)。
//!
//! app を終了すると、app が起動していた `claude` はすべて止まる(#391)。15 件を運用するため
//! (Desktop からの移行。#381)、**起動・停止・切り替えのたびに**再開に必要な指定を保存しておき、
//! 次の起動で順に再開する。
//!
//! 「終了時にまとめて書く」ことはしない: MSI の入れ替えなどで app がアプリの外側から強制終了
//! されると `RunEvent::Exit` は発火せず、書く機会が無いため(issue #458 の知見)。
//!
//! 保存するのは**指定だけ**でパスは持たない(native.md §4)。cwd・リポジトリは再開のときに
//! app が解決する。

use crate::{
    AppError, RestorableRunningSessionsStore, RunningPermissionMode, RunningSessionSwitch,
    StartModel, WorktreeSpec,
};
use domain::{
    RestorableRunningSession, RunningSessionByApp, MAIN_WORKTREE_ID, OUTSIDE_WORKTREE_ID,
};

/// 起動した(または起動し直した)実行中セッション1件を覚える。`project` は会話ファイルのある
/// プロジェクトフォルダ名(新規に始めた会話は、会話ファイルができるまで分からないので `None`)。
/// `model` は起動のときに選んだ別名(`None` は CLI の既定)。
pub fn remember_running_session(
    store: &dyn RestorableRunningSessionsStore,
    session: &RunningSessionByApp,
    profile_id: &str,
    project: Option<&str>,
    model: Option<StartModel>,
) -> Result<(), AppError> {
    let mut saved = store.load()?;
    saved.upsert(RestorableRunningSession {
        profile_id: profile_id.to_string(),
        project: project.map(str::to_string),
        session_id: session.base.session_id.clone(),
        permission_mode: session
            .current_permission_mode
            .clone()
            .unwrap_or_else(|| RunningPermissionMode::default().as_cli_value().to_string()),
        model: model.map(|m| m.as_cli_value().to_string()),
        name: session.base.name.clone(),
        worktree_id: session.worktree_id.clone(),
    });
    store.save(&saved)
}

/// 利用者が停止・終了した実行中セッションを忘れる(次の起動で再開しない)。
/// CLI が自分で終わった(異常終了した)ときは**呼ばない**: それは「前回動かしていた」ものとして
/// 残し、次の起動で再開を試みる。
pub fn forget_running_session(
    store: &dyn RestorableRunningSessionsStore,
    session_id: &str,
) -> Result<(), AppError> {
    let mut saved = store.load()?;
    saved.remove(session_id);
    store.save(&saved)
}

/// 起動中の切り替え(権限モード・モデル)が CLI に受け入れられたときに、覚えている指定を
/// 現在の値へ更新する。モデルは**別名のまま**覚える(`system/init` が報告する実際のモデル名は
/// 版が変わると古くなるため。[`RestorableRunningSession::model`])。app が知らない別名
/// (CLI の既定 `default` など)へ切り替えたときは「指定なし」に戻す。
pub fn remember_running_session_switch(
    store: &dyn RestorableRunningSessionsStore,
    session_id: &str,
    switch: &RunningSessionSwitch,
) -> Result<(), AppError> {
    let mut saved = store.load()?;
    saved.update(session_id, |entry| match switch {
        RunningSessionSwitch::PermissionMode(mode) => {
            entry.permission_mode = mode.as_cli_value().to_string();
        }
        RunningSessionSwitch::Model(value) => {
            entry.model = StartModel::from_cli_value(value).map(|m| m.as_cli_value().to_string());
        }
    });
    store.save(&saved)
}

/// 起動時に再開する一覧(保存した順)。設定で切ってあれば空(何もしない)。アーカイブ済み
/// (issue #494)は除く: 止めてからアーカイブしているので通常は控えに残らないはずだが、念のため
/// 復元の入り口でも除外する。
pub fn sessions_to_restore(
    store: &dyn RestorableRunningSessionsStore,
    settings: &domain::Settings,
    archived: &domain::ArchivedSessions,
) -> Result<Vec<RestorableRunningSession>, AppError> {
    if !settings.restore_running_sessions {
        return Ok(Vec::new());
    }
    Ok(store
        .load()?
        .sessions
        .into_iter()
        .filter(|s| !archived.is_archived(&s.session_id))
        .collect())
}

/// 覚えていた1件を、再開の指定へ組み立てたもの(issue #459)。パスは含まない(呼び出し側の
/// 起動の道筋が、プロファイル・会話ファイル・Git 台帳から解決する)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedRestore {
    pub profile_id: String,
    pub project: String,
    pub session_id: String,
    pub mode: RunningPermissionMode,
    pub model: Option<StartModel>,
    pub name: Option<String>,
    /// 起動する worktree。`None` は「指定しない」(会話ファイルに記録された cwd で開く。
    /// リポジトリ外で動かしていた会話)。
    pub worktree: Option<WorktreeSpec>,
}

/// 覚えていた1件を再開の指定へ変換する。会話ファイルのフォルダが分からないもの(新規に始めて
/// 会話ファイルができる前に app が終わった会話)は `--resume` で開き直せないため
/// [`AppError::InvalidInput`](呼び出し側は飛ばして次へ進む)。
///
/// worktree は台帳の ID で覚えてある:
/// - リポジトリ本体(`main-worktree`)→ [`WorktreeSpec::Main`]
/// - リポジトリ外(`outside-repository`)→ 指定しない(会話ファイルの cwd で開く)
/// - それ以外 → [`WorktreeSpec::Existing`](**作らない**。無ければ再開は失敗し、飛ばす)
pub fn plan_restore(entry: &RestorableRunningSession) -> Result<PlannedRestore, AppError> {
    let Some(project) = entry.project.clone() else {
        return Err(AppError::InvalidInput(
            "会話ファイルがまだ無いセッションは再開できません".to_string(),
        ));
    };
    let worktree = match entry.worktree_id.as_str() {
        MAIN_WORKTREE_ID => Some(WorktreeSpec::Main),
        OUTSIDE_WORKTREE_ID => None,
        worktree_id => Some(WorktreeSpec::Existing {
            worktree_id: worktree_id.to_string(),
        }),
    };
    Ok(PlannedRestore {
        profile_id: entry.profile_id.clone(),
        project,
        session_id: entry.session_id.clone(),
        // 知らない値(版が増やしたモード)は既定に倒す(起動を止めない)。
        mode: RunningPermissionMode::from_cli_value(&entry.permission_mode).unwrap_or_default(),
        model: entry.model.as_deref().and_then(StartModel::from_cli_value),
        name: entry.name.clone(),
        worktree,
    })
}

/// 復元する会話ファイルがまだあるかを確かめる(issue #459)。消えている会話を `--resume` で
/// 起こすと、CLI は起動直後にエラーで終わる(利用者には「終了」したセッションだけが残って
/// 分かりにくい)ので、起こす前に飛ばして理由を伝える。
///
/// 起動の道筋(`resume_running_session`)では、worktree を指定したときは会話ファイルを見ない
/// (cwd はその worktree に決まるため)。復元は利用者が選んだ操作ではなく、**古い控えを当てにして**
/// 起こすので、ここで確かめる。
pub fn ensure_restorable_conversation(
    source: &dyn crate::SessionSource,
    planned: &PlannedRestore,
) -> Result<(), AppError> {
    source
        .session_cwd(&planned.project, &planned.session_id)
        .map(|_| ())
        .map_err(|_| AppError::NotFound("会話ファイルが見つかりません".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{ProcessState, RestorableRunningSessions, RunningSession};
    use std::path::PathBuf;
    use std::sync::Mutex;

    struct FakeStore {
        saved: Mutex<RestorableRunningSessions>,
        fail_load: bool,
    }

    impl FakeStore {
        fn new() -> Self {
            Self {
                saved: Mutex::new(RestorableRunningSessions::default()),
                fail_load: false,
            }
        }
        fn sessions(&self) -> Vec<RestorableRunningSession> {
            self.saved.lock().unwrap().sessions.clone()
        }
    }

    impl RestorableRunningSessionsStore for FakeStore {
        fn load(&self) -> Result<RestorableRunningSessions, AppError> {
            if self.fail_load {
                return Err(AppError::Io("読めません".to_string()));
            }
            Ok(self.saved.lock().unwrap().clone())
        }
        fn save(&self, value: &RestorableRunningSessions) -> Result<(), AppError> {
            *self.saved.lock().unwrap() = value.clone();
            Ok(())
        }
    }

    fn session(session_id: &str, name: Option<&str>) -> RunningSessionByApp {
        let mut base = RunningSession::new(session_id, "windows:pc", 100, 1000);
        base.name = name.map(str::to_string);
        let mut session = RunningSessionByApp::new(
            base,
            std::path::PathBuf::from("/repo"),
            MAIN_WORKTREE_ID,
            1000,
        );
        session.current_permission_mode = Some("plan".to_string());
        session
    }

    fn entry(session_id: &str) -> RestorableRunningSession {
        RestorableRunningSession {
            profile_id: "default".to_string(),
            project: Some("proj-a".to_string()),
            session_id: session_id.to_string(),
            permission_mode: "plan".to_string(),
            model: Some("haiku".to_string()),
            name: Some("実装:APP".to_string()),
            worktree_id: MAIN_WORKTREE_ID.to_string(),
        }
    }

    #[test]
    fn remember_stores_everything_needed_to_resume_and_no_paths() {
        let store = FakeStore::new();

        remember_running_session(
            &store,
            &session("s1", Some("実装:APP")),
            "default",
            Some("proj-a"),
            Some(StartModel::Haiku),
        )
        .unwrap();

        assert_eq!(store.sessions(), vec![entry("s1")]);
    }

    #[test]
    fn remember_keeps_the_current_permission_mode_and_falls_back_before_the_first_init() {
        let store = FakeStore::new();
        let mut before_init = session("s1", None);
        before_init.current_permission_mode = None;

        remember_running_session(&store, &before_init, "default", Some("proj-a"), None).unwrap();

        assert_eq!(store.sessions()[0].permission_mode, "default");
        assert_eq!(store.sessions()[0].model, None);
        assert_eq!(store.sessions()[0].name, None);
    }

    #[test]
    fn a_new_conversation_without_a_file_is_remembered_but_cannot_be_planned() {
        let store = FakeStore::new();

        remember_running_session(&store, &session("s1", None), "default", None, None).unwrap();

        assert_eq!(store.sessions()[0].project, None);
        assert!(matches!(
            plan_restore(&store.sessions()[0]),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn forget_removes_only_the_stopped_conversation() {
        let store = FakeStore::new();
        remember_running_session(
            &store,
            &session("s1", None),
            "default",
            Some("proj-a"),
            None,
        )
        .unwrap();
        remember_running_session(
            &store,
            &session("s2", None),
            "default",
            Some("proj-a"),
            None,
        )
        .unwrap();

        forget_running_session(&store, "s1").unwrap();

        let ids: Vec<String> = store.sessions().into_iter().map(|s| s.session_id).collect();
        assert_eq!(ids, vec!["s2".to_string()]);
    }

    #[test]
    fn a_switch_updates_the_remembered_mode_and_keeps_the_model_as_an_alias() {
        let store = FakeStore::new();
        remember_running_session(
            &store,
            &session("s1", None),
            "default",
            Some("proj-a"),
            Some(StartModel::Haiku),
        )
        .unwrap();

        remember_running_session_switch(
            &store,
            "s1",
            &RunningSessionSwitch::PermissionMode(RunningPermissionMode::Auto),
        )
        .unwrap();
        remember_running_session_switch(
            &store,
            "s1",
            &RunningSessionSwitch::Model("opus".to_string()),
        )
        .unwrap();

        assert_eq!(store.sessions()[0].permission_mode, "auto");
        assert_eq!(store.sessions()[0].model.as_deref(), Some("opus"));
    }

    #[test]
    fn switching_to_a_model_the_app_does_not_know_goes_back_to_the_cli_default() {
        let store = FakeStore::new();
        remember_running_session(
            &store,
            &session("s1", None),
            "default",
            Some("proj-a"),
            Some(StartModel::Haiku),
        )
        .unwrap();

        // CLI の一覧には `default`(= CLI の既定)もある。実際のモデル名も覚えない。
        remember_running_session_switch(
            &store,
            "s1",
            &RunningSessionSwitch::Model("default".to_string()),
        )
        .unwrap();

        assert_eq!(store.sessions()[0].model, None);
    }

    #[test]
    fn a_switch_of_a_forgotten_conversation_does_not_bring_it_back() {
        let store = FakeStore::new();

        remember_running_session_switch(
            &store,
            "s1",
            &RunningSessionSwitch::Model("opus".to_string()),
        )
        .unwrap();

        assert!(store.sessions().is_empty());
    }

    #[test]
    fn sessions_to_restore_is_empty_when_the_setting_is_off() {
        let store = FakeStore::new();
        remember_running_session(
            &store,
            &session("s1", None),
            "default",
            Some("proj-a"),
            None,
        )
        .unwrap();
        let on = domain::Settings::default();
        let off = domain::Settings {
            restore_running_sessions: false,
            ..domain::Settings::default()
        };

        let none = domain::ArchivedSessions::default();
        assert_eq!(sessions_to_restore(&store, &on, &none).unwrap().len(), 1);
        assert!(sessions_to_restore(&store, &off, &none).unwrap().is_empty());
    }

    #[test]
    fn sessions_to_restore_excludes_archived_sessions() {
        // issue #494: 止める前にアーカイブしているので通常は残らないはずだが、念のため
        // 復元の入り口でも除外する。
        let store = FakeStore::new();
        remember_running_session(
            &store,
            &session("s1", None),
            "default",
            Some("proj-a"),
            None,
        )
        .unwrap();
        remember_running_session(
            &store,
            &session("s2", None),
            "default",
            Some("proj-a"),
            None,
        )
        .unwrap();
        let mut archived = domain::ArchivedSessions::default();
        archived.archive("s1");

        let restored =
            sessions_to_restore(&store, &domain::Settings::default(), &archived).unwrap();

        let ids: Vec<&str> = restored.iter().map(|s| s.session_id.as_str()).collect();
        assert_eq!(ids, vec!["s2"]);
    }

    #[test]
    fn plan_restore_maps_the_saved_values_back_to_the_start_request() {
        let planned = plan_restore(&entry("s1")).unwrap();

        assert_eq!(
            planned,
            PlannedRestore {
                profile_id: "default".to_string(),
                project: "proj-a".to_string(),
                session_id: "s1".to_string(),
                mode: RunningPermissionMode::Plan,
                model: Some(StartModel::Haiku),
                name: Some("実装:APP".to_string()),
                worktree: Some(WorktreeSpec::Main),
            }
        );
    }

    #[test]
    fn plan_restore_uses_the_existing_worktree_and_leaves_outside_ones_to_the_conversation_cwd() {
        let outside = plan_restore(&RestorableRunningSession {
            worktree_id: OUTSIDE_WORKTREE_ID.to_string(),
            ..entry("s1")
        })
        .unwrap();
        let in_worktree = plan_restore(&RestorableRunningSession {
            worktree_id: "wt-42".to_string(),
            ..entry("s1")
        })
        .unwrap();

        assert_eq!(outside.worktree, None);
        assert_eq!(
            in_worktree.worktree,
            Some(WorktreeSpec::Existing {
                worktree_id: "wt-42".to_string()
            }),
            "覚えている worktree をそのまま使う(復元では作らない)"
        );
    }

    #[test]
    fn plan_restore_falls_back_to_the_default_mode_for_values_it_does_not_know() {
        let planned = plan_restore(&RestorableRunningSession {
            permission_mode: "将来のモード".to_string(),
            model: Some("将来の別名".to_string()),
            ..entry("s1")
        })
        .unwrap();

        assert_eq!(planned.mode, RunningPermissionMode::Default);
        assert_eq!(planned.model, None);
    }

    #[test]
    fn a_failing_store_is_reported_instead_of_silently_losing_the_list() {
        let store = FakeStore {
            fail_load: true,
            ..FakeStore::new()
        };

        assert!(forget_running_session(&store, "s1").is_err());
        assert!(matches!(
            sessions_to_restore(
                &store,
                &domain::Settings::default(),
                &domain::ArchivedSessions::default()
            ),
            Err(AppError::Io(_))
        ));
    }

    #[test]
    fn a_conversation_that_is_gone_is_not_restored() {
        // 会話ファイルが消えていたら、起こす前に飛ばす(CLI を起動直後に死なせない)。
        struct Source(bool);
        impl crate::SessionSource for Source {
            fn list_projects(&self) -> Result<Vec<domain::Project>, AppError> {
                Ok(Vec::new())
            }
            fn list_sessions(
                &self,
                _project: &str,
            ) -> Result<Vec<domain::SessionSummary>, AppError> {
                Ok(Vec::new())
            }
            fn read_session(
                &self,
                _project: &str,
                _session_id: &str,
            ) -> Result<crate::SessionContent, AppError> {
                Err(AppError::NotFound("unused".to_string()))
            }
            fn session_fingerprint(
                &self,
                _project: &str,
                _session_id: &str,
            ) -> Result<crate::FileFingerprint, AppError> {
                Err(AppError::NotFound("unused".to_string()))
            }
            fn session_cwd(&self, _project: &str, _session_id: &str) -> Result<PathBuf, AppError> {
                if self.0 {
                    Ok(PathBuf::from("/repo"))
                } else {
                    Err(AppError::NotFound("無い".to_string()))
                }
            }
            fn list_parsed_sessions(
                &self,
                _project: &str,
            ) -> Result<Vec<domain::ParsedSession>, AppError> {
                Ok(Vec::new())
            }
            fn session_line_raw(
                &self,
                _project: &str,
                _session_id: &str,
                _uuid: &str,
            ) -> Result<String, AppError> {
                Err(AppError::NotFound("unused".to_string()))
            }
        }
        let planned = plan_restore(&entry("s1")).unwrap();

        assert!(ensure_restorable_conversation(&Source(true), &planned).is_ok());
        assert!(matches!(
            ensure_restorable_conversation(&Source(false), &planned),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn an_exited_session_is_kept_so_the_next_start_can_try_again() {
        // CLI が自分で終わったときは忘れない(利用者の停止のときだけ忘れる)。
        let store = FakeStore::new();
        let mut exited = session("s1", None);
        exited.process_state = ProcessState::Exited;

        remember_running_session(&store, &exited, "default", Some("proj-a"), None).unwrap();

        assert_eq!(store.sessions().len(), 1);
    }
}
