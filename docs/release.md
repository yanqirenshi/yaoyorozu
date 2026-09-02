# apps/native のリリース手順

`apps/native`(YAOYOROZU)のリリースは、git タグの push を起点に
[`.github/workflows/release.yml`](../.github/workflows/release.yml) が
MSI をビルドし、draft の GitHub Release を作成する。署名は行わない
(決定済み)。

## 手順

1. **バージョンを上げる**

   [`apps/native/tauri/tauri.conf.json`](../apps/native/tauri/tauri.conf.json)
   の `version` を新しいバージョン(例: `0.2.0`)に変更し、コミットする。
   このバージョンが `apps/native` のソースオブトゥルース。

2. **タグを push する**

   `tauri.conf.json` の `version` と**完全に一致する** `vX.Y.Z` 形式の
   タグを打ち、push する。

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

   一致しない場合、ワークフローはビルド前に失敗する(バージョン上げ
   忘れの検出)。

3. **Actions の完了を待つ**

   [GitHub Actions](../../actions) で `Release` ワークフローが成功する
   ことを確認する。成功すると、リポジトリの Releases に **draft** の
   リリースが作成され、以下が添付される。

   - `YAOYOROZU_X.Y.Z_x64_en-US.msi`
   - 同名 `.sha256`(チェックサム。ダウンロードした MSI の検証に使う)

4. **draft の内容を確認する**

   MSI をダウンロードして実機にインストールし、以下を確認する。

   - アプリが起動する(署名なしのため SmartScreen の警告が出るのは
     想定どおり)
   - 「アプリと機能」からアンインストールできる

5. **リリースノートを整えて publish する**

   前回タグ以降の変更(`git log <前回タグ>..vX.Y.Z --oneline`)を日本語で
   要約し、draft に設定する。複数行のノートは一時ファイルに書いて
   `--notes-file` で渡す(`--notes` に長文を直接渡すとシェルによって
   改行の扱いが崩れる)。

   ```bash
   gh release edit v0.2.0 --notes-file <ノートのパス>
   ```

   問題なければ publish する(誤タグ push の保険として、自動 publish は
   しない)。GitHub の Releases 画面から手動で行ってもよい。

   ```bash
   gh release edit v0.2.0 --draft=false
   ```

   なお draft の間、`gh release view` が返す URL は
   `.../releases/tag/untagged-<hash>` 形式で、publish 後に
   `.../releases/tag/vX.Y.Z` に変わる。

## スコープ外

- コード署名(署名なしで開始と決定済み。導入する場合は別途対応)
- winget への提出(公開配布に見合う完成度になるまで見送り。
  CLAUDE.md「配布(apps/native)」を参照)
- 自動アップデータ(`tauri-plugin-updater`)。当面は GitHub Releases から
  新しい MSI を手動で入れ直す運用とする
