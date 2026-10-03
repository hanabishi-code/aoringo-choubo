// 取引先(schemaVersion 8)のテスト: 移行(請求書の宛先から作成)、取り込みの検証、集計、検索、統合。
// 実行: osascript -l JavaScript tests/check_partners.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }
var document = { addEventListener: function () {} }; var window = {};
var localStorage = { getItem: function () { return null; }, setItem: function () {} };
var app = (new Function('document', 'window', 'localStorage', read('src/app.js') +
  '\nreturn { state: state, defaultSettings: defaultSettings, sanitizeBackup: sanitizeBackup, partnerSummary: partnerSummary, txMatches: txMatches, emptySearch: emptySearch, Store: Store, findPartnerByName: findPartnerByName, SCHEMA_VERSION: SCHEMA_VERSION, invoiceMatches: invoiceMatches };'))(document, window, localStorage);
var results = [];
function check(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push((ok ? 'OK  ' : 'NG  ') + name + (ok ? '' : '  実際=' + JSON.stringify(actual) + ' 期待=' + JSON.stringify(expected)));
}

/* 1. 移行 v7 → v8 */
var m = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 7,
  transactions: [{ id: 'tx_1', kind: 'income', date: '2026-01-10', amount: 110000, fund: 'bank', account: 'sales', memo: '株式会社テスト 1月分', taxCategory: 'standard' }],
  invoices: [
    { id: 'inv_1', number: '1', clientName: '株式会社テスト', clientAddress: '東京都', items: [], taxRounding: 'round' },
    { id: 'inv_2', number: '2', clientName: ' 株式会社テスト ', items: [], taxRounding: 'round' },
    { id: 'inv_3', number: '3', clientName: '別の会社', items: [], taxRounding: 'round', status: '下書き' },
    { id: 'inv_4', number: '4', clientName: '', items: [], taxRounding: 'round' }] });
check('移行: 請求書の宛先から取引先を作る(同じ名前は1つ、空は作らない)', m.partners.map(function (p) { return [p.name, p.address || '']; }), [['株式会社テスト', '東京都'], ['別の会社', '']]);
check('移行: 請求書が取引先とつながる', m.invoices.map(function (i) { return i.partnerId ? m.partners.find(function (p) { return p.id === i.partnerId; }).name : '-'; }), ['株式会社テスト', '株式会社テスト', '別の会社', '-']);
check('移行: 取引のメモからは推定しない(取引先は未設定のまま)', m.transactions[0].partnerId, undefined);
check('SCHEMA_VERSION は 8', app.SCHEMA_VERSION, 8);

/* 2. 取り込みの検証 */
var bad = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 8,
  partners: [{ id: 'pt_1', name: '  Ａ社 ' }, { id: '../x', name: 'B' }, { id: 'pt_2', name: '' }, { id: 'pt_1', name: '重複' }, { id: 'pt_3', name: 'C', address: 'x'.repeat(500), evil: 1 }],
  transactions: [{ id: 'tx_b', kind: 'income', date: '2026-01-01', amount: 1, fund: 'bank', account: 'sales', partnerId: '<script>' }],
  invoices: [{ id: 'inv_b', number: '1', items: [], status: '架空' }] });
check('取り込み: 名前の正規化、不正な ID・空の名前・ID の重複は外す', bad.partners.map(function (p) { return p.name; }), ['A社', 'C']);
check('取り込み: 住所は 200 文字まで、余分な項目は持たない', [bad.partners[1].address.length, Object.keys(bad.partners[1]).sort()], [200, ['address', 'id', 'name']]);
check('取り込み: 不正な partnerId は外す/不正な状態は下書き', [bad.transactions[0].partnerId, bad.invoices[0].status], [undefined, '下書き']);

/* 3. 集計 */
var s = app.state;
s.settings = app.defaultSettings(); s.fixedAssets = []; s.inventoryYearEnd = {}; s.taxInterim = {};
s.partners = [{ id: 'pt_a', name: 'A社' }, { id: 'pt_b', name: 'B社' }];
s.transactions = [
  { id: 't1', kind: 'income', date: '2026-02-01', amount: 300000, fund: 'bank', account: 'sales', partnerId: 'pt_a' },
  { id: 't2', kind: 'income', date: '2025-12-01', amount: 999, fund: 'bank', account: 'sales', partnerId: 'pt_a' },          // 前年は売上に入れない
  { id: 't3', kind: 'expense_accrued', date: '2026-03-01', amount: 50000, account: 'outsourcing', accountType: 'expense', liability: 'accrued', partnerId: 'pt_b' },
  { id: 't4', kind: 'pay_liability', date: '2026-04-01', amount: 20000, fund: 'bank', liability: 'accrued', partnerId: 'pt_b' },
  { id: 't5', kind: 'expense', date: '2026-05-01', amount: 1000, fund: 'cash', account: 'supplies' }];
