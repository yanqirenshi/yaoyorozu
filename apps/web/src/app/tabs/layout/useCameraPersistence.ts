"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { CameraTransform } from "@/data/layoutSaveApi";

// --- 視点(パン/ズーム)の保存 ---
// d3 の zoom を使う図(d3.classes など)は、ズーム・パンのたびに図の外枠の <g> の
// transform 属性を書き換えるだけで、変化を知らせるコールバックも、初期値を渡す口も無い。
// そのため transform 属性の変化を MutationObserver で監視して保存し、図を描き直した
// ときは applyCamera で保存済みの視点へ戻す。
// 「直近に svg 上のユーザー入力があったか」でユーザー操作とそれ以外(ライブラリの
// 初期化など)を見分け、後者は保存済みの視点へ戻す。
// 保存はパン中(svg 上で左ボタンを押している間)には行わず、離したときに書く。
// 開発時は保存でレイアウトファイルが書き換わるたびに再コンパイルと Fast Refresh が
// 走り、それが操作の途中にかかると視点移動が途切れるため。
// TM(TmTab.tsx)の同じ仕組みを、ほかの図でも使えるよう切り出したもの。

/** この時間内に svg 上の入力があった transform 変化だけをユーザー操作とみなす。 */
const CAMERA_INPUT_WINDOW_MS = 500;
/** 視点は連続的に変わるため、落ち着いてから保存する。 */
const CAMERA_SAVE_DEBOUNCE_MS = 800;

const IDENTITY: CameraTransform = { k: 1, x: 0, y: 0 };

