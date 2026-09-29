// 計算ロジック(仕訳・減価償却・損益計算書・貸借対照表)のテスト。
// 期待値は手計算(減価償却は 減価償却資産の耐用年数等に関する省令 別表第八 の定額法償却率。src/app.js の STRAIGHT_LINE_RATES)。
// 実行: osascript -l JavaScript tests/check_calc.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }
var document = { addEventListener: function () {} }; var window = {};
var localStorage = { getItem: function () { return null; }, setItem: function () {} };
var app = (new Function('document', 'window', 'localStorage', read('src/app.js') +
  '\nreturn { state: state, defaultSettings: defaultSettings, movementsOf: movementsOf, depreciationSchedule: depreciationSchedule, computePL: computePL, computeBS: computeBS, KIND_LABELS: KIND_LABELS };'))(document, window, localStorage);

var results = [];
function check(name, actual, expected, note) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push((ok ? 'OK  ' : 'NG  ') + name + (ok ? '' : '  実際=' + JSON.stringify(actual) + ' 期待=' + JSON.stringify(expected) + (note ? '  ※' + note : '')));
}
function reset(settings) {
  app.state.transactions = []; app.state.invoices = []; app.state.fixedAssets = []; app.state.inventoryYearEnd = {};
  app.state.settings = Object.assign(app.defaultSettings(), settings || {});
}
var n = 0;
function tx(kind, date, amount, extra) { app.state.transactions.push(Object.assign({ id: 'tx_t' + (++n), kind: kind, date: date, amount: amount }, extra || {})); }

/* ---------- 1. 仕訳: すべての取引種類で借方合計 = 貸方合計 ---------- */
var samples = {
  income: { fund: 'bank', account: 'sales' }, expense: { fund: 'cash', account: 'supplies' }, purchase: { fund: 'cash' },
  drawing: { fund: 'bank' }, contribution: { fund: 'cash' }, expense_accrued: { account: 'utilities', accountType: 'expense', liability: 'accrued' },
  pay_liability: { fund: 'bank', liability: 'accrued' }, borrow: { fund: 'bank' }, repay: { fund: 'bank' }
};
Object.keys(app.KIND_LABELS).forEach(function (k) {
  var m = app.movementsOf(Object.assign({ kind: k, amount: 12345 }, samples[k]));
  var dr = m.filter(function (x) { return x.side === 'debit'; }).reduce(function (s, x) { return s + x.amt; }, 0);
  var cr = m.filter(function (x) { return x.side === 'credit'; }).reduce(function (s, x) { return s + x.amt; }, 0);
  check('仕訳 ' + k + ': 借方=貸方=12345', [dr, cr], [12345, 12345]);
});

/* ---------- 2. 減価償却(定額法) ---------- */
function amounts(asset, years) { var s = app.depreciationSchedule(asset); return years.map(function (y) { return s[y] ? s[y].amount : 0; }); }
// 24万円・4年(償却率 0.250 → 年6万円)・4月取得: 初年度 9か月 = 45,000、最終年は備忘価額1円を残す
check('減価償却 240,000円/4年/4月取得',
  amounts({ cost: 240000, usefulLifeYears: 4, acquisitionDate: '2025-04-10', disposalDate: '' }, [2025, 2026, 2027, 2028, 2029, 2030]),
  [45000, 60000, 60000, 60000, 14999, 0]);
// 100万円・6年: 償却率 0.167 → 年 167,000円(最終年は 999,999 − 167,000×5 = 164,999)
check('減価償却 1,000,000円/6年/1月取得(償却率 0.167)',
  amounts({ cost: 1000000, usefulLifeYears: 6, acquisitionDate: '2025-01-05', disposalDate: '' }, [2025, 2026, 2027, 2028, 2029, 2030, 2031]),
  [167000, 167000, 167000, 167000, 167000, 164999, 0]);

// 30万円・3年(償却率 0.334 → 年 100,200円)。最終年は 299,999 − 200,400 = 99,599
check('減価償却 300,000円/3年/1月取得(償却率 0.334)',
  amounts({ cost: 300000, usefulLifeYears: 3, acquisitionDate: '2025-01-20', disposalDate: '' }, [2025, 2026, 2027, 2028]),
  [100200, 100200, 99599, 0]);
