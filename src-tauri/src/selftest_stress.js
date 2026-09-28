// 開発ビルドの強制終了テスト用(KEIRI_SELFTEST=stress のときだけ Rust 側から実行される)。
// 大きめのデータで保存(data.json の原子的書き込み+変更履歴の追記)を延々と繰り返す。外から kill -9 して壊れないかを確かめる。
(async function () {
  // 起動時の読み込み(loadAll)が終わってファイル保存が有効になるまで待つ。
  // 待たずに回すと、保存が即座に終わる(何も書かない)ため無限ループで読み込みの完了も止めてしまう
  while (STORAGE_MODE !== 'file') await new Promise(function (r) { setTimeout(r, 50); });
  if (state.transactions.length < 3000) {
    const base = [];
    for (let i = 0; i < 3000; i++) base.push({ id: 'tx_stress' + i, kind: 'expense', date: '2026-01-01', amount: i, memo: 'x'.repeat(200), fund: 'cash', account: 'supplies' });
    state.transactions = base;
  }
  let n = 0;
  for (;;) {
    state.transactions.push({ id: 'tx_loop' + (++n) + '_' + Date.now(), kind: 'income', date: '2026-02-01', amount: n, memo: 'loop' + n, fund: 'bank', account: 'sales' });
    try { await persist(); }
    catch (e) { await window.__TAURI__.core.invoke('selftest_report', { msg: 'save error after ' + n + ': ' + (typeof e === 'string' ? e : (e && e.message)) + ' mode=' + STORAGE_MODE }); return; }
    logChange('add', 'transaction', undefined, { n: n });
  }
})();
