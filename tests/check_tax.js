// 消費税の集計(computeConsumptionTax)のテスト。期待値は手計算(国税庁「申告書(簡易課税用)の書き方」令和6年11月の計算手順・端数処理)。
// 実行: osascript -l JavaScript tests/check_tax.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }
var document = { addEventListener: function () {} }; var window = {};
var localStorage = { getItem: function () { return null; }, setItem: function () {} };
var app = (new Function('document', 'window', 'localStorage', read('src/app.js') +
  '\nreturn { state: state, defaultSettings: defaultSettings, computeConsumptionTax: computeConsumptionTax, sanitizeBackup: sanitizeBackup, invoiceTotals: invoiceTotals, invoiceMissing: invoiceMissing, SCHEMA_VERSION: SCHEMA_VERSION };'))(document, window, localStorage);

var results = [];
function check(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push((ok ? 'OK  ' : 'NG  ') + name + (ok ? '' : '  実際=' + JSON.stringify(actual) + ' 期待=' + JSON.stringify(expected)));
}
var n = 0;
function reset(settings) {
  app.state.transactions = []; app.state.fixedAssets = []; app.state.invoices = []; app.state.inventoryYearEnd = {}; app.state.taxInterim = {};
  app.state.settings = Object.assign(app.defaultSettings(), settings || {});
}
function sale(date, amount, extra) { app.state.transactions.push(Object.assign({ id: 'tx_' + (++n), kind: 'income', date: date, amount: amount, fund: 'bank', account: 'sales', taxCategory: 'standard' }, extra || {})); }
function pick(r) { return [r.base, r.tax, r.deduction, r.net, r.local]; }

/* 1. 設定がないときは計算しない */
reset(); sale('2026-05-01', 1100000);
check('課税方式が未設定 → 計算しない(unset)', app.computeConsumptionTax(2026).status, 'unset');
reset({ taxMethod: 'simplified' }); sale('2026-05-01', 1100000);
check('簡易課税で事業区分が未設定 → 計算しない(unsetType)', app.computeConsumptionTax(2026).status, 'unsetType');
reset({ taxMethod: 'exempt' }); check('免税事業者 → 計算しない', app.computeConsumptionTax(2026).status, 'exempt');
reset({ taxMethod: 'general' }); check('本則課税 → この版では計算しない(案内のみ)', app.computeConsumptionTax(2026).status, 'general');

/* 2. 国税庁の設例の売上(8% 19,192,000円 / 10% 11,516,000円)。返還等がない場合 */
reset({ taxMethod: 'simplified', mainBusinessType: 2 });
sale('2026-03-01', 19192000, { taxCategory: 'reduced' });
sale('2026-04-01', 7712000);                       // 第2種(主たる事業区分)
sale('2026-05-01', 3804000, { businessType: 4 });   // 第4種に上書き
var r = app.computeConsumptionTax(2026);
check('設例: 対価の額(1円未満切捨て)8% / 10%', r.rates.map(function (x) { return [x.rate, x.exclusive]; }), [[10, 10469090], [8, 17770370]]);
check('設例: 課税標準額(税率ごとに千円未満切捨て)と合計', [r.rates.map(function (x) { return x.base; }), r.base], [[10469000, 17770000], 28239000]);
check('設例: 消費税額(7.8% / 6.24%)', r.rates.map(function (x) { return x.tax; }), [816582, 1108848]);
check('設例: 第2種が 87.7% → 特例(1種類で75%以上・80%)が有利で選ばれる', [r.how.indexOf('第2種') >= 0 && r.how.indexOf('75%以上') >= 0, r.deduction], [true, 1540343]);
check('設例: 原則計算の額も候補にある(1,486,396)', r.candidates.some(function (c) { return c.label === '原則計算' && c.total === 1486396; }), true);
check('設例: 差引税額 385,087 → 385,000 / 地方消費税 108,500(百円未満切捨て)', [r.net, r.local], [385000, 108500]);

