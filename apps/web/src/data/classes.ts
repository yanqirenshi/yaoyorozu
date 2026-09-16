/**
 * `/class-diagram` に描く1枚の図。図ごとのデータファイルを重ねる。
 *
 * - `classes-domain.ts`: YAOYOROZU のドメインのオブジェクトモデル(原点付近)
 * - `classes-session-line.ts`: セッションログ1行の型構造(Labo試作。x 負側に退避)
 * - `classes-native-prototype.ts`: domain クレートに実装済みの、まだオブジェクト
 *   モデルへ置き換えられていない型(プロトタイプ期の型。x 正側、ドメインモデルの
 *   さらに右)
 * - `classes-infra.ts`: infra クレートの型と、それが実現する app の port(trait)。
 *   x 正側、`classes-native-prototype.ts` のさらに下
 *
 * どちらも座標は同じ平面上にあるので、新しい図を足すときは既存の図と重ならない
 * 位置に置く。
 */
import type { DiagramInput } from "@yanqirenshi/d3.classes";
import { mergeDiagrams } from "./classDiagram";
import { DOMAIN_CLASS_DATA } from "./classes-domain";
import { SESSION_LINE_CLASS_DATA } from "./classes-session-line";
import { NATIVE_PROTOTYPE_CLASS_DATA } from "./classes-native-prototype";
import { INFRA_CLASS_DATA } from "./classes-infra";

export const CLASS_DIAGRAM_DATA: DiagramInput = mergeDiagrams(
  DOMAIN_CLASS_DATA,
  SESSION_LINE_CLASS_DATA,
  NATIVE_PROTOTYPE_CLASS_DATA,
  INFRA_CLASS_DATA,
);
