// `/settings`(プロファイルを指定せず、アクティブへ追従する画面)で、アクティブが変わった・表示中のプロファイルが削除された
// ときに、表示を移してよいかの判断(純粋)。
//
// 入力中(未保存の入力がある)・または、保存した直後(`touched`: 入力か保存の操作をしたあと、利用者が移ると選ぶまで)は、
// 表示を移さない(入れかけた値・「保存しました」が、知らせなく別のプロファイルへ移るのを防ぐ)。知らせを出し、利用者が選んだとき
// (`force`)に、確かめを 1 回はさんで移る。何も操作していないときは、移してよい。保存先は、いつも表示しているプロファイル。

export type HoldReason = "active-changed" | "deleted";

export function holdReason(args: {
  /** プロファイルを指定していない(アクティブへ追従する)か。 */
  followsActive: boolean;
  /** いま表示しているプロファイル(まだ何も読んでいなければ null)。 */
  shownId: string | null;
  /** 取り直した結果の、アクティブなプロファイル。 */
  activeId: string;
  /** 保存していない入力があるか。 */
  dirty: boolean;
  /** 入力か保存の操作をした(利用者が移ると選ぶまで、移さない)か。 */
  touched: boolean;
  /** 利用者が「移る」を選んだ(入力を捨てて移す)か。 */
  force: boolean;
  /** 表示しているプロファイルが、まだ存在するか。 */
  shownStillExists: boolean;
}): HoldReason | null {
  const { followsActive, shownId, activeId, dirty, touched, force, shownStillExists } = args;
  if (!followsActive || force || shownId === null) return null;
  if (!shownStillExists) {
    // 表示中のプロファイルが削除された。入力が残っているなら、確かめなしに消さない。
    return dirty ? "deleted" : null;
  }
  return (dirty || touched) && shownId !== activeId ? "active-changed" : null;
}

/** 表示を移さないか(`holdReason` が理由を返すか)。 */
export function shouldHoldDisplay(args: Parameters<typeof holdReason>[0]): boolean {
  return holdReason(args) !== null;
}
