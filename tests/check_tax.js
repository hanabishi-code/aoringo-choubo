// 消費税の集計(computeConsumptionTax)のテスト。期待値は手計算(国税庁「申告書(簡易課税用)の書き方」令和6年11月の計算手順・端数処理)。
// 実行: osascript -l JavaScript tests/check_tax.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }
var document = { addEventListener: function () {} }; var window = {};
var localStorage = { getItem: function () { return null; }, setItem: function () {} };
var app = (new Function('document', 'window', 'localStorage', read('src/app.js') +
  '\nreturn { state: state, defaultSettings: defaultSettings, computeConsumptionTax: computeConsumptionTax };'))(document, window, localStorage);

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

results.join('\n') + '\n\n' + results.filter(function (x) { return x.indexOf('NG') === 0; }).length + ' 件 NG / ' + results.length + ' 件';
