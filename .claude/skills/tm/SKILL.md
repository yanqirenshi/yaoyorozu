---
name: tm
description: apps/web の /tm(ドメインモデルのデータモデル)を編集する。TM(T字形ER)の規則に沿ってモノと関係を起こし、src/data/tm.ts に反映して描画まで検証する。TM図・データモデル・エンティティ・個体指定子の追加や修正を頼まれたときに使用。
---

# /tm

apps/web の TM(データモデル)を編集する。担当は「デザイン (ドメイン:Data)」セッション。

- **唯一の編集対象**は [tm.ts](../../../apps/web/src/data/tm.ts)。表示側([TmTab.tsx](../../../apps/web/src/app/tabs/TmTab.tsx))は触らない。
- 記法は TM(T字形ER)に従う。出典は佐藤正美/SDI「モデル作成の手続き」。
  同資料は複写・転写が禁止されているため、**本スキルにも tm.ts にも文面を転記しない**(手順として書き下したものだけを置く)。
- [web.md](../../../.claude/rules/web.md) の規約に従う(`src/data/*.ts` が SSoT、規約を逸脱する場合は理由をコメントに残す)。
- 現在のスコープと次段の候補は tm.ts 冒頭のコメントに書いてある。まずそこを読む。
- **段階を切って進める**。一度に全部描くと、オブジェクトモデル(`/class-diagram`)と同じ密度になりデータモデルとしての可読性を失う。

## 1. モデルを起こす(この順序を守る)

順序を飛ばすと、個体指定子の無いものをモノにしてしまう類の誤りが入る。実際に起きた。

### 1-1. 語彙を仕訳する

一次資料(現在は [claude-session-jsonl-format.md](../../../reports/claude-session-jsonl-format.md))から語彙(項目)を抜き、番号・コード類とそれ以外に分ける。

- MUST: ユーザ言語(資料に実在する名前)を変形しない。

### 1-2. モノを立てる

モノ ≡ **個体指定子が付与されている対象**。

- NEVER: 資料に存在しない ID・連番を発明して個体指定子にする。
  個体指定子が見つからないものは**モノではない**。他のモノの属性か、多値か、モデルから外すかのいずれか。
- 個体指定子は番号・コード以外(パス・略称等)でもよい。
- 導出できる値を個体指定子にしない。**導出の向きを必ず確認する**
  (例: 絶対パス → フォルダ名 の変換が不可逆なら、個体指定子はパスの側で、フォルダ名が `(D)`)。
- 値が実際に一意かどうかは気にしない。一意にする手続きがあればよい。

### 1-3. イベントとリソースに分類する

- イベント ≡ 出来事・行為・取引の**過去の**日付が帰属するモノ。
- 日付として認めない: 登録日・更新日、適用開始日・有効期間開始日、設立日・入社日の類。
- 日付が帰属しなければリソース。
- 資料に存在しない日付を補って分類を変えない(「開始日時」が記録されていないなら、それはリソース)。

### 1-4. 並べる

イベントは時系列(全順序)、リソースは順序を問わない(半順序)。図の配置もこれに従う。

### 1-5. 関係を構成する

| 組み合わせ | 構成 |
|---|---|
| E-R | イベント側にリソースの個体指定子を `(R)` 付きで持たせる |
| E-E | 先行・後続(後続側に `(R)`)、または対応表 TO(`CORRESPONDENCE`) |
| R-R | 対照表 TS(`COMPARATIVE`)。命名は `<モノ>．<モノ>．対照表` |
| 再帰 | 再帰表 RC(`RECURSION`)。命名は `<モノ>．<モノ>．再帰表` |

- `(R)` は「関係がある」の意味であり、参照キーではない。
- NEVER: R-R を対照表なしで、片方のリソースに `(R)` を持たせて済ませる。
  **R-R は多重度によらず必ず対照表を作る**。「1対複数の包含関係だから対照表は過剰」という
  判断は誤り(実際にそう判断して指摘を受けた)。対になる事実しか無く右側が空の
  mapping-list になっても、対照表として立てる。
- 対照表の意味論は基本的にイベントとして解釈する。日付や数量が付くならそれは右側に置く。
- 結線は4種。`cardinality` と `optionality` の組み合わせで表す(§2)。
  1対1 / 1対複数 / 1対「1または値なし」/ 1対「複数または値なし」。

### 1-6. セット(サブセット)と多値

サブセットは**区分コードによる切断**であり、部分集合のあいだに交わりを作らない(排他的 OR)。

- サブセットは親の個体指定子と**区分コードを持つ**。
- 属性構成が同じなら同一サブセット(`=区分コード`)、異なれば相違サブセット(`×区分コード`)。
- 以下はサブセットにできない。対照表で構成する。
  - 1つの区分コードで部分集合間に AND 関係が生じる。
  - 複数の区分コードで階が生じ、**上下を入れ替えても意味が通る**。
- null を除去するための形式的サブセットもある(状態遷移を表すことがある)。
- 多値: OR(MO)は正規形に分ける。AND(MA)は HDR-DTL 構成。
  **d3.ter に MO / MA の種別は無い**(§2)。代用したら理由をコメントに残す。

### 1-7. クラスで整える

1つのモノに他の性質(イベント的/他リソース的)が混入していたら切り出す。

- クラスは他のモノと直接結線しない。
- 計算・導出で得られる値は `(D)` を付ける。実装要否は後で判断してよい。

