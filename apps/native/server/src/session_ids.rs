//! 会話 ID の正規の形(小文字)を、1 か所で決める。
//!
//! 会話 ID は、比べるとき・控えやアーカイブの印に書くとき・claude へ渡すときの、**すべてで同じ値**を使う
//! (大文字小文字だけが違う同じ会話が、別の会話として扱われない)。入口(`archive_session` などの会話 ID を受け取る
//! command・`start_running_session`)で小文字にそろえ、すでにファイルにある控え・印は、読む前にそろえて 1 行にまとめる。

use std::path::Path;

/// 会話 ID の正規の形(小文字)。
pub fn canonical(session_id: &str) -> String {
    session_id.to_ascii_lowercase()
}

/// 小文字にそろえて、同じ ID を 1 つにまとめる(最初のものを残す)。変わったら `true`。
fn dedupe_lowercase(ids: &mut Vec<String>) -> bool {
    let before = ids.clone();
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(ids.len());
    for id in ids.drain(..) {
        let id = canonical(&id);
        if seen.insert(id.clone()) {
            out.push(id);
        }
    }
    *ids = out;
    *ids != before
}

/// データフォルダの再開の控え(`running-sessions.json`)とアーカイブの印(`archived-sessions.json`)に、
/// 大文字を含む会話 ID があれば、小文字にそろえて書き戻す。大文字小文字だけが違う同じ会話の行は、1 行にまとめる
/// (最初の行を残す)。読めない・形が違うファイルには触らない(退避は、読む側のストアが行う)。
/// 保存のレーン(`store_lane`)を持った状態で呼ぶ。
pub fn normalize_stores(data_dir: &Path) {
    normalize_restorable(&data_dir.join("running-sessions.json"));
    normalize_archived(&data_dir.join("archived-sessions.json"));
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn write_json(path: &Path, value: &serde_json::Value) {
    let Ok(text) = serde_json::to_string_pretty(value) else {
        return;
    };
    if let Err(e) = crate::data_files::write_atomic(path, text.as_bytes()) {
        eprintln!("会話 ID をそろえた控えを保存できませんでした: {e}");
    }
}

fn normalize_restorable(path: &Path) {
    let Some(mut value) = read_json(path) else {
        return;
    };
    let Some(sessions) = value.get_mut("sessions").and_then(|s| s.as_array_mut()) else {
        return;
    };
    let needs = sessions.iter().any(|s| {
        s.get("session_id")
            .and_then(|id| id.as_str())
            .is_some_and(|id| id.chars().any(|c| c.is_ascii_uppercase()))
    });
    if !needs {
        return;
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(sessions.len());
    for mut entry in sessions.drain(..) {
        let Some(id) = entry
            .get("session_id")
            .and_then(|id| id.as_str())
            .map(canonical)
        else {
            out.push(entry);
            continue;
        };
        if seen.insert(id.clone()) {
            entry["session_id"] = serde_json::Value::String(id);
            out.push(entry);
        }
    }
    *sessions = out;
    write_json(path, &value);
}

fn normalize_archived(path: &Path) {
    let Some(mut value) = read_json(path) else {
        return;
    };
    let Some(ids) = value.get("session_ids").and_then(|s| s.as_array()) else {
        return;
    };
    let mut list: Vec<String> = ids
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    if list.len() != ids.len() || !dedupe_lowercase(&mut list) {
        return;
    }
    value["session_ids"] = serde_json::json!(list);
    write_json(path, &value);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_is_lowercase() {
        assert_eq!(canonical("0A1B-FF"), "0a1b-ff");
    }

    #[test]
    fn two_rows_differing_only_in_case_become_one() {
        let dir = tempfile::tempdir().unwrap();
        let restorable = dir.path().join("running-sessions.json");
        std::fs::write(
            &restorable,
            r#"{"version":1,"sessions":[
                {"profile_id":"p","project":"x","session_id":"ABC-1","permission_mode":"default","model":null,"name":"first","worktree_id":"main-worktree"},
                {"profile_id":"p","project":"x","session_id":"abc-1","permission_mode":"plan","model":null,"name":"second","worktree_id":"main-worktree"},
                {"profile_id":"p","project":"x","session_id":"def-2","permission_mode":"default","model":null,"name":null,"worktree_id":"main-worktree"}
            ]}"#,
        )
        .unwrap();
        let archived = dir.path().join("archived-sessions.json");
        std::fs::write(
            &archived,
            r#"{"version":1,"session_ids":["ABC-1","abc-1","Def-2"]}"#,
        )
        .unwrap();

        normalize_stores(dir.path());

        let sessions: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&restorable).unwrap()).unwrap();
        let ids: Vec<&str> = sessions["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["session_id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["abc-1", "def-2"]);
        assert_eq!(sessions["sessions"][0]["name"], "first", "最初の行を残す");
        let marks: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&archived).unwrap()).unwrap();
        assert_eq!(marks["session_ids"], serde_json::json!(["abc-1", "def-2"]));
    }

    #[test]
    fn already_lowercase_files_are_not_rewritten_and_broken_ones_are_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let restorable = dir.path().join("running-sessions.json");
        std::fs::write(&restorable, r#"{"version":1,"sessions":[]}"#).unwrap();
        let archived = dir.path().join("archived-sessions.json");
        std::fs::write(&archived, "壊れた").unwrap();
        normalize_stores(dir.path());
        assert_eq!(
            std::fs::read_to_string(&restorable).unwrap(),
            r#"{"version":1,"sessions":[]}"#
        );
        assert_eq!(std::fs::read_to_string(&archived).unwrap(), "壊れた");
    }
}
