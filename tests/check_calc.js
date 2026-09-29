// 計算ロジック(仕訳・減価償却・損益計算書・貸借対照表)のテスト。
// 期待値は手計算(減価償却は 減価償却資産の耐用年数等に関する省令 別表第八 の定額法償却率。src/app.js の STRAIGHT_LINE_RATES)。
// 実行: osascript -l JavaScript tests/check_calc.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }
var document = { addEventListener: function () {} }; var window = {};
var localStorage = { getItem: function () { return null; }, setItem: function () {} };
var app = (new Function('document', 'window', 'localStorage', read('src/app.js') +
  '\nreturn { state: state, defaultSettings: defaultSettings, movementsOf: movementsOf, depreciationSchedule: depreciationSchedule, computePL: computePL, computeBS: computeBS, KIND_LABELS: KIND_LABELS, isValidUsefulLife: isValidUsefulLife, sanitizeBackup: sanitizeBackup, SCHEMA_VERSION: SCHEMA_VERSION, syncPurchaseTransaction: syncPurchaseTransaction };'))(document, window, localStorage);

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
// 端数処理(設定 depreciationRounding)。100万円・6年・8月取得の初年度 5か月 = 1,000,000 × 0.167 × 5/12 = 69,583.33…
// 10万円・4年・12月取得の初年度 1か月 = 100,000 × 0.25 × 1/12 = 2,083.33… / 30万円・6年・6月取得 7か月 = 29,225 ちょうど
var roundingCases = [
  ['floor', [69583, 2083, 29225]], ['round', [69583, 2083, 29225]], ['ceil', [69584, 2084, 29225]]
];
var assets = [
  { cost: 1000000, usefulLifeYears: 6, acquisitionDate: '2025-08-01', disposalDate: '' },
  { cost: 100000, usefulLifeYears: 4, acquisitionDate: '2025-12-01', disposalDate: '' },
  { cost: 300000, usefulLifeYears: 6, acquisitionDate: '2025-06-01', disposalDate: '' }
];
roundingCases.forEach(function (c) {
  app.state.settings = Object.assign(app.defaultSettings(), { depreciationRounding: c[0] });
  check('端数処理「' + c[0] + '」: 初年度の償却費', assets.map(function (a) { return amounts(a, [2025])[0]; }), c[1]);
});
// 四捨五入で切り上がるケース: 50万円・6年・11月取得 2か月 = 500,000 × 0.167 × 2/12 = 13,916.66…
app.state.settings = Object.assign(app.defaultSettings(), { depreciationRounding: 'floor' });
check('端数処理「floor」: 13,916.66… → 13,916', amounts({ cost: 500000, usefulLifeYears: 6, acquisitionDate: '2025-11-01', disposalDate: '' }, [2025]), [13916]);
app.state.settings = Object.assign(app.defaultSettings(), { depreciationRounding: 'round' });
check('端数処理「round」: 13,916.66… → 13,917', amounts({ cost: 500000, usefulLifeYears: 6, acquisitionDate: '2025-11-01', disposalDate: '' }, [2025]), [13917]);
app.state.settings = app.defaultSettings();
check('端数処理の初期値は切り捨て', app.defaultSettings().depreciationRounding, 'floor');

// 入力できる耐用年数は 2〜50 年の整数だけ
check('耐用年数の入力チェック(1, 2, 50, 51, 2.5, NaN)', [1, 2, 50, 51, 2.5, NaN].map(app.isValidUsefulLife), [false, true, true, false, false, false]);

/* ---------- 3. 除却・売却(24万円・4年・2025年1月取得 → 2026年6月30日に処分) ---------- */
// 償却: 2025年 60,000(12か月)、2026年 30,000(6月まで6か月)→ 処分時の帳簿価額 = 240,000 − 90,000 = 150,000
function disposalCase(type) {
  reset({ openingCash: 0, openingBank: 1000000, openingDate: '2025-01-01' });
  var asset = { id: 'fa_1', name: 'PC', cost: 240000, usefulLifeYears: 4, acquisitionDate: '2025-01-10', disposalDate: '2026-06-30', disposalType: type };
  if (type === 'sale') {
    asset.saleAmount = 100000; asset.saleFund = 'bank';
    tx('contribution', '2026-06-30', 100000, { fund: 'bank', linkedAssetId: 'fa_1' }); // 画面では売却を保存すると自動で作られる
  }
  app.state.fixedAssets.push(asset);
}
disposalCase('retire');
var pl26 = app.computePL(2026), bs25 = app.computeBS('2025-12-31'), bs26 = app.computeBS('2026-12-31');
check('除却: 2026年の償却費・固定資産除却損', [pl26.expenseTotals.depreciation, pl26.expenseTotals.retirement_loss], [30000, 150000]);
check('除却: 2026年末の固定資産の簿価 = 0(帳簿から外れる)', bs26.fixedAssetsVal, 0);
check('除却: 2025年末は簿価 180,000 のまま', bs25.fixedAssetsVal, 180000);
check('除却: 事業主貸・事業主借は変わらない', [bs26.drawing, bs26.contribution], [0, 0]);
check('除却: 資産合計 = 負債 + 純資産', bs26.assetsTotal, bs26.liabilitiesTotal + bs26.equityTotalVal);
check('除却: 繰越利益の増減(2025末→2026末)= 2026年の所得(−180,000)', bs26.retainedEarnings - bs25.retainedEarnings, pl26.net);
check('除却: 2026年の所得 = −(償却費 + 除却損)', pl26.net, -180000);

