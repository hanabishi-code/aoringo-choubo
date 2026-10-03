// 変更履歴の表示のテスト: データモデルのすべての項目に表示名と値の表示のしかたがあるか、
// 選択肢の値がすべて表示名になるか、差分の表示に内部キー・JSON・ID が出ないか。
// 項目を増やしたときに HISTORY_FIELDS への追加漏れを見つけるためのテスト。
// 実行: osascript -l JavaScript tests/check_history_labels.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }
var document = { addEventListener: function () {} }; var window = {};
var localStorage = { getItem: function () { return null; }, setItem: function () {} };
var app = (new Function('document', 'window', 'localStorage', read('src/app.js') +
  '\nreturn { state: state, defaultSettings: defaultSettings, sanitizeBackup: sanitizeBackup, HISTORY_FIELDS: HISTORY_FIELDS, historyValue: historyValue, historyDiffLines: historyDiffLines, historySummary: historySummary,' +
  ' KIND_LABELS: KIND_LABELS, TAX_CATEGORIES: TAX_CATEGORIES, TAX_METHODS: TAX_METHODS, BUSINESS_TYPES: BUSINESS_TYPES, DEPRECIATION_ROUNDING: DEPRECIATION_ROUNDING, THEME_LABELS: THEME_LABELS, ACCOUNTS: ACCOUNTS };'))(document, window, localStorage);
var results = [];
function check(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push((ok ? 'OK  ' : 'NG  ') + name + (ok ? '' : '  実際=' + JSON.stringify(actual) + ' 期待=' + JSON.stringify(expected)));
}
var known = {}; app.HISTORY_FIELDS.forEach(function (f) { known[f[0]] = f; });

// 1. データモデル(CLAUDE.md の「データモデル」)のすべての項目。項目を増やしたらここにも足す
var MODEL = {
  transaction: ['id', 'kind', 'date', 'amount', 'memo', 'fund', 'account', 'accountType', 'liability', 'partnerId', 'taxCategory', 'businessType', 'attachments', 'receiptAssetId', 'linkedAssetId', 'createdAt'],
  invoice: ['id', 'number', 'issueDate', 'transactionDate', 'dueDate', 'clientName', 'clientAddress', 'partnerId', 'status', 'items', 'taxRate', 'taxRounding', 'notes', 'attachments', 'createdAt'],
  fixedAsset: ['id', 'name', 'acquisitionDate', 'cost', 'usefulLifeYears', 'payFund', 'disposalDate', 'disposalType', 'saleAmount', 'saleFund'],
  inventory: ['opening', 'closing'], taxInterim: ['national', 'local'], partner: ['id', 'name', 'address'], bankAccount: ['id', 'name', 'opening']
};
var missing = [];
Object.keys(MODEL).forEach(function (t) { MODEL[t].forEach(function (k) { if (!known[k]) missing.push(t + '.' + k); }); });
Object.keys(app.defaultSettings()).forEach(function (k) { if (!known[k]) missing.push('settings.' + k); }); // 設定の項目は自動で調べる
check('すべての項目(データモデル + 設定の全キー)に表示名がある', missing, []);
var unlabeled = app.HISTORY_FIELDS.filter(function (f) { return f[2] !== 'hidden' && !f[1]; }).map(function (f) { return f[0]; });
check('表示する項目には必ず表示名がある', unlabeled, []);

// 取り込みの検証を通したあとの項目も、すべて HISTORY_FIELDS にある(sanitizeBackup が新しい項目を通すようになったら検出)
var full = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 9,
  transactions: [{ id: 'tx_1', kind: 'income', date: '2026-01-01', amount: 1, memo: 'm', fund: 'bank', account: 'sales', partnerId: 'pt_1', taxCategory: 'standard', businessType: 3, attachments: [{ id: 'rc_1', type: 'application/pdf', name: 'a.pdf', addedAt: '2026-01-01' }], linkedAssetId: 'fa_1', createdAt: '2026-01-01' }],
  invoices: [{ id: 'inv_1', number: '1', issueDate: '2026-01-01', transactionDate: '1月分', dueDate: '2026-02-01', clientName: 'A', clientAddress: 'B', partnerId: 'pt_1', status: '下書き', items: [{ name: 'x', qty: 1, unitPrice: 1, taxRate: 10 }], taxRounding: 'floor', notes: 'n', attachments: [] }],
  fixedAssets: [{ id: 'fa_1', name: 'PC', acquisitionDate: '2025-01-01', cost: 1, usefulLifeYears: 4, payFund: 'bank', disposalDate: '2026-01-01', disposalType: 'sale', saleAmount: 1, saleFund: 'cash' }],
  partners: [{ id: 'pt_1', name: 'A', address: 'B' }], inventoryYearEnd: { 2026: { opening: 1, closing: 2 } }, taxInterim: { 2026: { national: 1, local: 2 } } });
var seen = {};
['transactions', 'invoices', 'fixedAssets', 'partners'].forEach(function (k) { (full[k] || []).forEach(function (r) { Object.keys(r).forEach(function (x) { seen[x] = 1; }); }); });
Object.keys(full.inventoryYearEnd[2026]).concat(Object.keys(full.taxInterim[2026])).forEach(function (x) { seen[x] = 1; });
check('取り込み後のデータに、表示名のない項目がない', Object.keys(seen).filter(function (k) { return !known[k]; }), []);

