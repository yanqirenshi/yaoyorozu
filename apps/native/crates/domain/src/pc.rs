use crate::User;

/// クラス図(`apps/web` の `/class-diagram`、`classes-domain.ts`)のオブジェクト
/// モデル実装 第1弾(issue #182)。Claude Code を動かしているマシン。
/// フィールド名・構成は `classes-domain.ts` の `Pc` に厳密に合わせる
/// (モデルが正、実装が従)。OSから起動のたびに組み立てるランタイム状態で
/// あり、`WindowState` と同様に永続化しない(真実の源はOS)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pc {
    /// 個体指定子。OS由来のマシン固有値(アプリで採番しない)。
    pub system_uuid: String,
    pub pc_name: String,
    /// 当面は空文字(編集機能は将来)。
    pub description: String,
    /// コンポジション(クラス図の `users`。1..*)。実行時は「このPC・現在の
    /// ユーザー1人」だが、型はクラス図どおり複数ユーザーを許す。
    pub users: Vec<User>,
}
