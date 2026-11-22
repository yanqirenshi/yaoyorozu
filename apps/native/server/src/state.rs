//! 状態の唯一の置き場(Tauri 版 `AppState` の写し。段階 2 に要る分だけ)。
//! `tauri/src/state.rs` から写した: `resolve_effective_projects_dir`・`store_loaded_session`。

use crate::dto::PendingWarningDto;
use domain::{GitLedger, LogLine, Settings};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

/// 設定の `claude_projects_dir` と既定値(`~/.claude/projects/`)から、実際に使うルートを求める。
///
/// すでに保存されている上書き値が不正(相対・UNC・`..`・制御文字入りなど。古い版や手書きで入った値)
/// なら、起動は止めず、**この値を起点にした読み書きだけを断る**(`InvalidInput`)。画面で直せるように、
/// 設定の取得(`get_settings`)は [`describe_effective_projects_dir`] を使う。
pub fn resolve_effective_projects_dir(settings: &Settings) -> Result<PathBuf, app::AppError> {
    if let Some(dir) = settings.claude_projects_dir.as_deref() {
        crate::folders::guard_folder_path(&dir.to_string_lossy()).map_err(|e| match e {
            app::AppError::InvalidInput(why) => app::AppError::InvalidInput(format!(
                "保存されているセッションのルートのパスが不正です(設定で直してください): {why}"
            )),
            other => other,
        })?;
    }
    let default = infra::FileSystemRepository::default_projects_dir()?;
    Ok(domain::effective_projects_dir(
        settings.claude_projects_dir.as_deref(),
        &default,
    ))
}

/// ファイルの指紋(サイズ, 先頭の中身の指紋。`dismissed::fingerprint`)。変わったかの判定に使う(更新時刻は使わない)。
pub type FileFingerprint = (u64, u64);

/// 「飛ばした会話ファイル」の警告 1 件の、対象のファイル。
#[derive(Clone, Debug)]
pub struct SkipSource {
    pub project: String,
    pub file_name: String,
    pub fingerprint: FileFingerprint,
}

/// 途中経過の購読 1 件。**接続の ID と購読の ID だけ**を持つ(送り先の実体は `progress::Connections` が持つ。
/// 状態のロックの中で、送り先を触らないため)。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Subscription {
    pub id: u64,
    pub conn_id: String,
}

/// 進行中のターンの、ここまでの途中経過(連番つき)。凍結されたタブ・切り替えたあとの会話が、ターンの途中から表示を始められるように、
/// `get_running_session` が返す。ターンが終わったら捨てる(確定した内容は会話ファイルにある)。
/// 大きくなりすぎたら、古いほうから捨てる(画面は、残った分から続きを足す)。
#[derive(Default, Clone, Debug)]
pub struct TurnBuffer {
    events: std::collections::VecDeque<(u64, crate::dto::ProgressEventDto)>,
    bytes: usize,
}

impl TurnBuffer {
    /// 件数の上限と、大きさ(JSON にしたときの文字数)の上限。
    pub const MAX_EVENTS: usize = 20_000;
    pub const MAX_BYTES: usize = 2 * 1024 * 1024;

    /// 途中経過 1 件を足す。ターンの終わり(`finished`)なら、全部捨てる。
    pub fn record(&mut self, seq: u64, event: crate::dto::ProgressEventDto, finished: bool) {
        if finished {
            self.events.clear();
            self.bytes = 0;
            return;
        }
        let size = serde_json::to_string(&event).map(|s| s.len()).unwrap_or(0) + 16;
        self.events.push_back((seq, event));
        self.bytes += size;
        while self.events.len() > Self::MAX_EVENTS || self.bytes > Self::MAX_BYTES {
            let Some((_, dropped)) = self.events.pop_front() else {
                break;
            };
            let dropped_size = serde_json::to_string(&dropped)
                .map(|s| s.len())
                .unwrap_or(0)
                + 16;
            self.bytes = self.bytes.saturating_sub(dropped_size);
        }
    }

    pub fn snapshot(&self) -> Vec<crate::dto::TurnEventDto> {
        self.events
            .iter()
            .map(|(seq, event)| crate::dto::TurnEventDto {
                seq: *seq,
                event: event.clone(),
            })
            .collect()
    }

    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }
}