/* 3. 第3種のみ */
reset({ taxMethod: 'simplified', mainBusinessType: 3 });
sale('2026-01-31', 11000000);
check('第3種のみ: 課税標準 10,000,000 / 税額 780,000 / 控除 546,000 / 差引 234,000 / 地方 66,000', pick(app.computeConsumptionTax(2026)), [10000000, 780000, 546000, 234000, 66000]);

/* 4. 端数のケース */
reset({ taxMethod: 'simplified', mainBusinessType: 3 });
sale('2026-02-01', 1234567);
var r4 = app.computeConsumptionTax(2026);
check('端数: 対価 1,122,333 → 課税標準 1,122,000 / 税額 87,516 / 控除 61,261 / 差引 26,255→26,200 / 地方 7,389→7,300',
  [r4.rates[0].exclusive].concat(pick(r4)), [1122333, 1122000, 87516, 61261, 26200, 7300]);

/* 5. 第3種 + 固定資産の売却(第4種) */
reset({ taxMethod: 'simplified', mainBusinessType: 3 });
sale('2026-06-01', 9900000);
app.state.fixedAssets.push({ id: 'fa_1', name: '車', cost: 3000000, usefulLifeYears: 6, acquisitionDate: '2022-01-01', disposalDate: '2026-09-30', disposalType: 'sale', saleAmount: 1100000, saleFund: 'bank', payFund: 'bank' });
var r5 = app.computeConsumptionTax(2026);
check('混在: 固定資産の売却代金は第4種・標準税率で課税売上に入る', r5.rates[0].byType['4'].inclusive, 1100000);
check('混在: 第3種が 90% → 特例(70%)546,000 が原則計算 538,200 より有利で選ばれる', [r5.deduction, r5.candidates.some(function (c) { return c.label === '原則計算' && c.total === 538200; })], [546000, true]);
check('混在: 差引 234,000 / 地方 66,000', [r5.net, r5.local], [234000, 66000]);

/* 6. 税区分: 非課税・不課税・免税は課税売上に入れない */
reset({ taxMethod: 'simplified', mainBusinessType: 3 });
sale('2026-01-10', 1100000);
sale('2026-01-11', 50000, { account: 'misc_income', taxCategory: 'exempt' });
sale('2026-01-12', 30000, { taxCategory: 'outside' });
sale('2026-01-13', 200000, { taxCategory: 'export' });
check('非課税・不課税・免税は入らない(課税売上は 1,100,000 のみ)', app.computeConsumptionTax(2026).rates.map(function (x) { return x.inclusive; }), [1100000]);

/* 7. 2割特例・3割特例と適用年 */
reset({ taxMethod: 'special20' }); sale('2026-01-31', 11000000);
var r7 = app.computeConsumptionTax(2026);
check('2割特例(2026年): 控除 80% = 624,000 / 差引 156,000 / 地方 44,000 / 注意なし', [r7.deduction, r7.net, r7.local, r7.warnings.length], [624000, 156000, 44000, 0]);
reset({ taxMethod: 'special30' }); sale('2027-01-31', 11000000);
var r8 = app.computeConsumptionTax(2027);
check('3割特例(2027年): 控除 70% = 546,000 / 差引 234,000 / 注意なし', [r8.deduction, r8.net, r8.warnings.length], [546000, 234000, 0]);
reset({ taxMethod: 'special30' }); sale('2026-01-31', 11000000);
check('3割特例を2026年に選ぶと注意が出る', app.computeConsumptionTax(2026).warnings.length, 1);
reset({ taxMethod: 'special20' }); sale('2027-01-31', 11000000);
check('2割特例を2027年に選ぶと注意が出る', app.computeConsumptionTax(2027).warnings.length, 1);

