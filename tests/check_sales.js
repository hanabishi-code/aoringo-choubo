// 請求書から売上を記録する機能のテスト(日付の決め方・税率ごとの金額・記録済みの判定・取り込みの検証)。名前・金額は架空。
// 実行: osascript -l JavaScript tests/check_sales.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }
var document = { addEventListener: function () {} }; var window = {};
var localStorage = { getItem: function () { return null; }, setItem: function () {} };
var app = (new Function('document', 'window', 'localStorage', read('src/app.js') +
  '\nreturn { state: state, defaultSettings: defaultSettings, salesDateFor: salesDateFor, salesPrefillsFor: salesPrefillsFor, remainingSalesPrefills: remainingSalesPrefills, invoiceSalesTxs: invoiceSalesTxs, invoiceViewModel: invoiceViewModel, sanitizeBackup: sanitizeBackup, historyValue: historyValue, SCHEMA_VERSION: SCHEMA_VERSION };'))(document, window, localStorage);
var results = [];
function check(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push((ok ? 'OK  ' : 'NG  ') + name + (ok ? '' : '  実際=' + JSON.stringify(actual) + ' 期待=' + JSON.stringify(expected)));
}
function d(td, issue) { return app.salesDateFor({ transactionDate: td, issueDate: issue || '2026-10-05' }); }

/* 1. 日付の決め方 */
check('取引年月日が日付ならその日(いろいろな書き方)', [d('2026-09-15'), d('2026年9月15日'), d('2026/9/5'), d('２０２６年９月１５日')], ['2026-09-15', '2026-09-15', '2026-09-05', '2026-09-15']);
check('期間(「○年○月分」など)ならその月の末日(うるう年も)', [d('2026年9月分'), d('2026年2月分'), d('2028年2月分'), d('2026-12'), d('2026年8月1日〜31日'), d('2026年2月30日')], ['2026-09-30', '2026-02-28', '2028-02-29', '2026-12-31', '2026-08-31', '2026-02-28']);
check('年月が読めなければ発行日', [d(''), d('先月分'), d('2026年13月分')], ['2026-10-05', '2026-10-05', '2026-10-05']);

/* 2. 税率ごとの金額(税込) */
app.state.settings = app.defaultSettings(); app.state.transactions = []; app.state.invoices = [];
var inv = { id: 'iv_1', number: '2026-001', issueDate: '2026-10-05', transactionDate: '2026年9月分', partnerId: 'pt_1', taxRounding: 'floor', status: '送付済み(未入金)',
  items: [{ name: '作業', qty: 1, unitPrice: 50000, taxRate: 10 }, { name: '菓子', qty: 2, unitPrice: 1234, taxRate: 8 }] };
inv.issued = { at: '2026-10-05', view: app.invoiceViewModel(inv, app.state.settings) };
app.state.invoices = [inv];
var pf = app.salesPrefillsFor(inv);
check('8% の明細がある請求書は、税率ごとに2件(10%: 50,000 + 5,000 / 8%: 2,468 + 197)', pf.map(function (p) { return [p.taxCategory, p.amount, p.date, p.memo]; }),
  [['standard', 55000, '2026-09-30', '請求書 No.2026-001(10%分)'], ['reduced', 2665, '2026-09-30', '請求書 No.2026-001(8%(軽減)分)']]);
check('区分は収入・科目は売上・取引先は請求書の取引先', [pf[0].kind, pf[0].account, pf[0].partnerId], ['income', 'sales', 'pt_1']);
var only10 = Object.assign({}, inv, { id: 'iv_2', items: [{ name: '作業', qty: 1, unitPrice: 10000, taxRate: 10 }] });
only10.issued = { at: 'x', view: app.invoiceViewModel(only10, app.state.settings) };
check('10% だけの請求書は1件、メモに税率は付けない', app.salesPrefillsFor(only10).map(function (p) { return [p.amount, p.memo]; }), [[11000, '請求書 No.2026-001']]);

/* 3. 記録済みの判定(二重計上の防止) */
check('まだ何も記録していない → 2件とも残り', app.remainingSalesPrefills(inv).length, 2);
app.state.transactions.push({ id: 'tx_a', kind: 'income', date: '2026-09-30', amount: 55000, account: 'sales', fund: 'bank', taxCategory: 'standard', invoiceId: 'iv_1' });
check('10% の分を記録したら、残りは 8% の分だけ', app.remainingSalesPrefills(inv).map(function (p) { return p.taxCategory; }), ['reduced']);
app.state.transactions.push({ id: 'tx_b', kind: 'income', date: '2026-09-30', amount: 2665, account: 'sales', fund: 'bank', taxCategory: 'reduced', invoiceId: 'iv_1' });
check('両方記録したら残りなし(もう一度押すと注意)・記録済み 2件', [app.remainingSalesPrefills(inv).length, app.invoiceSalesTxs(inv).length], [0, 2]);

/* 4. 取り込みの検証・移行・変更履歴の表示 */
var s = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 12, transactions: [
  { id: 'tx_1', kind: 'income', date: '2026-01-01', amount: 1, fund: 'bank', account: 'sales', invoiceId: 'iv_ok' },
  { id: 'tx_2', kind: 'income', date: '2026-01-01', amount: 1, fund: 'bank', account: 'sales', invoiceId: '../evil' }] });
check('取り込み: 正しい invoiceId は残し、不正なものは外す', s.transactions.map(function (t) { return t.invoiceId; }), ['iv_ok', undefined]);
check('変更履歴: もとの請求書は番号で表示', [app.historyValue('invoiceId', 'iv_1'), app.historyValue('invoiceId', 'iv_gone')], ['請求書 No.2026-001', '(削除された請求書)']);
check('SCHEMA_VERSION は 12', app.SCHEMA_VERSION, 12);
/* 5. 請求書のタブを表示しない設定 */
var hs = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 12, settings: { hideInvoiceTab: 1 } });
var hb = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 12, settings: { hideInvoiceTab: 5 } });
check('設定: 請求書のタブを表示しない(1)は取り込み、0・1 以外は取り込まない、初期値は表示する(0)', [hs.settings.hideInvoiceTab, hb.settings.hideInvoiceTab, app.defaultSettings().hideInvoiceTab], [1, undefined, 0]);
check('変更履歴: 表示する/表示しない', [app.historyValue('hideInvoiceTab', 0), app.historyValue('hideInvoiceTab', 1)], ['表示する', '表示しない']);

results.join('\n') + '\n\n' + results.filter(function (r) { return r.indexOf('NG') === 0; }).length + ' 件 NG / ' + results.length + ' 件';
