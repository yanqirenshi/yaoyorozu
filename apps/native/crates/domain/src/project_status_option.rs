/// GitHub Projects(v2)のStatusフィールドの選択肢。かんばんのカラム定義に
/// 使うほか、`id` はStatus変更mutationの `optionId` に使う(issue #50)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectStatusOption {
    pub id: String,
    pub name: String,
}
