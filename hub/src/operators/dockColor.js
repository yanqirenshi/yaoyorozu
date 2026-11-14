import COLORS from '../config/COLORS.js';
import { manegers } from '@yanqirenshi/ihub.core';

// ドックのボタンと吹き出しの色。({ r, g, b })
// 配色の主の色 (src/config/COLORS.js の main)。決めていないときは null。
const DOCK_COLOR = manegers.colors.dockColor(COLORS);

export default DOCK_COLOR;
