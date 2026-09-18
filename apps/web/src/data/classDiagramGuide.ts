/**
 * Classes 図(`/class-diagram`)の「クラス図の書き方」タブの内容。
 *
 * ドメインのオブジェクトモデル(`classes-domain.ts`)を書くときの決まりは、ここを唯一の
 * 置き場所にする。`classes-domain.ts` の冒頭にはこのモデル固有のこと(スコープ、TM との
 * 違い)だけを書き、書き方はここを参照する。
 */

export type GuideFile = {
  path: string;
  role: string;
};

/** Classes 図にかかわるファイル。パスは apps/web からの相対。 */
export const GUIDE_FILES: GuideFile[] = [
  {
    path: "src/data/classes-domain.ts",
    role: "ドメインのオブジェクトモデル。TM を元に、クラス・関係線・位置を書く。",
  },
  {
    path: "src/data/classes-native-prototype.ts",
    role: "domain クレートに実装済みの、まだオブジェクトモデルへ置き換えられていない型(プロトタイプ期の型)を、コードのまま写した図。",
  },
  {
    path: "src/data/classes-infra.ts",
    role: "infra クレートの型と、それが実現する app の port(trait)を、コードのまま写した図。",
  },
  {
    path: "src/data/classDiagram.ts",
    role: "書くための道具(attr / label / method / defineDiagram / rel / mergeDiagrams)。",
  },
  {
    path: "src/data/classes.ts",
    role: "複数の図を1枚に重ねる(mergeDiagrams)。実装ファイルのパスの一覧(CLASS_FILE_PATHS)もここでまとめる。",
  },
  {
    path: "src/data/layout/classes.json",
    role: "画面での手調整(位置・端点の角度)と視点(ズーム倍率・位置)。位置と端点はデータより優先して使われる。",
  },
  {
    path: "src/data/classDiagramGuide.ts",
    role: "このタブの内容。",
  },
];

/** クラス1つの書き方の例。 */
export const GUIDE_CLASS_EXAMPLE = `{
  name: { physical: "GitBranch", logical: "GitBranch", description: "ブランチの作成・削除。… TM: Gitブランチ(イベント)" }, // 論理名: Gitブランチ
  attributes: [
    attr("branch_id", "String"), // 個体指定子。アプリが新設する GitブランチID
    attr("branch_name", "String"),
    attr("created_at_time", "u64"),
    attr("deleted_at_time", "Option<u64>"),
  ],
  position: { x: 951, y: 161 },
},`;

export type GuideClassItem = {
  item: string;
  howTo: string;
  example: string;
};

export const GUIDE_CLASS_ITEMS: GuideClassItem[] = [
  {
    item: "名前",
    howTo:
      "physical と logical に同じ英語名(PascalCase)を書く。description には役割と、元にした TM のモノを書く。日本語の論理名は行末のコメントに書く。",
    example: 'physical: "GitBranch"',
  },
  {
    item: "名前の重なり",
    howTo:
      "図は複数のデータファイルを1枚に重ねるので、ほかの図と同じ名前は使えない(画面が表示されなくなる)。native の domain クレートの型ともぶつからない名前にする。",
    example: "TM の UserLine は SessionLine の図と重なるので UserLogLine にした",
  },
  {
    item: "フィールド",
    howTo:
      "attr(名前, 型) で書く。名前は snake_case にして TM の物理名(camelCase)と1対1に対応させ、型は Rust の型にする。名前に「+ 」は書かない(可視性の記号はライブラリが付ける)。",
    example: 'attr("branch_name", "String")',
  },
  {
    item: "メソッド(オブジェクトモデルのみ)",
    howTo:
      "method(名前, 引数の配列, 戻り値の型) で書く。取得・保存(ファイルI/O、外部コマンドの実行など)は port(app/infra)の責務であり、クラスのメソッドには書かない。載せてよいのは組み立て・計算・判定のような純粋なロジックだけ。引数は「port が返した、読み込み済みのデータ」を受け取る形にし、I/O そのものは書かない(port の呼び出しは実装側の責務。図には表れない)。",
    example: 'method("load_sessions", ["parsed: Vec<ParsedSession>"], "()")',
  },
  {
    item: "抽象クラス",
    howTo: "stereotype に abstract を書く。箱の名前の上に «abstract» が出る。",
    example: 'stereotype: "abstract"',
  },
  {
    item: "列挙",
    howTo:
      "stereotype に enumeration を書き、バリアントは label(名前) で書く(可視性も型も描かない)。",
    example: '["user", "assistant"].map(label)',
  },
  {
    item: "位置",
    howTo:
      "position に箱の左上の座標を書く。画面での手調整が固まったら、その値を書き写す(「配置と手調整」を参照)。",
    example: "position: { x: 951, y: 161 }",
  },
  {
    item: "幅",
    howTo:
      "箱の幅は中身から計算されず 200 で固定なので、名前と型の列が重なるときだけ size.w で広げる。高さは中身から計算され、size.h は使われない(0 を書く)。",
    example: "size: { w: 250, h: 0 }",
  },
  {
    item: "実装ファイル",
    howTo:
      "対応する Rust の型が実装されていれば、filePath にリポジトリルートからの相対パスを書く。インスペクタのクラス名の下に表示される。まだ実装されていないクラス(classes-domain.ts の大半)は省略してよい(「(未実装)」と出る)。",
    example: 'filePath: "apps/native/crates/domain/src/pc.rs"',
  },
];

