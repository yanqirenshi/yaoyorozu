use crate::WindowTab;

/// 1つのウィンドウの表示状態(ハブ化 その1。issue #83)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowState {
    pub label: String,
    pub tabs: Vec<WindowTab>,
    pub active_tab_index: usize,
}
