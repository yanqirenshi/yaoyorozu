// メッセージの `timestamp`(ISO 8601)を、ローカル時刻の `yyyy-mm-dd hh:mm:ss`
// に整形する(表示用。issue #258)。空・不正な値は `null`(呼び出し側は
// プレースホルダを出さず、何も表示しない)。
export function formatTimestamp(iso: string): string | null {
  if (iso === "") return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