export type GuideRule = {
  title: string;
  body: string;
};

/** TM(データモデル)からオブジェクトモデルへの写し方。 */
export const GUIDE_TM_RULES: GuideRule[] = [
  {
    title: "リソース・イベントはクラスにする",
    body: "TM のリソース・イベントは、それぞれ1つのクラスにする。個体指定子もフィールドとして持つ(オブジェクトの同一性の根拠になるため)。",
  },
  {
    title: "継承した個体指定子((R))はフィールドにしない",
    body: "ほかのモノから継承した個体指定子(TM で (R) が付くもの)はフィールドにせず、関係線で表す。TM の (R) は「関係がある」の意味で、参照キーではないため。",
  },
  {
    title: "属性の無い対照表・対応表は関係線にする",
    body: "対照表(R-R)・対応表(E-E)は、それ自身の属性が無ければクラスにせず、多重度付きの関係線にする。属性があるときは関連クラスにしたいが、d3.classes に関連クラスの記法は無いので、ふつうのクラスとして描き、両側のクラスと線で結ぶ。",
  },
  {
    title: "再帰表は ID のフィールドにする",
    body: "再帰表(自分自身を指す関係)は、クラスにも線にもせず、相手の ID のフィールドとして持つ。d3.classes では自己参照の線を描けない(同じ箱の縁の2点を直線で結ぶと箱の内側を通る)ため。種別の属性があるときは、種別ごとにフィールドを分けて種別の属性を無くす(例: LogLine の parent_uuid / logical_parent_uuid)。",
  },
  {
    title: "サブセットは継承にする",
    body: "区分コードによるサブセットは継承(汎化)にする。区分コードはフィールドにしない(どのサブクラスかで決まる)。サブセットに分け尽くされる全体側は抽象クラス(«abstract»)にする。",
  },
  {
    title: "所有する関係はコンポジションにする",
    body: "全体が部分を所有する関係(部分は全体と運命を共にし、1つの全体にしか属さない)はコンポジションにし、実装では全体が部分をフィールドとして持つ。部分が役割で分かれるときは、役割ごとに線を分ける(例: Session の conversation_file と subagent_files)。",
  },
  {
    title: "持ち主は1つだけにする",
    body: "すでにほかのクラスが所有している相手を指したいときは、コンポジションにせず関連にし、実装では相手を所有せず ID で参照する(例: GitWorktree は、GitRepository が所有する GitBranch を ID で指す)。",
  },
  {
    title: "日時は u64 のミリ秒で持つ",
    body: "日時は domain クレートに合わせて、UNIX エポックからのミリ秒(u64)で持つ(domain は chrono などに依存しておらず、既存の *_ms も同じ単位)。まだ起きていない出来事の日時(削除日時など)は Option にする。",
  },
  {
    title: "導出できる値には / を付ける",
    body: "TM で (D) が付く導出できる値は、UML の派生属性にならって名前の前に / を付ける(例: /last_prompt)。実装ではフィールドにせず、計算するメソッドにしてよい。",
  },
];

