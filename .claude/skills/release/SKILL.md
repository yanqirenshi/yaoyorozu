---
name: release
description: apps/native(YAOYOROZU)のリリースを実施する。引数にバージョン(例 0.1.0)を取り、バージョン確認→タグpush→Actions監視→draft検証→publishまでを行う。リリース作業の依頼時に使用。
---

# /release <version>

apps/native(YAOYOROZU)を GitHub Releases にリリースする。
引数 `<version>` は `X.Y.Z` 形式(タグは `v<version>`)。引数が無い場合は、ユーザーにリリースするバージョンを確認してから進める。

配布方針(CLAUDE.md「配布(apps/native)」): GitHub Releases での MSI 公開のみ。署名なし。winget への提出はしない。

## 1. 前提チェック(必ず最初に行う。1つでも満たさなければ中断して報告)

1. カレントブランチが `main` で、`git status` がクリーンであること。未コミットの変更があれば**リリースに含めるべきか判断できないため中断**し、ユーザーに確認する。
2. `git pull origin main` で最新化する。
3. 同じバージョンのタグ・Release が存在しないこと: `git tag -l "v<version>"` と `gh release view v<version>` がどちらも空/エラーであること。
4. `apps/native/tauri/tauri.conf.json` の `version` を確認する:
   - 引数と一致 → そのまま次へ。
   - 不一致 → `version` を引数の値に書き換えてコミット(例: 「v0.2.0 にバージョンを上げる」)し、`git push origin main` する。
   - タグとこの `version` が一致しないとワークフローはビルド前に失敗する(上げ忘れ検出の仕様)。

## 2. タグ push とビルド監視

5. タグを作成して push する:
   ```bash
   git tag v<version> && git push origin v<version>
   ```
6. Release ワークフローの完了を監視する: `gh run list --workflow=release.yml --limit 1` で run ID を取り、`gh run watch <id>` で待つ。
   - **失敗した場合**: ログ(`gh run view <id> --log-failed`)から原因を特定して報告し、中断する。修正後にやり直す場合はタグを削除してから(`git tag -d v<version> && git push origin --delete v<version>`)再実行する。
7. draft Release が作成され、以下が添付されていることを確認する(`gh release view v<version>`):
   - `YAOYOROZU_<version>_x64_en-US.msi`
   - 同名の `.sha256`

## 3. 実機確認(ユーザーと協働)

8. MSI のインストール確認は**ユーザーに依頼する**(自動化しない): draft から MSI をダウンロード → インストール → アプリ起動 → 「アプリと機能」からアンインストールできること。SmartScreen の警告は署名なしのため想定どおり(「詳細情報 → 実行」)。

## 4. publish

9. リリースノートを整える: 前回タグ以降の変更を `git log <前回タグ>..v<version> --oneline --no-merges` から要約し(日本語)、一時ファイルに書いて `gh release edit v<version> --notes-file <パス>` で設定する。
   - `--notes` に長文を直接渡すとシェルによって改行の扱いが崩れるため、必ずファイル経由にする。
   - draft の間、`gh release view` が返す URL は `.../releases/tag/untagged-<hash>` 形式(publish 後に `.../releases/tag/v<version>` に変わる)。ユーザーに draft を案内するときはこの URL をそのまま渡す。
10. **ユーザーの明示的な承認を得てから** publish する:
    ```bash
    gh release edit v<version> --draft=false
    ```
    (draft のまま止める判断もありうるため、承認前に publish しない)
11. 公開 URL を報告して完了。

## 注意

- 本スキルと [docs/release.md](../../../docs/release.md) の内容がズレたら、必ず両方を更新する。
- リリースのやり直し(タグ打ち直し)は「タグ削除 → 修正 → 再タグ」で行い、公開済み Release の上書きはしない。
