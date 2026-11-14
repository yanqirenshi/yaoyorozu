import React from 'react';

import {Leaf} from '@yanqirenshi/manipulater';

// 吹き出しの枠の色。(src/config/COLORS.js の main。null のときは manipulater の既定の色)
import DOCK_COLOR from './dockColor.js';

export default function Other (props) {
    const root = props.root;

    const sample_width  = 400;
    const sample_height = 300;
    const sample_branch_h = 33;

    const w_center = root.position.x + (root.size.w / 2);

    const x = w_center - (sample_width / 2);
    const y = root.position.y - sample_branch_h - sample_height;

    return (
        <Leaf x={x} y={y} w={sample_width} h={sample_height} theme_color={DOCK_COLOR || undefined}>
        </Leaf>
    );
}
