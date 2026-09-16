/// `~/.claude` 配下のエントリの種別(/claude 画面のExplorerタブ)。
/// シンボリックリンク(Windowsのジャンクションを含む)は `~/.claude` の外を
/// 指しうるため辿らず、展開できない葉として扱う。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaudeDirEntryKind {
    Directory,
    File,
    Symlink,
}

/// `~/.claude` 配下のエントリ1件分(Explorerタブの1行)。名前・種別・サイズ・
/// 更新日時のみを持ち、内容は持たない(`.credentials.json` 等の秘匿情報を
/// 含むファイルがあるため、中身を読む経路は作らない)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeDirEntry {
    pub name: String,
    /// `~/.claude` からの相対パス(区切りは `/`)。ディレクトリを展開する際、
    /// 子の一覧取得の引数としてフロントがそのまま送り返す。
    pub path: String,
    pub kind: ClaudeDirEntryKind,
    /// ファイルのみ。ディレクトリ・リンクは `None`。
    pub size_bytes: Option<u64>,
    pub modified_at_ms: u64,
}

/// 親の相対パスとエントリ名から子の相対パスを組み立てる(ルートは空文字列)。
pub fn join_claude_dir_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

/// Explorerの表示順に並べる: ディレクトリを先に、同種内は名前の昇順
/// (大文字小文字を区別しない。同じになる場合のみ区別して順序を確定させる)。
pub fn sort_claude_dir_entries(entries: &mut [ClaudeDirEntry]) {
    entries.sort_by(|a, b| {
        let a_is_dir = a.kind == ClaudeDirEntryKind::Directory;
        let b_is_dir = b.kind == ClaudeDirEntryKind::Directory;
        b_is_dir
            .cmp(&a_is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_claude_dir_path_joins_with_slash() {
        assert_eq!(join_claude_dir_path("", "projects"), "projects");
        assert_eq!(join_claude_dir_path("projects", "foo"), "projects/foo");
        assert_eq!(
            join_claude_dir_path("projects/foo", "a.jsonl"),
            "projects/foo/a.jsonl"
        );
    }

    fn claude_dir_entry(name: &str, kind: ClaudeDirEntryKind) -> ClaudeDirEntry {
        ClaudeDirEntry {
            name: name.to_string(),
            path: name.to_string(),
            kind,
            size_bytes: None,
            modified_at_ms: 0,
        }
    }

    #[test]
    fn sort_claude_dir_entries_puts_directories_first_then_names_case_insensitively() {
        let mut entries = vec![
            claude_dir_entry("b.json", ClaudeDirEntryKind::File),
            claude_dir_entry("Zeta", ClaudeDirEntryKind::Directory),
            claude_dir_entry("A.md", ClaudeDirEntryKind::File),
            claude_dir_entry("link", ClaudeDirEntryKind::Symlink),
            claude_dir_entry("alpha", ClaudeDirEntryKind::Directory),
        ];

        sort_claude_dir_entries(&mut entries);

        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "Zeta", "A.md", "b.json", "link"]);
    }
}
