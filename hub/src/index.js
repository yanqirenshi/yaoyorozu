// iHub の入り口。
// 設定 (config) を組み立てて、コア (@yanqirenshi/ihub.core) の <IHub> に渡し、アプリの Router を描く。
// コアからアプリのファイルは import しないので、アプリに固有のものは、すべてここから設定として渡す。
//
// IHub は、bulma と iHub の CSS (@yanqirenshi/ihub.core の index.css) を読むので、ほかの import より先に書く。(CSS の読み込み順を保つため)
import { IHub } from '@yanqirenshi/ihub.core';
import React from 'react';
import ReactDOM from 'react-dom/client';

import Router from './Router.js';
import { PAGES, makePages } from './config/ACCOUNT_MENUS.js';
import ACCOUNT_MENU_COLORS from './config/ACCOUNT_MENU_COLORS.js';
import COLORS from './config/COLORS.js';
import OPERATOR_ITEMS from './config/OPERATOR_ITEMS.js';
import Operators from './operators/Operators.js';
import { withIcons, withoutIcons } from './operators/labels.js';
import NotFoundWbsNodeData from './wbs/NotFoundWbsNodeData.js';
import NotFoundWbsNodeComponent from './wbs/NotFoundWbsNodeComponent.js';
import * as serviceWorkerRegistration from './js/serviceWorkerRegistration';
import reportWebVitals from './js/reportWebVitals';
// アプリのスタイル。ほかの CSS より後に読み、上書きできるようにする。
import './index.css';

// 作り直さないように、モジュールの中で 1 つだけ作る。
const config = {
    // 画面の名前。書き込んだ画面の id を送るヘッダー (X-{name}-Client) にも使う。
    app: { name: 'iHub' },

    // サイドメニュー
    menus: { pages: PAGES, makePages },
    menuColors: ACCOUNT_MENU_COLORS,

    // 配色
    colors: COLORS,

    // ドック
    operators: { items: OPERATOR_ITEMS, Leafs: Operators, labels: { withIcons, withoutIcons } },

    // WBS のノードのページ (src/wbs/)
    // 動的 import は、webpack がこのアプリのフォルダを束ねられるように、アプリ側に置く。
    wbs: {
        page: (path)=> import(`./wbs/${path}.js`),
        NotFoundData: NotFoundWbsNodeData,
        NotFoundComponent: NotFoundWbsNodeComponent,
    },

    // GitHub の個人用アクセストークン
    github: { token: process.env.REACT_APP_GITHU_PARSONAL_TOKEN },
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
      <IHub config={config}>
        <Router/>
      </IHub>
    </React.StrictMode>
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://cra.link/PWA
serviceWorkerRegistration.unregister();

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
