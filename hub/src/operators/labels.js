import React from 'react';

import Tooltip from '@mui/material/Tooltip';
import MenuIcon from '@mui/icons-material/Menu';

import DOCK_COLOR from './dockColor.js';

// ドックのボタンのアイコン。
// Manipulater の Root は label.type が 'icon' のとき、決まった code のアイコンしか描かない。
// それ以外のアイコンは、ここで描画の直前に差し込む。
const ICONS = {
    menu: MenuIcon,
};

// 選んでいるボタンのアイコンの色。
// 配色の主の色 (src/config/COLORS.js の main)。null のときは Manipulater の既定の色。
const THEME_COLOR = DOCK_COLOR
      ? `rgba(${DOCK_COLOR.r}, ${DOCK_COLOR.g}, ${DOCK_COLOR.b}, 1.0)`
      : 'rgba(8, 156, 163, 1.0)';

// Redux の state には React の部品 (関数) を入れられないので、state には label.code だけを持たせる。
// 描画の直前に、type: 'function' のラベルへ置き換える。
export function withIcons (operators) {
    return {
        ...operators,
        list: operators.list.map(operator=> {
            const label = operator.label;
            const Icon = label.type==='icon' ? ICONS[label.code] : null;

            if (!Icon) return operator;

            const active = operator.code===operators.active;
            const sx = { fontSize: 44, color: active ? THEME_COLOR : '#888' };

            return {
                ...operator,
                label: {
                    type: 'function',
                    code: label.code,
                    text: label.val,
                    replaced: true,
                    val: ()=> active
                        ? <Icon sx={sx}/>
                        : <Tooltip title={label.val}><Icon sx={sx}/></Tooltip>,
                },
            };
        }),
    };
}

// state に保存する前に、withIcons で置き換えたラベルを元に戻す。
export function withoutIcons (operators) {
    return {
        ...operators,
        list: operators.list.map(operator=> {
            const label = operator.label;

            if (!label || !label.replaced) return operator;

            return {
                ...operator,
                label: { type: 'icon', code: label.code, val: label.text },
            };
        }),
    };
}