### 1-8. 関係の検証表をつくる

モノ × モノ の表を書き、関係の網羅性を確認する。**報告に含める**(図だけでは抜けが見えない)。

## 2. d3.ter の仕様(調べ直さないこと)

`@yanqirenshi/d3.ter` の `dist` を読んで確認した、ドキュメントに無い仕様。

- **エンティティ種別は7種のみ**。`RESOURCE` / `RESOURCE-SUBSET` / `EVENT` / `EVENT-SUBSET` /
  `COMPARATIVE`(対照表) / `CORRESPONDENCE`(対応表) / `RECURSION`(再帰表)。
  **未知の値を渡すと例外で図ごと落ちる**。MO / MA は無い。
- **結線角度 `position`**: `0=下` / `90=左` / `180=上` / `270=右`。
  Geometry が基準ベクトルを `(0, +対角長)` から回すため。SVG 座標なので y は下向き。
  同じ辺から複数の線を出すときは角度をずらす(例: 下辺なら `30, 10, 350, 330` で左から右へ)。
- **`cardinality`**: `1`=単一(横棒) / `3`=複数(鳥足)。**`optionality`**: `1`=必須(横棒) / `0`=任意(丸)。
  記号は各端点(port)側に描かれる。「そのエンティティが相手1件に対して何件か」を表す。
- **`size: { w: 0, h: 0 }`** を渡すと内容から実寸を自動計算する。手で指定しない。
  左右のカラムは強制的に等幅(半分ずつ)になる。
- **表示名の上書き**: 識別子・属性インスタンスに `name` を与えるとプールのマスタ名を上書きできる
  (`data.name ? data.name : master.name`)。`(R)` 表記はこれで実現する。マスタを重複させない。
- `name` は `{ physical, logical }` を渡す。**図に出るのは `logical`**(`logical || physical`)。
  文字列を渡すと `physical` 側に入り、`logical` が空になる。
- `description` は保持されるだけで描画されない。モデルの根拠を残す場所として使う。

## 3. tm.ts の書き方

- MUST: 型を `export type` で明示し、データと分離する(web.md §2)。
- MUST: ID は物理名をキーにした定義から**機械的に採番する**。手で採番した番号はズレて壊れる。
- MUST: `physical` は資料上のフィールド名、`logical` は日本語。`(R)` `(D)` は `logical` に付ける。
- MUST: エンティティの `description` にモデルの根拠(一次資料の該当節、分類の理由)を書く。
- 同じ物理名で意味が違う語彙は**別の属性に分ける**(例: フォルダのパスと行ごとの cwd)。
  1つにまとめると誤ったモデルになる。

## 4. 検証する

```bash
npx tsc --noEmit -p apps/web/tsconfig.json
npm run web:build
```

次に `/tm` を開いて描画を確認する(preview_start で `yaoyorozu-web` を起動)。
図が広いのでビューポートを広げる(`resize_window` で 1900x1000 程度。終わったら `desktop` に戻す)。

ブラウザで以下を実行し、**エンティティ数・重なり・結線記号の数**を照合する。

```js
const es = [...document.querySelectorAll('g.entity')].map(g => { const d = g.__data__;
  return { n: d.name.val(), x: d.position.x, y: d.position.y,
           r: d.position.x + Math.round(d.size.w), b: d.position.y + Math.round(d.size.h) }; });
const ov = [];
for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
  const a = es[i], c = es[j];
  if (a.x < c.r && c.x < a.r && a.y < c.b && c.y < a.b) ov.push(a.n + ' x ' + c.n);
}
const svg = document.querySelector('g.entity').ownerSVGElement;
({ count: es.length, overlaps: ov,
   extentX: Math.max(...es.map(e => e.r)), extentY: Math.max(...es.map(e => e.b)),
   connectors: svg.querySelectorAll('line.connector').length,
   cardLine: svg.querySelectorAll('line.cardinality').length,     // cardinality 1
   cardPath: svg.querySelectorAll('path.cardinality').length,     // cardinality 3
   optLine:  svg.querySelectorAll('line.optionality').length,     // optionality 1
   optCircle: svg.querySelectorAll('circle.optionality').length })// optionality 0
```

判定基準:

- `count` が定義したエンティティ数と一致する。
- `overlaps` が空。重なっていたら `position` を調整する(実寸は上の結果から読める)。
- `connectors` がリレーションシップ数と一致する。
- `cardLine + cardPath` と `optLine + optCircle` がどちらも **リレーションシップ数 × 2**。
  内訳も定義から数えた期待値と一致すること(合計だけ合っていても向きが逆なことがある)。
- コンソールエラーが無い(`read_console_messages`)。
  ただし `/wbs` を経由するとログが残るため、`/tm` を単独でリロードしてから見る。

## 注意

- 図が横に伸びやすい。実寸を測ってから `position` を詰める。手で見積もると外れる。
- WBS([wbs.ts](../../../apps/web/src/data/wbs.ts))の TM 配下(`_id: 40`)にモデルの構成要素が並んでいる。
  エンティティの種類を増やしたらここも合わせる。
  `/tm` の「WBS」タブが見ているのは画面としての TM(`_id: 26`)であり別物なので注意。
- レイアウトの手調整を localStorage に持たせる仕組みは TM にはまだ無い(Classes / サイトマップにはある)。
  位置は tm.ts に直接書く。
