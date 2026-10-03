// 口座(普通預金の補助科目、schemaVersion 9)のテスト: 移行、口座ごとの残高と貸借対照表、固定資産の支払い・受け取り、
// 取り込みの検証、削除の制限、選び方(3つまでボタン・4つ以上プルダウン)、変更履歴の表示。
// 実行: osascript -l JavaScript tests/check_accounts.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }
var document = { addEventListener: function () {} }; var window = {};
var localStorage = { getItem: function () { return null; }, setItem: function () {} };
var app = (new Function('document', 'window', 'localStorage', read('src/app.js') +
  '\nreturn { state: state, defaultSettings: defaultSettings, sanitizeBackup: sanitizeBackup, fundBalance: fundBalance, totalBankBalance: totalBankBalance, computeBS: computeBS, computePL: computePL,' +
  ' movementsOf: movementsOf, syncPurchaseTransaction: syncPurchaseTransaction, syncSaleTransaction: syncSaleTransaction, bankAccountUsage: bankAccountUsage, Store: Store, fundPickerHtml: fundPickerHtml,' +
  ' historyValue: historyValue, fundAccounts: fundAccounts, allNodes: allNodes, SCHEMA_VERSION: SCHEMA_VERSION };'))(document, window, localStorage);
var results = [];
function check(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push((ok ? 'OK  ' : 'NG  ') + name + (ok ? '' : '  実際=' + JSON.stringify(actual) + ' 期待=' + JSON.stringify(expected)));
}
var s = app.state;
function reset(accounts) {
  s.transactions = []; s.invoices = []; s.fixedAssets = []; s.inventoryYearEnd = {}; s.taxInterim = {}; s.partners = [];
  s.settings = Object.assign(app.defaultSettings(), { openingCash: 10000, openingDate: '2026-01-01' });
  s.bankAccounts = accounts;
}
var n = 0;
function tx(kind, date, amount, extra) { s.transactions.push(Object.assign({ id: 'tx_' + (++n), kind: kind, date: date, amount: amount }, extra || {})); }

/* 1. 移行 v8 → v9 */
var m = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 8, settings: { openingBank: 500000, openingCash: 3000 },
  transactions: [{ id: 'tx_a', kind: 'income', date: '2026-01-05', amount: 1000, fund: 'bank', account: 'sales', taxCategory: 'standard' }] });
check('移行: 最初の口座は「普通預金」(ID bank)、開始残高は設定から移す', m.bankAccounts, [{ id: 'bank', name: '普通預金', opening: 500000 }]);
check('移行: 設定の預金の開始残高は 0 に(二重に数えない)、現金はそのまま', [m.settings.openingBank, m.settings.openingCash], [0, 3000]);
check('移行: 以前の取引の資金 bank はそのまま', m.transactions[0].fund, 'bank');
check('SCHEMA_VERSION は 9', app.SCHEMA_VERSION, 9);

/* 2. 口座ごとの残高と貸借対照表 */
reset([{ id: 'bank', name: 'A銀行', opening: 500000 }, { id: 'bk_2', name: 'B銀行', opening: 200000 }]);
tx('income', '2026-02-01', 330000, { fund: 'bank', account: 'sales' });
tx('expense', '2026-02-10', 50000, { fund: 'bk_2', account: 'rent' });
tx('drawing', '2026-03-01', 100000, { fund: 'bk_2' });
check('口座ごとの残高: A銀行 830,000 / B銀行 50,000 / 現金 10,000', [app.fundBalance('bank', '2026-12-31'), app.fundBalance('bk_2', '2026-12-31'), app.fundBalance('cash', '2026-12-31')], [830000, 50000, 10000]);
var bs = app.computeBS('2026-12-31');
check('貸借対照表: 普通預金は合計 880,000 と内訳', [bs.bank, bs.bankBreakdown.map(function (b) { return [b.name, b.balance]; })], [880000, [['A銀行', 830000], ['B銀行', 50000]]]);
check('貸借対照表: 元入金は現金と全口座の開始残高の合計(710,000)', bs.openingCapital, 710000);
check('貸借対照表: 繰越利益 = 所得(280,000)、資産 = 負債 + 純資産', [bs.retainedEarnings, app.computePL(2026).net, bs.assetsTotal === bs.liabilitiesTotal + bs.equityTotalVal], [280000, 280000, true]);
check('総勘定元帳の科目に口座ごとの元帳がある', app.allNodes().filter(function (x) { return x.indexOf('fund:') === 0; }), ['fund:cash', 'fund:bank', 'fund:bk_2']);

