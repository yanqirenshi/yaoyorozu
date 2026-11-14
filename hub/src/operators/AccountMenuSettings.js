import React, { useState } from 'react';

import Box from '@mui/material/Box';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import {Leaf} from '@yanqirenshi/manipulater';

// 吹き出しの枠の色。(src/config/COLORS.js の main。null のときは manipulater の既定の色)
import DOCK_COLOR from './dockColor.js';

import ACCOUNT_MENU_ITEMS, { ACCOUNT_MENU_PAGES, isActive } from '../config/ACCOUNT_MENUS.js';
import { errorMessage, useCollections, usePatchCollectionMutation } from '@yanqirenshi/ihub.core';

// 吹き出しの大きさ
const LEAF_W = 444;
const LEAF_H = 666;
// ボタンと吹き出しの間隔
const BRANCH_H = 33;
// 画面の端からの余白
const MARGIN = 8;

// on/off を保存する、個人の設定のコレクション。(data/local/account_menus.json)
const ACTIVES = 'local/account_menus';

function leafPosition (root) {
    const w_center = root.position.x + (root.size.w / 2);

    const x = Math.min(Math.max(MARGIN, w_center - (LEAF_W / 2)),
                       Math.max(MARGIN, window.innerWidth - LEAF_W - MARGIN * 3));
    const y = Math.max(MARGIN, root.position.y - BRANCH_H - LEAF_H);

    return { x, y };
}

// 選んでいるタブ (ページの label) を sessionStorage に記録するキー。
// 吹き出しを開き直したときも、同じタブを開くために使う。
const TAB_KEY = 'ihub.account-menu-settings.tab';

function loadTab () {
    try {
        return window.sessionStorage.getItem(TAB_KEY) || ACCOUNT_MENU_PAGES[0].label;
    } catch (e) {
        return ACCOUNT_MENU_PAGES[0].label;
    }
}

function saveTab (label) {
    try {
        window.sessionStorage.setItem(TAB_KEY, label);
    } catch (e) {
        // sessionStorage が使えない場合は、記録しないだけにする。
    }
}

function itemKey (page, code) {
    return `${page}/${code}`;
}

// サイドメニューの項目の active (表示/非表示) を切り替える。
// 切り替えた結果は、個人の設定として API サーバーへ保存し、サイドメニューにすぐ反映する。
export default function AccountMenuSettings (props) {
    const root = props.root;

    const actives = useCollections()[ACTIVES];
    const [patchCollection] = usePatchCollectionMutation();

    const [saving, setSaving] = useState(null);
    const [error, setError] = useState(null);
    const [tab, setTab] = useState(loadTab);

    const page = ACCOUNT_MENU_PAGES.find(p=> p.label===tab) || ACCOUNT_MENU_PAGES[0];

    const selectTab = (label)=> {
        setTab(label);
        saveTab(label);
    };

    const toggle = async (page, item)=> {
        const active = !isActive(page, item, actives);
        // 既定値に戻すときは、個人の設定から消す。
        const value = active===(item.active===true) ? null : active;

        setSaving(itemKey(page.label, item.code));
        setError(null);

        try {
            await patchCollection({ name: ACTIVES, patch: { [page.label]: { [item.code]: value } } }).unwrap();
        } catch (e) {
            setError(errorMessage(e, '保存できません。'));
        } finally {
            setSaving(null);
        }
    };

    const { x, y } = leafPosition(root);

    return (
        <Leaf x={x} y={y} w={LEAF_W} h={LEAF_H} theme_color={DOCK_COLOR || undefined}>
          <Box sx={{ height: '100%', boxSizing: 'border-box', p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="h6">サイドメニューの項目</Typography>

            <Tabs value={page.label}
                  onChange={(e, v)=> selectTab(v)}
                  variant="scrollable"
                  sx={{ borderBottom: '1px solid #ddd', minHeight: 40 }}>
              {ACCOUNT_MENU_PAGES.map(p=> (
                  <Tab key={p.label} label={p.label} value={p.label} sx={{ minHeight: 40, textTransform: 'none' }}/>
              ))}
            </Tabs>

            {error && <Typography color="error" sx={{ whiteSpace: 'pre-wrap' }}>{error}</Typography>}

            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {page.items.map(item=> {
                  const menu = ACCOUNT_MENU_ITEMS[item.code];
                  const key = itemKey(page.label, item.code);

                  return (
                      <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Switch size="small"
                                checked={isActive(page, item, actives)}
                                disabled={saving!==null}
                                onChange={()=> toggle(page, item)}
                                slotProps={{ input: { 'aria-label': `${page.label} ${item.code}` } }}/>

                        {menu && <img src={menu.icon} alt="" width={22} height={22}/>}

                        <Typography sx={{ flex: 1 }}>
                          {menu ? menu.label : item.code}
                        </Typography>

                        <Typography sx={{ color: '#888', fontSize: 12 }}>
                          {item.code}
                        </Typography>
                      </Box>
                  );
              })}
            </Box>
          </Box>
        </Leaf>
    );
}