s.invoices = [{ id: 'i1', number: '1', partnerId: 'pt_a', status: '送付済み(未入金)', taxRounding: 'floor', items: [{ qty: 1, unitPrice: 100000, taxRate: 10 }] },
              { id: 'i2', number: '2', partnerId: 'pt_a', status: '入金済み', taxRounding: 'floor', items: [{ qty: 1, unitPrice: 5000, taxRate: 10 }] }];
var sum = app.partnerSummary(2026).map(function (r) { return [r.id, r.sales, r.costs, r.payable, r.unpaid]; });
check('集計: 売上・経費・未払金の残高(年末)・未入金の請求書、未設定は最後', sum, [['pt_a', 300000, 0, 0, 110000], ['pt_b', 0, 50000, 30000, 0], ['-', 0, 1000, 0, 0]]);

/* 4. 検索(取引先で絞り込み・名前の文字でも探せる) */
function find(q) { return s.transactions.filter(function (t) { return app.txMatches(t, Object.assign(app.emptySearch(), q)); }).map(function (t) { return t.id; }); }
check('検索: 取引先で絞り込み / 未設定 / 名前の文字', [find({ partnerId: 'pt_b' }), find({ partnerId: '-' }), find({ text: 'A社' })], [['t3', 't4'], ['t5'], ['t1', 't2']]);
check('検索: 取引先 × 日付 × 金額の組み合わせ', find({ partnerId: 'pt_a', dateFrom: '2026-01-01', amountMin: '1000' }), ['t1']);

/* 5. 統合(画面の Store.mergePartner と同じ処理。保存は Tauri がないので行われない) */
app.Store.mergePartner('pt_b', 'pt_a');
check('統合: B社の取引を A社 に付け替え、B社は一覧から消える', [s.partners.map(function (p) { return p.name; }), find({ partnerId: 'pt_a' })], [['A社'], ['t1', 't2', 't3', 't4']]);
check('名前で探す(全角/半角・前後の空白を無視)', app.findPartnerByName(' Ａ社') && app.findPartnerByName(' Ａ社').id, 'pt_a');

/* 6. 請求書の検索(取引先・状態・発行日・合計・文字) */
var invs = [
  { id: 'i1', number: '2026-001', issueDate: '2026-09-30', transactionDate: '2026年9月分', clientName: 'A社', partnerId: 'pt_a', status: '送付済み(未入金)', taxRounding: 'floor', notes: '', items: [{ name: 'システム保守', qty: 1, unitPrice: 100000, taxRate: 10 }] },
  { id: 'i2', number: '2026-002', issueDate: '2026-10-31', transactionDate: '2026年10月分', clientName: 'A社', partnerId: 'pt_a', status: '入金済み', taxRounding: 'floor', notes: '振込済', items: [{ name: 'デザイン', qty: 2, unitPrice: 30000, taxRate: 10 }] },
  { id: 'i3', number: '2026-003', issueDate: '2026-10-15', clientName: '個人のお客様', status: '下書き', taxRounding: 'floor', items: [{ name: '食品', qty: 1, unitPrice: 1000, taxRate: 8 }] }];
function findInv(q) { return invs.filter(function (i) { return app.invoiceMatches(i, Object.assign(app.emptySearch(), q)); }).map(function (i) { return i.id; }); }
check('請求書の検索: 取引先 / 未設定', [findInv({ partnerId: 'pt_a' }), findInv({ partnerId: '-' })], [['i1', 'i2'], ['i3']]);
check('請求書の検索: 状態', [findInv({ status: '送付済み(未入金)' }), findInv({ status: '下書き' })], [['i1'], ['i3']]);
check('請求書の検索: 発行日の範囲', findInv({ dateFrom: '2026-10-01', dateTo: '2026-10-31' }), ['i2', 'i3']);
check('請求書の検索: 合計(税込)の範囲 / 合計の金額そのもの', [findInv({ amountMin: '60000', amountMax: '70000' }), findInv({ text: '110,000' })], [['i2'], ['i1']]);
check('請求書の検索: 文字(明細・取引年月日・備考・番号)', [findInv({ text: '保守' }), findInv({ text: '10月分' }), findInv({ text: '振込済' }), findInv({ text: '003' })], [['i1'], ['i2'], ['i2'], ['i3']]);
check('請求書の検索: 組み合わせ(取引先 × 状態 × 文字)', findInv({ partnerId: 'pt_a', status: '入金済み', text: 'デザイン' }), ['i2']);

results.join('\n') + '\n\n' + results.filter(function (r) { return r.indexOf('NG') === 0; }).length + ' 件 NG / ' + results.length + ' 件';
