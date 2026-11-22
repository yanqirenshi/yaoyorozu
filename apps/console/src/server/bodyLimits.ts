// 中継(`app/api/[...path]/route.ts`)が、サーバの本文の上限を先に確かめるための値。
//
// なぜ: 上限を超える本文を、そのままサーバへ送ると、サーバが本文の途中で 413 を返して接続を閉じ、送っている側の fetch が
// 失敗して、中継が「サーバに接続できません」(503)を返すことがある(大きい画像で、ときどき)。中継が先に大きさを見て、
// 上限を超えるものはサーバへ送らずに 413 を返す。
//
// 数字は、サーバ(`apps/native/server/src/rpc/mod.rs`)の上限と同じ。サーバが正で、ここは写し
// (一致は `tests/bodyLimits.test.ts` が、Rust のソースを読んで確かめる)。

/** ふつうの command(axum の既定 2MB)。 */
export const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024;

/** `check_image_attachment`(`IMAGE_CHECK_BODY_LIMIT`)。 */
export const IMAGE_CHECK_BODY_LIMIT = 6 * 1024 * 1024;

/** `send_to_running_session`(`SEND_BODY_LIMIT`)。 */
export const SEND_BODY_LIMIT = 26 * 1024 * 1024;

/** 中継する先(`rpc/<command>` など)の、本文の上限(バイト)。 */
export function bodyLimitFor(target: string): number {
  switch (target) {
    case "rpc/check_image_attachment":
      return IMAGE_CHECK_BODY_LIMIT;
    case "rpc/send_to_running_session":
      return SEND_BODY_LIMIT;
    default:
      return DEFAULT_BODY_LIMIT;
  }
}
