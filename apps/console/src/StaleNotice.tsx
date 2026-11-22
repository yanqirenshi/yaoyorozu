"use client";

// 「ほかで変更されました」の知らせ。入力中の欄を取り直しで上書きしない代わりに出す
// (`useRefreshGuard` と対)。「取り直す」を押すと、今の入力を捨てて取り直す(呼び出し側が行う)。
export default function StaleNotice({
  onReload,
  message = "ほかで変更されました。入力中の内容は残してあります。",
  disabled = false,
  actionLabel = "取り直す",
}: {
  onReload: () => void;
  message?: string;
  disabled?: boolean;
  actionLabel?: string;
}) {
  return (
    <p className="stale-notice" role="status" data-testid="stale-notice">
      <span>{message}</span>
      <button type="button" onClick={onReload} disabled={disabled}>
        {actionLabel}
      </button>
    </p>
  );
}