export type GuideMultiplicity = {
  tm: string;
  uml: string;
};

/**
 * TM の結線記号と多重度の対応。記号は「そのエンティティが相手1件に対して何件か」を
 * 表すので、UML で同じ側の端に置く多重度とそのまま対応する。
 */
export const GUIDE_MULTIPLICITIES: GuideMultiplicity[] = [
  { tm: "鳥足 + 横棒", uml: "1..*" },
  { tm: "鳥足 + 丸", uml: "0..*" },
  { tm: "横棒 + 横棒", uml: "1" },
  { tm: "横棒 + 丸", uml: "0..1" },
];

export type GuideRelationshipType = {
  label: string;
  type: string;
  line: string;
  marker: string;
  direction: string;
  usage: string;
};

/** d3.classes の関係線の種類と、このモデルでの使い方。 */
export const GUIDE_RELATIONSHIP_TYPES: GuideRelationshipType[] = [
  {
    label: "関連",
    type: "association",
    line: "実線",
    marker: "起点に ×、終点に開いた矢印",
    direction: "たどれる向き(参照する側 → される側)",
    usage:
      "所有しない相手を ID で参照する(実装では起点が終点を参照する)。起点の × は UML で「起点の側へはたどれない」の意味。ラベルは参照するフィールド名。多重度は両端に書く。",
  },
  {
    label: "コンポジション",
    type: "composition",
    line: "実線",
    marker: "終点に黒い◆",
    direction: "部分 → 全体",
    usage:
      "全体が部分を所有する。ラベルは全体側のフィールド名。多重度は部分側(起点)だけ書く(全体側は定義で必ず 1)。",
  },
  {
    label: "継承",
    type: "inheritance",
    line: "実線",
    marker: "終点に白抜きの三角",
    direction: "サブクラス → 親",
    usage: "TM のサブセット。ラベルと多重度は書かない。",
  },
  {
    label: "集約",
    type: "aggregation",
    line: "実線",
    marker: "終点に白抜きの◇",
    direction: "—",
    usage: "いまのドメインのモデルでは使っていない。",
  },
  {
    label: "依存",
    type: "dependency",
    line: "破線",
    marker: "終点に開いた矢印",
    direction: "—",
    usage:
      "ドメインのモデルでは使っていない(SessionLine の図で、列挙からバリアントの型を指すのに使っている)。",
  },
  {
    label: "実現",
    type: "realization",
    line: "破線",
    marker: "終点に白抜きの三角",
    direction: "—",
    usage: "使っていない。",
  },
];

/** 関係線の書き方の例(classes-domain.ts から)。 */
export const GUIDE_REL_EXAMPLE = `// GitRepository が GitBranch を所有する。線は「部分 → 全体」の向きに書く。
rel("composition", "GitBranch", "GitRepository", "branches", "left", 250, {
  fromMultiplicity: "0..*",
}),
// GitWorktree が、チェックアウト中のブランチを ID で参照する。
rel("association", "GitWorktree", "GitBranch", "checked_out_branch", "top", "bottom", {
  fromMultiplicity: "0..1",
  toMultiplicity: "0..1",
}),
// UserLogLine は LogLine のサブクラス。ラベルは無いので undefined を渡す。
rel("inheritance", "UserLogLine", "LogLine", undefined, "top", 30),`;

export type GuideRelArg = {
  arg: string;
  meaning: string;
};

/** rel(種類, 起点, 終点, ラベル, 起点の端点, 終点の端点, オプション) の引数。 */
export const GUIDE_REL_ARGS: GuideRelArg[] = [
  { arg: "種類", meaning: "関係線の種類(上の表の type)。" },
  {
    arg: "起点・終点",
    meaning: "クラスの物理名。綴りを間違えると例外で止まる。",
  },
  {
    arg: "ラベル",
    meaning: "線の中央に出る文字。書かないときは undefined を渡す。",
  },
  {
    arg: "起点の端点・終点の端点",
    meaning:
      "辺のキーワードか角度(下の「端点」を参照)。省略すると、起点は bottom、終点は top。",
  },
  {
    arg: "key",
    meaning:
      "同じ組に2本以上の線を張るときの識別子。線の id が「起点->終点#key」になる。付け忘れると id が重なり、例外で止まる。",
  },
  {
    arg: "fromMultiplicity・toMultiplicity",
    meaning: "起点側・終点側の端に出る多重度。",
  },
];