disposalCase('sale');
pl26 = app.computePL(2026); bs25 = app.computeBS('2025-12-31'); bs26 = app.computeBS('2026-12-31');
check('売却: 2026年の償却費・固定資産除却損(除却損は出ない)', [pl26.expenseTotals.depreciation, pl26.expenseTotals.retirement_loss], [30000, 0]);
check('売却: 2026年末の固定資産の簿価 = 0', bs26.fixedAssetsVal, 0);
check('売却: 事業主貸 = 帳簿価額 150,000、事業主借 = 売却代金 100,000', [bs26.drawing, bs26.contribution], [150000, 100000]);
check('売却: 預金 = 1,000,000 + 売却代金 100,000', bs26.bank, 1100000);
check('売却: 資産合計 = 負債 + 純資産', bs26.assetsTotal, bs26.liabilitiesTotal + bs26.equityTotalVal);
check('売却: 繰越利益の増減(2025末→2026末)= 2026年の所得(−30,000)', bs26.retainedEarnings - bs25.retainedEarnings, pl26.net);

/* ---------- 3b. データ形式の移行(v2 → v3)と取り込みの検証 ---------- */
var migrated = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 2, fixedAssets: [
  { id: 'fa_a', name: 'A', cost: 1000, usefulLifeYears: 4, acquisitionDate: '2025-01-01', disposalDate: '2026-01-31' },
  { id: 'fa_b', name: 'B', cost: 1000, usefulLifeYears: 4, acquisitionDate: '2025-01-01', disposalDate: '' }] });
check('移行 v2→v3: 処分日のある資産は除却として扱う/処分日のない資産はそのまま', migrated.fixedAssets.map(function (a) { return a.disposalType || '-'; }), ['retire', '-']);
var bad = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 3,
  fixedAssets: [{ id: 'fa_c', name: 'C', cost: 1000, usefulLifeYears: 4, acquisitionDate: '2025-01-01', disposalDate: '2026-01-31', disposalType: 'hack', saleFund: 'wallet', saleAmount: 'abc' }],
  transactions: [{ id: 'tx_x', kind: 'contribution', date: '2026-01-31', amount: 1, fund: 'bank', linkedAssetId: '../x' }] });
var c = bad.fixedAssets[0];
check('取り込み: 不正な処分の種類は除却に/不正な受け取り先は外す/売却代金は数値に', [c.disposalType, c.saleFund === undefined, c.saleAmount], ['retire', true, 0]);
check('取り込み: 不正な linkedAssetId は外す', bad.transactions[0].linkedAssetId === undefined, true);
check('SCHEMA_VERSION は 4', app.SCHEMA_VERSION, 4);

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

/* ---------- 6. 固定資産を買った年も、繰越利益 = 所得 になるか(支払いは「固定資産の購入」の取引) ---------- */
reset({ openingCash: 0, openingBank: 1000000, openingDate: '2025-01-01' });
var pc = { id: 'fa_2', name: 'PC', cost: 240000, usefulLifeYears: 4, acquisitionDate: '2025-04-10', disposalDate: '', payFund: 'bank' };
app.state.fixedAssets.push(pc);
app.syncPurchaseTransaction(pc); // 画面で台帳に登録して保存したときと同じ処理
var ptx = app.state.transactions.filter(function (t) { return t.linkedAssetId === 'fa_2'; });
check('購入: 台帳の登録で「固定資産の購入」の取引が1件できる(預金から 240,000)', ptx.map(function (t) { return [t.kind, t.fund, t.amount, t.date]; }), [['asset_purchase', 'bank', 240000, '2025-04-10']]);
var m = app.movementsOf(ptx[0]);
check('購入: 仕訳は 借方 固定資産 / 貸方 普通預金', m.map(function (x) { return x.side + ':' + x.node; }), ['debit:asset:fixed', 'credit:fund:bank']);
var bs2 = app.computeBS('2025-12-31'), pl2 = app.computePL(2025);
// 償却 2025年 9か月 = 45,000 → 所得 −45,000、預金 760,000、固定資産 195,000
check('購入: 2025年末の預金・固定資産の簿価', [bs2.bank, bs2.fixedAssetsVal], [760000, 195000]);
check('購入: 繰越利益 = 所得(−45,000)', bs2.retainedEarnings, pl2.net);
// 台帳を直すと仕訳も直る
pc.cost = 300000; pc.payFund = 'cash'; pc.acquisitionDate = '2025-05-01';
app.syncPurchaseTransaction(pc);
ptx = app.state.transactions.filter(function (t) { return t.linkedAssetId === 'fa_2'; });
check('購入: 金額・日付・支払い方法を直すと仕訳も追随', ptx.map(function (t) { return [t.fund, t.amount, t.date]; }), [['cash', 300000, '2025-05-01']]);
// 支払い方法を「記録しない」にすると仕訳は消える
pc.payFund = undefined; app.syncPurchaseTransaction(pc);
check('購入: 支払いを記録しない → 連動する仕訳は削除', app.state.transactions.filter(function (t) { return t.linkedAssetId === 'fa_2'; }).length, 0);

results.join('\n') + '\n\n' + results.filter(function (r) { return r.indexOf('NG') === 0; }).length + ' 件 NG / ' + results.length + ' 件';
