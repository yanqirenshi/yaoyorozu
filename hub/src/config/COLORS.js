// アプリの配色。
// 4 つの色を、CSS の色 ('#rrggbb') で書く。
// null のときは、それぞれの部品のこれまでの色になる。
//
// どこに使うか (packages/ihub.core/src/manegers/colors.js)
//   base:   画面の背景、CSS のクラス theme-color1〜5
//   main:   文字、MUI の primary、ドックのボタンと吹き出しの枠、サイドメニューの背景、CSS のクラス text-color1
//   sub:    補助の文字 (MUI の text.secondary)、区切りの線、CSS のクラス text-color2
//   accent: 差し色 (MUI の secondary)、CSS のクラス pair-color1〜5
//
// サイドメニューの色は、src/config/ACCOUNT_MENU_COLORS.js で決めたときは、そちらを使う。
//
// iHub の配色は「梅紫と藤鼠」(雅・同系色でまとめる)。
const COLORS = {
    // 地の色。白藤
    base: '#F4F1F6',

    // 主の色。滅紫
    main: '#574C57',

    // 補助の色。藤鼠
    sub: '#A6A5C4',

    // 差し色。梅紫
    accent: '#9D5B8B',
};

export default COLORS;