// 2. 選択肢の値はすべて表示名になる(内部の値のまま・「不明な値」にならない)
function bad(k, values, rec) { return values.filter(function (v) { var out = app.historyValue(k, v, rec || {}); return out === String(v) || out.indexOf('不明') >= 0; }); }
check('区分', bad('kind', Object.keys(app.KIND_LABELS)), []);
check('税区分', bad('taxCategory', Object.keys(app.TAX_CATEGORIES)), []);
check('課税方式(未設定以外)', bad('taxMethod', Object.keys(app.TAX_METHODS).filter(Boolean)), []);
check('事業区分', bad('businessType', Object.keys(app.BUSINESS_TYPES).map(Number)), []);
check('端数処理', bad('taxRounding', Object.keys(app.DEPRECIATION_ROUNDING)), []);
check('表示テーマ', bad('theme', Object.keys(app.THEME_LABELS)), []);
check('資金・受け取り先・支払い方法(口座名)', [bad('fund', ['cash', 'bank']), bad('saleFund', ['cash', 'bank']), bad('payFund', ['cash', 'bank', 'accrued'])], [[], [], []]);
check('口座の開始残高は「開始残高」(棚卸高ではない)', app.historyDiffLines({ action: 'update', target: 'bankAccount', before: { id: 'bank', name: 'A', opening: 0 }, after: { id: 'bank', name: 'B', opening: 1000 } }), ['口座の名前: A → B', '開始残高: ¥0 → ¥1,000']);
check('負債の科目・処分の種類・科目の区分', [bad('liability', ['payable', 'accrued', 'loan']), bad('disposalType', ['retire', 'sale']), bad('accountType', ['expense', 'cogs'])], [[], [], []]);
var allAccounts = [].concat(app.ACCOUNTS.income, app.ACCOUNTS.expense, app.ACCOUNTS.cogs || []).map(function (a) { return a.key; });
check('勘定科目(すべて)', bad('account', allAccounts), []);
check('日付・金額・耐用年数・税率', [app.historyValue('date', '2026-10-03'), app.historyValue('amount', 12345), app.historyValue('usefulLifeYears', 4), app.historyValue('taxRate', 8)], ['2026年10月3日', '¥12,345', '4年', '8%(軽減)']);

// 3. 差分の表示に、内部キー・JSON・ID が出ない
app.state.partners = [{ id: 'pt_1', name: '株式会社テスト' }]; app.state.bankAccounts = [{ id: 'bank', name: '普通預金', opening: 0 }]; app.state.fixedAssets = [{ id: 'fa_1', name: '営業車' }];
var before = { id: 'tx_1', kind: 'expense', date: '2026-01-01', amount: 1000, fund: 'cash', account: 'supplies', taxCategory: 'standard', attachments: [{ id: 'rc_1', type: 'image/jpeg', name: 'レシート.jpg' }], createdAt: 'x' };
var after = { id: 'tx_1', kind: 'expense', date: '2026-01-02', amount: 1100, fund: 'bank', account: 'travel', partnerId: 'pt_1', taxCategory: 'reduced', attachments: [{ id: 'rc_2', type: 'application/pdf', name: '請求書.pdf' }], linkedAssetId: 'fa_1', mysteryKey: 'tx_abc123', createdAt: 'x' };
var lines = app.historyDiffLines({ action: 'update', target: 'transaction', before: before, after: after });
var text = lines.join('\n');
check('差分: 入力欄の順に並ぶ', lines.map(function (l) { return l.split(':')[0]; }), ['日付', '金額', '勘定科目', '資金', '取引先', '消費税の税区分', '添付ファイル', '連動する固定資産', 'その他の項目']);
check('差分: 表示名に変換される', lines.slice(0, 8), ['日付: 2026年1月1日 → 2026年1月2日', '金額: ¥1,000 → ¥1,100', '勘定科目: 消耗品費 → 旅費交通費', '資金: 現金 → 普通預金', '取引先: (なし) → 株式会社テスト', '消費税の税区分: 課税(標準税率) → 課税(軽減税率)', '添付ファイル: 「請求書.pdf」(PDF)を追加、「レシート.jpg」(画像)を外した', '連動する固定資産: (なし) → 営業車']);
check('差分: JSON・内部の ID・内部キーが出ない', [/[{}\[\]"]/.test(text), /\b(tx|inv|fa|pt|rc|h)_[A-Za-z0-9]/.test(text), /\b(cash|bank|supplies|travel|standard|reduced|mysteryKey)\b/.test(text)], [false, false, false]);
var inv = app.historyDiffLines({ action: 'update', target: 'invoice', before: { items: [] }, after: { items: [{ name: '作業', qty: 2, unitPrice: 5000, taxRate: 10 }, { name: '食品', qty: 1, unitPrice: 800, taxRate: 8 }] } });
check('差分: 請求書の明細は「内容 数量 × 単価(税率)」', inv, ['明細: (なし) → 作業 2 × ¥5,000(10%) / 食品 1 × ¥800(8%(軽減))']);
check('要約: 取引の日付は「年月日」、取引先の名前', app.historySummary({ target: 'transaction', after: { date: '2026-10-03', kind: 'income', amount: 1100, partnerId: 'pt_1', memo: '9月分' } }), '2026年10月3日 収入 ¥1,100 株式会社テスト 9月分');

results.join('\n') + '\n\n' + results.filter(function (r) { return r.indexOf('NG') === 0; }).length + ' 件 NG / ' + results.length + ' 件';
