# 経理ノート — Claude Code 向け作業指示

個人事業主向けの複式簿記アプリ。現在は `index.html` 1ファイル(HTML/CSS/JS)。
目標は **Mac用オフラインデスクトップアプリ(Tauri v2)として GitHub で公開**すること。

## 決定事項(変更する場合は必ず先に確認すること)
- 完全オフライン。外部通信は一切しない(CSP で `connect-src 'none'` を維持)
  - 例外: Tauri 版ではアプリ内部 IPC のため `connect-src ipc: http://ipc.localhost` のみ許可(外部通信ではない。2026-09-27 ユーザー承認)
- データは Mac 上の通常ファイルに保存し、Time Machine の対象にする
- 保存先: `~/Library/Application Support/<bundle id>/`。iCloud Drive には本体を置かない
- アプリ側の自動バックアップ+世代管理を持つ
- Apple の署名・公証は当面しない(未署名で配布、README に開き方を記載)
- 税務の正確性は保証しない旨を免責として明記する

## 現状(第1段階 完了済み)
- Google Fonts 削除(システムフォント)、CSP 追加
- Claude 専用の保存機能(`window.claude` / dbモード / assets / downloads)は無効化済み。
  コードは残っているので、第2段階で `Store` を書き換える際に削除する
- バックアップ復元時の検証 `sanitizeBackup()` を追加(型・ID・不正キー・版数)
- バックアップ JSON に `app: 'keiri-note'`, `schemaVersion: 1` を付与
- 7日以上バックアップがないと警告を表示
- レシート画像機能はオフライン版では非表示(第2段階で復活させる)

## データモデル(schemaVersion 1)
- `transactions[]`: id, kind(KIND_LABELS のキー), date, amount, memo, fund, 勘定科目関連, receiptAssetId?
- `invoices[]`: id, number, issueDate, dueDate, clientName, clientAddress, items[{name, qty, unitPrice}], taxRate, notes, status
- `fixedAssets[]`: id, name, acquisitionDate, cost, usefulLifeYears, disposalDate
- `inventoryYearEnd{ "YYYY": {opening, closing} }`
- `settings`: `defaultSettings()` のキーのみ
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
- [ ] ネットワークを切った状態で全機能が動く
- [ ] アプリを強制終了してもデータが壊れない(書き込み中に kill して確認)
- [ ] Time Machine 対象フォルダにデータとバックアップがある
- [ ] 旧版の JSON を取り込むと件数・金額合計が一致する
- [ ] 不正な JSON を取り込んでも画面が壊れない

## 第3段階: 公開準備
- 計算ロジック(損益計算・減価償却・貸借対照表)のテスト
- README: 概要、インストール手順(未署名アプリの開き方: システム設定 → プライバシーとセキュリティ → このまま開く)、FileVault と Time Machine の推奨、免責
- LICENSE(ユーザーに種類を確認すること)
- GitHub Releases でビルド済みアプリを配布

## 作業ルール(トークン節約)
- ファイル全体の書き直しは避け、差分編集を基本にする
- ビルド・テストは自分で実行し、エラーは自分で読んで直す
- 依存パッケージの追加は理由を述べてから行う
- 各段階の終わりに完了条件を1つずつ確認して報告する