/// サーバが起動して持っている実行中セッション 1 つ(Tauri 版 `RunningSessionSlot` の写し)。
pub struct RunningSessionSlot {
    /// このセッションが送り出した途中経過の最後の番号(1 から。送るたびに 1 増える)。取り直し(`get_running_session`)が
    /// 「ここまで」として返し、画面が重なり・順番の崩れを番号で見分ける。
    pub progress_seq: u64,
    /// 会話ファイルのあるプロジェクトフォルダ名。再開のときだけ(新規は会話ファイルができるまで分からない)。
    pub project: Option<String>,
    pub session: domain::RunningSessionByApp,
    /// 子プロセスの操作口(標準入力への書き込み・中断・停止)。
    pub process: Arc<dyn app::RunningProcess>,
    /// CLI が報告した、選べるモデル。
    pub available_models: Vec<app::AvailableModel>,
    /// 途中経過の購読(購読が無い間の出来事は捨てる。状態・答え待ちは Query で取れる)。
    pub subscribers: Vec<Subscription>,
    /// 進行中のターンの、ここまでの途中経過(連番つき)。
    pub turn_events: TurnBuffer,
}

pub struct ServerState {
    pub settings: Settings,
    pub save_path: PathBuf,
    /// 起動時の設定読み込みが既定値へ復旧した(issue #538)直後、まだ一度も保存していないか。
    /// 真の間は、次の保存が上書きする前に今のファイルの複製を残す。
    pub settings_recovery_pending: bool,
    /// 起動直後に出て取りこぼした警告の控え(`list_pending_warnings`)。
    pub warnings: Vec<PendingWarningDto>,
    pub next_warning_id: u64,
    /// 「飛ばした会話ファイル」の警告(控えの id → 対象のファイルと、そのときのファイルの状態)。
    pub skip_sources: HashMap<u64, Vec<SkipSource>>,
    /// 閉じられた「飛ばした会話ファイル」の警告(プロジェクト, ファイル名 → 閉じたときのファイルの状態)。
    /// **そのファイルが変わるまで**、同じ警告を出さない。
    pub dismissed_skips: HashMap<(String, String), FileFingerprint>,
    /// セッションを開いたときに組み立てた `LogLine` のキャッシュ(会話ファイルのパスがキー)。
    pub loaded_log_lines: HashMap<PathBuf, Vec<LogLine>>,
    /// 解析済みメッセージのキャッシュ(issue #350)。ファイルの状態とセットで持つ。
    pub loaded_messages: HashMap<PathBuf, app::CachedMessages>,
    /// 起動した実行中セッション。終了しても、同じ会話を起動し直して置き換えるか、上限を超えて忘れるまで残す。
    pub running_sessions: Vec<RunningSessionSlot>,
    /// 起動している最中の会話の ID(起動は数秒かかりうるので、同じ会話・上限超えの同時の起動を止める)。
    pub starting_session_ids: Vec<String>,
    /// 途中経過の購読 ID の連番。
    pub next_subscription_id: u64,
    /// Claude.ai の利用状況(アカウント単位。最後に取れた値)。
    pub claude_usage: app::ClaudeUsageSnapshot,
    /// 利用状況の定期取得が動いているか。
    pub usage_polling_active: bool,
    /// Git 台帳(最小。`git-ledger.json`。worktree の ID と実体の対応に使う)。
    pub git_ledger: GitLedger,
    pub git_ledger_path: PathBuf,
    /// 現在の PC・ログインユーザー。`users[].sessions` は、ここに**常駐**する(素材 `user_sessions` が変わったとき、
    /// `app::refresh_user_sessions` で更新する。`get_pc` は組み立てをしない)。起動直後は会話が空で、走査キューが埋める。
    pub pc: domain::Pc,
    /// 全プロジェクトを走査した `ParsedSession` の一覧(走査キューが埋める。永続化しない)。
    pub user_sessions: Vec<domain::ParsedSession>,
    /// `git_ledger`・`user_sessions` の読み込みが完了したか(`get_pc` の `data_loaded`)。起動時は `false`。
    pub pc_data_loaded: bool,
    /// 走査キューの世代番号。キューが始まるたびに増え、走っているものは、適用の前に自分の世代と比べる。
    pub session_scan_generation: u64,
    /// ファイル監視が検知した会話ファイルの変更の待ち行列(ハブの自動更新)。
    pub session_rescan: app::RescanQueue,
    /// 「git の観測 → 全件の走査」が走っているか(二重に走らせない)。
    pub reload_running: bool,
}