/* 3. 固定資産の支払い・売却代金も口座ごと */
var pc = { id: 'fa_1', name: 'PC', cost: 240000, usefulLifeYears: 4, acquisitionDate: '2026-04-01', disposalDate: '', payFund: 'bk_2' };
s.fixedAssets.push(pc); app.syncPurchaseTransaction(pc);
var ptx = s.transactions.filter(function (t) { return t.linkedAssetId === 'fa_1'; })[0];
check('固定資産の購入: B銀行から支払う仕訳', app.movementsOf(ptx).map(function (x) { return x.node; }), ['asset:fixed', 'fund:bk_2']);
pc.disposalDate = '2026-12-01'; pc.disposalType = 'sale'; pc.saleAmount = 100000; pc.saleFund = 'bank'; app.syncSaleTransaction(pc);
var stx = s.transactions.filter(function (t) { return t.linkedAssetId === 'fa_1' && t.kind === 'contribution'; })[0];
check('固定資産の売却代金: A銀行で受け取る', stx.fund, 'bank');

/* 4. 取り込みの検証 */
var bad = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 9,
  bankAccounts: [{ id: 'bank', name: ' Ａ銀行 ', opening: '1000' }, { id: '../x', name: 'X' }, { id: 'bk_9', name: '' }, { id: 'bank', name: '重複' }],
  fixedAssets: [{ id: 'fa_x', name: 'x', cost: 1, usefulLifeYears: 4, acquisitionDate: '2026-01-01', payFund: 'wallet', saleFund: 'bk_unknown' },
                { id: 'fa_y', name: 'y', cost: 1, usefulLifeYears: 4, acquisitionDate: '2026-01-01', payFund: 'bank', saleFund: 'cash' }] });
check('取り込み: 口座の名前の正規化・不正な ID・空の名前・重複を外す、開始残高は数値に', bad.bankAccounts, [{ id: 'bank', name: 'A銀行', opening: 1000 }]);
check('取り込み: 存在しない口座の支払い方法・受け取り先は外す/ある口座は残す', [bad.fixedAssets[0].payFund, bad.fixedAssets[0].saleFund, bad.fixedAssets[1].payFund, bad.fixedAssets[1].saleFund], [undefined, undefined, 'bank', 'cash']);

/* 5. 削除の制限 */
reset([{ id: 'bank', name: 'A銀行', opening: 0 }, { id: 'bk_2', name: 'B銀行', opening: 0 }, { id: 'bk_3', name: 'C銀行', opening: 5000 }]);
tx('expense', '2026-02-10', 100, { fund: 'bk_2', account: 'rent' });
check('使われている数: 取引のある口座・開始残高のある口座は 0 でない', [app.bankAccountUsage('bank'), app.bankAccountUsage('bk_2'), app.bankAccountUsage('bk_3')], [0, 1, 1]);
app.Store.deleteBankAccount('bk_2'); app.Store.deleteBankAccount('bank');
check('削除: 使われている口座は消えず、使われていない口座は消える', s.bankAccounts.map(function (a) { return a.id; }), ['bk_2', 'bk_3']);

/* 6. 口座の選び方 */
reset([{ id: 'bank', name: 'A銀行', opening: 0 }, { id: 'bk_2', name: 'B銀行', opening: 0 }, { id: 'bk_3', name: 'C銀行', opening: 0 }]);
var h3 = app.fundPickerHtml('fund-group', 'bk_2');
check('口座が3つまではボタン(現金 + 3口座)、選んだ口座に印', [/<select/.test(h3), (h3.match(/type="radio"/g) || []).length, /value="bk_2" checked/.test(h3)], [false, 4, true]);
s.bankAccounts.push({ id: 'bk_4', name: 'D銀行', opening: 0 });
var h4 = app.fundPickerHtml('fund-group', 'bk_4');
check('口座が4つ以上はプルダウン', [/<select/.test(h4), /value="bk_4" selected/.test(h4)], [true, true]);

/* 7. 変更履歴の表示は口座の名前 */
check('変更履歴: 資金・支払い方法・受け取り先は口座名', [app.historyValue('fund', 'bk_3'), app.historyValue('payFund', 'accrued'), app.historyValue('saleFund', 'cash'), app.historyValue('fund', 'bk_gone')], ['C銀行', '未払金', '現金', '(削除された口座)']);

results.join('\n') + '\n\n' + results.filter(function (r) { return r.indexOf('NG') === 0; }).length + ' 件 NG / ' + results.length + ' 件';
