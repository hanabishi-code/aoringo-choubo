# 経理ノート — Claude Code 向け作業指示

個人事業主向けの複式簿記アプリ。画面は `src/`(index.html / styles.css / app.js)、Mac アプリ側は `src-tauri/`(Tauri v2・Rust)。
旧ブラウザ版は `legacy/index.html`(ブラウザで開いてもアプリにはならない)。
目標は **Mac用オフラインデスクトップアプリ(Tauri v2)として GitHub で公開**すること。

## 決定事項(変更する場合は必ず先に確認すること)
- 完全オフライン。外部通信は一切しない(CSP で `connect-src 'none'` を維持)
  - 例外: Tauri 版ではアプリ内部 IPC のため `connect-src ipc: http://ipc.localhost` のみ許可(外部通信ではない。2026-09-27 ユーザー承認)
- データは Mac 上の通常ファイルに保存し、Time Machine の対象にする
- 保存先: `~/Library/Application Support/<bundle id>/`。iCloud Drive には本体を置かない
- アプリ側の自動バックアップ+世代管理を持つ
- Apple の署名・公証は当面しない(未署名で配布、README に開き方を記載)
- 税務の正確性は保証しない旨を免責として明記する

## 現状(第2段階 完了済み・2026-09-29)
- 保存先 `~/Library/Application Support/com.keirinote.desktop/`:
  `data.json`(本体)、`history.jsonl`(変更履歴・追記専用)、`backups/`(自動バックアップ・各種退避)、`receipts/`(レシート画像)
- 書き込みは Rust 側で原子的(一時ファイル → fsync → rename)。書き出しは Rust 側の保存ダイアログで選んだ場所のみ
- 依存: chrono(日付)、tauri-plugin-dialog(保存ダイアログ)。いずれもユーザー承認済み・通信なし
- 開発ビルドの起動: `src-tauri/target/debug/keiri-note`(`cargo build` 後)。
  自己テスト: `KEIRI_SELFTEST=1`(画像保存)/ `KEIRI_SELFTEST=stress`(強制終了テスト用)+ `KEIRI_DATA_DIR=<一時フォルダ>`。開発ビルドのみ有効
- テスト: `cargo test`(src-tauri)、`osascript -l JavaScript tests/check_calc.js`・`check_import.js`・`check_history.js`・`check_receipt_ipc.js`

## データモデル(schemaVersion 4)
- `transactions[]`: id, kind(KIND_LABELS のキー), date, amount, memo, fund, 勘定科目関連, receiptAssetId?, linkedAssetId?
  - kind `asset_purchase`(固定資産の購入): 固定資産台帳から自動で作る。借方 固定資産 / 貸方 fund(cash/bank)または liability(accrued=未払金)
  - `linkedAssetId` のある取引は台帳と連動(購入 = asset_purchase、売却代金 = contribution)。取引一覧から直接は編集・削除しない
- `invoices[]`: id, number, issueDate, dueDate, clientName, clientAddress, items[{name, qty, unitPrice}], taxRate, notes, status
- `fixedAssets[]`: id, name, acquisitionDate, cost, usefulLifeYears(2〜50), disposalDate,
  payFund?(cash / bank / accrued。未設定は支払い未記録の既存資産), disposalType?(retire=除却 / sale=売却), saleAmount?, saleFund?(cash / bank)
- `inventoryYearEnd{ "YYYY": {opening, closing} }`
- `settings`: `defaultSettings()` のキーのみ(depreciationRounding: floor / round / ceil、初期値 floor を含む)
- バックアップ JSON のみ: `receipts{ 画像ID: base64 }`
- 版ごとの変更と移行(`migrateBackup()`): v2 で receipts、v3 で固定資産の処分の種類・売却代金(処分日のある既存資産は除却)、
  v4 で asset_purchase と payFund(既存資産は未設定のまま)。移行の前に data.json を `*-pre-migrate.json` として必ず退避する
データ形式を変える場合は schemaVersion を上げ、旧版からの移行関数を必ず書くこと。

## 第2段階: Mac アプリ化(完了条件つき)
1. Tauri v2 プロジェクト化。同時に index.html を HTML / CSS / JS に分割(分割はこの1回だけ)
2. `Store` をファイル保存に置き換え(Rust 側コマンド or tauri-plugin-fs)
   - 書き込みは「一時ファイルに書く → fsync → rename」で原子的に行う
3. 自動バックアップ: 起動時と終了時に `backups/` へ日付付きで保存。直近30日分+各月末を保持し、それ以外は削除
4. 復元画面: バックアップ一覧から選んで復元(復元前に現状も自動退避)
5. 旧版(ブラウザ版)のバックアップ JSON 取り込み(`sanitizeBackup` を再利用)
6. 変更履歴: 追加・修正・削除を追記専用ログに記録し、画面で閲覧できる
7. レシート画像: `receipts/` にファイル保存。バックアップにも含める

完了条件:
- [x] ネットワークを切った状態で全機能が動く(2026-09-29 ユーザー確認)
- [x] アプリを強制終了してもデータが壊れない(kill -9 を計45回。変更履歴の1行欠落は第3段階で修正)
- [ ] Time Machine 対象フォルダにデータとバックアップがある
      → アプリ側は完了(データ・backups・receipts は tmutil で Included)。Time Machine の設定待ち
- [x] 旧版の JSON を取り込むと件数・金額合計が一致する(テスト用ファイルで確認)
- [x] 不正な JSON を取り込んでも画面が壊れない

## 第3段階: 公開準備
- 計算ロジック(損益計算・減価償却・貸借対照表)のテスト
- README: 概要、インストール手順(未署名アプリの開き方: システム設定 → プライバシーとセキュリティ → このまま開く)、FileVault と Time Machine の推奨、免責
- LICENSE(ユーザーに種類を確認すること)
- GitHub Releases でビルド済みアプリを配布
- 初回 push の前に必ずユーザーに提案すること: コミット作成者のメールアドレスが個人アドレスになっている。
  GitHub の noreply アドレスに切り替え、既存コミットの作成者も書き換えるか確認する(push 後は書き換え困難)

## 作業ルール(トークン節約)
- ファイル全体の書き直しは避け、差分編集を基本にする
- ビルド・テストは自分で実行し、エラーは自分で読んで直す
- 依存パッケージの追加は理由を述べてから行う
- 各段階の終わりに完了条件を1つずつ確認して報告する
