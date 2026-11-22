// `/settings`(プロファイルを指定せず、アクティブへ追従する画面)で、アクティブが変わったときに、表示を移してよいかの判断(純粋)。
//
// 保存していない入力があるときは、表示を移さない(入れかけた値が、知らせなく消えるのを防ぐ)。
// 「アクティブなプロファイルが変わりました」と知らせ、利用者が選んだとき(`force`)に移す。入力が無いときは移してよい。
// 保存先は、いつも表示しているプロファイル。

export function shouldHoldDisplay(args: {
  /** プロファイルを指定していない(アクティブへ追従する)か。 */
  followsActive: boolean;
  /** いま表示しているプロファイル(まだ何も読んでいなければ null)。 */
  shownId: string | null;
  /** 取り直した結果の、アクティブなプロファイル。 */
  activeId: string;
  /** 保存していない入力があるか。 */
  dirty: boolean;
  /** 利用者が「移す」を選んだ(入力を捨てて移す)か。 */
  force: boolean;
  /** 表示しているプロファイルが、まだ存在するか(削除されていたら、移すしかない)。 */
  shownStillExists: boolean;
}): boolean {
  const { followsActive, shownId, activeId, dirty, force, shownStillExists } = args;
  return (
    followsActive && !force && dirty && shownStillExists && shownId !== null && shownId !== activeId
  );
}
