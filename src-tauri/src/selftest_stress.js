// 開発ビルドの強制終了テスト用(KEIRI_SELFTEST=stress のときだけ Rust 側から実行される)。
// 大きめのデータで保存(data.json の原子的書き込み+変更履歴の追記)を延々と繰り返す。外から kill -9 して壊れないかを確かめる。
(async function () {
  // 起動時の読み込み(loadAll)と履歴の後始末が終わるまで待つ。
  // 待たずに回すと、保存が即座に終わる(何も書かない)ため無限ループで読み込みの完了も止めてしまう
  while (!APP_READY) await new Promise(function (r) { setTimeout(r, 50); });
  if (state.transactions.length < 3000) {
    const base = [];
    for (let i = 0; i < 3000; i++) base.push({ id: 'tx_stress' + i, kind: 'expense', date: '2026-01-01', amount: i, memo: 'x'.repeat(200), fund: 'cash', account: 'supplies' });
    state.transactions = base;
  }
  // 画面と同じ経路(Store.addTransaction: 履歴の保留 → 保存 → 完了)で追加し続ける
  let n = 0;
  for (;;) {
    await Store.addTransaction({ kind: 'income', date: '2026-02-01', amount: ++n, memo: 'loop' + n, fund: 'bank', account: 'sales' });
  }
})();
