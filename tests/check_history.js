// 変更履歴の「保留(pending)のまま残った変更が、データに反映されているか」の判定(historyApplied)のテスト。
// 強制終了で完了の印が書けなかったとき、次の起動時にこの判定で done / aborted を決める。
// 実行: osascript -l JavaScript tests/check_history.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }
var document = { addEventListener: function () {} }; var window = {};
var localStorage = { getItem: function () { return null; }, setItem: function () {} };
var app = (new Function('document', 'window', 'localStorage', read('src/app.js') +
  '\nreturn { state: state, defaultSettings: defaultSettings, historyApplied: historyApplied };'))(document, window, localStorage);

var results = [];
function check(name, actual, expected) {
  results.push((actual === expected ? 'OK  ' : 'NG  ') + name + (actual === expected ? '' : '  実際=' + actual + ' 期待=' + expected));
}
var s = app.state;
s.settings = Object.assign(app.defaultSettings(), { businessName: '新しい屋号' });
s.transactions = [{ id: 'tx_a', kind: 'expense', date: '2026-01-01', amount: 2000, memo: '修正後' }];
s.invoices = []; s.fixedAssets = []; s.inventoryYearEnd = { 2025: { opening: 0, closing: 5000 } };
var before = { id: 'tx_a', kind: 'expense', date: '2026-01-01', amount: 1000, memo: '修正前' };
var after = s.transactions[0];

check('追加: 取引がある → 反映済み', app.historyApplied({ action: 'add', target: 'transaction', after: after }), true);
check('追加: 取引がない → 未反映', app.historyApplied({ action: 'add', target: 'transaction', after: { id: 'tx_none' } }), false);
check('修正: 修正後の値になっている → 反映済み', app.historyApplied({ action: 'update', target: 'transaction', before: before, after: after }), true);
check('修正: 修正前の値のまま → 未反映', app.historyApplied({ action: 'update', target: 'transaction', before: after, after: before }), false);
check('削除: 取引が残っていない → 反映済み', app.historyApplied({ action: 'delete', target: 'transaction', before: { id: 'tx_gone' } }), true);
check('削除: 取引が残っている → 未反映', app.historyApplied({ action: 'delete', target: 'transaction', before: after }), false);
check('設定: 新しい値になっている → 反映済み', app.historyApplied({ action: 'update', target: 'settings', after: { businessName: '新しい屋号' } }), true);
check('設定: 古い値のまま → 未反映', app.historyApplied({ action: 'update', target: 'settings', after: { businessName: '古い屋号' } }), false);
check('棚卸高: 同じ値 → 反映済み', app.historyApplied({ action: 'update', target: 'inventory', year: 2025, after: { opening: 0, closing: 5000 } }), true);
check('棚卸高: 違う値 → 未反映', app.historyApplied({ action: 'update', target: 'inventory', year: 2025, after: { opening: 0, closing: 9999 } }), false);
check('取り込み・復元: 件数が一致 → 反映済み', app.historyApplied({ action: 'import', target: 'all', after: { transactions: 1, invoices: 0, fixedAssets: 0 } }), true);
check('取り込み・復元: 件数が違う → 未反映', app.historyApplied({ action: 'restore', target: 'all', after: { transactions: 5, invoices: 0, fixedAssets: 0 } }), false);

results.join('\n') + '\n\n' + results.filter(function (r) { return r.indexOf('NG') === 0; }).length + ' 件 NG / ' + results.length + ' 件';
