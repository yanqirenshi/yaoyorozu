use std::path::PathBuf;

/// クラス図(`classes-domain.ts`)の `LogLine` の共通属性(オブジェクトモデル
/// 実装 第6弾。issue #208)。`uuid`/`parent_uuid`で親子チェーンを構成する。
/// `UserLogLine`/`AssistantLogLine`/`SystemLogLine`/`AttachmentLogLine` の
/// 各サブクラスが `base: LogLineBase` として埋め込む(クラス図の抽象クラス
/// `LogLine` を、Rustでは継承ではなく埋め込みstructで表現する。issue本文の
/// 指示どおり)。
///
/// `session_line::ChainLineBase`(既存のjsonlパース用DTO)と属性名は重なるが
/// 別物: あちらは`timestamp: Option<String>`(生のISO8601文字列)を持つ
/// serdeデシリアライズ専用の構造体で、こちらはクラス図どおり
/// `timestamp: u64`(epoch ms。変換は
/// [`super::parse_iso_timestamp_to_epoch_ms`](crate::parse_iso_timestamp_to_epoch_ms)
/// が担う)を持つドメインモデルの値である。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogLineBase {
    /// 個体指定子。行UUID。
    pub uuid: String,
    /// 物理チェーンの親。
    pub parent_uuid: Option<String>,
    /// 論理チェーンの親(`compact_boundary`で圧縮前の末尾)。
    pub logical_parent_uuid: Option<String>,
    pub timestamp: u64,
    pub cwd: Option<PathBuf>,
    pub entrypoint: Option<String>,
    pub version: Option<String>,
    pub git_branch: Option<String>,
    pub is_sidechain: Option<bool>,
    pub user_type: Option<String>,
}
