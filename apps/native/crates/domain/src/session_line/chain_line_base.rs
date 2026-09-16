use serde::Deserialize;

/// 会話チェーンを構成する行(`user`/`assistant`/`system`/`attachment`)の
/// 共通フィールド。実データでは常に揃っているが、将来のバージョンでの
/// 増減に備えてすべて `Option` + `#[serde(default)]` にする。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ChainLineBase {
    pub uuid: Option<String>,
    pub parent_uuid: Option<String>,
    pub is_sidechain: Option<bool>,
    pub session_id: Option<String>,
    pub timestamp: Option<String>,
    pub cwd: Option<String>,
    pub entrypoint: Option<String>,
    pub version: Option<String>,
    pub git_branch: Option<String>,
    pub user_type: Option<String>,
    pub slug: Option<String>,
    pub agent_id: Option<String>,
}
