/*
 * 画面のワイヤーフレーム(大きな区切り)を取り出す関数。
 *
 * ブラウザで開いた Webアプリ(apps/web)のページの中で実行する(Claude Code の
 * Browser の javascript ツール等)。このファイルの中身(関数式)に引数を渡して呼び、
 * 戻り値を apps/web/src/data/wireframes/<サイトの id>.ts に書く。
 *
 *   (このファイルの中身)({ siteId: 20, title: "構成図", imageLabel: "構成図(d3.deployment)" })
 *
 * 取り出す前に:
 *   - 表示サイズを決めてから再読み込みする。図のライブラリは読み込んだときの大きさで
 *     描くため、サイズを変えただけでは図の領域が正しく測れない
 *   - インスペクタ等の一時的な表示は閉じておく
 *
 * 取り出す区切りと、d3.wireframe 0.1.1 の要素(frame / image / button / modal /
 * dialog のみ描ける)への振り分け:
 *   - <nav>                         → frame(中の見出しをラベルに)
 *   - <main>                        → frame
 *   - role=menuitem                 → button(選択中は「(選択中)」を添える)
 *   - タブの並び(role=tablist)     → frame「タブ」
 *   - role=tab                      → button(選択中は「(選択中)」を添える)
 *   - 大きな図(svg / canvas。画面の 10% 以上) → image
 *
 * 親子は包含関係から決め、位置は親からの相対座標に直す(d3.wireframe は children の
 * 位置を親からの相対として扱う)。色や文字の大きさは持たない(描くときに付ける)。
 */
(options = {}) => {
  const {
    siteId = null,
    title = document.title,
    imageLabel = "図",
    minImageAreaRatio = 0.1,
  } = options;

  const viewport = { w: window.innerWidth, h: window.innerHeight };

  const rectOf = (el) => {
    const b = el.getBoundingClientRect();
    return {
      x: Math.round(b.left + window.scrollX),
      y: Math.round(b.top + window.scrollY),
      w: Math.round(b.width),
      h: Math.round(b.height),
    };
  };
  const textOf = (el) => (el.textContent || "").trim().replace(/\s+/g, " ");
  const selectedMark = (selected) => (selected ? "(選択中)" : "");

  const regions = [];
  const add = (type, label, el) => {
    const r = rectOf(el);
    if (r.w > 0 && r.h > 0) regions.push({ type, label, r, children: [] });
  };

  for (const nav of document.querySelectorAll("nav")) {
    const heading = nav.querySelector("h1, h2, h3");
    add(
      "frame",
      heading ? textOf(heading) : nav.getAttribute("aria-label") || "ナビゲーション",
      nav,
    );
  }
  for (const main of document.querySelectorAll("main")) add("frame", "", main);
  for (const item of document.querySelectorAll('[role="menuitem"]')) {
    const selected =
      item.classList.contains("Mui-selected") ||
      item.getAttribute("aria-current") === "page";
    add("button", textOf(item) + selectedMark(selected), item);
  }
  for (const list of document.querySelectorAll('[role="tablist"]')) {
    // MUI の Tabs は tablist が中身の幅しか持たないため、並び全体(Tabs の根)を取る。
    add("frame", "タブ", list.closest(".MuiTabs-root") || list);
  }
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    add(
      "button",
      textOf(tab) + selectedMark(tab.getAttribute("aria-selected") === "true"),
      tab,
    );
  }
  const minArea = viewport.w * viewport.h * minImageAreaRatio;
  for (const figure of document.querySelectorAll("svg, canvas")) {
    if (figure.parentElement && figure.parentElement.closest("svg")) continue;
    const r = rectOf(figure);
    if (r.w * r.h >= minArea) regions.push({ type: "image", label: imageLabel, r, children: [] });
  }

  // 親子を決める。大きい区切りから順に、自分を含む最小の区切りの子にする。
  const root = { type: "frame", label: title, r: { x: 0, y: 0, ...viewport }, children: [] };
  const contains = (outer, inner) =>
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.w <= outer.x + outer.w + 1 &&
    inner.y + inner.h <= outer.y + outer.h + 1;
  const area = (region) => region.r.w * region.r.h;
  const placed = [root];
  for (const region of regions.sort((a, b) => area(b) - area(a))) {
    const parent =
      placed
        .filter((p) => contains(p.r, region.r))
        .sort((a, b) => area(a) - area(b))[0] || root;
    parent.children.push(region);
    placed.push(region);
  }

  // 親からの相対座標に直し、上から・左から並べる。
  const toElement = (region, parent) => {
    const children = region.children
      .sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x)
      .map((child) => toElement(child, region));
    return {
      type: region.type,
      ...(region.label ? { label: region.label } : {}),
      rect: {
        x: parent ? region.r.x - parent.r.x : region.r.x,
        y: parent ? region.r.y - parent.r.y : region.r.y,
        w: region.r.w,
        h: region.r.h,
      },
      ...(children.length > 0 ? { children } : {}),
    };
  };

  return {
    siteId,
    source: {
      path: window.location.pathname,
      viewport,
      capturedAt: new Date().toISOString().slice(0, 10),
    },
    elements: [toElement(root, null)],
  };
}
