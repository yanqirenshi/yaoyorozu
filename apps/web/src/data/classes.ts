/**
 * `/class-diagram` に描く1枚の図。図ごとのデータファイルを重ねる。
 *
 * - `classes-domain.ts`: YAOYOROZU のドメインのオブジェクトモデル(原点付近)
 * - `classes-native-prototype.ts`: domain クレートに実装済みの、まだオブジェクト
 *   モデルへ置き換えられていない型(プロトタイプ期の型。x 正側、ドメインモデルの
 *   さらに右)
 * - `classes-infra.ts`: infra クレートの型と、それが実現する app の port(trait)。
 *   x 正側、`classes-native-prototype.ts` のさらに下
 * - `classes-tauri.ts`: tauri クレートの型(DTO・アプリ状態・ローカルAPI)。
 *   x 正側、`classes-infra.ts` のさらに下
 *
 * どちらも座標は同じ平面上にあるので、新しい図を足すときは既存の図と重ならない
 * 位置に置く。
 */
import type { DiagramInput } from "@yanqirenshi/d3.classes";
import { mergeDiagrams, type ClassFilePaths } from "./classDiagram";
import { DOMAIN_CLASS_DATA, DOMAIN_CLASS_FILE_PATHS } from "./classes-domain";
import {
  NATIVE_PROTOTYPE_CLASS_DATA,
  NATIVE_PROTOTYPE_CLASS_FILE_PATHS,
} from "./classes-native-prototype";
import { INFRA_CLASS_DATA, INFRA_CLASS_FILE_PATHS } from "./classes-infra";
import { TAURI_CLASS_DATA, TAURI_CLASS_FILE_PATHS } from "./classes-tauri";

export const CLASS_DIAGRAM_DATA: DiagramInput = mergeDiagrams(
  DOMAIN_CLASS_DATA,
  NATIVE_PROTOTYPE_CLASS_DATA,
  INFRA_CLASS_DATA,
  TAURI_CLASS_DATA,
);

/**
 * 物理名 → 実装ファイルのパス。インスペクタでの表示用(`ClassesTab.tsx`)。
 * クラスの物理名は図全体で一意(`mergeDiagrams` が保証)なので、単純に重ねてよい。
 */
export const CLASS_FILE_PATHS: ClassFilePaths = {
  ...DOMAIN_CLASS_FILE_PATHS,
  ...NATIVE_PROTOTYPE_CLASS_FILE_PATHS,
  ...INFRA_CLASS_FILE_PATHS,
  ...TAURI_CLASS_FILE_PATHS,
};