// 100万円・6年・8月取得: 初年度 5か月 = 1,000,000 × 0.167 × 5/12 = 69,583.33… → 四捨五入で 69,583(端数処理はユーザーに確認中)
check('減価償却 1,000,000円/6年/8月取得の初年度(5か月)',
  amounts({ cost: 1000000, usefulLifeYears: 6, acquisitionDate: '2025-08-01', disposalDate: '' }, [2025]), [69583]);

/* ---------- 3. 除却した固定資産は、除却後の貸借対照表に残らない ---------- */
reset({ openingDate: '2025-01-01' });
app.state.fixedAssets.push({ id: 'fa_1', name: 'PC', cost: 240000, usefulLifeYears: 4, acquisitionDate: '2025-01-10', disposalDate: '2026-06-30' });
check('除却後(2026-12-31)の固定資産の簿価 = 0', app.computeBS('2026-12-31').fixedAssetsVal, 0,
  'アプリは除却した資産も簿価のまま貸借対照表に残し、除却損も計上しない');

/* ---------- 4. 損益計算書 ---------- */
reset({ openingCash: 100000, openingBank: 500000, openingDate: '2025-01-01' });
tx('income', '2025-03-31', 1000000, { fund: 'bank', account: 'sales' });
tx('expense', '2025-04-15', 200000, { fund: 'bank', account: 'supplies' });
tx('purchase', '2025-05-10', 300000, { fund: 'bank' });
tx('expense_accrued', '2025-12-31', 10000, { account: 'utilities', accountType: 'expense', liability: 'accrued' });
tx('income', '2026-01-10', 999999, { fund: 'bank', account: 'sales' }); // 翌年分は含めない
app.state.inventoryYearEnd['2025'] = { opening: 0, closing: 80000 };
var pl = app.computePL(2025);
// 売上原価 = 期首0 + 仕入300,000 − 期末80,000 = 220,000 / 経費 = 200,000 + 10,000 / 所得 = 1,000,000 − 220,000 − 210,000
check('損益計算書 2025: 売上・売上原価・経費・所得', [pl.incomeSum, pl.cogs, pl.expenseSum, pl.net], [1000000, 220000, 210000, 570000]);

/* ---------- 5. 貸借対照表: 元入金以外の純資産の増加 = その年の所得 ---------- */
tx('pay_liability', '2025-12-31', 4000, { fund: 'bank', liability: 'accrued' });
tx('borrow', '2025-06-01', 500000, { fund: 'bank' });
tx('repay', '2025-11-30', 100000, { fund: 'bank' });
tx('drawing', '2025-08-01', 50000, { fund: 'bank' });
tx('contribution', '2025-09-01', 30000, { fund: 'cash' });
var bs = app.computeBS('2025-12-31');
// 現金 100,000 + 30,000 / 預金 500,000 + 1,000,000 − 200,000 − 300,000 − 4,000 + 500,000 − 100,000 − 50,000 / 棚卸 80,000
// 負債: 未払金 10,000 − 4,000 = 6,000、借入金 500,000 − 100,000 = 400,000
check('貸借対照表 2025末: 現金・預金・棚卸・負債合計', [bs.cash, bs.bank, bs.inventoryVal, bs.liabilitiesTotal], [130000, 1346000, 80000, 406000]);
check('貸借対照表 2025末: 資産合計 = 負債 + 純資産', bs.assetsTotal, bs.liabilitiesTotal + bs.equityTotalVal);
check('貸借対照表の繰越利益 = 損益計算書の所得(2025)', bs.retainedEarnings, app.computePL(2025).net);

/* ---------- 6. 固定資産を買った年も、繰越利益 = 所得 になるか ---------- */
reset({ openingCash: 0, openingBank: 1000000, openingDate: '2025-01-01' });
app.state.fixedAssets.push({ id: 'fa_2', name: 'PC', cost: 240000, usefulLifeYears: 4, acquisitionDate: '2025-04-10', disposalDate: '' });
// PC の代金 240,000円を預金から払った。アプリには固定資産の購入代金を記録する取引種類がないため、支払いは記録できない
var bs2 = app.computeBS('2025-12-31'), pl2 = app.computePL(2025);
check('固定資産を買った年の繰越利益 = 所得(−45,000)', bs2.retainedEarnings, pl2.net,
  '固定資産の購入代金の支払いを記録する取引種類がなく、預金が減らないため、純資産が 240,000円多くなる');

results.join('\n') + '\n\n' + results.filter(function (r) { return r.indexOf('NG') === 0; }).length + ' 件 NG / ' + results.length + ' 件';
