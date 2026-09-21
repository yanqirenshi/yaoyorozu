---
name: restart-app
description: main ブランチを最新にして、動作確認用のアプリ(Tauri の開発版と Web の開発サーバ)を両方とも再起動する。「main を最新にしてアプリを再起動」「アプリを起動して」と依頼されたときに使う。運用:リリース セッション専用(CLAUDE.md「セッション構成」)。
---

# /restart-app

main 作業ツリー(`C:\Users\yanqi\prj\yaoyorozu`)で、次の2つを最新の main で起動し直す。

| 対象 | 起動方法 | ポート |
|---|---|---|
| Tauri 開発版(`npm run native:dev`) | Bash のバックグラウンド実行 | 1420(Vite)、14200(ローカル API) |
| Web(Next.js) | `preview_start`(`.claude/launch.json` の `yaoyorozu-web`) | 3000 |

main でのアプリ起動は 運用:リリース セッションが担当する(2026-09-19 決定)。
他セッションの作業を壊さないことを最優先とし、判断に迷う状態なら止めてユーザーに確認する。

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
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 1420,3000,14200 } | ForEach-Object { "{0} pid={1}" -f $_.LocalPort,$_.OwningProcess }
# native.exe から親をたどり、tauri dev のプロセスツリーを特定する
$n = $all | Where-Object Name -eq 'native.exe'
foreach ($x in $n) { $cur = $x; for ($i=0; $i -lt 8 -and $cur; $i++) { $c = ($cur.CommandLine -replace '\s+',' '); "{0} {1}" -f $cur.ProcessId, $c.Substring(0,[Math]::Min(100,$c.Length)); $cur = $all | Where-Object ProcessId -eq $cur.ParentProcessId } }
Get-Process cargo,rustc -ErrorAction SilentlyContinue
```

ツリーは下から `native.exe` → `cargo` → `tauri.js dev` → `cmd /c cd tauri && tauri dev` → `node(npm)` → `cmd /c npm run tokens && npm run tauri:dev ...` → `node(npm)` の順に並ぶ。
**最上位の `node(npm)`**(`npm run tokens && ...` の `cmd` の親)が停止対象。

- `native.exe` が無く、1420 だけが使われている → Vite だけが残っている。1420 の pid から同じ要領で親をたどり、最上位の npm を停止対象にする。
- 3000 のプロセスが**別の worktree**(コマンドラインのパスが `C:\Users\yanqi\prj\yaoyorozu\` 以外)のものなら止めずにユーザーへ確認する。

## 2. 停止と main の更新(並行して実行する)

- **Tauri**: 動いていれば `taskkill /T /F /PID <最上位のnpm>`。その後、1420 / 14200 が空き、`cargo` / `rustc` / `native` が残っていないことを確かめる。
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
- **Tauri**: Bash の `run_in_background: true` で起動する。ログはスクラッチパッドに書き出す。

  ```bash
  cd /c/Users/yanqi/prj/yaoyorozu && RUST_BACKTRACE=1 npm run native:dev > "<スクラッチパッド>/native-dev.log" 2>&1
  ```

  `RUST_BACKTRACE=1` は、パニック時にスタックトレースを残すため常に付ける。

- **起動完了の待機**: 同じく `run_in_background: true` で、14200 の待ち受け開始かエラーを検知したら終わるループを走らせる(上限15分)。

  ```bash
  log="<スクラッチパッド>/native-dev.log"
  sleep 3
  end=$((SECONDS+900))
  until netstat -ano 2>/dev/null | grep -qE '127\.0\.0\.1:14200 .*LISTENING' \
     || grep -qE 'error\[E|^error:|npm error|ELIFECYCLE|failed to (bundle|run|build)|panicked' "$log" 2>/dev/null \
     || [ $SECONDS -ge $end ]; do sleep 2; done
  if netstat -ano 2>/dev/null | grep -qE '127\.0\.0\.1:14200 .*LISTENING'; then echo "READY: 14200 listening";
  elif [ $SECONDS -ge $end ]; then echo "TIMEOUT (15分)";
  else echo "ERROR 検出"; fi
  echo "--- log tail ---"; sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -v '^\s*$' | tail -4
  ```

Rust に変更があると再ビルドで1〜2分かかる。変更が無ければ数秒で終わる。

## 5. 動作確認

待機が終わったら、結果の出力を読み、次を確認する。

```powershell
Get-Process native -ErrorAction SilentlyContinue | Select-Object Id, MainWindowTitle, Responding
foreach ($u in 'http://127.0.0.1:14200/health','http://localhost:1420','http://localhost:3000') {
  try { $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 90; "{0} -> {1}" -f $u, $r.StatusCode } catch { "{0} -> 失敗: {1}" -f $u, $_.Exception.Message }
}
```

- Web の初回アクセスはページのコンパイルで遅いことがあるので、タイムアウトは長め(90秒)にする。
- ウィンドウタイトルが「YAOYOROZU」以外(例:「設定」)でも、前回開いていた画面が復元されただけなので問題ない。

## 6. 報告

- 更新後の main のコミット(`<hash>`(PR #<番号>))と、取り込んだコミットの要約
- 再ビルドの有無と所要時間、`npm install` の有無
- 次の表

  | アプリ | 状態 |
  |---|---|
  | Tauri(デスクトップ) | ウィンドウ表示中(pid、応答あり) |
  | ├ フロント(Vite) | http://localhost:1420 → 200 |
  | └ ローカル API | http://127.0.0.1:14200/health → 200 |
  | Web(Next.js) | http://localhost:3000 → 200 |

- 未コミットの変更を残したこと

## 起動後に届く通知の読み方

起動タスクは、アプリが動いている間は終わらない。終わったという通知が来たら、ログを見て次のように判断する。

| ログの様子 | 意味 | 対応 |
|---|---|---|
| タスク全体が exit 0。最後に Vite の `npm error code 4294967295` だけがある | ウィンドウを閉じた(正常終了) | 停止した旨を報告するだけでよい |
| `File ... changed. Rebuilding application...` がある | `tauri dev` の監視機能が Rust ファイルの変更を検知して、自動で再ビルド・再起動した。古い `native.exe` が exit code 1 で終わることがある | 異常ではない。再起動後に動いているか確認して報告する |
| `panicked` / `stack backtrace` がある | アプリがクラッシュした | バックトレースを添えてユーザーに報告する |
| こちらで `taskkill` した直後に「失敗」通知 | 自分で止めた | 想定どおり |

## 注意

- 他セッションの worktree(`.claude/worktrees/` 配下や `../yaoyorozu-*`)のプロセスやファイルには触れない。
- main 以外のブランチへの切り替え、`git stash`、未コミット変更の破棄はしない。
- 手順を変えたら、このファイルを更新する。