/* 8. 中間納付 */
reset({ taxMethod: 'simplified', mainBusinessType: 3 }); sale('2026-01-31', 11000000);
app.state.taxInterim = { 2026: { national: 100000, local: 28000 } };
var r9 = app.computeConsumptionTax(2026);
check('中間納付を差し引く: 国税 234,000 − 100,000 / 地方 66,000 − 28,000 / 合計', [r9.payNational, r9.payLocal, r9.payTotal], [134000, 38000, 172000]);

/* 9. 大きな金額でも誤差が出ない(整数で計算) */
reset({ taxMethod: 'simplified', mainBusinessType: 1 }); sale('2026-12-31', 9999999999);
var r10 = app.computeConsumptionTax(2026);
// 9,999,999,999 × 100/110 = 9,090,909,090 → 9,090,909,000 × 7.8% = 709,090,902 × 90% = 638,181,811 → 差引 70,909,091 → 70,909,000
check('大きな金額: 課税標準・税額・控除・差引', [r10.base, r10.tax, r10.deduction, r10.net], [9090909000, 709090902, 638181811, 70909000]);

/* 10. データ形式の移行(v5 → v6)と取り込みの検証 */
var m = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 5, settings: { businessName: 'x' },
  transactions: [{ id: 'tx_s', kind: 'income', date: '2026-01-01', amount: 1100, fund: 'bank', account: 'sales' },
                 { id: 'tx_e', kind: 'expense', date: '2026-01-02', amount: 500, fund: 'cash', account: 'supplies' }],
  invoices: [{ id: 'inv_a', number: '1', taxRate: 8, items: [{ name: 'A', qty: 1, unitPrice: 1000 }] },
             { id: 'inv_b', number: '2', taxRate: 0, items: [{ name: 'B', qty: 2, unitPrice: 500 }] }] });
check('移行: 既存の売上は課税(標準税率)、経費は税区分なしのまま', m.transactions.map(function (t) { return t.taxCategory || '-'; }), ['standard', '-']);
check('移行: 売上があれば見直しの案内を出す(課税方式・事業区分は未設定のまま)', [m.settings.taxReview, m.settings.taxMethod, m.settings.mainBusinessType], ['pending', undefined, undefined]);
check('移行: 請求書の税率は明細ごとに(元の税率のまま)', m.invoices.map(function (i) { return [i.taxRate, i.items[0].taxRate]; }), [[undefined, 8], [undefined, 0]]);
var bad = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 6, settings: { taxMethod: 'hack', mainBusinessType: 9, taxReview: 'x' },
  transactions: [{ id: 'tx_x', kind: 'income', date: '2026-01-01', amount: 1, fund: 'bank', account: 'sales', taxCategory: 'evil', businessType: 7 }],
  invoices: [{ id: 'inv_x', number: '1', items: [{ name: 'A', qty: 1, unitPrice: 1, taxRate: 5 }], transactionDate: 'x'.repeat(100) }],
  taxInterim: { 2026: { national: -5, local: 'abc' }, 'xx': { national: 1 } } });
check('取り込み: 不正な課税方式・事業区分・案内の値は取り込まない', [bad.settings.taxMethod, bad.settings.mainBusinessType, bad.settings.taxReview], [undefined, undefined, undefined]);
check('取り込み: 不正な税区分・事業区分は外す', [bad.transactions[0].taxCategory, bad.transactions[0].businessType], [undefined, undefined]);
check('取り込み: 請求書の不正な税率は 10%、取引年月日は 40 文字まで', [bad.invoices[0].items[0].taxRate, bad.invoices[0].transactionDate.length], [10, 40]);
check('取り込み: 中間納付は年(4桁)ごと・0 以上の数値', bad.taxInterim, { 2026: { national: 0, local: 0 } });
check('SCHEMA_VERSION は 7 以上(最新の版数は tests/check_partners.js)', app.SCHEMA_VERSION >= 7, true);

