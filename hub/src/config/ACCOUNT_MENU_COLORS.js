// サイドメニューの色。
// background が null のときは、配色の主の色 (src/config/COLORS.js の main) を使う。
// それも null のときは、@yanqirenshi/menubook の既定の色 (紫 { r: 157, g: 91, b: 139 } の背景に、白い文字) になる。
const ACCOUNT_MENU_COLORS = {
    // 背景の色。{ r, g, b } (0〜255) で書く。
    // 選択中の項目は白い背景になり、この色を文字の色に使う。
    // iHub は、配色の差し色 (梅紫 #9D5B8B) にする。(menubook の既定の色と同じ)
    background: { r: 157, g: 91, b: 139 },

    // 文字とアイコンの色。CSS の色 ('#2b2b2b' など) で書く。
    // 背景が明るくて、白い文字が読みにくいときにだけ決める。
    // 選択中の項目とページの一覧 (どちらも白い背景) の文字にも使うので、暗い色にする。
    // 決めると、アイコンを白く反転しなくなる。アイコンの色は、ICONS.js の SVG の fill で決まる。(無いときは黒)
    text: null,

    // メニューを開いているときの、アカウントの円 (アバターの周り) の色。CSS の色で書く。
    // null のときは、CSS のクラス pair-color1 の色 (配色の差し色) になる。
    // iHub は、サイドメニューの背景と同じ差し色だと円が見えなくなるので、補助の色 (藤鼠) にする。
    avatar: '#A6A5C4',
};

export default ACCOUNT_MENU_COLORS;
