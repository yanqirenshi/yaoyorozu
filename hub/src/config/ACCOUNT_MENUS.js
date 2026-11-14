import ICONS from './ICONS.js';

const MAIN = [
    // 艦橋のページ。code は、ドックの Z から切り替えた on/off (data/local/account_menus.json) の鍵なので、cockpit のまま。(変えると、保存した設定が効かなくなる)
    { code: 'cockpit',               url: '/',                      label: '艦橋',         icon: ICONS.bridge },
    { code: 'markets',               url: '/markets',               label: '市場',         icon: ICONS.markets },
    { code: 'business',              url: '/business',              label: 'ビジネス',     icon: ICONS.business },
    { code: 'design',                url: '/design',                label: 'デザイン',     icon: ICONS.design },
    { code: 'screens',                url: '/screens',                label: '画面',        icon: ICONS.screens },
    { code: 'api',                   url: '/api',                   label: 'API',          icon: ICONS.api },
    { code: 'batchs',                url: '/batchs',                label: 'バッチ',       icon: ICONS.batchs },
    { code: 'data',                  url: '/data',                  label: 'データ',       icon: ICONS.data },
    { code: 'classes',               url: '/classes',               label: 'クラス',       icon: ICONS.classes },
    { code: 'external-resources',    url: '/external-resources',    label: '外部リソース', icon: ICONS.externalResources },
    { code: 'system-environment',    url: '/system-environment',    label: 'システム構成', icon: ICONS.systemEnvironment },
    { code: 'message',               url: '/message',               label: 'メッセージ',   icon: ICONS.message },
    { code: 'devops',                url: '/devops',                label: '*Ops',         icon: ICONS.devops },
    { code: 'scrum',                 url: '/scrum',                 label: 'Scrum',        icon: ICONS.scrum },
    { code: 'help',                  url: '/help',                  label: 'Help',         icon: ICONS.help },
    { code: 'organizations',         url: '/organizations',         label: '組織',         icon: ICONS.organizations },
];

const UX = [
    { code: 'docs.user-scenario',        url: '/user-scenario',        label: 'ユーザーシナリオ',         icon: ICONS.userScenario },
    { code: 'docs.customer-journey-map', url: '/customer-journey-map', label: 'カスタマージャーニーマップ', icon: ICONS.customerJourneyMap },
    { code: 'docs.use-case',             url: '/use-case',             label: 'ユースケース',             icon: ICONS.useCase },
    { code: 'docs.systemic-design',      url: '/systemic-design',      label: 'Systemic Design',          icon: ICONS.systemicDesign },
    { code: 'docs.bpmn',                 url: '/bpmn',                 label: 'BPMN',                     icon: ICONS.bpmn },
];

const UI = [
    { code: 'docs.ui-design',                 url: '/ui-design',                 label: 'UI Design', icon: ICONS.uiDesign },
    { code: 'docs.screen-transition-diagram', url: '/screen-transition-diagram', label: '画面遷移図', icon: ICONS.screenTransitionDiagram },
];

const APP = [
    { code: 'docs.classes',    url: '/classes',    label: 'Class図',   icon: ICONS.classes },
    { code: 'docs.procedures', url: '/procedures', label: '機能一覧', icon: ICONS.procedures },
];

const MODEL = [
    { code: 'docs.tm',  url: '/tm',  label: 'TM',   icon: ICONS.tm },
    { code: 'docs.er',  url: '/er',  label: 'ER図', icon: ICONS.er },
    { code: 'docs.uml', url: '/uml', label: 'UML',  icon: ICONS.uml },
    { code: 'docs.pad', url: '/pad', label: 'PAD',  icon: ICONS.pad },
];

const Etc = [
    { code: 'system-dynamics', url: '/system-dynamics', label: 'System Dynamics', icon: ICONS.systemDynamics },
    { code: 'ddd',             url: '/ddd',             label: 'DDD',             icon: ICONS.ddd },
    { code: 'wbs',             url: '/wbs',             label: 'WBS',             icon: ICONS.wbs },
    { code: 'account',         url: '/account',         label: 'アカウント',       icon: ICONS.account },
    { code: 'auth',            url: '/auth',            label: '認証',             icon: ICONS.auth },
    { code: 'next.js',         url: '/next.js',         label: 'Next.js',         icon: ICONS.nextJs },
];

const ACCOUNT_MENU_ITEMS = [
    ...MAIN,
    ...UX,
    ...UI,
    ...APP,
    ...MODEL,
    ...Etc,
].reduce((ht, item)=> {
    if (ht[item.code])
        throw new Error('Dupulicate code. code='+item.code);

    ht[item.code] = item;

    return ht;
}, {});

// サイドメニューのページと、表示する項目。
// 先頭のページを、初めに開く。ページの名前 (label) は、アプリに合わせて変えてよい。
// active は表示するかどうかの既定値。
// ドックの Z から切り替えた on/off は、個人の設定として data/local/account_menus.json に保存し、既定値より優先する。
export const ACCOUNT_MENU_PAGES = [
    {
        label: 'iHub',
        items: [
            { code: 'cockpit',                        active: true },
            { code: 'markets',                        active: true },
            { code: 'business',                       active: true },
            { code: 'design',                         active: true },
            { code: 'screens',                        active: true },
            { code: 'api',                            active: true },
            { code: 'batchs',                         active: true },
            { code: 'data',                           active: true },
            { code: 'classes',                        active: true },
            { code: 'external-resources',             active: true },
            { code: 'system-environment',             active: true },
            { code: 'message',                        active: true },
            { code: 'devops',                         active: true },
            { code: 'scrum',                          active: true },
            { code: 'organizations',                  active: true },
            { code: 'wbs',                            active: true },
            { code: 'help',                           active: true },
        ],
    },
    {
        label: 'Docs',
        items: [
            // ux
            { code: 'docs.user-scenario',             active: true },
            { code: 'docs.customer-journey-map',      active: true },
            { code: 'docs.use-case',                  active: true },
            { code: 'docs.systemic-design',           active: true },
            { code: 'docs.bpmn',                      active: true },
            // ui
            { code: 'docs.ui-design',                 active: true },
            { code: 'docs.screen-transition-diagram', active: true },
            // Application
            { code: 'docs.classes',                   active: true },
            { code: 'docs.procedures',                active: true },
            // Model
            { code: 'docs.tm',                        active: true },
            { code: 'docs.er',                        active: true },
            { code: 'docs.uml',                       active: true },
            { code: 'docs.pad',                       active: true },
        ],
    },
    {
        label: 'Etc',
        items: [
            { code: 'system-dynamics',                active: true },
            { code: 'ddd',                            active: true },
            { code: 'wbs',                            active: true },
            { code: 'account',                        active: true },
            { code: 'auth',                           active: true },
            { code: 'next.js',                        active: true },
        ],
    },
];

// 項目を表示するかどうか。
// actives は個人の設定 ({ ページの label: { 項目の code: true/false } }) で、無い項目は既定値 (active) を使う。
export function isActive (page, item, actives) {
    const value = actives?.[page.label]?.[item.code];

    return typeof value === 'boolean' ? value : item.active === true;
}

// 表示する項目だけを並べた、サイドメニューのページを作る。
export function makePages (actives = {}) {
    return ACCOUNT_MENU_PAGES.map(page=> ({
        label: page.label,
        items: page.items
            .filter(item=> isActive(page, item, actives))
            .map(item=> ACCOUNT_MENU_ITEMS[item.code]),
    }));
}

// 既定値だけで作ったページ。(個人の設定を読み込む前に使う)
export const PAGES = makePages();

export default ACCOUNT_MENU_ITEMS;