/* 11. 請求書: 税率ごとの合計(端数処理は1請求書・1税率につき1回、四捨五入) */
var t = app.invoiceTotals({ items: [{ name: 'A', qty: 3, unitPrice: 333, taxRate: 10 }, { name: 'B', qty: 1, unitPrice: 1, taxRate: 10 }, { name: '食品', qty: 1, unitPrice: 1234, taxRate: 8 }] });
// 10%: 999 + 1 = 1,000 → 100 / 8%: 1,234 × 8% = 98.72 → 99
check('請求書: 税率ごとの対価・消費税と合計', [t.byRate, t.subtotal, t.tax, t.total], [[{ rate: 10, subtotal: 1000, tax: 100 }, { rate: 8, subtotal: 1234, tax: 99 }], 2234, 199, 2433]);
var t2 = app.invoiceTotals({ items: [{ qty: 1, unitPrice: 105, taxRate: 10 }, { qty: 1, unitPrice: 104, taxRate: 10 }] });
check('請求書: 明細ごとではなく税率ごとに1回だけ丸める(以前の請求書=四捨五入: 105+104=209 → 20.9 → 21)', t2.tax, 21);
// 端数処理の3方式(1税率につき1回): 10%対象 1,234 → 123.4 / 8%対象 1,234 → 98.72
var items = [{ qty: 1, unitPrice: 1234, taxRate: 10 }, { qty: 1, unitPrice: 1234, taxRate: 8 }];
check('請求書の端数処理: 切り捨て 123 / 98', app.invoiceTotals({ taxRounding: 'floor', items: items }).byRate.map(function (g) { return g.tax; }), [123, 98]);
check('請求書の端数処理: 四捨五入 123 / 99', app.invoiceTotals({ taxRounding: 'round', items: items }).byRate.map(function (g) { return g.tax; }), [123, 99]);
check('請求書の端数処理: 切り上げ 124 / 99', app.invoiceTotals({ taxRounding: 'ceil', items: items }).byRate.map(function (g) { return g.tax; }), [124, 99]);
check('請求書の端数処理: ちょうど割り切れるときは3方式とも同じ(1,000 → 100)', ['floor', 'round', 'ceil'].map(function (m) { return app.invoiceTotals({ taxRounding: m, items: [{ qty: 1, unitPrice: 1000, taxRate: 10 }] }).tax; }), [100, 100, 100]);
check('請求書の端数処理: 設定の初期値は切り捨て', app.defaultSettings().invoiceTaxRounding, 'floor');
var mig = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 6, invoices: [{ id: 'inv_old', number: '1', items: [{ qty: 1, unitPrice: 209, taxRate: 10 }] }] });
check('移行 v6→v7: 以前の請求書は四捨五入のまま(金額が変わらない: 20.9 → 21)', [mig.invoices[0].taxRounding, app.invoiceTotals(mig.invoices[0]).tax], ['round', 21]);
var badr = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 7, settings: { invoiceTaxRounding: 'hack' }, invoices: [{ id: 'inv_b', number: '1', items: [], taxRounding: 'evil' }] });
check('取り込み: 不正な端数処理は取り込まない/請求書は四捨五入扱い', [badr.settings.invoiceTaxRounding, badr.invoices[0].taxRounding], [undefined, 'round']);
app.state.settings = Object.assign(app.defaultSettings(), { businessName: '屋号', invoiceRegNo: '' });
check('請求書: 記載事項の不足(登録番号・宛先・取引年月日)', app.invoiceMissing({ clientName: '', transactionDate: '', items: [{ name: 'A' }] }), ['登録番号(設定)', '宛先', '取引年月日']);
app.state.settings = Object.assign(app.defaultSettings(), { businessName: '屋号', invoiceRegNo: 'T1234567890123' });
check('請求書: 記載事項がそろっていれば不足なし', app.invoiceMissing({ clientName: '株式会社テスト', transactionDate: '2026年9月分', items: [{ name: '作業' }] }), []);

results.join('\n') + '\n\n' + results.filter(function (x) { return x.indexOf('NG') === 0; }).length + ' 件 NG / ' + results.length + ' 件';