export type GuidePoint = {
  value: string;
  position: string;
};

/**
 * 端点の指定のしかた。角度はボックスの中心から 0 = 真下、時計回りに 90 = 左、
 * 180 = 真上、270 = 右(d3.ter / d3.deployment と同じ規約)。
 */
export const GUIDE_POINTS: GuidePoint[] = [
  { value: '"bottom" / 0', position: "下辺の中央" },
  { value: '"left" / 90', position: "左辺の中央" },
  { value: '"top" / 180', position: "上辺の中央" },
  { value: '"right" / 270', position: "右辺の中央" },
  {
    value: "そのほかの角度",
    position:
      "箱の中心からその向きに延ばした線が、箱の縁と交わる点(例: 250 は右辺の上寄り、290 は右辺の下寄り)",
  },
];

/** 画面での手調整と、データへの書き写し。 */
export const GUIDE_LAYOUT_RULES: GuideRule[] = [
  {
    title: "画面で動かす",
    body: "箱をドラッグすると、位置が src/data/layout/classes.json に保存される。箱を右クリックするとインスペクタが開き、位置と、つながる線の端点の角度を数値で変えられる(空き地の右クリックは閉じる操作にあたる)。ホイールでのズームや空き地のドラッグで変えた視点(ズーム倍率と位置)も同じファイルに保存され、次に開いたときに戻る。",
  },
  {
    title: "手調整はデータより優先される",
    body: "classes.json にある値は、データの position や端点より優先して使われる。データを直しても画面が変わらないときは、classes.json に同じクラスや線の値が残っていないかを見る。",
  },
  {
    title: "固まったらデータに書き写す",
    body: "配置が固まったら、classes.json の値をデータファイルへ書き写す PR を作る。ドラッグで付いた小数は丸め、同じ列・行に並べたつもりのわずかなずれは揃える。角度が 0 / 90 / 180 / 270 の端点は辺のキーワードで書く。消したクラスや線のキーは書き写さない。",
  },
  {
    title: "説明のコメントも直す",
    body: "位置や端点を変えたら、どこに置き、どの辺でつなぐかを説明するコメントも合わせて直す。",
  },
  {
    title: "マージの後に書き写した手調整を消す",
    body: "書き写した PR がマージされたら、classes.json から位置と端点(classes と ports)を消す。消さないと、古い手調整がデータより優先され続ける。視点(camera)は表示のための値でデータには書き写さないので、残してよい。",
  },
];

export type GuideCheck = {
  item: string;
  note: string;
};

/** 書いたあとに画面で確かめること。 */
export const GUIDE_CHECKS: GuideCheck[] = [
  {
    item: "箱どうしが重ならない",
    note: "箱が高くなる(フィールドを足す)と、下の箱に食い込むことがある。",
  },
  {
    item: "線がほかのクラスの箱を横切らない",
    note: "端点の辺や角度を変えるか、箱を動かして避ける。",
  },
  {
    item: "線どうしが交差しない",
    note: "同じ辺に複数つなぐときは、相手の並びと同じ順に角度を振る。",
  },
  {
    item: "線の文字が箱に隠れない",
    note: "ラベルは線の中央、多重度は線の端に沿って置かれる。箱の間が狭いと、箱の下に隠れる。",
  },
  {
    item: "ラベルが線の端の記号に重ならない",
    note: "線が短いと、中央のラベルが端の記号(×・矢印・◆・三角)に届く。例: source_tool_assistant(幅 約112px)は、箱の間を 180px ほど空けた。",
  },
  {
    item: "名前と型の列が重ならない",
    note: "箱の幅は 200 で固定なので、名前と型の組み合わせが長い行は重なる。size.w で広げる。",
  },
  {
    item: "画面が表示される",
    note: "クラス名の重なり、綴り違い、key の付け忘れは、型チェックでは見つからず、画面を開いたときに例外で止まる。",
  },
];