impl ServerState {
    pub fn new(settings: Settings, save_path: PathBuf, recovered_from_corruption: bool) -> Self {
        Self {
            settings,
            save_path,
            settings_recovery_pending: recovered_from_corruption,
            warnings: Vec::new(),
            next_warning_id: 1,
            skip_sources: HashMap::new(),
            dismissed_skips: HashMap::new(),
            loaded_log_lines: HashMap::new(),
            loaded_messages: HashMap::new(),
            running_sessions: Vec::new(),
            starting_session_ids: Vec::new(),
            next_subscription_id: 1,
            claude_usage: app::ClaudeUsageSnapshot::default(),
            usage_polling_active: false,
            git_ledger: GitLedger::default(),
            git_ledger_path: PathBuf::new(),
            // 実際の値は、起動のとき(`main`)に OS から作って差し替える。
            pc: domain::Pc {
                system_uuid: String::new(),
                pc_name: String::new(),
                description: String::new(),
                users: Vec::new(),
            },
            user_sessions: Vec::new(),
            pc_data_loaded: false,
            session_scan_generation: 0,
            session_rescan: app::RescanQueue::default(),
            reload_running: false,
        }
    }

    /// 警告を控えに積む。戻り値は割り当てた ID。
    pub fn push_warning(&mut self, kind: &str, message: String) -> u64 {
        let id = self.next_warning_id;
        self.next_warning_id += 1;
        self.warnings.push(PendingWarningDto {
            id,
            kind: kind.to_string(),
            message,
        });
        id
    }

    /// 同じ内容の警告が控えに無いときだけ積む(積んだら割り当てた ID を返す)。同じ内容を何度も出さない。
    pub fn push_warning_once(&mut self, kind: &str, message: String) -> Option<u64> {
        if self
            .warnings
            .iter()
            .any(|w| w.kind == kind && w.message == message)
        {
            return None;
        }
        Some(self.push_warning(kind, message))
    }

    /// 「飛ばした会話ファイル」の警告を積む。同じプロジェクトの前の同種の警告は、置き換える(対象が変わるため)。
    /// 同じ内容がすでにあるときは積まない(`None`)。
    pub fn push_skip_warning(
        &mut self,
        project: &str,
        message: String,
        sources: Vec<SkipSource>,
    ) -> Option<u64> {
        if self
            .warnings
            .iter()
            .any(|w| w.kind == "app:warning" && w.message == message)
        {
            return None;
        }
        // 同じプロジェクトの、前の「飛ばした」警告(対象のファイルが変わった・直った)を取り除く。
        let stale: Vec<u64> = self
            .skip_sources
            .iter()
            .filter(|(_, v)| v.iter().all(|s| s.project == project))
            .map(|(id, _)| *id)
            .collect();
        for id in stale {
            self.skip_sources.remove(&id);
            self.warnings.retain(|w| w.id != id);
        }
        let id = self.push_warning("app:warning", message);
        self.skip_sources.insert(id, sources);
        Some(id)
    }

    /// 警告を閉じる。「飛ばした会話ファイル」の警告なら、そのファイルが変わるまで同じ警告を出さない。
    pub fn dismiss_warning(&mut self, id: u64) {
        self.warnings.retain(|w| w.id != id);
        if let Some(sources) = self.skip_sources.remove(&id) {
            for s in sources {
                self.dismissed_skips
                    .insert((s.project, s.file_name), s.fingerprint);
            }
        }
    }

    /// 閉じた(または閉じられた)接続の購読を、全部外す。
    pub fn drop_connection_subscriptions(&mut self, conn_ids: &[String]) {
        if conn_ids.is_empty() {
            return;
        }
        for slot in &mut self.running_sessions {
            slot.subscribers.retain(|s| !conn_ids.contains(&s.conn_id));
        }
    }

    /// 読み直した会話をキャッシュへ入れる(遅れて終わった古い読みが新しいキャッシュを
    /// 上書きしないよう、置き換えてよいかは `app::should_replace_cache` で判断する)。
    pub fn store_loaded_session(&mut self, path: PathBuf, reloaded: app::ReloadedSession) {
        if !app::should_replace_cache(self.loaded_messages.get(&path), &reloaded.messages) {
            return;
        }
        self.loaded_log_lines.insert(path.clone(), reloaded.lines);
        self.loaded_messages.insert(path, reloaded.messages);
    }
}

/// 設定画面に出す「実際に使うセッションのルート」。上書き値が不正でも失敗させず、その値をそのまま
/// 見せる(画面で直せるように。読み書きは [`resolve_effective_projects_dir`] が断る)。
pub fn describe_effective_projects_dir(settings: &Settings) -> Result<String, app::AppError> {
    match resolve_effective_projects_dir(settings) {
        Ok(dir) => Ok(dir.display().to_string()),
        Err(app::AppError::InvalidInput(_)) => Ok(settings
            .claude_projects_dir
            .as_deref()
            .map(|p| p.display().to_string())
            .unwrap_or_default()),
        Err(other) => Err(other),
    }
}
