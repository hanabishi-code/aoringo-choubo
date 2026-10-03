// 検索(txMatches)のテスト: 文字・日付の範囲・金額の範囲と、その組み合わせ。
// 実行: osascript -l JavaScript tests/check_search.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }
var document = { addEventListener: function () {} }; var window = {};
var localStorage = { getItem: function () { return null; }, setItem: function () {} };
var app = (new Function('document', 'window', 'localStorage', read('src/app.js') +
  '\nreturn { txMatches: txMatches, emptySearch: emptySearch, isSearchActive: isSearchActive };'))(document, window, localStorage);

var results = [];
function check(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push((ok ? 'OK  ' : 'NG  ') + name + (ok ? '' : '  実際=' + JSON.stringify(actual) + ' 期待=' + JSON.stringify(expected)));
}
var txs = [
  { id: 't1', kind: 'expense', date: '2025-04-15', amount: 1100, memo: 'タクシー 新宿', fund: 'cash', account: 'travel' },
  { id: 't2', kind: 'income', date: '2025-05-31', amount: 330000, memo: '株式会社テスト 5月分', fund: 'bank', account: 'sales' },
  { id: 't3', kind: 'expense', date: '2026-01-10', amount: 25000, memo: 'ＰＣ周辺機器', fund: 'bank', account: 'supplies' },
  { id: 't4', kind: 'expense_accrued', date: '2025-12-31', amount: 11000, memo: '', account: 'utilities', accountType: 'expense', liability: 'accrued' }
];
function find(q) { return txs.filter(function (t) { return app.txMatches(t, Object.assign(app.emptySearch(), q)); }).map(function (t) { return t.id; }); }

check('条件なし → 検索中ではない', app.isSearchActive(app.emptySearch()), false);
check('メモの一部', find({ text: 'タクシー' }), ['t1']);
check('科目名(旅費交通費)', find({ text: '旅費' }), ['t1']);
check('区分名(未払計上)と科目名(未払金)', [find({ text: '未払計上' }), find({ text: '未払金' })], [['t4'], ['t4']]);
check('全角・半角、大文字・小文字の違いを無視(pc → ＰＣ)', find({ text: 'pc' }), ['t3']);
check('金額(カンマ・円・¥ 付きでも同じ。金額は完全一致なので 1100 で 11,000 は出ない)', [find({ text: '1,100' }), find({ text: '1100円' }), find({ text: '¥330,000' }), find({ text: '11000' })], [['t1'], ['t1'], ['t2'], ['t4']]);
check('数字は日付とは部分一致(2026 → 2026年の日付 / 31 → 31日の取引)', [find({ text: '2026' }), find({ text: '31' })], [['t3'], ['t2', 't4']]);
check('空白で区切った語はすべて含む(AND)', [find({ text: 'テスト 5月' }), find({ text: 'テスト 6月' })], [['t2'], []]);
check('日付の範囲(から〜まで、両端を含む)', find({ dateFrom: '2025-05-31', dateTo: '2025-12-31' }), ['t2', 't4']);
check('日付(からのみ)', find({ dateFrom: '2026-01-01' }), ['t3']);
check('金額の範囲(以上〜以下、両端を含む)', find({ amountMin: '1100', amountMax: '11000' }), ['t1', 't4']);
check('組み合わせ: 日付 × 金額 × 文字', find({ dateFrom: '2025-01-01', dateTo: '2025-12-31', amountMin: '10000', text: '普通預金' }), ['t2']);
check('条件に合うものがない', find({ amountMin: '999999' }), []);

results.join('\n') + '\n\n' + results.filter(function (r) { return r.indexOf('NG') === 0; }).length + ' 件 NG / ' + results.length + ' 件';
