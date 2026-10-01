---
name: restart-app
description: main ブランチを最新にして、動作確認用のアプリ(Tauri の開発版と Web の開発サーバ)を両方とも再起動する。「main を最新にしてアプリを再起動」「アプリを起動して」と依頼されたときに使う。運用:リリース セッション専用(CLAUDE.md「セッション構成」)。
---

# /restart-app

main 作業ツリー(`C:\Users\yanqi\prj\yaoyorozu`)で、次の2つを最新の main で起動し直す。

| 対象 | 起動方法 | ポート |
|---|---|---|
| Tauri 開発版(動作確認専用、MSI 版とは別 identifier) | Bash のバックグラウンド実行(`tauri dev --config`、環境変数 `YAOYOROZU_LOCAL_API_PORT=14201` を付けて起動 — §0 参照) | 1425(Vite)、14201(ローカル API) |
| Web(Next.js) | `preview_start`(`.claude/launch.json` の `yaoyorozu-web`) | 3000 |

main でのアプリ起動は 運用:リリース セッションが担当する(2026-09-19 決定)。
**app の使い分け(2026-09-30 決定、CLAUDE.md「セッション構成」)**: 全セッションが日々の作業で動かすのは**インストール済みの MSI 版**(identifier `com.yaoyorozu.native`、実行ファイル `C:\Program Files\YAOYOROZU\native.exe`)。
このスキルが起動する開発版は**動作確認専用**で、別の identifier(`com.yaoyorozu.native.dev-main`)・別の Vite ポート(1425)で起動し、日々の作業用の MSI 版とは分離する。
理由: identifier を分けないと、起動のたびに `app_data_dir/local-api-token` を上書きし、MSI 版のローカル API が使えなくなる(手法は memory `native-dev-verify-from-worktree` と同じ)。
**開発版の exe は必ず `tauri dev --config` で作る。`cargo build` / `cargo run` を直接してできた exe を起動しない**(2026-10-01 決定、native.md §8)。`tauri.conf.json` の既定値(MSI 版と同じ identifier)が埋め込まれて本番の `app_data_dir` を読む exe になり、起動すると自動再開(#459)で本番の実行中セッション全部に再開を試みる(PR #492 の確認中に発生。拒否されて実害は無かった)。
他セッションの作業を壊さないことを最優先とし、判断に迷う状態なら止めてユーザーに確認する。

## 0. 前提: ローカル API のポートは環境変数で MSI 版と分ける([Issue #470](https://github.com/yanqirenshi/yaoyorozu/issues/470) で解消済み)

ローカル API のポート(既定 `14200`)は環境変数 `YAOYOROZU_LOCAL_API_PORT` で上書きできる(native.md §7)。
開発版を起動するときは、`tauri dev --config` と同じ Bash 呼び出しで `YAOYOROZU_LOCAL_API_PORT=14201` を付け、MSI 版(既定 14200 のまま)とポートを分ける。
これにより、MSI 版が動いていても開発版のローカル API を起動できる(以前の制約は解消済み)。
apps/web との連携(レイアウト保存 API 等)は、Web の Route Handler が MSI 版の identifier(`com.yaoyorozu.native`)固定でポート・トークンを読むため、引き続き MSI 版で確認する(開発版は動作確認専用で、apps/web の連携先にはならない)。

## 1. 事前確認(読み取りのみ。2つを並行して実行する)

### 1-1. git の状態

```bash
git branch --show-current
git fetch origin -q
git rev-list --left-right --count origin/main...HEAD      # behind ahead
git status --short
git log HEAD..origin/main --oneline --no-merges
git diff --stat HEAD origin/main
# 依存の変更 → npm install が必要か
git diff --quiet HEAD origin/main -- package.json package-lock.json apps/native/package.json apps/web/package.json && echo なし || echo あり
# Rust の変更 → 再ビルドが走るか(報告用)
git diff --quiet HEAD origin/main -- apps/native/crates apps/native/tauri apps/native/Cargo.toml apps/native/Cargo.lock && echo なし || echo あり
# 未コミットファイルが取り込みと重なるか
for f in $(git status --short | awk '{print $2}'); do git diff --quiet HEAD origin/main -- "$f" && echo "重ならない: $f" || echo "重なる: $f"; done
```

**次のどれかに当たったら中断し、ユーザーに報告して指示を待つ。**

- ブランチが `main` ではない(他セッションが作業ツリーを使っている可能性がある。勝手に切り替えない)
- ahead が 1 以上(ローカルの `main` に未 push のコミットがある)
- 未コミットファイルが取り込み対象と**重なる**

未コミットの変更(例: `apps/web/src/data/layout/*.json`)は**触らない**(commit・stash・破棄のいずれもしない)。
重ならない限りは残したまま進めてよい。

### 1-2. プロセスとポートの状態(PowerShell)

```powershell
$all = Get-CimInstance Win32_Process
$dev_exe = 'C:\Users\yanqi\prj\yaoyorozu\apps\native\target\debug\native.exe'
$msi_exe = 'C:\Program Files\YAOYOROZU\native.exe'
# ポートごとに、使っているプロセスの実行ファイルパスとコマンドラインを出す
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 1425,3000,14200,14201 } | ForEach-Object {
  $p = ($all | Where-Object ProcessId -eq $_.OwningProcess)
  "{0} pid={1} exe={2} {3}" -f $_.LocalPort, $_.OwningProcess, $p.ExecutablePath, (($p.CommandLine -replace '\s+',' ').Substring(0,[Math]::Min(90,($p.CommandLine -replace '\s+',' ').Length)))
}
# 動いている native.exe をすべて、実行ファイルのパス付きで出す(MSI 版・開発版の両方が映る)
Get-Process native -ErrorAction SilentlyContinue | ForEach-Object { "{0} {1}" -f $_.Id, $_.Path }
# main の開発版(target/debug)の native.exe から親をたどり、tauri dev のプロセスツリーを特定する
$n = $all | Where-Object { $_.Name -eq 'native.exe' -and $_.ExecutablePath -eq $dev_exe }
foreach ($x in $n) { $cur = $x; for ($i=0; $i -lt 8 -and $cur; $i++) { $c = ($cur.CommandLine -replace '\s+',' '); "{0} {1}" -f $cur.ProcessId, $c.Substring(0,[Math]::Min(100,$c.Length)); $cur = $all | Where-Object ProcessId -eq $cur.ParentProcessId } }
Get-Process cargo,rustc -ErrorAction SilentlyContinue
```

ツリーは下から `native.exe` → `cargo` → `tauri.js dev` → `cmd /c cd apps/native/tauri && tauri dev --config ...` → `node(npm)` の順に並ぶ。
**最上位の `node`/`npm`** プロセスが停止対象。

- **MSI 版(`C:\Program Files\YAOYOROZU\native.exe`)は開発版と別物。止めない。** 14200 の持ち主が MSI 版なら §0 のとおり想定どおり(開発版は 14201 を使う)。
- `native.exe` が無く、1425 だけが使われている → Vite だけが残っている。1425 の pid から同じ要領で親をたどり、最上位の npm を停止対象にする。
- 3000 のプロセスが**別の worktree**(コマンドラインのパスが `C:\Users\yanqi\prj\yaoyorozu\` 以外)のものなら止めずにユーザーへ確認する。
- **1425 を別の worktree のアプリが使っている**(exe パスが `C:\Users\yanqi\prj\yaoyorozu\apps\native\target\debug\native.exe` 以外)なら、**中断してユーザーに確認する**(このポートは main 動作確認専用の固定値だが、衝突すると気づきにくいため)。他セッションのプロセスなので止めない。
- `cargo` / `rustc` が main のツリー以外にもいることがある。他セッションが自分の worktree でビルドしているものなので、触らない。

## 2. 停止と main の更新(並行して実行する)

- **Tauri(開発版)**: 動いていれば `taskkill /T /F /PID <最上位のnpm>`。その後、1425 が空き、停止したツリーの `native`(target\debug の exe)/ `cargo` が残っていないことを確かめる(他セッションの `cargo` / `rustc`、MSI 版の `native.exe` は対象外)。
- **Web**: `preview_list` で `yaoyorozu-web` の serverId を調べて `preview_stop`。
  preview 管理外の `next dev`(この作業ツリーのもの)が 3000 を使っていれば、その親の `next dev` から `taskkill /T /F`。
- **main の更新**: behind が 1 以上なら `git pull --ff-only origin main`。

自分で止めた起動タスクは「失敗(exit code 1)」として通知されるが、想定どおり。報告では一言触れるだけでよい。

## 3. 依存のインストール(必要なときだけ)

1-1 で「依存の変更: あり」だった場合、Web を止めたあと(2 の後)に `npm install` を実行する。
共有の `node_modules` を使う開発サーバが動いている間に入れ替えないため。

- 終了コードと、更新されたパッケージのバージョンを確認する。
- `npm warn allow-scripts`(インストールスクリプトの承認待ち)は、**承認しない**。セキュリティに関わる判断なので、出ていることを報告するだけにする。

## 4. 起動(3つを並行して実行する)

- **Web**: `preview_start`(`name: "yaoyorozu-web"`)
- **Tauri(開発版)**: `apps/native/tauri` で、`--config` により identifier と Vite ポートを MSI 版と分離して起動する。Bash の `run_in_background: true` で実行し、ログはスクラッチパッドに書き出す。

  ```bash
  cd /c/Users/yanqi/prj/yaoyorozu/apps/native/tauri && RUST_BACKTRACE=1 YAOYOROZU_LOCAL_API_PORT=14201 npx tauri dev --config '{"identifier":"com.yaoyorozu.native.dev-main","build":{"devUrl":"http://localhost:1425","beforeDevCommand":"npm run dev -- --port 1425"}}' > "<スクラッチパッド>/native-dev.log" 2>&1
  ```

  `RUST_BACKTRACE=1` は、パニック時にスタックトレースを残すため常に付ける。
  `YAOYOROZU_LOCAL_API_PORT=14201` で、ローカル API のポートを MSI 版(14200)と分ける(§0。issue #470)。
  `react/vite.config.ts` は `server.port: 1420` / `strictPort: true` を既定にしているため、`--port 1425` を明示して上書きする(1420・1421 は既定設定と HMR 用に使われているため避ける)。

- **起動完了の待機**: 同じく `run_in_background: true` で、Vite(1425)が応答し、かつ**開発版(target\debug)の** `native.exe` が起動しているか、エラーを検知したら終わるループを走らせる(上限15分)。
  ローカル API(14201)も、MSI 版(14200)とポートが分かれているため**待ち受けを完了条件にしてよい**(§0)。

  ```bash
  log="<スクラッチパッド>/native-dev.log"
  dev_exe='C:\Users\yanqi\prj\yaoyorozu\apps\native\target\debug\native.exe'
  vite_ready() { curl -s -o /dev/null -w '%{http_code}' http://localhost:1425 2>/dev/null; }
  dev_running() {
    powershell -NoProfile -Command "if (Get-Process native -ErrorAction SilentlyContinue | Where-Object { \$_.Path -eq '$dev_exe' }) { 'yes' } else { 'no' }" | tr -d '\r'
  }
  sleep 3
  end=$((SECONDS+900))
  until { [ "$(vite_ready)" = "200" ] && [ "$(dev_running)" = "yes" ]; } \
     || grep -qE 'error\[E|^error:|npm error|ELIFECYCLE|failed to (bundle|run|build)|panicked' "$log" 2>/dev/null \
     || [ $SECONDS -ge $end ]; do sleep 3; done
  if [ "$(vite_ready)" = "200" ] && [ "$(dev_running)" = "yes" ]; then echo "READY: 開発版(identifier分離)が起動";
  elif [ $SECONDS -ge $end ]; then echo "TIMEOUT (15分)";
  else echo "ERROR 検出"; fi
  echo "Vite(1425): $(vite_ready)  開発版プロセス: $(dev_running)"
  echo "--- log tail ---"; sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -v '^\s*$' | tail -6
  ```

  MSI 版(14200)と開発版(14201)はポートが分かれているため、`ローカルAPIサーバの起動に失敗しました...(os error 10048)` がログに出た場合は想定外(§0 の環境変数が効いていない・14201 を他の何かが使っている等)なので、報告する。

Rust に変更があると再ビルドで1〜2分かかる。変更が無ければ数秒で終わる。

## 5. 動作確認

待機が終わったら、結果の出力を読み、次を確認する。

```powershell
$dev_exe = 'C:\Users\yanqi\prj\yaoyorozu\apps\native\target\debug\native.exe'
Get-Process native -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $dev_exe } | Select-Object Id, MainWindowTitle, Responding, Path
foreach ($u in 'http://localhost:1425','http://localhost:3000') {
  try { $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 90; "{0} -> {1}" -f $u, $r.StatusCode } catch { "{0} -> 失敗: {1}" -f $u, $_.Exception.Message }
}
# 14200(MSI 版)・14201(開発版)それぞれの持ち主を確認する(issue #470)
foreach ($port in 14200, 14201) {
  $o = (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess
  if ($o) { "{0} の持ち主: pid={1} {2}" -f $port, $o, (Get-Process -Id $o).Path } else { "{0} は誰も待ち受けていない" -f $port }
}
```

- Web の初回アクセスはページのコンパイルで遅いことがあるので、タイムアウトは長め(90秒)にする。
- 1425(開発版の Vite)が 200 でも、応答しているのが別の worktree のアプリということがある。**開発版プロセスの exe パスが `target\debug\native.exe` であること**を必ず確かめる。違っていたら、状況を添えてユーザーに報告する。
- 14200 の持ち主が `C:\Program Files\YAOYOROZU\native.exe`(MSI 版)、14201 の持ち主が開発版(`target\debug\native.exe`)ならどちらも正常。14201 の持ち主が MSI 版の exe パスだったり、14200 に開発版の exe パスが出ていたら identifier・ポート分離が効いていない不具合なので、ユーザーに報告する。14200 を誰も待ち受けていなければ、MSI 版が起動していない状態(apps/web との連携確認は保留)。
- ウィンドウタイトルが「YAOYOROZU」以外(例:「設定」)でも、前回開いていた画面が復元されただけなので問題ない。

## 6. 報告

- 更新後の main のコミット(`<hash>`(PR #<番号>))と、取り込んだコミットの要約
- 再ビルドの有無と所要時間、`npm install` の有無
- 次の表

  | アプリ | 状態 |
  |---|---|
  | Tauri(開発版、動作確認専用) | ウィンドウ表示中(pid、応答あり) |
  | └ フロント(Vite) | http://localhost:1425 → 200 |
  | Web(Next.js) | http://localhost:3000 → 200 |
  | (参考)ローカル API MSI 版(14200) | 使用中(pid)/ 未起動 |
  | (参考)ローカル API 開発版(14201) | 使用中(pid、開発版の exe)/ 未起動 |

- 未コミットの変更を残したこと
- ローカル API 経由の確認(apps/web との連携)が必要な場合は MSI 版で行う旨

## 起動後に届く通知の読み方

起動タスクは、アプリが動いている間は終わらない。終わったという通知が来たら、ログを見て次のように判断する。

| ログの様子 | 意味 | 対応 |
|---|---|---|
| タスク全体が exit 0。最後に Vite の `npm error code 4294967295` だけがある | ウィンドウを閉じた(正常終了) | 停止した旨を報告するだけでよい |
| `File ... changed. Rebuilding application...` がある | `tauri dev` の監視機能が Rust ファイルの変更を検知して、自動で再ビルド・再起動した。古い `native.exe` が exit code 1 で終わることがある | 異常ではない。再起動後に動いているか確認して報告する |
| `panicked` / `stack backtrace` がある | アプリがクラッシュした | バックトレースを添えてユーザーに報告する |
| `ローカルAPIサーバの起動に失敗しました(127.0.0.1:14201): … (os error 10048)` がある | MSI 版とはポートが分かれている(§0)ため、14201 を他の何か(他セッションの開発版など)が先に取っている | 想定外。14201 の持ち主を調べてユーザーに報告する |
| こちらで `taskkill` した直後に「失敗」通知 | 自分で止めた | 想定どおり |

## 注意

- 他セッションの worktree(`.claude/worktrees/` 配下や `../yaoyorozu-*`)のプロセスやファイルには触れない。
- MSI 版(`C:\Program Files\YAOYOROZU\native.exe`)は日々の作業用。停止・再起動しない。
- main 以外のブランチへの切り替え、`git stash`、未コミット変更の破棄はしない。
- 手順を変えたら、このファイルを更新する。
