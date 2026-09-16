use crate::ClaudeDirEntry;

/// ディレクトリ直下の一覧の1ページ分。`total` はページング前の件数。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeDirPage {
    pub entries: Vec<ClaudeDirEntry>,
    pub total: usize,
}
