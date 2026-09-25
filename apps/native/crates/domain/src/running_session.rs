use std::path::PathBuf;

/// いま動いている Claude Code のプロセス1つ(クラス図 `RunningSession`。issue #391)。
/// `~/.claude/sessions/<pid>.json`(と `.key`)が台帳。
///
/// クラス図では抽象クラス(起動元 = app 自身 / 外部で分け尽くされる)。Rust には継承が無いので、
/// **共通のフィールドを持つ struct** にし、サブクラスの [`crate::RunningSessionByApp`] /
/// [`crate::RunningSessionExternal`] がこれを `base` として持つ(コンポジション)形にした
/// (trait にするとフィールドの読み出しが全部メソッドになり、台帳の語彙をそのまま写す
/// 用途に合わないため。判断は PR に記録)。
///
/// 個体指定子は `pid_domain` + `pid` + `started_at`(pid は OS が使い回すので単独では
/// 個体を指定できない)。会話(`Session`)は関係線(`session`)で表し、ここでは
/// `session_id`(R)として持つ。
#[derive(Clone, PartialEq)]
pub struct RunningSession {
    /// この実行中セッションが動かしている会話の ID(`Session` との関連。R)。
    pub session_id: String,
    /// pid が有効な範囲(`<OS>:<ホスト名>`)。
    pub pid_domain: String,
    pub pid: u32,
    /// 起動日時(epoch ms。Claude Code がセッションを始めた時刻)。
    pub started_at: u64,
    /// 生存判定に使う値(OS のプロセス作成時刻)。sdk-cli 起動の台帳には原則書かれない。
    /// 形式も版で違う(FILETIME / .NET tick)ので文字列で持つ。
    pub proc_start: Option<String>,
    pub cwd: Option<PathBuf>,
    /// 台帳の状態(`idle` / `busy`)。app が起動したものの `process_state`(5値)とは別の語彙。
    pub status: Option<String>,
    pub status_updated_at: Option<u64>,
    pub host_session_id: Option<String>,
    pub version: Option<String>,
    pub kind: Option<String>,
    /// `sdk-cli` は ほかの SDK 利用でも同じ値で、起動元の区分には使えない。
    pub entrypoint: Option<String>,
    /// 表示名(`--name`)。会話タイトル(`custom-title`)にも入る。
    pub name: Option<String>,
    pub name_source: Option<String>,
    pub name_since: Option<u64>,
    pub updated_at_time: Option<u64>,
    pub peer_protocol: Option<String>,
    pub messaging_socket_path: Option<PathBuf>,
    pub bridge_session_id: Option<String>,
    /// `.key` にある認証値。**秘匿**: 画面・ログ・`Debug` 出力に出さない(native.md §4)。
    pub peer_token: Option<String>,
    /// ピア機能(TM の多値。属性が1つだけなので値の列として持つ)。
    pub peer_features: Vec<String>,
}

impl RunningSession {
    /// 個体指定子だけを与えて作る(ほかの台帳の語彙は分かったものから埋める)。
    pub fn new(session_id: &str, pid_domain: &str, pid: u32, started_at: u64) -> Self {
        Self {
            session_id: session_id.to_string(),
            pid_domain: pid_domain.to_string(),
            pid,
            started_at,
            proc_start: None,
            cwd: None,
            status: None,
            status_updated_at: None,
            host_session_id: None,
            version: None,
            kind: None,
            entrypoint: None,
            name: None,
            name_source: None,
            name_since: None,
            updated_at_time: None,
            peer_protocol: None,
            messaging_socket_path: None,
            bridge_session_id: None,
            peer_token: None,
            peer_features: Vec::new(),
        }
    }
}

/// `peer_token` は値を出さない(`Some` かどうかだけ)。`{:?}` でログに流れても秘匿値が
/// 漏れないようにするため、`derive(Debug)` にしない。
impl std::fmt::Debug for RunningSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunningSession")
            .field("session_id", &self.session_id)
            .field("pid_domain", &self.pid_domain)
            .field("pid", &self.pid)
            .field("started_at", &self.started_at)
            .field("proc_start", &self.proc_start)
            .field("cwd", &self.cwd)
            .field("status", &self.status)
            .field("status_updated_at", &self.status_updated_at)
            .field("host_session_id", &self.host_session_id)
            .field("version", &self.version)
            .field("kind", &self.kind)
            .field("entrypoint", &self.entrypoint)
            .field("name", &self.name)
            .field("name_source", &self.name_source)
            .field("name_since", &self.name_since)
            .field("updated_at_time", &self.updated_at_time)
            .field("peer_protocol", &self.peer_protocol)
            .field("messaging_socket_path", &self.messaging_socket_path)
            .field("bridge_session_id", &self.bridge_session_id)
            .field(
                "peer_token",
                &self.peer_token.as_ref().map(|_| "<redacted>"),
            )
            .field("peer_features", &self.peer_features)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_output_never_contains_the_peer_token() {
        let mut session = RunningSession::new("s1", "windows:PC", 100, 1);
        session.peer_token = Some("super-secret-token".to_string());

        let printed = format!("{session:?}");

        assert!(!printed.contains("super-secret-token"));
        assert!(printed.contains("<redacted>"));
    }

    #[test]
    fn debug_output_shows_no_token_marker_when_absent() {
        let session = RunningSession::new("s1", "windows:PC", 100, 1);

        assert!(format!("{session:?}").contains("peer_token: None"));
    }
}