/** d3-zoom が書く "translate(x,y) scale(k)" を読み取る。 */
function parseTransform(el: Element): CameraTransform | null {
  const attr = el.getAttribute("transform");
  if (!attr) return null;
  const m = attr.match(
    /translate\(([-\d.eE+]+)[,\s]+([-\d.eE+]+)\)\s*scale\(([-\d.eE+]+)/,
  );
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
}

function sameCamera(a: CameraTransform, b: CameraTransform): boolean {
  return (
    Math.abs(a.k - b.k) < 1e-6 &&
    Math.abs(a.x - b.x) < 1e-6 &&
    Math.abs(a.y - b.y) < 1e-6
  );
}

type CameraPersistenceOptions = {
  /** 図を描くコンテナ。この中の svg への入力と transform の変化を見る。 */
  containerRef: RefObject<HTMLElement | null>;
  /** d3-zoom が transform を書き換える要素のセレクタ(d3.classes なら "g.viewport")。 */
  layerSelector: string;
  /** 保存済みの視点。無ければ等倍・原点から始める。 */
  initial: CameraTransform | null;
  /** 視点を保存する。落ち着いたとき(パン中はボタンを離したとき)に呼ばれる。 */
  onSave: (camera: CameraTransform) => void;
};

/**
 * 図の視点を保存・復元する。返す `cameraRef` は視点の現在値で、ほかの手調整を
 * 保存するときに一緒に書く(同じファイルに入るため)。`applyCamera` は図を描いた
 * 直後に呼び、保存済みの視点へ戻す。
 */
export function useCameraPersistence({
  containerRef,
  layerSelector,
  initial,
  onSave,
}: CameraPersistenceOptions) {
  // 視点の現在値。描画はライブラリ側が持つので state にはしない。
  const cameraRef = useRef<CameraTransform>(initial ?? IDENTITY);
  // 保存判定に使う入力の状態。開発時は保存のたびに Fast Refresh がかかり、
  // useEffect が作り直される。effect の中の変数に置くとそのたびに初期値へ戻り、
  // パン途中の動きをライブラリの初期化と取り違えるため、ref に置いて持ち越す。
  const inputRef = useRef({
    /** 最後に svg 上の入力(ホイール・押下・押したままの移動)があった時刻 */
    lastInputAt: 0,
    /** svg 上で左ボタンを押している間(パン中)は true */
    pointerDown: false,
    /** パン中に保存の時機が来たため、ボタンを離すまで保存を待っている */
    savePending: false,
  });
  // 保存にはほかの手調整の最新の値を使うので、呼び出し側の関数を ref で持つ
  // (effect を作り直さずに差し替えるため)。
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // 保存済みの視点をライブラリの管理下ごと書き戻す。属性だけ変えると次の
  // ズーム操作が初期値から始まってしまうため、d3-zoom が svg 要素に持たせて
  // いる現在値(__zoom)も差し替える。ZoomTransform クラスは export されて
  // いないので、既存インスタンスの constructor から作り直す。
  const applyCamera = useCallback(
    (svg: SVGSVGElement) => {
      const camera = cameraRef.current;
      const holder = svg as unknown as { __zoom?: object };
      if (holder.__zoom) {
        const Ctor = holder.__zoom.constructor as new (
          k: number,
          x: number,
          y: number,
        ) => object;
        holder.__zoom = new Ctor(camera.k, camera.x, camera.y);
      }
      svg.querySelectorAll(layerSelector).forEach((layer) => {
        layer.setAttribute(
          "transform",
          `translate(${camera.x},${camera.y}) scale(${camera.k})`,
        );
      });
    },
    [layerSelector],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const input = inputRef.current;
    const saveCamera = () => onSaveRef.current(cameraRef.current);

    // 保存するとレイアウトファイルが書き換わり、開発サーバが再コンパイルして
    // Fast Refresh がかかる。パン中にそれが起きると操作が途切れるため、
    // ボタンを押している間は保存せず、離したときに書く。
    const saveOrDefer = () => {
      if (input.pointerDown) {
        input.savePending = true;
        return;
      }
      input.savePending = false;
      saveCamera();
    };

    // 「svg 上の入力があったか」の判定材料。ズーム(ホイール)とパン
    // (svg 上でのドラッグ)だけを数え、インスペクタ等の操作は含めない。
    const isOnSvg = (event: Event) =>
      Boolean((event.target as Element).closest?.("svg"));
    const handleWheel = (event: WheelEvent) => {
      if (isOnSvg(event)) input.lastInputAt = Date.now();
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (!isOnSvg(event)) return;
      input.lastInputAt = Date.now();
      if (event.button === 0) input.pointerDown = true;
    };

    let saveTimer: number | null = null;
    const scheduleSave = () => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        saveTimer = null;
        saveOrDefer();
      }, CAMERA_SAVE_DEBOUNCE_MS);
    };

    const handleMouseUp = () => {
      if (!input.pointerDown) return;
      input.pointerDown = false;
      // パンが終わったので、待っていた保存も待ち時間中の保存もここで1回だけ書く
      // (タイマーを残すと離した直後にもう一度保存が走り、再コンパイルが重なる)。
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
        input.savePending = true;
      }
      if (input.savePending) saveOrDefer();
    };
    const handleMouseMove = (event: MouseEvent) => {
      if (event.buttons & 1) {
        // パン中(左ボタン押下でのドラッグ)だけ延長する。
        if (isOnSvg(event)) input.lastInputAt = Date.now();
      } else if (input.pointerDown) {
        // ウィンドウの外で離して mouseup を取り逃がした場合の後始末。
        handleMouseUp();
      }
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const target = mutation.target;
        if (!(target instanceof SVGGElement) || !target.matches(layerSelector))
          continue;

        const parsed = parseTransform(target);
        if (!parsed || sameCamera(parsed, cameraRef.current)) continue;

        // ボタンを押している間(パン中)は、押したまま止まっていた時間に
        // 関係なくユーザー操作とみなす。d3-zoom は window の capture で動きを
        // 受けるため、ここへの通知は lastInputAt の更新より先に届くことがある。
        const byUser =
          input.pointerDown ||
          Date.now() - input.lastInputAt < CAMERA_INPUT_WINDOW_MS;
        if (byUser) {
          cameraRef.current = parsed;
          scheduleSave();
        } else if (target.ownerSVGElement) {
          // ユーザー操作ではない変化(ライブラリの初期化など)。保存済みの視点へ
          // 戻す。この書き戻しも mutation を起こすが、次回は parsed が一致して
          // 素通りするためループしない。
          applyCamera(target.ownerSVGElement);
        }
        // 1バッチにつき先頭だけ見ればよい。
        break;
      }
    });
    observer.observe(container, {
      subtree: true,
      attributes: true,
      attributeFilter: ["transform"],
    });

    container.addEventListener("wheel", handleWheel, { capture: true });
    container.addEventListener("mousedown", handleMouseDown, { capture: true });
    container.addEventListener("mousemove", handleMouseMove, { capture: true });
    // 図の外で離すこともあるので window で拾う。
    window.addEventListener("mouseup", handleMouseUp, { capture: true });
    return () => {
      observer.disconnect();
      container.removeEventListener("wheel", handleWheel, { capture: true });
      container.removeEventListener("mousedown", handleMouseDown, {
        capture: true,
      });
      container.removeEventListener("mousemove", handleMouseMove, {
        capture: true,
      });
      window.removeEventListener("mouseup", handleMouseUp, { capture: true });
      if (saveTimer !== null) {
        // 保存待ちのまま作り直し・アンマウントしない(最後の視点を書き切る)。
        // Fast Refresh による作り直しがパン中に起きた場合は、savePending として
        // 次の effect へ持ち越し、ボタンを離したときに書く。
        window.clearTimeout(saveTimer);
        saveOrDefer();
      }
    };
  }, [containerRef, layerSelector, applyCamera]);

  return { cameraRef, applyCamera };
}
