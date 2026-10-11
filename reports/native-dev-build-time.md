# apps/native の開発ビルドが遅い原因と、改善策の実測(#559)

Issue: [#559](https://github.com/yanqirenshi/yaoyorozu/issues/559)。
実施: Lab (PM)、2026-10-07。調査のみ(main の `Cargo.toml` / `.cargo/config.toml` は変えていない)。

## 結論

日常の体感(Rust を 1 行変えて再ビルド)を決めているのは **依存クレートではなく、Tauri 層 `native_lib` のコンパイル(約 13 秒)とリンク(約 6 秒)** で、どちらも**デバッグ情報の量**に比例している。
依存クレートは 1 行変更では一切作り直されていない。

| 推奨 | 1 行変更(tauri 層) | 失うもの | 手間 |
|---|---|---|---|
| **1. 開発プロファイルのデバッグ情報を減らす**(`[profile.dev] debug = "line-tables-only"`、`apps/native/Cargo.toml` に 2 行) | 19.7 s → **15.1 s**(−23 %)。`debug = 0` なら **9.6 s**(−51 %) | `line-tables-only`: デバッガで変数の中身が見えなくなる(バックトレースの行番号は残る)。`debug = 0`: バックトレースの行番号も消える | 2 行。副作用は上記のみ |
| **2. 肥大化した `target` の掃除**(main の 32 GB のうち約 25 GB は残骸。各ツリーで `cargo clean` を実行、不要な worktree の `target` を削除) | 古い target(5.8 GB)での 1 行変更 27.2 s → まっさら 19.7 s(−7 s、1 回だけの計測) | 掃除した直後の初回は 6 分(まっさら) | ディスク 58 GB → 20 GB 程度 |

見送り: `rust-lld`(効果なし。§4.2)、sccache(1 行変更に効かず、まっさらの初回が遅くなる。§4.4)。

## 1. 環境

| 項目 | 内容 |
|---|---|
| CPU / RAM / ディスク | Intel Core Ultra 7 255U(12 コア / 14 スレッド)/ 31 GB / NVMe SSD 477 GB(空き 166 GB) |
| Rust | rustc 1.95.0、cargo 1.95.0(stable-x86_64-pc-windows-msvc) |
| リンカ | 既定の MSVC `link.exe`。`rust-lld.exe` はツールチェーン同梱(未使用)。`lld-link` / `sccache` は未導入(本調査で sccache 0.18.0 を `cargo install`) |
| 設定 | `.cargo/config.toml` なし、`[profile]` 指定なし(すべて Cargo の既定: `opt-level = 0`、`debug = 2`、`incremental = true`、`codegen-units = 256`) |
| 依存クレート | 524(`Cargo.lock`)。ビルド単位 438 |
| Defender | リアルタイム保護は無効 |
| 測定 | `cargo build -p native --no-default-features --timings`(`tauri dev` が内部で実行する `cargo run --no-default-features` と同じ引数)。時間は cargo の `Finished … in` の報告値。作業ツリーは `yaoyorozu-lab`(`session/lab`)。設定は環境変数(`RUSTFLAGS` / `CARGO_PROFILE_DEV_DEBUG` / `RUSTC_WRAPPER`)で渡し、`target` はバリアントごとに専用フォルダ |

ぶれについて: 測定中に他セッションの `cargo` が動いていた場面は `rust-lld` の一部(§4.2 に明記)だけ。常時 `cargo run`(開発版 app のホストプロセス、コンパイルはしていない)が 2 つ居る状態で測った。

## 2. 基準(何に時間を使っているか)

| 場面 | 時間 | 内訳(`--timings`) |
|---|---|---|
| (a) まっさら | **6 分 00 秒** | 依存のコンパイル 2,942 CPU 秒 + ビルドスクリプト 242 CPU 秒(並列で約 5 分 30 秒)、自分のクレート 141 秒、リンク 7 秒。長いもの: `windows` 160 s、`windows-sys` 90 s、`tauri-utils` 83 + 64 s、`h2` 61 s |
| (b) tauri 層(`tauri/src/lib.rs`)1 行変更 | **19.7 秒** | `native_lib` コンパイル 12.6 s + `native`(bin)= リンク 6.0 s。依存は 0 |
| (b') domain 層(`crates/domain/src/lib.rs`)1 行変更 | **25.0 秒** | `domain` 1.8 + `app` 1.4 + `infra` 2.0 + `native_lib` 13.7 + リンク 6.4 |
| (c) 変更なし | **1.0 秒** | 何も作らない(§2.1 の例外あり) |
| (d) 別の作業ツリー(main)のソースを同じ `target` で初回 | 2 分 16 秒 | 依存は再利用(0 秒)。自分のクレートだけ 145 秒(`native_lib` 101 s。パスが違うので作り直し) |
| (d') 同・2 回目 | 1.6 秒 | |

`native_lib` 1 つのコンパイルに 13 秒かかるのは、Tauri の `generate_context!` マクロと `#[tauri::command]` の展開、および完全なデバッグ情報(`.rlib` 465 MB、`.lib` 1.06 GB)の書き出しのため。
リンクも 1.06 GB の静的ライブラリと 187 MB の `.pdb` を読み書きしている。

### 2.1 まっさらの直後に 1 回だけ余計に作り直される

まっさらビルドの直後に変更なしで再ビルドすると、1 回だけ `native_lib` + リンク(16.7 秒)が走る。
原因は cargo の指紋ログで確認した: `generate_context!` がコンパイル中に `OUT_DIR` へ書くファイル(`build/native-…/out/7a6b…`)の更新時刻が、`native_lib` の指紋の基準時刻より新しくなるため(`FsStatusOutdated(StaleItem(ChangedFile …))`)。
3 回目以降は 1.0〜1.2 秒で安定する。日常の体感には関係しない。

### 2.2 見立ての裏付け

| 見立て | 結果 |
|---|---|
| 作業ツリーごとに `target` が分かれ、キャッシュが共有されない | **当たり**。ただし影響は「ツリーを作った初回の 6 分」と「ディスク 58 GB」であり、日常の 1 行変更には関係しない(1 行変更で依存は作り直されない) |
| Windows の既定リンカが遅い | **外れ**(この環境では)。`rust-lld` に替えてもリンクは速くならなかった(§4.2) |
| デバッグ情報が多くリンクが重い | **当たり**。リンクだけでなく `native_lib` のコンパイルにも効いている(§4.1) |
| 32 GB の `target` 自体が遅くしている | **一部当たり**。古い `target`(5.8 GB)で 1 行変更が +7 秒(1 回の計測)。32 GB の main は実行中の app があり測っていない |

## 3. `target` の中身(main の 32 GB)

| 内訳 | 大きさ | 見方 |
|---|---|---|
| `debug/deps/*.rcgu.o` | **10.7 GB(8,861 個)** | `native_lib` のコード生成単位の中間ファイル。8〜9 月のものだけで、10 月には作られていない。lab の `target` には 1 つも無い。**残骸**(作られた経緯は未特定) |
| `debug/incremental` | **11.1 GB** | `native_lib` の増分コンパイルの履歴が 142 世代(1 世代 0.5〜1.1 GB)。cargo は古い世代を自動では消さない |
| `debug/deps` の `.rlib` / `.rmeta` / `.pdb` | 4.1 / 1.4 / 1.5 GB | 依存の成果物。`infra` だけで 51 通りの設定(指紋)で作られ、8 月の成果物が 31 個残っている |
| `native_lib.lib` + `.rlib`(直下と deps で 2 組) | 1.06 GB × 2 + 0.47 GB × 2 | 完全なデバッグ情報込み |
| `release` | 1.7 GB | |

いま使われているのは 10 月 3 日の `native.exe`(27 MB)と `.pdb` だけで、**32 GB のうち約 25 GB は残骸と履歴**。
全作業ツリーの合計: main 32 GB、impl-app 11 GB、lab 5.8 GB、impl-app-claude 4.6 GB、impl-app-hub 4.4 GB、settings 4.4 GB、jovial-maxwell-cc4800(detached、9 月 13 日以来未使用)1.7 GB。

## 4. 改善策の実測

すべて作業ツリー lab、各バリアントごとにまっさらの `target` から。

| バリアント | (a) まっさら | (b) tauri 層 1 行 | (b') domain 層 1 行 | `native_lib` コンパイル / リンク(b) | `target` | `native_lib.lib` / `.pdb` |
|---|---|---|---|---|---|---|
| 基準 | 6:00 | 19.7 s | 25.0 s | 12.6 / 6.0 s | 4.5 GB | 1,060 / 187 MB |
| `rust-lld` ※ | 6:30 | 26.5 s | 37.5 s | 15.1 / 9.6 s | 4.6 GB | — / 210 MB |
| `debug = "line-tables-only"` | 5:20 | **15.1 s** | 17.5 s | 8.8 / 4.1 s | 2.3 GB | 313 / 74 MB |
| `debug = 0` | 5:03 | **9.6 s** | 15.5 s | 5.6 / 2.9 s | 1.9 GB | 220 / 19 MB |
| `rust-lld` + line-tables-only | 5:17 | 14.9 s | 19.7 s | 9.1 / 4.8 s | 2.3 GB | — / 76 MB |
| sccache(冷 → 温) | 7:24 → **3:45** | 20.6 s | 23.9 s | 12.6 / 6.9 s | 4.5 GB + キャッシュ 0.4 GB | — |
| mixed1: 自分のクレート line-tables-only + 依存 `debug = 0` | **4:21** | 16.8 s | 14.2 s | 10.8 / 4.7 s | 2.1 GB | 246 / 45 MB |
| mixed2: 自分のクレート既定(完全)+ 依存 `debug = 0` | 5:42 | 21.7 s | 18.6 s | 13.8 / 7.1 s | 3.5 GB | 678 / 90 MB |

※ `rust-lld` の行は、他のビルド(本調査の診断用)と重なった時間帯の計測でぶれがある。
ただし重なりの無い併用の行でもリンクは 4.8 s(line-tables-only 単独 4.1 s)で、改善は見られない。

### 4.1 デバッグ情報を減らす(推奨 1)

- `line-tables-only`(行番号だけ): 1 行変更 −23 %、まっさら −11 %、`target` 半分。パニックのバックトレースに行番号は出る。デバッガで変数の値は見えない
- `debug = 0`: 1 行変更 −51 %。バックトレースの行番号も消える(関数名は残る)
- 効く理由: `native_lib` の成果物が 1.06 GB → 313 MB → 220 MB と小さくなり、書き出しとリンクの両方が軽くなる

入れ方(`apps/native/Cargo.toml` のワークスペース直下に追記。`tauri dev` / `cargo build` の両方に効く):

```toml
[profile.dev]
debug = "line-tables-only"   # または 0
```

自分のクレートだけ行番号を残し、依存をゼロにする分け方(mixed1 / mixed2)の数字は上の表のとおり(依存を 0 にしても 1 行変更は縮まらず、まっさらだけが縮む: mixed1 は line-tables-only 単独と 1 行変更が同等(16.8 s 対 15.1 s、ぶれの範囲)でまっさらが最速の 4:21。mixed2(自分のクレートは完全なデバッグ情報のまま)は 1 行変更 21.7 s で基準と変わらない。1 行変更に効くのは自分のクレート側の設定だけ、ということ)。

### 4.2 リンカを `rust-lld` にする(見送り)

`RUSTFLAGS="-Clinker=<sysroot>/…/rust-lld.exe -Clinker-flavor=lld-link"` で、rustc の引数に渡っていることは `cargo build -v` で確認した。
リンクは 6.0 → 9.6 s(ぶれあり)、併用でも 4.1 → 4.8 s で、速くならない。
`.pdb` の書き出しが律速で、リンカの差が出ない大きさ(exe 26 MB)とみられる。

### 4.3 `target` の掃除(推奨 2)

- 古い `target`(lab、5.8 GB、8 月から使用)での 1 行変更は 27.2 s。まっさらの `target` では 19.7 s(+7 s。1 回の計測)
- main の 32 GB は実行中の app が exe を掴んでいるため測っていないが、残骸が多い分、同等以上の差があるとみられる
- 掃除の手段: `cargo clean`(作業ツリーごと。直後の初回は 6 分)。`debug/incremental` と `deps/*.rcgu.o` だけ消す手もあるが、`cargo clean` のほうが確実
- 運用: 使い終わった worktree(`jovial-maxwell-cc4800` など)の `target` は消す。`cargo-sweep`(日数で古い成果物を消す)は未検証

### 4.4 sccache(見送り)

- まっさら: 冷(キャッシュ無し)7:24 と基準より 1 分 24 秒遅く、温(別ツリーを想定)3:45 と 2 分 15 秒速い。温の当たり率は 286 / 323(89 %)。外れの 37 はビルドスクリプトとプロシージャマクロ(`crate-type` 138 件は対象外として扱われる)
- 1 行変更: 20.6 s と変わらない(自分のクレートは増分コンパイルなのでキャッシュ対象外)
- 結論: 「新しい作業ツリーを作る初回」だけに効く。導入(`cargo install sccache`、`RUSTC_WRAPPER` の設定)と常駐サーバの手間に見合わない

### 4.5 `target` を作業ツリー間で共有する(見送り)

`CARGO_TARGET_DIR` を共通にすると、別ツリーの初回は 2:16(依存は再利用、自分のクレートだけ作り直し)、以後は通常どおり。
しかし実行中の app が `target/debug/native.exe` を掴んでいるため、**main と共有すると動作確認中のビルドが失敗する**(memory `native-dev-verify-from-worktree` のとおり)。
sccache と同じく初回にしか効かないので採らない。

## 5. 推奨のまとめ(効果 ÷ 手間・副作用)

1. **`[profile.dev] debug = "line-tables-only"`** — 2 行で 1 行変更 −23 %、`target` 半分。失うのはデバッガでの変数表示だけ。バックトレースはこれまでどおり読める。`debug = 0` にすればさらに半分だが、行番号が消えるので、パニックの調査を考えると `line-tables-only` を勧める
2. **`target` の掃除** — 各ツリーで `cargo clean`(main は app を止めた時に)。+7 秒分と 38 GB の回収。あわせて未使用 worktree の `target` を消す運用

採用の判断とイシュー化はデザイン (全体) が行う。

## 付録 A. 残課題・未検証

- `native_lib` のコンパイル自体(行番号のみでも 8.8 s)を縮める手: Tauri 層を薄くする(コマンドの実装を `app` 層へ寄せ、`native_lib` を配線だけにする)と増分コンパイルの単位が小さくなるはず。未計測
- `opt-level` / `codegen-units` の調整、`incremental` の無効化: 今回は測っていない(1 行変更では効きにくい)
- `cargo-sweep` による自動掃除
- 32 GB の `target` そのものでの計測(app 停止時に)

## 付録 B. 測定の手順

`cargo build -p native --no-default-features --timings --manifest-path <lab>/Cargo.toml` を、バリアントごとに `CARGO_TARGET_DIR` を変えて実行。
場面は (a) `target` 削除後 → (c) 変更なし → (b) `tauri/src/lib.rs` 末尾にコメント 1 行追記 → `git checkout --` → (b') `crates/domain/src/lib.rs` に同じ → `git checkout --` → (c') 変更なし。
`--timings` の HTML から `UNIT_DATA` を読み、`native` の bin ユニットをリンク時間、それ以外の自分のクレートをコンパイル時間とした。
スクリプトと HTML は Lab (PM) の手元(`C:\Users\yanqi\tmp\poc559`)にあり、リポジトリには入れていない。

---

# 第 2 部: 実際に待たされているのは何か(#602)

Issue: [#602](https://github.com/yanqirenshi/yaoyorozu/issues/602)。
実施: Lab (PM)、2026-10-11。第 1 部(#559)で `line-tables-only` と `target` の掃除を入れた後も「まだ遅い」とユーザーが感じている件。
調査のみ。他セッションのプロセスは止めておらず、`target` を消したのは私の一時フォルダだけ。

## 結論

**待たされているのは 1 行変更の `cargo build` ではなく、PR の前に走らせている `cargo test --workspace` → `cargo clippy --all-targets` → `npm run native:build`(release)の一連**だった。
会話ファイル(10/1〜10/11)の集計で、native の実装セッションの待ち時間の 9 割がこの 3 つで、1 行変更の build は 1 割に満たない。
しかもこの 3 つのうち、規約(`.claude/rules/native.md` §8)が MUST にしているのは `cargo fmt` と `cargo clippy -D warnings` だけで、**`cargo test --workspace` と `native:build` は規約が求めていないのにイシューの確認項目として毎回書かれていた**(デザイン (全体) が確認)。

| 検証コマンド | 10 日間の回数 | 追加で捕まえた失敗 | 1 回の時間(lab 実測、変更あり) |
|---|---|---|---|
| `cargo test --workspace` | 59 | **0**(失敗 9 回はすべて開発中の `-p` 実行で捕まっている) | 20〜27 秒(実セッションでは 70〜91 秒) |
| `cargo test -p domain -p app` | — | — | **3.5〜5 秒** |
| `cargo clippy --all-targets -- -D warnings` | 36 | 3(実際の lint 違反。MUST として機能) | 4〜5 秒(初回だけ 22 秒) |
| `npm run native:build`(release) | 12 | **0** | **3 分 49 秒〜4 分 13 秒**(初回 13 分 36 秒) |
| web `npm run build` | 136 | 0(失敗 2 回は `.next` の古いキャッシュ。`rm -rf .next` で通った) | 34 秒(中央値) |

**効く手は、ビルド設定ではなく手順**: 開発中は `cargo test -p domain -p app`(3.5 秒)と `clippy`(4 秒)、`--workspace` は PR 直前に 1 回、`native:build` はフロントの依存やビルド設定を触ったときだけ。
これで実装:APP (共通) の 4 日間の待ち 35 分のうち、test 21 分の大半と release 5 分がそのまま消える(A〜D のビルド設定の変更は不要)。

## 1. 現状の実測(lab 作業ツリー、`line-tables-only` 入り、他のビルド無しの時間帯)

| 場面 | 時間 | 備考 |
|---|---|---|
| 1 行変更の `cargo build`(tauri 層) | **11.0〜18.3 秒**(4 回: 18.3 / 11.0 / 14.0 / 12.7) | 前回の 14.9 秒と同じ水準。`-j 4` でも 10.6 秒(遅くならない) |
| まっさらからのフルビルド(dev) | 5 分 20 秒 | 前回と同じ |
| `[profile.dev]` を変えた直後の初回 | 5 分 42 秒 | 10/7 の `line-tables-only` 導入で、**全ツリーが 1 回ずつフルビルドになった**(lab で実測。設定変更の代償) |
| `cargo test --workspace`(domain 1 行変更後) | 27 秒(cargo 16.7 秒 + テスト実行 10 秒。infra のテストが 5.6 秒) | 変更なしなら 12 秒(実行だけ) |
| `cargo test -p domain -p app`(domain 1 行変更後) | **3.5〜5 秒**(初回だけ 34 秒) | テスト 447 件。`--workspace` が追加するのは infra 268 件(15 件 ignored)と native_lib 2 件、doc-test は全クレート 0 件 |
| `cargo clippy --all-targets -- -D warnings`(1 行変更後) | 4.1〜4.2 秒(初回 22 秒) | |
| `cargo check`(初回) | 2 分 56 秒 | check 用の成果物を一から作るため。2 回目以降は数秒 |
| `cargo build --release`(= `native:build` の Rust 部分)初回 | **13 分 36 秒** | 298 クレートを最適化ビルド |
| 同・変更なし(初回の直後) | 4 分 13 秒 | 第 1 部 §2.1 と同じ「初回の直後に 1 回だけ `native_lib` が作り直される」が、release では `native_lib` 1 つで 4 分かかる |
| 同・tauri 層 1 行変更 | **3 分 49 秒** | `native` だけの再コンパイル。release は増分コンパイルが無く、`native_lib` を毎回最適化し直す。実セッションで観測した 232 秒と一致 |

### 1.1 `target` の肥大について

impl-app の 7.1 GB の内訳は debug/deps 2.85 GB + incremental 1.75 GB + release 1.88 GB + テスト実行ファイルと pdb 0.4 GB。第 1 部で見つけた `.rcgu.o` の残骸は 0 個。
**release ビルドとテストの成果物が乗っているだけで、残骸ではない**。
`cargo sweep --dry-run --time 3` / `--installed` を lab の `target` に当てたところ「消すもの無し」だった(直前に全部作り直したため。古い成果物が溜まった `target` での効果は未測定)。掃除の優先度は下がった。

## 2. 検証コマンドが実際に何を捕まえたか(会話ファイル 10/1〜10/11、全セッション)

tool_use(Bash / PowerShell)とその tool_result を突き合わせ、出力に `FAILED` / `error[` / `Failed to compile` / `Type error` 等があるものを失敗とした。

| 種別 | 回数 | 失敗 | 中身 |
|---|---|---|---|
| `cargo test --workspace` | 59 | 0 | (検出 2 件はコマンド文字列に "cargo test" を含む別コマンドの誤検出) |
| `cargo test -p …` | 49 | 9 | テストコードのコンパイルエラー 5、テストの失敗 2、引数ミス 2。`-p infra …` の失敗 3 を含む |
| `cargo clippy` | 36 | 3 | 実際の lint 違反・コンパイルエラー |
| `npm run native:build` | 12 | 0 | |
| web `npm run build` | 136 | 2 | どちらも `.next` の古いキャッシュ(消したページへの生成型 `.next/types/.../page.js` の参照、セミコロン欠落の型エラー)。直後に `rm -rf apps/web/.next` して通った。オブジェクトの回は直前の `npx tsc --noEmit` が通っている |
| `tsc --noEmit` | 68 | 1(誤検出) | |
| lint | 20 | 0 | |

- `--workspace` で初めて落ちた回は無い。infra のテストは `-p infra …` で開発中に回されていて、そこで 3 回失敗を捕まえている
- release で初めて見つかった失敗は無い
- web の `npm run build` が tsc + lint の後に捕まえた「コードの」失敗は無い。データ/文書だけの PR(yyz/*.json と .md のみ)は 10/1 以降の web 系 23 件のうち 3 件(#598・#577・#536)で、残り 20 件はコードを含む
- 補足: lab の計測中、infra の `keyring_token_store::tests::save_then_load_roundtrips` が 9 回中 1 回落ちた(Windows の資格情報ストアに触るテスト。再現せず)。`--workspace` を回すとこの種の環境依存の揺れに当たることがある

## 3. 待ち時間の内訳(会話ファイル 10/7〜10/11、前景実行の tool_result まで)

| 種別 | 回数 | 待ち合計 | 中央値 | 最大 |
|---|---|---|---|---|
| web `npm run build` | 43 | 26.7 分 | 34 秒 | 149 秒 |
| `cargo test`(ほぼ `--workspace`) | 38 | 21.6 分 | 27 秒 | 149 秒(`--workspace` は 70〜91 秒) |
| `cargo build`(Lab の計測を除くと 5 回) | 16 | 18.5 分(うち Lab 17.8) | 13 秒 | — |
| `native:build` | 前景 1 回 232 秒 + 背景 6 回(時間は記録に出ない) | — | — | — |
| `cargo clippy` | 13 | 5.9 分 | 16 秒 | 156 秒 |

セッション別: **実装:APP (共通) 35 分**(test 21 / clippy 6 / release 5 / check 2 / build 0.5)、デザイン (ドメイン:Data / オブジェクト / 画面構成)各 6〜8 分(すべて web の `npm run build`)、実装:APP、画面:/ 2.5 分。
`tauri dev` は背景実行なので待ちが記録に出ないが、中身は 1 行変更の build(13 秒)+ Vite の起動で、十数秒。

## 4. 同時実行の取り合い(lab と一時フォルダの 2 つの `target` で同時に走らせた)

| 組み合わせ | 単独 | 同時 | 倍率 |
|---|---|---|---|
| dev の 1 行変更 build × 2 | 12.7〜14.0 秒 | 14.3 秒 と **45.3 秒** | 片方が 3.4× |
| dev の 1 行変更 build、裏で `cargo test --workspace` | 12.7 秒 | 28.8 秒(test 側は 49 秒、単独 20〜27 秒) | 2.2× / 2× |
| `cargo test --workspace` × 2 | 19.8 秒 | 27.3 秒 と 27.1 秒 | 1.4× |
| release の domain 1 行変更、裏で `cargo test --workspace` | (単独未測。tauri 層 1 行なら 3 分 49 秒) | **8 分 57 秒**(test 側は 44 秒) | 2× 前後 |
| `cargo test --workspace` を `-j 7` / `-j 4` で単独 | 19.8 秒(`-j 14`) | 17.8 秒 / 14.4 秒 | **絞ったほうが速い**(1 回ずつの計測) |
| dev の 1 行変更 build を `-j 4` で単独 | 12.7 秒 | 10.6 秒 | 同上 |

- 2 本同時なら 1.4〜3.4 倍、release が走っている裏では 2 倍前後。**15 セッションのうち native を触るのは 4〜5 本なので、PR 前の一連(test → clippy → release で 6 分前後)が重なると 10 分を超える**。手順を絞れば重なる機会そのものが減る
- `-j` を絞ると単独でも速い(1 行変更は `native_lib` 1 つのコンパイルが律速で並列度が要らず、test もリンクが律速)。ただし 1 回ずつの計測なので、入れるなら `CARGO_BUILD_JOBS=4〜7` を各セッションの環境で試してから

## 5. 案 A〜D について

| 案 | 結果 |
|---|---|
| A. Tauri 層を薄くする | **保留**。`native_lib` は 5,768 行(`lib.rs` 1,790、`dto.rs` 1,705 で DTO 70 型、コマンド 58 個)。1 行変更の 13 秒のうち `native_lib` のコンパイルは 8〜9 秒だが、§3 のとおり 1 行変更は待ち時間の 1 割未満。手順を絞った後にまだ遅ければ着手 |
| B. `split-debuginfo` | MSVC では `unpacked` を指定しても受け付けるが(domain 単体で 22.3 秒 対 `packed` 15.8 秒)、デバッグ情報は `.pdb` に出るのは同じ。効果は見込めない。`codegen-units` / `incremental` は未測(1 行変更が主因でないため) |
| C. 普段 `debug = 0`、追うときだけ行番号 | **できる**。`Cargo.toml` に `[profile.dev] debug = 0` と `[profile.dev-trace] inherits = "dev" debug = "line-tables-only"` を置き、追うときは `cargo build --profile dev-trace` / `cargo test --profile dev-trace`。`tauri dev` は `npm run tauri dev -- --profile dev-trace` で runner(cargo)に渡せる(`tauri dev --help` の `[ARGS]...`)。成果物は `target/debug` と `target/dev-trace` に分かれるので切り替えでの作り直しは無いが、`dev-trace` の初回は 5 分かかる。環境変数 `CARGO_PROFILE_DEV_DEBUG=line-tables-only` でも切り替えられるが、同じ `target/debug` を使うので切り替えるたびに自分のクレートが作り直される。効果は第 1 部の `debug = 0` の数字(1 行変更 −51 %)で、**今回の主因(test / release)には効かない** |
| D. `cargo-sweep` | インストールして dry-run した(§1.1)。古い成果物が溜まった `target` での効果は未測定。優先度は下がった |

## 6. 推奨(効果 ÷ 手間・副作用)

1. **イシューの確認項目から `cargo test --workspace` と `npm run native:build` の無条件指定をやめる**(デザイン (全体) の管轄。既に着手)。開発中は `cargo test -p domain -p app`(3.5 秒)+ `cargo clippy --all-targets -- -D warnings`(4 秒)+ `cargo fmt`、`--workspace` は PR 直前に 1 回(27 秒)、`native:build` はフロントの依存・ビルド設定・Tauri の設定を触ったときだけ。**実装:APP (共通) の待ち時間の 7 割強が消える**見込み
2. web の `npm run build`(web.md §6 の MUST)は、tsc + lint の後に捕まえたコードの失敗が 0 回で、失敗 2 回は `.next` のキャッシュだった。緩めるかはユーザーの判断。緩めるなら「コードを触った PR では 1 回、データ/文書だけなら不要」が事実に合う。1 回 34 秒 × 週 30 回前後
3. 同時実行は手順を絞れば自然に減る。`CARGO_BUILD_JOBS` を絞る手は単独でも速かったが 1 回ずつの計測なので、入れるなら試してから

## 付録 C. 第 2 部の測定の手順

lab 作業ツリー(`session/lab`、main と同期、`line-tables-only` 入り)で、`cargo build` / `cargo test` / `cargo clippy` / `cargo build --release` を「変更なし → `tauri/src/lib.rs` または `crates/domain/src/lib.rs` に 1 行 → `git checkout --`」の順に実行し、経過秒と cargo の `Finished … in` を記録した。
同時実行は一時フォルダ `target-dup` を同じソースから作り、同じ 1 行変更を 2 つの `target` で同時にビルドした。
会話ファイルの集計は `~/.claude/projects/C--Users-yanqi-prj-yaoyorozu/*.jsonl` の `tool_use`(Bash / PowerShell)と `tool_result` の時刻差・出力から取った。
`npm run build --prefix apps/native`(react のみ)は lab の `node_modules` に `loading-dev` が無く失敗したため、release は `cargo build --release` で測った(`tauri build` の Rust 部分と同じ)。
スクリプトとログは `C:\Users\yanqi\tmp\poc602`(リポジトリには入れていない)。
