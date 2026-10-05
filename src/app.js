/* ============================== 勘定科目 ============================== */
const ACCOUNTS = {
  income: [
    { key: 'sales', label: '売上高' },
    { key: 'misc_income', label: '雑収入' }
  ],
  cogs: [
    { key: 'purchases', label: '仕入高' }
  ],
  expense: [
    { key: 'tax', label: '租税公課' }, { key: 'shipping', label: '荷造運賃' }, { key: 'utilities', label: '水道光熱費' },
    { key: 'travel', label: '旅費交通費' }, { key: 'communication', label: '通信費' }, { key: 'advertising', label: '広告宣伝費' },
    { key: 'entertainment', label: '接待交際費' }, { key: 'insurance', label: '損害保険料' }, { key: 'repair', label: '修繕費' },
    { key: 'supplies', label: '消耗品費' }, { key: 'depreciation', label: '減価償却費', auto: true }, { key: 'welfare', label: '福利厚生費' },
    { key: 'wages', label: '給料賃金' }, { key: 'outsourcing', label: '外注工賃' }, { key: 'interest', label: '利子割引料' },
    { key: 'rent', label: '地代家賃' }, { key: 'bad_debt', label: '貸倒金' }, { key: 'misc_expense', label: '雑費' },
    { key: 'retirement_loss', label: '固定資産除却損', auto: true }
  ],
  fund: [ { key: 'cash', label: '現金' }, { key: 'bank', label: '普通預金' } ], // 普通預金は口座ごと(state.bankAccounts)。fundAccounts() を使う
  liability: [ { key: 'payable', label: '買掛金' }, { key: 'accrued', label: '未払金' }, { key: 'loan', label: '借入金' } ]
};
const KIND_LABELS = {
  income: '収入', expense: '経費', purchase: '仕入(現金)', drawing: '事業主貸(出金)', contribution: '事業主借(入金)',
  expense_accrued: '未払計上', pay_liability: '買掛金・未払金の支払', borrow: '借入金の受取', repay: '借入金の返済(元本)',
  asset_purchase: '固定資産の購入' // 固定資産台帳の登録から自動で作る(入力画面の区分には出さない)
};
const TABS = [
  { id: 'entry', label: '入力' }, { id: 'journal', label: '仕訳帳' }, { id: 'ledger', label: '総勘定元帳' },
  { id: 'assets', label: '資産・負債' }, { id: 'pl', label: '損益計算書' }, { id: 'bs', label: '貸借対照表' },
  { id: 'invoice', label: '請求書' }, { id: 'partners', label: '取引先' }, { id: 'report', label: 'レポート' }, { id: 'settings', label: '設定' }
];

/* ============================== 状態 ============================== */
const state = { transactions: [], invoices: [], settings: null, fixedAssets: [], inventoryYearEnd: {}, taxInterim: {}, partners: [], bankAccounts: defaultBankAccounts() };
let STORAGE_MODE = 'memory'; // 'file' = ファイルに保存 / 'memory' = 保存しない(読み込み失敗時)
let STORAGE_ERROR = '';
let currentTab = 'entry';
let editingTxId = null;
let invoiceDraft = null;
let editingInvoiceId = null;
let editingAssetId = null;

/* ============================== ユーティリティ ============================== */
function uid(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
// 金額の表示。マイナスは赤(.neg)にする(記号「−」も付くので色だけに頼らない)
function money(n) { n = Number(n) || 0; return n < 0 ? '<span class="neg">' + yen(n) + '</span>' : yen(n); }
function yen(n) { n = Number(n) || 0; const sign = n < 0 ? '−' : ''; return sign + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP'); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function accountLabel(type, key) { const list = ACCOUNTS[type] || []; const f = list.find(function (a) { return a.key === key; }); return f ? f.label : (key || ''); }
// 資金の一覧: 現金 + 口座(普通預金の補助科目)。最初の口座の ID は 'bank'(以前のデータの fund: 'bank' がそのまま入る)
function defaultBankAccounts() { return [{ id: 'bank', name: '普通預金', opening: 0 }]; }
function bankAccounts() { return (state.bankAccounts && state.bankAccounts.length) ? state.bankAccounts : defaultBankAccounts(); }
function fundAccounts() { return [{ key: 'cash', label: '現金' }].concat(bankAccounts().map(function (a) { return { key: a.id, label: a.name }; })); }
function isBankFund(key) { return key !== 'cash' && !!findById(bankAccounts(), key); }
function fundLabel(key) { if (key === 'cash') return '現金'; const a = findById(bankAccounts(), key); return a ? a.name : '(削除された口座)'; }
function totalBankBalance(asOf) { return bankAccounts().reduce(function (x, a) { return x + fundBalance(a.id, asOf); }, 0); }
function totalBankOpening() { return bankAccounts().reduce(function (x, a) { return x + (Number(a.opening) || 0); }, 0); }
// 資金を選ぶ部品: 口座が3つまではボタン、4つ以上はプルダウン。extra は先頭以外に足す選択肢([値, 表示名])
function fundPickerHtml(id, current, extra) {
  const opts = fundAccounts().map(function (f) { return [f.key, f.label]; }).concat(extra || []);
  const cur = opts.some(function (o) { return o[0] === current; }) ? current : opts[0][0];
  if (bankAccounts().length <= 3) return '<div class="radio-group" id="' + id + '">' + opts.map(function (o) { return '<label><input type="radio" name="' + id + '" value="' + esc(o[0]) + '"' + (o[0] === cur ? ' checked' : '') + '><span>' + esc(o[1]) + '</span></label>'; }).join('') + '</div>';
  return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
}
// 口座が使われている数(取引の資金・固定資産の支払い方法と受け取り先)と、開始残高が 0 でないか
function bankAccountUsage(id) {
  const a = findById(bankAccounts(), id);
  return state.transactions.filter(function (t) { return t.fund === id; }).length +
    (state.fixedAssets || []).filter(function (x) { return x.payFund === id || x.saleFund === id; }).length + (a && Number(a.opening) ? 1 : 0);
}
function fundPickerValue(id) {
  const el = document.getElementById(id); if (!el) return null;
  if (el.tagName === 'SELECT') return el.value;
  const c = el.querySelector('input:checked'); return c ? c.value : null;
}
function defaultSettings() {
  return { businessName: '', ownerName: '', address: '', phone: '', invoiceRegNo: '', bankInfo: '', postalCode: '', fax: '', bankName: '', bankBranch: '', bankAccountType: '', bankAccountNumber: '', bankAccountHolder: '', openingCash: 0, openingBank: 0, openingDate: todayStr(), invoiceSeq: 0, theme: 'auto', depreciationRounding: 'floor', invoiceTaxRounding: 'floor', taxMethod: '', mainBusinessType: 0, taxReview: '' };
}
function toast(msg, ms) {
  const wrap = document.getElementById('toast-wrap'); const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg; wrap.appendChild(el);
  setTimeout(function () { el.remove(); }, ms || 2600);
}
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function availableYears() {
  const ys = new Set();
  state.transactions.forEach(function (t) { if (t.date) ys.add(Number(t.date.slice(0, 4))); });
  Object.keys(state.inventoryYearEnd || {}).forEach(function (y) { ys.add(Number(y)); });
  ys.add(new Date().getFullYear());
  return Array.from(ys).sort(function (a, b) { return b - a; });
}

/* ============================== 仕訳ロジック ============================== */
function movementsOf(tx) {
  const amt = Number(tx.amount) || 0;
  if (tx.kind === 'income') return [{ node: 'fund:' + tx.fund, side: 'debit', amt: amt }, { node: 'income:' + tx.account, side: 'credit', amt: amt }];
  if (tx.kind === 'expense') return [{ node: 'expense:' + tx.account, side: 'debit', amt: amt }, { node: 'fund:' + tx.fund, side: 'credit', amt: amt }];
  if (tx.kind === 'purchase') return [{ node: 'cogs:purchases', side: 'debit', amt: amt }, { node: 'fund:' + tx.fund, side: 'credit', amt: amt }];
  if (tx.kind === 'drawing') return [{ node: 'equity:drawing', side: 'debit', amt: amt }, { node: 'fund:' + tx.fund, side: 'credit', amt: amt }];
  if (tx.kind === 'contribution') return [{ node: 'fund:' + tx.fund, side: 'debit', amt: amt }, { node: 'equity:contribution', side: 'credit', amt: amt }];
  if (tx.kind === 'expense_accrued') return [{ node: (tx.accountType || 'expense') + ':' + tx.account, side: 'debit', amt: amt }, { node: 'liability:' + tx.liability, side: 'credit', amt: amt }];
  if (tx.kind === 'pay_liability') return [{ node: 'liability:' + tx.liability, side: 'debit', amt: amt }, { node: 'fund:' + tx.fund, side: 'credit', amt: amt }];
  if (tx.kind === 'borrow') return [{ node: 'fund:' + tx.fund, side: 'debit', amt: amt }, { node: 'liability:loan', side: 'credit', amt: amt }];
  if (tx.kind === 'repay') return [{ node: 'liability:loan', side: 'debit', amt: amt }, { node: 'fund:' + tx.fund, side: 'credit', amt: amt }];
  // 固定資産の購入: 貸方は支払った現金・普通預金、あとで払う場合は未払金(tx.liability)
  if (tx.kind === 'asset_purchase') return [{ node: 'asset:fixed', side: 'debit', amt: amt }, { node: tx.liability ? 'liability:' + tx.liability : 'fund:' + tx.fund, side: 'credit', amt: amt }];
  return [];
}
function nodeLabel(node) {
  const parts = node.split(':'); const type = parts[0]; const key = parts[1];
  if (type === 'fund') return fundLabel(key);
  if (type === 'income') return accountLabel('income', key);
  if (type === 'cogs') return accountLabel('cogs', key);
  if (type === 'expense') return accountLabel('expense', key);
  if (type === 'liability') return accountLabel('liability', key);
  if (type === 'equity') return key === 'drawing' ? '事業主貸' : '事業主借';
  if (type === 'asset') return '固定資産';
  return node;
}
/* ============================== 検索 ============================== */
// 仕訳帳・総勘定元帳・取引一覧の絞り込み。文字(メモ・区分・科目・金額)、日付の範囲、金額の範囲を組み合わせて使える。
// 電子帳簿保存法の検索要件(取引年月日・取引金額の範囲指定と組み合わせ)を満たすため。取引先は取引先の機能で追加する
const searchState = {}; // 画面ごと(entry / journal / ledger)の検索条件。タブを切り替えると消える
function normalizeSearch(s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/[\s,，¥￥円]/g, ''); }
function emptySearch() { return { text: '', dateFrom: '', dateTo: '', amountMin: '', amountMax: '', partnerId: '', status: '' }; }
function getSearch(scope) { return searchState[scope] || emptySearch(); }
function isSearchActive(q) { return !!(q.text || q.dateFrom || q.dateTo || q.amountMin !== '' || q.amountMax !== '' || q.partnerId || q.status); }
function txSearchText(t) {
  const m = movementsOf(t);
  return normalizeSearch([t.memo, partnerName(t.partnerId), KIND_LABELS[t.kind], m.map(function (x) { return nodeLabel(x.node); }).join(' '), t.date].join(' '));
}
function txMatches(t, q) {
  if (q.partnerId && (q.partnerId === '-' ? t.partnerId : t.partnerId !== q.partnerId)) return false; // '-' は取引先が未設定のもの
  if (q.dateFrom && (!t.date || t.date < q.dateFrom)) return false;
  if (q.dateTo && (!t.date || t.date > q.dateTo)) return false;
  const amt = Number(t.amount) || 0;
  if (q.amountMin !== '' && amt < Number(q.amountMin)) return false;
  if (q.amountMax !== '' && amt > Number(q.amountMax)) return false;
  if (q.text) {
    const hay = txSearchText(t);
    // 空白で区切った語はすべて含むもの(AND)。数字だけの語は、金額とは完全一致(1100 で 11,000 は出さない)、メモ・日付とは部分一致
    const words = String(q.text).normalize('NFKC').split(/\s+/).map(normalizeSearch).filter(Boolean);
    if (!words.every(function (w) { return (/^\d+$/.test(w) && amt === Number(w)) || hay.indexOf(w) >= 0; })) return false;
  }
  return true;
}
// 請求書の検索: 取引先・状態・発行日の範囲・金額(税込合計)の範囲・文字(番号・宛先・明細・備考・取引年月日)
function invoiceMatches(inv, q) {
  if (q.partnerId && (q.partnerId === '-' ? inv.partnerId : inv.partnerId !== q.partnerId)) return false;
  if (q.status && (inv.status || '下書き') !== q.status) return false;
  if (q.dateFrom && (!inv.issueDate || inv.issueDate < q.dateFrom)) return false;
  if (q.dateTo && (!inv.issueDate || inv.issueDate > q.dateTo)) return false;
  const total = invoiceTotals(inv).total;
  if (q.amountMin !== '' && total < Number(q.amountMin)) return false;
  if (q.amountMax !== '' && total > Number(q.amountMax)) return false;
  if (q.text) {
    const hay = normalizeSearch([inv.number, inv.clientName, inv.clientAddress, partnerName(inv.partnerId), inv.transactionDate, inv.notes, (inv.items || []).map(function (it) { return it.name; }).join(' '), inv.issueDate].join(' '));
    const words = String(q.text).normalize('NFKC').split(/\s+/).map(normalizeSearch).filter(Boolean);
    if (!words.every(function (w) { return (/^\d+$/.test(w) && total === Number(w)) || hay.indexOf(w) >= 0; })) return false;
  }
  return true;
}
function searchBarHtml(scope, note) {
  const isInv = scope === 'invoice';
  const q = getSearch(scope);
  return '<form class="search-bar" data-search-scope="' + scope + '" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:12px;">' +
    '<div class="field" style="flex:1 1 140px;margin:0;"><label>取引先</label><select name="partnerId"><option value="">すべて</option><option value="-"' + (q.partnerId === '-' ? ' selected' : '') + '>未設定</option>' + (state.partners || []).slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; }).map(function (p) { return '<option value="' + esc(p.id) + '"' + (q.partnerId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></div>' +
    (isInv ? '<div class="field" style="flex:1 1 140px;margin:0;"><label>状態</label><select name="status"><option value="">すべて</option>' + INVOICE_STATUSES.map(function (st) { return '<option' + (q.status === st ? ' selected' : '') + '>' + st + '</option>'; }).join('') + '</select></div>' : '') +
    '<div class="field" style="flex:2 1 180px;margin:0;"><label>' + (isInv ? '文字(番号・宛先・明細・備考・取引年月日)' : '文字(メモ・取引先・科目・金額)') + '</label><input type="search" name="text" value="' + esc(q.text) + '" placeholder="' + (isInv ? '例: 9月分 / 保守' : '例: 交通費 / 1100') + '"></div>' +
    '<div class="field" style="flex:1 1 130px;margin:0;"><label>' + (isInv ? '発行日(から)' : '日付(から)') + '</label><input type="date" name="dateFrom" value="' + esc(q.dateFrom) + '"></div>' +
    '<div class="field" style="flex:1 1 130px;margin:0;"><label>' + (isInv ? '発行日(まで)' : '日付(まで)') + '</label><input type="date" name="dateTo" value="' + esc(q.dateTo) + '"></div>' +
    '<div class="field" style="flex:1 1 110px;margin:0;"><label>' + (isInv ? '合計(税込・以上)' : '金額(以上)') + '</label><input type="number" name="amountMin" min="0" step="1" value="' + esc(q.amountMin) + '"></div>' +
    '<div class="field" style="flex:1 1 110px;margin:0;"><label>' + (isInv ? '合計(税込・以下)' : '金額(以下)') + '</label><input type="number" name="amountMax" min="0" step="1" value="' + esc(q.amountMax) + '"></div>' +
    '<div style="display:flex;gap:6px;"><button type="submit" class="btn secondary small">検索</button>' + (isSearchActive(q) ? '<button type="button" class="btn ghost small" data-search-clear>クリア</button>' : '') + '</div>' +
    (note && isSearchActive(q) ? '<div class="muted" style="flex-basis:100%;font-size:12px;">' + esc(note) + '</div>' : '') +
  '</form>';
}
function bindSearchBars() {
  document.querySelectorAll('form.search-bar').forEach(function (f) {
    const scope = f.dataset.searchScope;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      const v = function (n) { return f.elements[n].value.trim(); };
      searchState[scope] = { text: v('text'), dateFrom: v('dateFrom'), dateTo: v('dateTo'), amountMin: v('amountMin'), amountMax: v('amountMax'), partnerId: v('partnerId'), status: f.elements.status ? v('status') : '' };
      renderView();
    });
    const clear = f.querySelector('[data-search-clear]');
    if (clear) clear.addEventListener('click', function () { delete searchState[scope]; renderView(); });
  });
}

function journalOf(tx) {
  const m = movementsOf(tx);
  const d = m.find(function (x) { return x.side === 'debit'; });
  const c = m.find(function (x) { return x.side === 'credit'; });
  return { debit: d ? nodeLabel(d.node) : '-', credit: c ? nodeLabel(c.node) : '-' };
}
function allNodes() {
  const list = [];
  fundAccounts().forEach(function (a) { list.push('fund:' + a.key); });
  ACCOUNTS.income.forEach(function (a) { list.push('income:' + a.key); });
  ACCOUNTS.cogs.forEach(function (a) { list.push('cogs:' + a.key); });
  ACCOUNTS.expense.forEach(function (a) { list.push('expense:' + a.key); });
  ACCOUNTS.liability.forEach(function (a) { list.push('liability:' + a.key); });
  list.push('equity:drawing'); list.push('equity:contribution');
  return list;
}
function isDebitNormal(node) { return node.indexOf('fund:') === 0 || node.indexOf('expense:') === 0 || node.indexOf('cogs:') === 0 || node === 'equity:drawing'; }
function primaryLabel(t) {
  const m = movementsOf(t);
  if (!m.length) return KIND_LABELS[t.kind] || t.kind;
  const nonFund = m.find(function (x) { return x.node.indexOf('fund:') !== 0; });
  return nodeLabel(nonFund ? nonFund.node : m[0].node);
}
function txSign(t) {
  if (['income', 'contribution', 'borrow'].indexOf(t.kind) >= 0) return '+';
  if (t.kind === 'asset_purchase') return t.liability ? '' : '−'; // 未払金での購入はお金が出ていかない
  if (['expense', 'purchase', 'drawing', 'repay', 'pay_liability'].indexOf(t.kind) >= 0) return '−';
  return '';
}
function fundBalance(fundKey, asOfDate) {
  const acc = fundKey === 'cash' ? null : findById(bankAccounts(), fundKey);
  let bal = fundKey === 'cash' ? Number(state.settings.openingCash || 0) : Number(acc && acc.opening || 0);
  state.transactions.forEach(function (t) {
    if (!t.date || (asOfDate && t.date > asOfDate)) return;
    movementsOf(t).forEach(function (m) { if (m.node === 'fund:' + fundKey) bal += (m.side === 'debit' ? m.amt : -m.amt); });
  });
  return bal;
}
function liabilityBalance(key, asOfDate) {
  let bal = 0;
  state.transactions.forEach(function (t) {
    if (!t.date || (asOfDate && t.date > asOfDate)) return;
    movementsOf(t).forEach(function (m) { if (m.node === 'liability:' + key) bal += (m.side === 'credit' ? m.amt : -m.amt); });
  });
  return bal;
}
function equityTotal(nodeKey, asOfDate) {
  let sum = 0;
  state.transactions.forEach(function (t) {
    if (!t.date || (asOfDate && t.date > asOfDate)) return;
    movementsOf(t).forEach(function (m) { if (m.node === 'equity:' + nodeKey) sum += m.amt; });
  });
  return sum;
}

/* ============================== 固定資産・減価償却 ============================== */
// 定額法の償却率(平成19年4月1日以後に取得した減価償却資産)。耐用年数 2〜50年
// 出典: 減価償却資産の耐用年数等に関する省令 別表第八
//       国税庁「減価償却資産の償却率表」 https://www.nta.go.jp/law/joho-zeikaishaku/shotoku/shinkoku/070412/pdf/3.pdf
const STRAIGHT_LINE_RATES = {
  2: 0.500, 3: 0.334, 4: 0.250, 5: 0.200, 6: 0.167, 7: 0.143, 8: 0.125, 9: 0.112, 10: 0.100,
  11: 0.091, 12: 0.084, 13: 0.077, 14: 0.072, 15: 0.067, 16: 0.063, 17: 0.059, 18: 0.056, 19: 0.053, 20: 0.050,
  21: 0.048, 22: 0.046, 23: 0.044, 24: 0.042, 25: 0.040, 26: 0.039, 27: 0.038, 28: 0.036, 29: 0.035, 30: 0.034,
  31: 0.033, 32: 0.032, 33: 0.031, 34: 0.030, 35: 0.029, 36: 0.028, 37: 0.028, 38: 0.027, 39: 0.026, 40: 0.025,
  41: 0.025, 42: 0.024, 43: 0.024, 44: 0.023, 45: 0.023, 46: 0.022, 47: 0.022, 48: 0.021, 49: 0.021, 50: 0.020
};
// 入力できる耐用年数は償却率表にある 2〜50 年の整数だけ
function isValidUsefulLife(n) { return Number.isInteger(n) && Object.prototype.hasOwnProperty.call(STRAIGHT_LINE_RATES, n); }
// 年間の償却費 = 取得価額 × 償却率。表にない耐用年数(1年・51年以上)は (取得価額 − 1) ÷ 耐用年数 で計算する
function annualStraightLine(cost, life) {
  const rate = STRAIGHT_LINE_RATES[life];
  return rate ? cost * rate : Math.max(0, cost - 1) / life;
}
// 償却費の1円未満の端数処理(月数按分の結果にかける)。設定「減価償却の端数処理」で選ぶ。初期値は切り捨て
const DEPRECIATION_ROUNDING = { floor: '切り捨て', round: '四捨五入', ceil: '切り上げ' };
// 1円未満の端数処理(floor = 切り捨て / round = 四捨五入 / ceil = 切り上げ)。
// 浮動小数点の誤差(例: 69583.99999…)で1円ずれないよう、先に小数第6位で丸めてから端数処理する
function roundBy(mode, x) {
  const v = Math.round(x * 1e6) / 1e6;
  return mode === 'round' ? Math.round(v) : mode === 'ceil' ? Math.ceil(v) : Math.floor(v);
}
function roundDepreciation(x) { return roundBy(state.settings && state.settings.depreciationRounding, x); }
function depreciationSchedule(asset) {
  const cost = Number(asset.cost) || 0;
  const life = Math.max(1, Number(asset.usefulLifeYears) || 1);
  const base = Math.max(0, cost - 1); // 備忘価額として1円を残す
  const annualFull = annualStraightLine(cost, life);
  const acqYear = Number(asset.acquisitionDate.slice(0, 4));
  const acqMonth = Number(asset.acquisitionDate.slice(5, 7));
  const disposalYear = asset.disposalDate ? Number(asset.disposalDate.slice(0, 4)) : null;
  const disposalMonth = asset.disposalDate ? Number(asset.disposalDate.slice(5, 7)) : null;
  const schedule = {};
  let cum = 0;
  const lastYear = disposalYear || (acqYear + life + 1);
  for (let y = acqYear; y <= lastYear; y++) {
    if (cum >= base) { schedule[y] = { amount: 0, cumulative: cum, bookValue: cost - cum }; continue; }
    let months = 12;
    if (y === acqYear && disposalYear === acqYear) months = disposalMonth - acqMonth + 1;
    else if (y === acqYear) months = 12 - acqMonth + 1;
    else if (disposalYear && y === disposalYear) months = disposalMonth;
    months = Math.max(0, Math.min(12, months));
    let amt = roundDepreciation(annualFull * months / 12);
    if (cum + amt > base) amt = base - cum;
    cum += amt;
    schedule[y] = { amount: amt, cumulative: cum, bookValue: cost - cum };
  }
  return schedule;
}
function assetAnnualDepreciation(asset, year) { const s = depreciationSchedule(asset); return s[year] ? s[year].amount : 0; }
function assetBookValueAsOf(asset, dateStr) {
  const cost = Number(asset.cost) || 0;
  if (asset.acquisitionDate > dateStr) return cost;
  const y = Number(dateStr.slice(0, 4)); const m = Number(dateStr.slice(5, 7));
  const sched = depreciationSchedule(asset);
  const acqYear = Number(asset.acquisitionDate.slice(0, 4));
  const acqMonth = Number(asset.acquisitionDate.slice(5, 7));
  let cum = 0;
  for (let yy = acqYear; yy < y; yy++) cum += (sched[yy] ? sched[yy].amount : 0);
  const startMonth = (y === acqYear) ? acqMonth : 1;
  const fullYearMonths = (y === acqYear) ? (12 - acqMonth + 1) : 12;
  const monthsElapsed = Math.max(0, Math.min(fullYearMonths, m - startMonth + 1));
  const fullYearAmt = sched[y] ? sched[y].amount : 0;
  const partial = fullYearMonths > 0 ? Math.round(fullYearAmt * monthsElapsed / fullYearMonths) : 0;
  cum += Math.min(partial, fullYearAmt);
  const base = Math.max(0, cost - 1);
  cum = Math.min(cum, base);
  return cost - cum;
}
// 処分(除却・売却)した資産の、処分時点の帳簿価額 = 取得価額 − 処分した年までの償却費の累計
// (処分した年は処分した月まで月割りで償却する)
function assetDisposalBookValue(asset) {
  if (!asset.disposalDate) return 0;
  const s = depreciationSchedule(asset); const e = s[Number(asset.disposalDate.slice(0, 4))];
  return e ? e.bookValue : (Number(asset.cost) || 0);
}
function isDisposedBy(asset, dateStr) { return !!asset.disposalDate && asset.disposalDate <= dateStr; }
function isSale(asset) { return asset.disposalType === 'sale'; }
// その年に除却(廃棄)した資産の帳簿価額の合計 = 固定資産除却損
function totalRetirementLoss(year) {
  return (state.fixedAssets || []).filter(function (a) { return a.disposalDate && !isSale(a) && a.disposalDate.slice(0, 4) === String(year); })
    .reduce(function (s, a) { return s + assetDisposalBookValue(a); }, 0);
}
// 売却した資産の帳簿価額は経費にせず、事業主貸として帳簿から外す(譲渡所得の取得費の側に回るため)
function soldAssetsDrawing(asOfDate) {
  return (state.fixedAssets || []).filter(function (a) { return isSale(a) && isDisposedBy(a, asOfDate); })
    .reduce(function (s, a) { return s + assetDisposalBookValue(a); }, 0);
}
function totalDepreciation(year) { return (state.fixedAssets || []).reduce(function (s, a) { return s + assetAnnualDepreciation(a, year); }, 0); }
function totalFixedAssetsBookValue(asOfDate) {
  return (state.fixedAssets || []).filter(function (a) { return a.acquisitionDate <= asOfDate && !isDisposedBy(a, asOfDate); }).reduce(function (s, a) { return s + assetBookValueAsOf(a, asOfDate); }, 0);
}
function latestInventoryClosing(year) {
  const inv = state.inventoryYearEnd || {};
  const years = Object.keys(inv).map(Number).filter(function (y) { return y <= year; }).sort(function (a, b) { return b - a; });
  if (!years.length) return 0;
  return Number(inv[years[0]].closing) || 0;
}

/* ============================== 消費税 ============================== */
// 出典: 国税庁「消費税及び地方消費税の申告書(簡易課税用)の書き方」(令和6年11月)
//   https://www.nta.go.jp/publication/pamph/shohi/kaisei/yoshiki/pdf/202411_02.pdf
//   付表4-3・付表5-3: 課税資産の譲渡等の対価の額 = 税込 × 100/110(軽減は 100/108)、1円未満切捨て
//   課税標準額 = 税率ごとに千円未満切捨て / 消費税額 = 課税標準額 × 7.8%(軽減 6.24%)、1円未満切捨て
//   控除対象仕入税額: 1種類 = 基礎となる消費税額 × みなし仕入率。2種類以上 = 原則計算・特例(1種類で75%以上・2種類で75%以上)
//   (適用税率ごとに異なる計算方法は選べない)/ 差引税額・譲渡割額(× 22/78)は百円未満切捨て
// みなし仕入率: 国税庁 No.6505 簡易課税制度 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6505.htm
// 2割特例・3割特例: 国税庁「2割特例の概要」https://www.nta.go.jp/publication/pamph/shohi/kaisei/202304/01.htm
//   「インボイス制度に関する令和8年度税制改正について」(個人事業者: 令和8年分は2割特例、令和9・10年分は3割特例)
//   https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice-review/pdf/0026002-095.pdf
// 税率の表(適用開始日つき)。法改正のときはここを更新する。国税分は標準 7.8%・軽減 6.24%
const TAX_RATES = [{ from: '2019-10-01', standard: 10, reduced: 8 }];
const NATIONAL_PART = { 10: 78, 8: 62.4 }; // 税率の内の国税分(%)× 10。10% → 7.8% / 8% → 6.24%
const BUSINESS_TYPES = { 1: { label: '第1種(卸売業)', rate: 90 }, 2: { label: '第2種(小売業など)', rate: 80 }, 3: { label: '第3種(製造業・建設業など)', rate: 70 },
  4: { label: '第4種(その他の事業)', rate: 60 }, 5: { label: '第5種(サービス業・運輸通信業など)', rate: 50 }, 6: { label: '第6種(不動産業)', rate: 40 } };
const TAX_METHODS = { '': '未設定', exempt: '免税事業者(消費税の計算をしない)', simplified: '簡易課税', general: '本則課税', special20: '2割特例', special30: '3割特例' };
const TAX_CATEGORIES = { standard: '課税(標準税率)', reduced: '課税(軽減税率)', exempt: '非課税', outside: '不課税・対象外', export: '免税(輸出など)' };
function taxRateOn(date, category) {
  const row = TAX_RATES.slice().reverse().find(function (r) { return date >= r.from; });
  if (!row) return null;
  return category === 'reduced' ? row.reduced : row.standard;
}
const bigFloorDiv = function (a, b) { return a / b; }; // BigInt の割り算は 0 方向への切り捨て(ここでは正の数だけを扱う)
// 税込金額の合計から、税率ごとの各金額を国税庁の様式どおりに計算する
function taxBaseFor(inclusive, rate) {
  const incl = BigInt(Math.max(0, Math.floor(inclusive)));
  const exclusive = bigFloorDiv(incl * 100n, BigInt(100 + rate));          // 課税資産の譲渡等の対価の額(1円未満切捨て)
  const base = bigFloorDiv(exclusive, 1000n) * 1000n;                       // 課税標準額(千円未満切捨て)
  const national = BigInt(NATIONAL_PART[rate] * 10);                          // 7.8% → 780 / 6.24% → 624(× 1/10000)
  const tax = bigFloorDiv(base * national, 10000n);                           // 消費税額(1円未満切捨て)
  const taxInSales = bigFloorDiv(incl * national, BigInt((100 + rate) * 100)); // 売上に含まれる消費税額(事業区分別。1円未満切捨て)
  return { exclusive: exclusive, base: base, tax: tax, taxInSales: taxInSales };
}
// その年の消費税の集計。売上の金額は税込で記録している前提(年は1月〜12月の課税期間)
function computeConsumptionTax(year) {
  const s = state.settings || {};
  const method = s.taxMethod || '';
  const mainType = Number(s.mainBusinessType) || 0;
  const out = { year: year, method: method, warnings: [] };
  if (!method) { out.status = 'unset'; return out; }
  if (method === 'exempt') { out.status = 'exempt'; return out; }
  if (method === 'general') { out.status = 'general'; return out; }
  if (method === 'simplified' && !BUSINESS_TYPES[mainType]) { out.status = 'unsetType'; return out; }
  if (method === 'special20' && !(year >= 2023 && year <= 2026)) out.warnings.push('2割特例は、個人事業者は令和8年分(2026年分)までです。この年には使えない可能性があります');
  if (method === 'special30' && !(year >= 2027 && year <= 2028)) out.warnings.push('3割特例は、個人事業者の令和9年分・令和10年分(2027・2028年分)だけです。この年には使えない可能性があります');
  // 課税売上(税込)を、税率 × 事業区分ごとに集める
  const sales = {}; // sales[rate][type] = 税込合計
  let outOfTable = 0;
  const add = function (rate, type, amt) { sales[rate] = sales[rate] || {}; sales[rate][type] = (sales[rate][type] || 0) + amt; };
  state.transactions.forEach(function (t) {
    if (t.kind !== 'income' || !t.date || t.date.slice(0, 4) !== String(year)) return;
    const cat = t.taxCategory || 'standard';
    if (cat !== 'standard' && cat !== 'reduced') return;
    const rate = taxRateOn(t.date, cat); if (!rate) { outOfTable++; return; }
    add(rate, Number(t.businessType) || mainType, Number(t.amount) || 0);
  });
  // 固定資産の売却代金は、所得税では事業主借だが、消費税では課税売上(第4種・標準税率)
  (state.fixedAssets || []).forEach(function (a) {
    if (!isSale(a) || !a.disposalDate || a.disposalDate.slice(0, 4) !== String(year) || !(Number(a.saleAmount) > 0)) return;
    const rate = taxRateOn(a.disposalDate, 'standard'); if (!rate) { outOfTable++; return; }
    add(rate, 4, Number(a.saleAmount));
  });
  if (outOfTable) out.warnings.push('税率の表より前の日付の売上 ' + outOfTable + ' 件は集計していません');
  const rates = Object.keys(sales).map(Number).sort(function (a, b) { return b - a; });
  out.rates = rates.map(function (rate) {
    const inclusive = Object.keys(sales[rate]).reduce(function (x, k) { return x + sales[rate][k]; }, 0);
    const b = taxBaseFor(inclusive, rate);
    const byType = {};
    Object.keys(sales[rate]).forEach(function (k) { byType[k] = taxBaseFor(sales[rate][k], rate); byType[k].inclusive = sales[rate][k]; });
    return { rate: rate, inclusive: inclusive, exclusive: b.exclusive, base: b.base, tax: b.tax, byType: byType };
  });
  const sumBig = function (f) { return out.rates.reduce(function (x, r) { return x + f(r); }, 0n); };
  const totalTax = sumBig(function (r) { return r.tax; });
  // 控除対象仕入税額(税率ごとに計算し、すべての税率で同じ計算方法を使う)
  let deduction = 0n; let how = '';
  const pct = function (k, p) { return bigFloorDiv(k * BigInt(p), 100n); };
  if (method === 'special20' || method === 'special30') {
    const p = method === 'special20' ? 80 : 70;
    out.rates.forEach(function (r) { r.deduction = pct(r.tax, p); });
    how = TAX_METHODS[method] + '(売上の消費税額の ' + p + '% を控除)';
  } else {
    const types = Array.from(new Set([].concat.apply([], out.rates.map(function (r) { return Object.keys(r.byType).map(Number); })))).sort();
    const salesOfType = {}; let salesAll = 0n;
    types.forEach(function (t) { salesOfType[t] = out.rates.reduce(function (x, r) { return x + (r.byType[t] ? r.byType[t].exclusive : 0n); }, 0n); salesAll += salesOfType[t]; });
    const candidates = [];
    const apply = function (label, perRate) { const ds = out.rates.map(perRate); candidates.push({ label: label, ds: ds, total: ds.reduce(function (x, d) { return x + d; }, 0n) }); };
    if (types.length <= 1) {
      const m = types.length ? BUSINESS_TYPES[types[0]].rate : BUSINESS_TYPES[mainType].rate;
      apply((types.length ? BUSINESS_TYPES[types[0]].label : '') + '(1種類の事業)', function (r) { return pct(r.tax, m); });
    } else {
      // 原則計算: 基礎となる消費税額 × Σ(事業区分別の消費税額 × みなし仕入率)÷ 事業区分別の消費税額の合計
      apply('原則計算', function (r) {
        let num = 0n, den = 0n;
        Object.keys(r.byType).forEach(function (t) { num += r.byType[t].taxInSales * BigInt(BUSINESS_TYPES[t].rate); den += r.byType[t].taxInSales; });
        return den === 0n ? 0n : bigFloorDiv(r.tax * num, den * 100n);
      });
      // 特例: 1種類の事業で75%以上
      types.forEach(function (t) {
        if (salesOfType[t] * 100n >= salesAll * 75n) apply('特例計算(' + BUSINESS_TYPES[t].label + 'で75%以上)', function (r) { return pct(r.tax, BUSINESS_TYPES[t].rate); });
      });
      // 特例: 2種類の事業で75%以上(高い方のみなし仕入率をその事業に、低い方を残りに)
      for (let i = 0; i < types.length; i++) for (let j = i + 1; j < types.length; j++) {
        const t1 = types[i], t2 = types[j];
        if ((salesOfType[t1] + salesOfType[t2]) * 100n < salesAll * 75n) continue;
        const hi = BUSINESS_TYPES[t1].rate >= BUSINESS_TYPES[t2].rate ? t1 : t2, lo = hi === t1 ? t2 : t1;
        apply('特例計算(' + BUSINESS_TYPES[t1].label + 'と' + BUSINESS_TYPES[t2].label + 'で75%以上)', function (r) {
          let den = 0n; Object.keys(r.byType).forEach(function (t) { den += r.byType[t].taxInSales; });
          if (den === 0n) return 0n;
          const eHi = r.byType[hi] ? r.byType[hi].taxInSales : 0n;
          return bigFloorDiv(r.tax * (eHi * BigInt(BUSINESS_TYPES[hi].rate) + (den - eHi) * BigInt(BUSINESS_TYPES[lo].rate)), den * 100n);
        });
      }
    }
    // 有利な(控除額が最も大きい)計算方法を使う
    candidates.sort(function (a, b) { return b.total > a.total ? 1 : (b.total < a.total ? -1 : 0); });
    const best = candidates[0];
    out.rates.forEach(function (r, i) { r.deduction = best ? best.ds[i] : 0n; });
    how = best ? best.label : '';
    out.candidates = candidates.map(function (c) { return { label: c.label, total: Number(c.total) }; });
  }
  deduction = sumBig(function (r) { return r.deduction; });
  const net = totalTax > deduction ? bigFloorDiv(totalTax - deduction, 100n) * 100n : 0n;          // 差引税額(百円未満切捨て)
  const local = bigFloorDiv(bigFloorDiv(net * 22n, 78n), 100n) * 100n;                                 // 譲渡割額(百円未満切捨て)
  const interim = (state.taxInterim || {})[year] || {};
  const toNum = function (b) { return Number(b); };
  out.status = 'ok'; out.how = how;
  out.rates = out.rates.map(function (r) {
    const byType = {}; Object.keys(r.byType).forEach(function (t) { byType[t] = { inclusive: r.byType[t].inclusive, exclusive: toNum(r.byType[t].exclusive), taxInSales: toNum(r.byType[t].taxInSales) }; });
    return { rate: r.rate, inclusive: r.inclusive, exclusive: toNum(r.exclusive), base: toNum(r.base), tax: toNum(r.tax), deduction: toNum(r.deduction), byType: byType };
  });
  out.base = out.rates.reduce(function (x, r) { return x + r.base; }, 0);
  out.tax = toNum(totalTax); out.deduction = toNum(deduction); out.net = toNum(net); out.local = toNum(local);
  out.interimNational = Number(interim.national) || 0; out.interimLocal = Number(interim.local) || 0;
  out.payNational = out.net - out.interimNational; out.payLocal = out.local - out.interimLocal;
  out.payTotal = out.payNational + out.payLocal;
  return out;
}

/* ============================== 損益計算書 / 貸借対照表 ============================== */
function computePL(year) {
  const incomeTotals = {}; ACCOUNTS.income.forEach(function (a) { incomeTotals[a.key] = 0; });
  const expenseTotals = {}; ACCOUNTS.expense.forEach(function (a) { expenseTotals[a.key] = 0; });
  let purchases = 0;
  state.transactions.forEach(function (t) {
    if (!t.date || t.date.slice(0, 4) !== String(year)) return;
    const amt = Number(t.amount) || 0;
    if (t.kind === 'income') incomeTotals[t.account] = (incomeTotals[t.account] || 0) + amt;
    else if (t.kind === 'expense') expenseTotals[t.account] = (expenseTotals[t.account] || 0) + amt;
    else if (t.kind === 'purchase') purchases += amt;
    else if (t.kind === 'expense_accrued') {
      if (t.accountType === 'cogs') purchases += amt;
      else expenseTotals[t.account] = (expenseTotals[t.account] || 0) + amt;
    }
  });
  expenseTotals.depreciation = totalDepreciation(year);
  expenseTotals.retirement_loss = totalRetirementLoss(year);
  const inv = (state.inventoryYearEnd && state.inventoryYearEnd[year]) ? state.inventoryYearEnd[year] : { opening: 0, closing: 0 };
  const cogs = (Number(inv.opening) || 0) + purchases - (Number(inv.closing) || 0);
  const incomeSum = Object.values(incomeTotals).reduce(function (a, b) { return a + b; }, 0);
  const grossProfit = incomeSum - cogs;
  const expenseSum = Object.values(expenseTotals).reduce(function (a, b) { return a + b; }, 0);
  const net = grossProfit - expenseSum;
  return { incomeTotals: incomeTotals, expenseTotals: expenseTotals, incomeSum: incomeSum, purchases: purchases, cogs: cogs, grossProfit: grossProfit, expenseSum: expenseSum, net: net, inventoryOpening: Number(inv.opening) || 0, inventoryClosing: Number(inv.closing) || 0 };
}
function computeBS(asOfDate) {
  const year = Number(asOfDate.slice(0, 4));
  const cash = fundBalance('cash', asOfDate);
  const bankBreakdown = bankAccounts().map(function (a) { return { id: a.id, name: a.name, balance: fundBalance(a.id, asOfDate) }; });
  const bank = bankBreakdown.reduce(function (x, b) { return x + b.balance; }, 0);
  const inventoryVal = latestInventoryClosing(year);
  const fixedAssetsVal = totalFixedAssetsBookValue(asOfDate);
  const assetsTotal = cash + bank + inventoryVal + fixedAssetsVal;
  const payable = liabilityBalance('payable', asOfDate);
  const accrued = liabilityBalance('accrued', asOfDate);
  const loan = liabilityBalance('loan', asOfDate);
  const liabilitiesTotal = payable + accrued + loan;
  const openingCapital = Number(state.settings.openingCash || 0) + totalBankOpening();
  const contribution = equityTotal('contribution', asOfDate);
  const drawing = equityTotal('drawing', asOfDate) + soldAssetsDrawing(asOfDate);
  const contributedCapital = openingCapital + contribution - drawing;
  const retainedEarnings = assetsTotal - liabilitiesTotal - contributedCapital;
  const equityTotalVal = contributedCapital + retainedEarnings;
  return { cash: cash, bank: bank, bankBreakdown: bankBreakdown, inventoryVal: inventoryVal, fixedAssetsVal: fixedAssetsVal, assetsTotal: assetsTotal, payable: payable, accrued: accrued, loan: loan, liabilitiesTotal: liabilitiesTotal, openingCapital: openingCapital, contribution: contribution, drawing: drawing, contributedCapital: contributedCapital, retainedEarnings: retainedEarnings, equityTotalVal: equityTotalVal };
}

/* ============================== 保存レイヤー ============================== */
// データは Rust 側(src-tauri/src/lib.rs)が Application Support 内の data.json に原子的に書き込む
// options(ヘッダーなど)もそのまま渡す
function invoke(cmd, args, options) {
  if (!window.__TAURI__ || !window.__TAURI__.core) return Promise.reject(new Error('Tauri 環境ではありません'));
  return window.__TAURI__.core.invoke(cmd, args, options);
}
function snapshot() {
  return { app: 'keiri-note', schemaVersion: SCHEMA_VERSION, transactions: state.transactions, invoices: state.invoices, settings: state.settings, fixedAssets: state.fixedAssets, inventoryYearEnd: state.inventoryYearEnd, taxInterim: state.taxInterim, partners: state.partners, bankAccounts: state.bankAccounts };
}
// 保存は順番に1つずつ実行する(古い内容が新しい内容を上書きしないように)
let saveChain = Promise.resolve();
function persist() {
  if (STORAGE_MODE !== 'file') return Promise.resolve();
  const json = JSON.stringify(snapshot());
  const p = saveChain.then(function () { return invoke('save_data', { json: json }); });
  saveChain = p.catch(function () {});
  return p;
}
async function persistOrWarn(okMsg) {
  try { await persist(); if (okMsg) toast(okMsg); return true; } catch (e) { toast('保存に失敗しました'); return false; }
}
// 変更履歴(追記専用ログ)。保存の「前」に保留(status: pending)として書き、保存できたら完了(done)を追記する。
// 強制終了で完了を書けなかった保留は、次の起動時にデータと照らし合わせて done / aborted を追記する(recoverPendingHistory)。
// こうすると「保存されたのに履歴がない」ことが起きない
function appendHistory(entry) { return invoke('append_history', { entry: JSON.stringify(entry) }); }
async function logBegin(action, target, before, after, extra) {
  if (STORAGE_MODE !== 'file') return null;
  const entry = Object.assign({ hid: uid('h'), status: 'pending', action: action, target: target }, extra || {});
  if (before !== undefined) entry.before = before;
  if (after !== undefined) entry.after = after;
  try { await appendHistory(entry); return entry.hid; } catch (e) { toast('変更履歴の記録に失敗しました'); return null; }
}
function logEnd(hid, ok) {
  if (!hid) return;
  appendHistory({ status: ok ? 'done' : 'aborted', ref: hid }).catch(function () { toast('変更履歴の記録に失敗しました'); });
}
async function saveAndLog(action, target, before, after, okMsg, extra) {
  const hid = await logBegin(action, target, before, after, extra);
  logEnd(hid, await persistOrWarn(okMsg));
}
// 保留のままの変更が、読み込んだデータに反映されているか
const HISTORY_LISTS = { transaction: 'transactions', invoice: 'invoices', fixedAsset: 'fixedAssets' };
function historyApplied(e) {
  const same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  if (HISTORY_LISTS[e.target]) {
    const rec = e.after || e.before || {};
    const cur = findById(state[HISTORY_LISTS[e.target]], rec.id);
    if (e.action === 'delete') return !cur;
    if (!cur) return false;
    if (e.action === 'add') return true;
    // 修正: 変わった項目が修正後の値になっていれば反映済み
    return Object.keys(Object.assign({}, e.before, e.after)).every(function (k) { return same((e.before || {})[k], (e.after || {})[k]) || same(cur[k], (e.after || {})[k]); });
  }
  if (e.target === 'inventory') return same(state.inventoryYearEnd[e.year], e.after);
  if (e.target === 'taxInterim') return same(state.taxInterim[e.year], e.after);
  if (e.target === 'bankAccount') { const rec = e.after || e.before || {}; const cur = findById(bankAccounts(), rec.id);
    if (e.action === 'delete') return !cur; return !!cur && same(cur.name, (e.after || {}).name) && same(Number(cur.opening) || 0, Number((e.after || {}).opening) || 0); }
  if (e.target === 'partner') { const rec = e.after || e.before || {}; const cur = findById(state.partners || [], rec.id);
    if (e.action === 'delete' || e.action === 'merge') return !findById(state.partners || [], (e.before || {}).id);
    return !!cur && (e.action === 'add' || same(cur.name, (e.after || {}).name)); }
  if (e.target === 'settings') return Object.keys(e.after || {}).every(function (k) { return same(state.settings[k], e.after[k]); });
  if (e.target === 'all' && e.after) return e.after.transactions === state.transactions.length && e.after.invoices === state.invoices.length && e.after.fixedAssets === state.fixedAssets.length;
  return false;
}
async function recoverPendingHistory() {
  if (STORAGE_MODE !== 'file') return;
  let lines; try { lines = await invoke('read_history', { limit: 5000 }); } catch (e) { return; }
  const resolved = new Set(); const pending = [];
  lines.forEach(function (l) { let e; try { e = JSON.parse(l); } catch (x) { return; } if (e.ref) resolved.add(e.ref); else if (e.status === 'pending' && e.hid) pending.push(e); });
  for (const e of pending) {
    if (resolved.has(e.hid)) continue;
    try { await appendHistory({ status: historyApplied(e) ? 'done' : 'aborted', ref: e.hid, recovered: true }); } catch (x) {}
  }
}
function findById(list, id) { return list.find(function (x) { return x.id === id; }); }
/* ---------- 取引先(partners: [{ id, name, address? }]。取引・請求書は partnerId で指す) ---------- */
function partnerName(id) { const p = id && findById(state.partners || [], id); return p ? p.name : ''; }
function normName(s) { return String(s || '').normalize('NFKC').trim(); }
function findPartnerByName(name) { const n = normName(name); return n ? (state.partners || []).find(function (p) { return normName(p.name) === n; }) : null; }
function partnerUsage(id) {
  return { transactions: state.transactions.filter(function (t) { return t.partnerId === id; }).length, invoices: state.invoices.filter(function (i) { return i.partnerId === id; }).length };
}
// 入力された名前の取引先を返す。なければ作る(名前が空なら null)
async function partnerIdForName(name, address) {
  const n = normName(name).slice(0, 100); if (!n) return null;
  const found = findPartnerByName(n); if (found) return found.id;
  const doc = await Store.addPartner({ name: n, address: address ? String(address).slice(0, 200) : undefined });
  return doc.id;
}
// 取引先を選ぶプルダウン(▼)。取引先の一覧(名前順)+「新しい取引先を入力」。新しく入力するときだけ名前の入力欄を出す。
// 取引先が 10 件以上あるときは、プルダウンの上に絞り込みの入力欄を出す
const NEW_PARTNER = '__new';
const NO_PARTNER = '';
function partnerPickerHtml(prefix, currentId, currentName, allowNone) {
  const list = (state.partners || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
  // allowNone: 取引の入力では「(なし)」を選べる(取引先のない取引のため)。取引先も名前もなければ「(なし)」
  const sel = currentId && findById(list, currentId) ? currentId : (allowNone && !currentName ? NO_PARTNER : NEW_PARTNER);
  const showNew = sel === NEW_PARTNER;
  return '<div class="partner-picker" data-picker="' + prefix + '">' +
    (list.length >= 10 ? '<input type="search" class="picker-filter" placeholder="取引先を絞り込む" style="margin-bottom:6px;">' : '') +
    '<select id="' + prefix + '-sel">' + (allowNone ? '<option value=""' + (sel === NO_PARTNER ? ' selected' : '') + '>(なし)</option>' : '') + list.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
      '<option value="' + NEW_PARTNER + '"' + (showNew ? ' selected' : '') + '>' + (list.length ? '+ 新しい取引先を入力' : '新しい取引先を入力') + '</option></select>' +
    '<input type="text" id="' + prefix + '-new" maxlength="100" value="' + esc(showNew ? (currentName || '') : '') + '" placeholder="新しい取引先の名前" style="margin-top:6px;"' + (showNew ? '' : ' hidden') + '>' +
  '</div>';
}
// 選んだ取引先の名前(新しく入力した場合はその名前)を返す
function pickerName(prefix) {
  const sel = document.getElementById(prefix + '-sel'); if (!sel) return '';
  if (sel.value === NEW_PARTNER) return (document.getElementById(prefix + '-new') || {}).value || '';
  if (sel.value === NO_PARTNER) return '';
  return partnerName(sel.value);
}
function bindPartnerPicker(prefix, onPick) {
  const box = document.querySelector('[data-picker="' + prefix + '"]'); if (!box) return;
  const sel = document.getElementById(prefix + '-sel'), input = document.getElementById(prefix + '-new'), filter = box.querySelector('.picker-filter');
  sel.addEventListener('change', function () { input.hidden = sel.value !== NEW_PARTNER; if (sel.value === NEW_PARTNER) input.focus(); if (onPick) onPick((sel.value === NEW_PARTNER || sel.value === NO_PARTNER) ? null : findById(state.partners, sel.value)); });
  if (input && onPick) input.addEventListener('input', function () { onPick(null); });
  if (filter) filter.addEventListener('input', function () {
    const w = normalizeSearch(filter.value);
    Array.from(sel.options).forEach(function (o) { o.hidden = o.value !== NEW_PARTNER && o.value !== NO_PARTNER && w && normalizeSearch(o.textContent).indexOf(w) < 0; });
  });
}

const Store = {
  async loadAll() {
    state.transactions = []; state.invoices = []; state.settings = defaultSettings(); state.fixedAssets = []; state.inventoryYearEnd = {}; state.taxInterim = {}; state.partners = []; state.bankAccounts = defaultBankAccounts();
    let text;
    try { text = await invoke('load_data'); } catch (e) { STORAGE_MODE = 'memory'; STORAGE_ERROR = 'データを読み込めませんでした'; return; }
    STORAGE_MODE = 'file';
    if (text == null) return;
    let data;
    try {
      const raw = JSON.parse(text);
      const ver = raw && typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
      if (ver < SCHEMA_VERSION) {
        // データ形式を新しくする前に、今の data.json を「移行前の退避」として必ず残す。失敗したら保存を止める
        try { await invoke('backup_before_migration'); }
        catch (e) { STORAGE_MODE = 'memory'; STORAGE_ERROR = '形式の移行前の退避に失敗したため、保存を止めています(データファイルは上書きしていません)'; return; }
      }
      data = sanitizeBackup(raw);
    }
    catch (e) { STORAGE_MODE = 'memory'; STORAGE_ERROR = 'データファイルが壊れているため読み込めませんでした(ファイルは上書きしていません)'; return; }
    if (data.transactions) state.transactions = data.transactions;
    if (data.invoices) state.invoices = data.invoices;
    if (data.fixedAssets) state.fixedAssets = data.fixedAssets;
    if (data.inventoryYearEnd) state.inventoryYearEnd = data.inventoryYearEnd;
    if (data.taxInterim) state.taxInterim = data.taxInterim;
    if (data.partners) state.partners = data.partners;
    if (data.bankAccounts && data.bankAccounts.length) state.bankAccounts = data.bankAccounts;
    state.settings = Object.assign(defaultSettings(), data.settings || {});
  },
  async saveSettings(patch) {
    const before = state.settings;
    state.settings = Object.assign({}, state.settings, patch);
    await saveAndLog('update', 'settings', before, state.settings, '設定を保存しました');
  },
  async addTransaction(tx) {
    const doc = Object.assign({}, tx, { id: uid('tx'), createdAt: new Date().toISOString() });
    Object.keys(doc).forEach(function (k) { if (doc[k] === undefined) delete doc[k]; });
    state.transactions.push(doc);
    await saveAndLog('add', 'transaction', undefined, doc);
    return doc;
  },
  async updateTransaction(id, patch) {
    const idx = state.transactions.findIndex(function (t) { return t.id === id; }); if (idx < 0) return;
    const before = state.transactions[idx];
    const next = Object.assign({}, before, patch);
    Object.keys(next).forEach(function (k) { if (next[k] === undefined) delete next[k]; });
    state.transactions[idx] = next;
    await saveAndLog('update', 'transaction', before, state.transactions[idx]);
  },
  async deleteTransaction(id) {
    const before = findById(state.transactions, id);
    state.transactions = state.transactions.filter(function (t) { return t.id !== id; });
    await saveAndLog('delete', 'transaction', before, undefined);
  },
  async addInvoice(inv) {
    const doc = Object.assign({}, inv, { id: uid('inv'), createdAt: new Date().toISOString() });
    state.invoices.push(doc);
    await saveAndLog('add', 'invoice', undefined, doc);
    return doc;
  },
  async updateInvoice(id, patch) {
    const idx = state.invoices.findIndex(function (t) { return t.id === id; }); if (idx < 0) return;
    const before = state.invoices[idx];
    state.invoices[idx] = Object.assign({}, before, patch);
    await saveAndLog('update', 'invoice', before, state.invoices[idx]);
  },
  async deleteInvoice(id) {
    const before = findById(state.invoices, id);
    state.invoices = state.invoices.filter(function (t) { return t.id !== id; });
    await saveAndLog('delete', 'invoice', before, undefined);
  },
  async addFixedAsset(a) {
    const doc = Object.assign({}, a, { id: uid('fa') });
    Object.keys(doc).forEach(function (k) { if (doc[k] === undefined) delete doc[k]; });
    state.fixedAssets.push(doc);
    await saveAndLog('add', 'fixedAsset', undefined, doc);
    return doc;
  },
  async updateFixedAsset(id, patch) {
    const idx = state.fixedAssets.findIndex(function (a) { return a.id === id; }); if (idx < 0) return;
    const before = state.fixedAssets[idx];
    const next = Object.assign({}, before, patch);
    Object.keys(next).forEach(function (k) { if (next[k] === undefined) delete next[k]; }); // 処分を取り消した項目は消す
    state.fixedAssets[idx] = next;
    await saveAndLog('update', 'fixedAsset', before, state.fixedAssets[idx]);
    return state.fixedAssets[idx];
  },
  async deleteFixedAsset(id) {
    const before = findById(state.fixedAssets, id);
    state.fixedAssets = state.fixedAssets.filter(function (a) { return a.id !== id; });
    await saveAndLog('delete', 'fixedAsset', before, undefined);
  },
  // 口座(普通預金の補助科目)
  async addBankAccount(name) {
    const doc = { id: uid('bk'), name: name, opening: 0 };
    state.bankAccounts = bankAccounts().concat([doc]);
    await saveAndLog('add', 'bankAccount', undefined, doc, '口座を追加しました');
    return doc;
  },
  async updateBankAccount(id, patch) {
    const list = bankAccounts().slice(); const idx = list.findIndex(function (a) { return a.id === id; }); if (idx < 0) return;
    const before = list[idx]; list[idx] = Object.assign({}, before, patch); state.bankAccounts = list;
    await saveAndLog('update', 'bankAccount', before, list[idx]);
  },
  async deleteBankAccount(id) {
    if (bankAccountUsage(id) || bankAccounts().length <= 1) { toast('使われている口座・最後の1つの口座は削除できません'); return; }
    const before = findById(bankAccounts(), id);
    state.bankAccounts = bankAccounts().filter(function (a) { return a.id !== id; });
    await saveAndLog('delete', 'bankAccount', before, undefined);
  },
  async addPartner(p) {
    const doc = { id: uid('pt'), name: p.name }; if (p.address) doc.address = p.address;
    state.partners.push(doc);
    await saveAndLog('add', 'partner', undefined, doc);
    return doc;
  },
  async updatePartner(id, patch) {
    const idx = state.partners.findIndex(function (p) { return p.id === id; }); if (idx < 0) return;
    const before = state.partners[idx];
    const next = Object.assign({}, before, patch); Object.keys(next).forEach(function (k) { if (next[k] === undefined) delete next[k]; });
    state.partners[idx] = next;
    await saveAndLog('update', 'partner', before, state.partners[idx]);
  },
  // 統合: from の取引・請求書を to に付け替えてから from を消す(履歴には件数を残す)
  async mergePartner(fromId, toId) {
    const from = findById(state.partners, fromId), to = findById(state.partners, toId); if (!from || !to || fromId === toId) return;
    let n = 0;
    state.transactions = state.transactions.map(function (t) { if (t.partnerId !== fromId) return t; n++; return Object.assign({}, t, { partnerId: toId }); });
    state.invoices = state.invoices.map(function (i) { if (i.partnerId !== fromId) return i; n++; return Object.assign({}, i, isDraftInvoice(i) ? { partnerId: toId, clientName: to.name } : { partnerId: toId }); });
    state.partners = state.partners.filter(function (p) { return p.id !== fromId; });
    await saveAndLog('merge', 'partner', from, to, '統合しました', { moved: n });
  },
  async deletePartner(id) {
    const u = partnerUsage(id); if (u.transactions || u.invoices) { toast('使われている取引先は削除できません(統合してください)'); return; }
    const before = findById(state.partners, id);
    state.partners = state.partners.filter(function (p) { return p.id !== id; });
    await saveAndLog('delete', 'partner', before, undefined);
  },
  async setTaxInterim(year, data) {
    const before = state.taxInterim[year];
    state.taxInterim[year] = data;
    await saveAndLog(before ? 'update' : 'add', 'taxInterim', before, data, '保存しました', { year: Number(year) });
  },
  async setInventoryYear(year, data) {
    const before = state.inventoryYearEnd[year];
    state.inventoryYearEnd[year] = data;
    await saveAndLog(before ? 'update' : 'add', 'inventory', before, data, '保存しました', { year: Number(year) });
  },
  // まとめて置き換える(取り込み・全削除)。履歴には件数の要約を残す
  async replaceAll(data, action) {
    const counts = function () { return { transactions: state.transactions.length, invoices: state.invoices.length, fixedAssets: state.fixedAssets.length }; };
    const before = counts();
    state.transactions = data.transactions; state.invoices = data.invoices; state.settings = data.settings; state.fixedAssets = data.fixedAssets; state.inventoryYearEnd = data.inventoryYearEnd; state.taxInterim = data.taxInterim || {}; state.partners = data.partners || []; state.bankAccounts = (data.bankAccounts && data.bankAccounts.length) ? data.bankAccounts : defaultBankAccounts();
    await saveAndLog(action, 'all', before, counts());
  }
};

/* ============================== 画像(領収書)処理 ============================== */
// 画像は receipts/ にファイルとして保存し、表示時に読み出して blob: URL にする
const receiptUrls = {};
// 添付ファイルの形式は中身で判定する(JPEG / PNG / HEIC / PDF)。Rust 側の image_ext と同じ判定
function fileMime(u8) {
  if (u8.length >= 3 && u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) return 'image/jpeg';
  if (u8.length >= 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47 && u8[4] === 0x0D && u8[5] === 0x0A && u8[6] === 0x1A && u8[7] === 0x0A) return 'image/png';
  if (u8.length >= 5 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46 && u8[4] === 0x2D) return 'application/pdf';
  if (u8.length >= 12 && String.fromCharCode(u8[4], u8[5], u8[6], u8[7]) === 'ftyp' && ['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'].indexOf(String.fromCharCode(u8[8], u8[9], u8[10], u8[11])) >= 0) return 'image/heic';
  return null;
}
const imageMime = fileMime;
async function readReceiptBytes(id) { return new Uint8Array(await invoke('read_receipt', { id: id })); }
async function receiptUrl(id) {
  if (receiptUrls[id]) return receiptUrls[id];
  const bytes = await readReceiptBytes(id);
  receiptUrls[id] = URL.createObjectURL(new Blob([bytes], { type: imageMime(bytes) || 'application/octet-stream' }));
  return receiptUrls[id];
}
// 画像を保存し、Rust 側で作った画像 ID を返す
function saveReceiptBytes(bytes) { return invoke('save_receipt', bytes); }
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
// 添付ファイルの一覧(取引・請求書の attachments: [{ id, type, name, addedAt }])。ファイルは receipts/ に原本のまま保存し、
// 外しても消さない(訂正・削除の防止のため。外したことは変更履歴に残る)
function attachmentTileHtml(a) {
  const isImg = a.type && a.type.indexOf('image/') === 0;
  return '<div class="tx-thumb" data-receipt-open="' + esc(a.id) + '" title="' + esc(a.name || '') + '">' +
    (isImg ? '<img data-receipt="' + esc(a.id) + '" alt="">' : '<span style="display:flex;align-items:center;justify-content:center;height:100%;font-size:11px;font-weight:700;color:var(--ink-muted);">PDF</span>') + '</div>';
}
function attachWidgetHtml(key, list) {
  return '<div class="attach-widget" data-attach-key="' + key + '">' + attachListHtml(list) +
    '<input type="file" multiple accept="image/jpeg,image/png,image/heic,application/pdf,.heic,.pdf" data-attach-input style="margin-top:6px;">' +
    '<div class="note" style="margin-top:6px;">JPEG・PNG・HEIC・PDF(1ファイル 20MB まで)を、原本のまま保存します。外しても、ファイル自体は消さずに残します。<br>' +
    '写真には撮影場所(位置情報)などが含まれることがあります。書き出したバックアップにも含まれるので、人に渡すときは注意してください。</div></div>';
}
function attachListHtml(list) {
  if (!list || !list.length) return '<div class="attach-list muted" style="font-size:12px;">添付なし</div>';
  return '<div class="attach-list" style="display:flex;flex-direction:column;gap:6px;">' + list.map(function (a, i) {
    return '<div style="display:flex;align-items:center;gap:10px;">' + attachmentTileHtml(a) +
      '<div style="flex:1;font-size:12px;word-break:break-all;">' + esc(a.name || a.id) + '</div>' +
      '<a data-attach-open="' + esc(a.id) + '" style="font-size:12px;cursor:pointer;">開く</a>' +
      '<a data-attach-remove="' + i + '" style="font-size:12px;cursor:pointer;color:var(--danger);">外す</a></div>';
  }).join('') + '</div>';
}
// 添付の編集中の一覧(取引の入力画面 = 'tx'。請求書は invoiceDraft.attachments を直接使う)
const formAttach = { tx: null, txOwner: null };
function attachListFor(key) { return key === 'inv' ? (invoiceDraft.attachments = invoiceDraft.attachments || []) : formAttach.tx; }
function bindAttachWidgets() {
  document.querySelectorAll('.attach-widget').forEach(function (w) {
    const key = w.dataset.attachKey;
    const redraw = function () { w.querySelector('.attach-list').outerHTML = attachListHtml(attachListFor(key)); bindAttachWidgets(); hydrateReceipts(); };
    w.querySelectorAll('[data-attach-open]').forEach(function (el) { el.onclick = function () { openAttachment(el.dataset.attachOpen); }; });
    w.querySelectorAll('[data-attach-remove]').forEach(function (el) { el.onclick = function () { attachListFor(key).splice(Number(el.dataset.attachRemove), 1); redraw(); }; });
    const input = w.querySelector('[data-attach-input]');
    input.onchange = async function () {
      const files = Array.from(input.files || []); input.value = '';
      for (const f of files) {
        try {
          if (f.size > MAX_ATTACHMENT_BYTES) throw new Error('20MB を超えています');
          const bytes = new Uint8Array(await f.arrayBuffer());
          const type = fileMime(bytes); if (!type) throw new Error('JPEG・PNG・HEIC・PDF 以外の形式です');
          const id = await saveReceiptBytes(bytes);
          attachListFor(key).push({ id: id, type: type, name: String(f.name || '').slice(0, 200), addedAt: new Date().toISOString() });
        } catch (e) { toast('添付できませんでした(' + String(typeof e === 'string' ? e : (e && e.message) || '').slice(0, 80) + ')', 8000); }
      }
      redraw();
    };
  });
}
function openAttachment(id) { invoke('open_attachment', { id: id }).catch(function (e) { toast('開けませんでした(' + String(typeof e === 'string' ? e : (e && e.message) || '').slice(0, 80) + ')', 6000); }); }
// 画面内の <img data-receipt> に画像を読み込む。見つからない画像は空欄のままにする
function hydrateReceipts() {
  document.querySelectorAll('img[data-receipt]').forEach(function (img) {
    receiptUrl(img.dataset.receipt).then(function (u) { img.src = u; }).catch(function () { img.removeAttribute('data-receipt'); img.parentNode.title = '画像が見つかりません'; });
  });
  // クリックすると「プレビュー」で開く(原本ではなく読み取り専用のコピー)
  document.querySelectorAll('[data-receipt-open]').forEach(function (el) {
    el.style.cursor = 'pointer';
    el.onclick = function (ev) { ev.preventDefault(); ev.stopPropagation(); openAttachment(el.dataset.receiptOpen); };
  });
}
function bytesToBase64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function base64ToBytes(b64) { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }
// 失敗した段階がわかるよう、stage(read / decode / convert)を付けて reject する
function stageError(stage, detail) { const e = new Error(stage + (detail ? ': ' + detail : '')); e.stage = stage; return e; }
function loadImageElement(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader(); const img = new Image();
    reader.onerror = function () { reject(stageError('read', reader.error && reader.error.name)); };
    reader.onload = function () { img.src = reader.result; };
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(stageError('decode', 'img')); };
    reader.readAsDataURL(file);
  });
}
async function decodeImage(file) {
  try { return await loadImageElement(file); }
  catch (e) {
    if (e.stage !== 'decode' || !window.createImageBitmap) throw e;
    // <img> で読めない形式は createImageBitmap でも試す
    try { return await createImageBitmap(file); } catch (e2) { throw stageError('decode', 'bitmap ' + (e2 && e2.name)); }
  }
}
async function compressImage(file, maxDim, quality) {
  maxDim = maxDim || 1400; quality = quality || 0.82;
  const img = await decodeImage(file);
  let w = img.width, h = img.height;
  if (!w || !h) throw stageError('decode', 'size 0');
  if (w > maxDim || h > maxDim) { if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; } else { w = Math.round(w * maxDim / h); h = maxDim; } }
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); if (!ctx) throw stageError('convert', 'no 2d context');
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', quality); });
  if (!blob) throw stageError('convert', 'toBlob null');
  return blob;
}

/* ============================== ダウンロード ============================== */
async function downloadFile(filename, content) {
  // 書き出しは Mac 標準の保存ダイアログで選んだ場所にだけ保存する。キャンセルなら何も書かない
  try {
    const saved = await invoke('export_file', { filename: filename, content: content });
    if (!saved) return false;
    toast('保存しました: ' + saved); return true;
  } catch (e) { toast('書き出しに失敗しました'); return false; }
}
function csvField(v) { v = String(v == null ? '' : v); if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"'; return v; }

/* ============================== モーダル ============================== */
function openModal(title, bodyHtml) {
  if (onModalClose) { const f = onModalClose; onModalClose = null; f(); } // 確認中に別のモーダルが開いたら「キャンセル」扱い
  document.getElementById('modal-root').innerHTML =
    '<div class="modal-backdrop" id="modal-backdrop"><div class="modal-sheet"><div class="modal-head"><h3>' + esc(title) + '</h3><button class="modal-close" id="modal-close">&times;</button></div>' + bodyHtml + '</div></div>';
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', function (e) { if (e.target.id === 'modal-backdrop') closeModal(); });
}
let onModalClose = null;
function closeModal() { document.getElementById('modal-root').innerHTML = ''; const f = onModalClose; onModalClose = null; if (f) f(); }
// window.confirm() は Tauri(WKWebView)では表示されないため、自前のモーダルで確認する。OK なら true を返す
function confirmDialog(message, okLabel) {
  return new Promise(function (resolve) {
    openModal('確認', '<p style="margin-bottom:18px;line-height:1.7;">' + esc(message) + '</p>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;"><button class="btn secondary" id="confirm-cancel">キャンセル</button><button class="btn danger" id="confirm-ok">' + esc(okLabel || 'OK') + '</button></div>');
    let result = false;
    onModalClose = function () { resolve(result); };
    document.getElementById('confirm-cancel').addEventListener('click', closeModal);
    document.getElementById('confirm-ok').addEventListener('click', function () { result = true; closeModal(); });
    document.getElementById('confirm-cancel').focus();
  });
}

/* ============================== レンダリング: シェル ============================== */
function renderShell() {
  const cash = fundBalance('cash', todayStr()); const bank = totalBankBalance(todayStr());
  const tabsHtml = TABS.map(function (t) { return '<button data-tab=\"' + esc(t.id) + '\" class="' + (t.id === currentTab ? 'active' : '') + '">' + t.label + '</button>'; }).join('');
  document.getElementById('app').innerHTML =
    '<header class="app-header"><div class="header-row">' + hankoSvg() +
      '<div class="brand"><h1>青りんご帳簿</h1><div class="sub">' + esc(state.settings.businessName || '個人事業主の複式簿記') + '</div></div>' +
      '<div class="balance-chip"><div class="lbl">現金+預金残高</div><div class="val num">' + yen(cash + bank) + '</div></div>' +
    '</div><nav class="tabs">' + tabsHtml + '</nav></header><main id="view"></main>';
  document.querySelectorAll('nav.tabs button').forEach(function (b) { b.addEventListener('click', function () { currentTab = b.dataset.tab; editingTxId = null; Object.keys(searchState).forEach(function (k) { delete searchState[k]; }); renderShell(); }); });
  renderView();
}
function hankoSvg() {
  return '<svg class="hanko" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="18" fill="none" stroke="var(--brand-gold)" stroke-width="2.5"/><text x="20" y="26" text-anchor="middle" font-size="16" font-family="var(--font-display)" fill="var(--brand-gold)">帳</text></svg>';
}
function renderView() {
  const view = document.getElementById('view');
  renderViewContent(view);
  const notice = invalidLifeNotice(); // すべてのタブの上に表示
  if (notice) view.insertAdjacentHTML('afterbegin', '<div style="margin-bottom:12px;">' + notice + '</div>');
  bindViewEvents();
}
function renderViewContent(view) {
  if (currentTab === 'entry') view.innerHTML = viewEntry();
  else if (currentTab === 'journal') view.innerHTML = viewJournal();
  else if (currentTab === 'ledger') view.innerHTML = viewLedger();
  else if (currentTab === 'assets') view.innerHTML = viewAssets();
  else if (currentTab === 'pl') view.innerHTML = viewPL();
  else if (currentTab === 'bs') view.innerHTML = viewBS();
  else if (currentTab === 'invoice') view.innerHTML = viewInvoiceList();
  else if (currentTab === 'report') view.innerHTML = viewReport();
  else if (currentTab === 'partners') view.innerHTML = viewPartners();
  else if (currentTab === 'settings') view.innerHTML = viewSettings();
}
// v6 への移行で既存の売上を「課税(標準税率)」にしたことの案内。確認したら消せる
function taxReviewNotice() {
  if ((state.settings || {}).taxReview !== 'pending') return '';
  const n = state.transactions.filter(function (t) { return t.kind === 'income'; }).length;
  return '<div class="storage-flag"><span class="storage-dot warn"></span><div>以前の売上(収入) ' + n + ' 件を、消費税の税区分「課税(標準税率)」として移行しました。非課税・不課税(預金の利息など)のものがあれば、取引を編集して修正してください。 <a data-tax-review-done style="cursor:pointer;">確認した(この案内を消す)</a></div></div>';
}
function storageFlag() {
  const ok = STORAGE_MODE === 'file';
  const label = ok ? '保存先: この Mac 内のファイル(アプリのデータフォルダ。Time Machine の対象です)'
    : '保存できません: ' + (STORAGE_ERROR || '保存先を利用できません') + '。この画面での変更は保存されません';
  return '<div class="storage-flag"><span class="storage-dot ' + (ok ? 'ok' : 'warn') + '"></span>' + label + '</div>' + backupReminder() + assetPaymentNotice();
}
// 支払いが記録されていない固定資産(この仕組みより前に登録したもの)の案内。
// 未設定の間は購入代金が資金・未払金から引かれないため、貸借対照表の繰越利益が所得と一致しない
function assetsWithoutPayment() { return (state.fixedAssets || []).filter(function (a) { return !a.payFund; }); }
function assetPaymentNotice() {
  const n = assetsWithoutPayment().length; if (!n) return '';
  return '<div class="storage-flag"><span class="storage-dot warn"></span>支払い方法が未設定の固定資産が ' + n + ' 件あります。「資産・負債」タブの固定資産台帳で編集し、支払い方法を設定してください(設定すると支払いの仕訳を作ります)。未設定の間は、購入代金が現金・預金・未払金に反映されないため、貸借対照表の数字が実際と合いません。</div>';
}
// 耐用年数が償却率表の範囲外(2〜50年の整数でない)の固定資産。既存データや取り込みで入ってくることがある。
// データは消さず、(取得価額 − 1) ÷ 耐用年数 で計算を続けたうえで、画面で修正を促す
function assetsWithInvalidLife(list) { return (list || state.fixedAssets || []).filter(function (a) { return !isValidUsefulLife(Number(a.usefulLifeYears)); }); }
function invalidLifeNotice() {
  const n = assetsWithInvalidLife().length; if (!n) return '';
  return '<div class="storage-flag"><span class="storage-dot warn"></span>耐用年数が 2〜50 年の範囲外の固定資産が ' + n + ' 件あります。「資産・負債」タブの固定資産台帳で修正してください。修正するまで、減価償却費は暫定値です。</div>';
}
function backupReminder() {
  if (!state.transactions.length && !state.invoices.length) return '';
  let last = null; try { last = localStorage.getItem('keirinote_lastBackupAt'); } catch (e) {}
  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  if (days !== null && days < 7) return '';
  const msg = days === null ? 'まだバックアップがありません。設定画面から書き出してください' : '最後のバックアップから' + days + '日たっています。設定画面から書き出してください';
  return '<div class="storage-flag"><span class="storage-dot warn"></span>' + esc(msg) + '</div>';
}

/* ============================== 入力タブ ============================== */
function kindSelectHtml(current) {
  const groups = [
    { label: '現金取引', opts: [['income', '収入'], ['expense', '経費'], ['purchase', '仕入(棚卸資産がある場合)']] },
    { label: '資金移動', opts: [['drawing', '事業主貸(生活費などの出金)'], ['contribution', '事業主借(個人資金の入金)']] },
    { label: '未払い・買掛(発生主義)', opts: [['expense_accrued', '経費・仕入を未払計上する'], ['pay_liability', '買掛金・未払金を支払う']] },
    { label: '借入', opts: [['borrow', '借入金を受け取る'], ['repay', '借入金を返済する(元本)']] }
  ];
  return groups.map(function (g) {
    return '<optgroup label="' + g.label + '">' + g.opts.map(function (o) { return '<option value="' + o[0] + '" ' + (o[0] === current ? 'selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</optgroup>';
  }).join('');
}
function accountSelectHtml(type, current, excludeDepreciation) {
  let list = ACCOUNTS[type]; if (excludeDepreciation) list = list.filter(function (a) { return !a.auto; });
  return '<label>勘定科目</label><select id="f-account">' + list.map(function (a) { return '<option value="' + a.key + '" ' + (a.key === current ? 'selected' : '') + '>' + a.label + '</option>'; }).join('') + '</select>';
}
function accrualOptionsHtml(current) {
  let html = '<optgroup label="経費">';
  ACCOUNTS.expense.filter(function (a) { return !a.auto; }).forEach(function (a) { const v = 'expense:' + a.key; html += '<option value="' + v + '" ' + (v === current ? 'selected' : '') + '>' + a.label + '</option>'; });
  html += '</optgroup><optgroup label="仕入">';
  ACCOUNTS.cogs.forEach(function (a) { const v = 'cogs:' + a.key; html += '<option value="' + v + '" ' + (v === current ? 'selected' : '') + '>' + a.label + '</option>'; });
  html += '</optgroup>';
  return html;
}
function liabilityOptionsHtml(keys, current) {
  return keys.map(function (k) { const a = ACCOUNTS.liability.find(function (x) { return x.key === k; }); return '<option value="' + k + '" ' + (k === current ? 'selected' : '') + '>' + a.label + '</option>'; }).join('');
}
// 税区分(収入は必須・初期値あり。経費などは記録のみで任意)と、売上ごとの事業区分の上書き
function taxFieldsHtml(kind, tx) {
  const opts = function (cur, withBlank) {
    return (withBlank ? '<option value="">未入力</option>' : '') + Object.keys(TAX_CATEGORIES).map(function (k) { return '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + TAX_CATEGORIES[k] + '</option>'; }).join('');
  };
  if (kind === 'income') {
    const cur = tx && tx.taxCategory ? tx.taxCategory : ((tx && tx.account === 'misc_income') ? 'exempt' : 'standard');
    const bt = tx && tx.businessType ? Number(tx.businessType) : 0;
    return '<div class="field-row" style="margin-top:10px;"><div class="field"><label>消費税の税区分</label><select id="f-taxcat">' + opts(cur, false) + '</select></div>' +
      '<div class="field"><label>事業区分(簡易課税)</label><select id="f-bizcat"><option value="0">主たる事業区分</option>' +
      Object.keys(BUSINESS_TYPES).map(function (k) { return '<option value="' + k + '"' + (bt === Number(k) ? ' selected' : '') + '>' + BUSINESS_TYPES[k].label + '・' + BUSINESS_TYPES[k].rate + '%</option>'; }).join('') + '</select></div></div>' +
      '<div class="note">売上の金額は税込で入力します。事業区分は、主たる事業と違う売上のときだけ選びます。</div>';
  }
  if (kind === 'expense' || kind === 'purchase' || kind === 'expense_accrued') {
    return '<div class="field" style="margin-top:10px;"><label>消費税の税区分(任意・記録のみ)</label><select id="f-taxcat">' + opts(tx ? tx.taxCategory : '', true) + '</select></div>';
  }
  return '';
}
function renderDynamicFields(kind, tx) {
  const box = document.getElementById('account-field'); const fundWrap = document.getElementById('fund-field-wrap');
  let html = '';
  if (kind === 'income') html = accountSelectHtml('income', tx ? tx.account : null);
  else if (kind === 'expense') html = accountSelectHtml('expense', tx ? tx.account : null, true);
  else if (kind === 'purchase') html = '<div class="note">仕入高(棚卸資産のもとになる仕入)として記録します。</div>';
  else if (kind === 'expense_accrued') {
    const cur = tx ? (tx.accountType + ':' + tx.account) : null;
    html = '<label>費用の種類</label><select id="f-accrual-account">' + accrualOptionsHtml(cur) + '</select>' +
      '<label style="margin-top:10px;">未払いの区分</label><select id="f-liability">' + liabilityOptionsHtml(['payable', 'accrued'], tx ? tx.liability : null) + '</select>';
  } else if (kind === 'pay_liability') {
    html = '<label>支払う負債</label><select id="f-liability">' + liabilityOptionsHtml(['payable', 'accrued'], tx ? tx.liability : null) + '</select>';
  }
  html += taxFieldsHtml(kind, tx);
  if (box) box.innerHTML = html;
  if (fundWrap) fundWrap.style.display = (kind === 'expense_accrued') ? 'none' : '';
  // 収入の科目を変えたら、税区分の初期値(売上 = 課税・標準税率 / 雑収入 = 非課税)も合わせる(既存の取引の編集中は変えない)
  const acc = document.getElementById('f-account'), tc = document.getElementById('f-taxcat');
  if (kind === 'income' && acc && tc && !tx) acc.addEventListener('change', function () { tc.value = acc.value === 'misc_income' ? 'exempt' : 'standard'; });
}
function fundRadio(k, current) { return '<label><input type="radio" name="fund" value="' + k + '" ' + (k === current ? 'checked' : '') + '><span>' + fundLabel(k) + '</span></label>'; }
function viewEntry() {
  const editing = editingTxId ? state.transactions.find(function (t) { return t.id === editingTxId; }) : null;
  const kind = editing ? editing.kind : 'expense';
  const q = getSearch('entry'); const searching = isSearchActive(q);
  const sorted = state.transactions.slice().sort(function (a, b) { return (b.date + b.createdAt) < (a.date + a.createdAt) ? -1 : 1; });
  const matched = searching ? sorted.filter(function (t) { return txMatches(t, q); }) : sorted;
  const recent = matched.slice(0, searching ? 300 : 25);
  return (
    '<section class="block"><h2>' + (editing ? '取引を編集' : '取引を記録') + '</h2>' + storageFlag() +
      '<form id="tx-form">' +
        '<div class="field"><label>区分</label><select id="f-kind">' + kindSelectHtml(kind) + '</select></div>' +
        '<div class="field-row">' +
          '<div class="field"><label>日付</label><input type="date" id="f-date" value="' + esc(editing ? editing.date : todayStr()) + '"></div>' +
          '<div class="field"><label>金額(円)</label><input type="number" id="f-amount" min="0" step="1" value="' + (editing ? editing.amount : '') + '" placeholder="0"></div>' +
        '</div>' +
        '<div class="field" id="account-field"></div>' +
        '<div class="field" id="fund-field-wrap"><label>資金(現金・口座)</label>' + fundPickerHtml('fund-group', editing ? editing.fund : 'cash') + '</div>' +
        '<div class="field"><label>取引先(任意)</label>' + partnerPickerHtml('f-partner', editing ? editing.partnerId : null, '', true) + '</div>' +
        '<div class="field"><label>メモ</label><input type="text" id="f-memo" value="' + esc(editing ? (editing.memo || '') : '') + '" placeholder="例:交通費など"></div>' +
        '<div class="field"><label>添付ファイル(レシート・領収書・請求書など。任意)</label>' + attachWidgetHtml('tx', txFormAttachments(editing)) + '</div>' +
        '<div style="display:flex; gap:10px; margin-top:16px;"><button type="submit" class="btn block">' + (editing ? '更新する' : '記録する') + '</button>' +
          (editing ? '<button type="button" id="cancel-edit" class="btn secondary">キャンセル</button>' : '') +
        '</div>' +
      '</form>' +
    '</section>' +
    '<section class="block"><h2>' + (searching ? '検索結果(' + matched.length + ' 件' + (matched.length > recent.length ? '・新しい順に ' + recent.length + ' 件を表示' : '') + ')' : '最近の記録') + '</h2>' + searchBarHtml('entry', 'すべての年から探します') +
      (recent.length ? recent.map(txRowHtml).join('') : '<div class="muted" style="padding:16px 0;">' + (searching ? '条件に合う取引はありません。' : 'まだ記録がありません。上のフォームから最初の取引を記録しましょう。') + '</div>') +
    '</section>'
  );
}
// 入力画面の添付一覧は、編集する取引が変わったときだけ作り直す(描き直しで未保存の添付を失わない)
function txFormAttachments(editing) {
  const owner = editing ? editing.id : 'new';
  if (formAttach.txOwner !== owner || !formAttach.tx) { formAttach.txOwner = owner; formAttach.tx = (editing && editing.attachments || []).map(function (a) { return Object.assign({}, a); }); }
  return formAttach.tx;
}
function txRowHtml(t) {
  const label = primaryLabel(t); const sign = txSign(t); const cls = sign === '+' ? 'income' : 'expense';
  return (
    '<div class="tx-row">' + (t.attachments && t.attachments.length ? attachmentTileHtml(t.attachments[0]) : '<div class="tx-thumb"></div>') +
      '<div class="tx-main"><div class="tx-top"><span class="tx-cat">' + esc(label) + '</span><span class="tx-amt num ' + cls + '">' + sign + yen(t.amount) + '</span></div>' +
      '<div class="tx-meta"><span class="tag">' + esc(KIND_LABELS[t.kind]) + '</span> ' + (t.linkedAssetId && t.kind === 'contribution' ? '<span class="tag">固定資産の売却</span> ' : '') + (t.attachments && t.attachments.length > 1 ? '<span class="tag">添付 ' + t.attachments.length + '</span> ' : '') + esc(t.date) + (t.fund ? ' ・ ' + esc(fundLabel(t.fund)) : '') + (t.partnerId ? ' ・ ' + esc(partnerName(t.partnerId)) : '') + (t.memo ? ' ・ ' + esc(t.memo) : '') + '</div>' +
      '<div class="tx-actions"><a data-edit-tx=\"' + esc(t.id) + '\">編集</a><a data-del-tx=\"' + esc(t.id) + '\" style="color:var(--danger);">削除</a></div></div></div>'
  );
}

/* ============================== 仕訳帳タブ ============================== */
function viewJournal() {
  const years = availableYears(); const y = window.__journalYear || years[0] || new Date().getFullYear(); const m = window.__journalMonth || 0;
  const q = getSearch('journal'); const searching = isSearchActive(q);
  // 検索中は年・月の選択を使わず、すべての年から探す
  const rows = state.transactions.filter(function (t) { return searching ? txMatches(t, q) : (t.date && t.date.slice(0, 4) === String(y) && (m === 0 || Number(t.date.slice(5, 7)) === m)); })
    .sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  const monthOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (mo) { return '<option value="' + mo + '" ' + (mo === m ? 'selected' : '') + '>' + (mo === 0 ? '全月' : mo + '月') + '</option>'; }).join('');
  const yearOptions = years.map(function (yr) { return '<option value="' + yr + '" ' + (yr === y ? 'selected' : '') + '>' + yr + '年</option>'; }).join('');
  return (
    '<section class="block"><h2>仕訳帳' + (searching ? '(検索結果 ' + rows.length + ' 件)' : '') + '</h2>' +
      '<div style="display:flex; gap:8px; margin-bottom:14px;"><select class="year-select" id="journal-year"' + (searching ? ' disabled' : '') + '>' + yearOptions + '</select><select class="year-select" id="journal-month"' + (searching ? ' disabled' : '') + '>' + monthOptions + '</select></div>' +
      searchBarHtml('journal', '検索中は年・月の選択を使わず、すべての年から探します') +
      '<div class="table-scroll"><table class="ledger"><tr><th>日付</th><th>借方科目</th><th class="num">借方金額</th><th>貸方科目</th><th class="num">貸方金額</th><th>摘要</th></tr>' +
        (rows.length ? rows.map(function (t) { const j = journalOf(t); return '<tr><td>' + esc(t.date) + '</td><td>' + esc(j.debit) + '</td><td class="num">' + yen(t.amount) + '</td><td>' + esc(j.credit) + '</td><td class="num">' + yen(t.amount) + '</td><td class="muted">' + esc(t.memo || '') + '</td></tr>'; }).join('') : '<tr><td colspan="6" class="muted" style="padding:20px 6px;">この期間の記録はありません</td></tr>') +
      '</table></div>' +
    '</section>'
  );
}

/* ============================== 総勘定元帳タブ ============================== */
function viewLedger() {
  const years = availableYears(); const y = window.__ledgerYear || years[0] || new Date().getFullYear(); const node = window.__ledgerNode || 'fund:cash';
  const groups = [
    { label: '資金', nodes: fundAccounts().map(function (a) { return { node: 'fund:' + a.key, label: a.label }; }) },
    { label: '収入', nodes: ACCOUNTS.income.map(function (a) { return { node: 'income:' + a.key, label: a.label }; }) },
    { label: '仕入', nodes: ACCOUNTS.cogs.map(function (a) { return { node: 'cogs:' + a.key, label: a.label }; }) },
    { label: '経費', nodes: ACCOUNTS.expense.map(function (a) { return { node: 'expense:' + a.key, label: a.label }; }) },
    { label: '負債', nodes: ACCOUNTS.liability.map(function (a) { return { node: 'liability:' + a.key, label: a.label }; }) },
    { label: '元入・事業主勘定', nodes: [{ node: 'equity:drawing', label: '事業主貸' }, { node: 'equity:contribution', label: '事業主借' }] }
  ];
  const optionsHtml = groups.map(function (g) { return '<optgroup label="' + g.label + '">' + g.nodes.map(function (n) { return '<option value="' + n.node + '" ' + (n.node === node ? 'selected' : '') + '>' + n.label + '</option>'; }).join('') + '</optgroup>'; }).join('');
  const yearOptions = years.map(function (yr) { return '<option value="' + yr + '" ' + (yr === y ? 'selected' : '') + '>' + yr + '年</option>'; }).join('');
  const debitNormal = isDebitNormal(node);
  const openingNote = (node.indexOf('fund:') === 0) ? fundBalance(node.split(':')[1], String(y - 1) + '-12-31') : 0;
  let running = openingNote;
  const ledgerQ = getSearch('ledger'); const ledgerSearching = isSearchActive(ledgerQ);
  const rows = state.transactions.filter(function (t) { return t.date && t.date.slice(0, 4) === String(y); })
    .sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); })
    .map(function (t) {
      let debit = 0, credit = 0, hit = false;
      movementsOf(t).forEach(function (m) { if (m.node === node) { hit = true; if (m.side === 'debit') debit += m.amt; else credit += m.amt; } });
      if (!hit) return null;
      running += debitNormal ? (debit - credit) : (credit - debit);
      const other = movementsOf(t).filter(function (m) { return m.node !== node; }).map(function (m) { return nodeLabel(m.node); }).join('/');
      return { date: t.date, other: other, debit: debit, credit: credit, balance: running, memo: t.memo, tx: t };
    }).filter(Boolean)
    // 検索は残高を計算したあとに絞り込む(表示される残高はその時点の正しい残高)
    .filter(function (r) { return !ledgerSearching || txMatches(r.tx, ledgerQ); });
  return (
    '<section class="block"><h2>総勘定元帳' + (ledgerSearching ? '(検索結果 ' + rows.length + ' 件)' : '') + '</h2>' +
      '<div style="display:flex; gap:8px; margin-bottom:14px;"><select class="year-select" id="ledger-year">' + yearOptions + '</select><select class="year-select" id="ledger-node">' + optionsHtml + '</select></div>' +
      searchBarHtml('ledger', '選んだ年・科目の中から探します。残高は絞り込む前の、その時点の残高です') +
      (node.indexOf('fund:') === 0 ? '<div class="note">前年繰越残高: ' + yen(openingNote) + '</div>' : '') +
      '<div class="table-scroll"><table class="ledger"><tr><th>日付</th><th>相手科目</th><th class="num">借方</th><th class="num">貸方</th><th class="num">残高</th></tr>' +
        (rows.length ? rows.map(function (r) { return '<tr><td>' + esc(r.date) + '</td><td class="muted">' + esc(r.other) + (r.memo ? '(' + esc(r.memo) + ')' : '') + '</td><td class="num">' + (r.debit ? yen(r.debit) : '') + '</td><td class="num">' + (r.credit ? yen(r.credit) : '') + '</td><td class="num">' + yen(r.balance) + '</td></tr>'; }).join('') : '<tr><td colspan="5" class="muted" style="padding:20px 6px;">この年の記録はありません</td></tr>') +
      '</table></div>' +
    '</section>'
  );
}

/* ============================== 資産・負債タブ ============================== */
function assetFormHtml(a) {
  a = a || { name: '', acquisitionDate: todayStr(), cost: '', usefulLifeYears: '', disposalDate: '' };
  const sale = isSale(a);
  return (
    '<div class="field"><label>資産名</label><input type="text" id="af-name" value="' + esc(a.name) + '" placeholder="例:ノートパソコン"></div>' +
    '<div class="field-row"><div class="field"><label>取得日</label><input type="date" id="af-date" value="' + esc(a.acquisitionDate) + '"></div>' +
    '<div class="field"><label>取得価額(円)</label><input type="number" id="af-cost" value="' + esc(a.cost) + '"></div></div>' +
    '<div class="field"><label>支払い方法</label>' + fundPickerHtml('af-pay', a.payFund || (a.id ? '' : bankAccounts()[0].id), (a.id && !a.payFund ? [['', '未設定(支払いの仕訳を作らない)']] : []).concat([['accrued', '未払金(あとで払う・分割・カード払い)']])) +
      '<div class="note" style="margin-top:6px;">保存すると、支払いの仕訳(固定資産/支払い方法)を自動で作ります。取得日・取得価額・支払い方法を直すと仕訳も直ります。<br>未払金の場合、実際の支払い(分割払い・カードの引き落としなど)は、そのつど取引の入力で「買掛金・未払金を支払う」(未払金)として記録してください。減価償却は支払日ではなく取得日(使い始めた日)から始まります。</div></div>' +
    '<div class="field-row"><div class="field"><label>耐用年数(年・2〜50)</label><input type="number" id="af-life" min="2" max="50" step="1" value="' + esc(a.usefulLifeYears) + '"></div>' +
    '<div class="field"><label>除却・売却日(任意)</label><input type="date" id="af-disposal" value="' + esc(a.disposalDate || '') + '"></div></div>' +
    '<div class="field"><label>処分の種類</label><div class="radio-group">' +
      '<label><input type="radio" name="af-dtype" value="retire"' + (sale ? '' : ' checked') + '> 除却(廃棄)</label>' +
      '<label><input type="radio" name="af-dtype" value="sale"' + (sale ? ' checked' : '') + '> 売却</label></div></div>' +
    '<div id="af-sale-fields"' + (sale ? '' : ' hidden') + '>' +
      '<div class="field-row"><div class="field"><label>売却代金(円)</label><input type="number" id="af-sale-amount" min="0" step="1" value="' + esc(a.saleAmount || '') + '"></div>' +
      '<div class="field"><label>受け取り先</label>' + fundPickerHtml('af-sale-fund', a.saleFund || bankAccounts()[0].id) + '</div></div>' +
      '<div class="note"><strong>事業用資産の売却益は、原則として譲渡所得となり、本アプリでは計算しません。税理士・税務署に確認してください。</strong><br>売却した年は売却した月まで償却し、残りの帳簿価額は「事業主貸」、売却代金は「事業主借」として記録します。</div>' +
    '</div>' +
    '<div class="note" id="af-retire-note"' + (sale ? ' hidden' : '') + '>除却した年は除却した月まで償却し、残りの帳簿価額を「固定資産除却損」(経費)にします。</div>' +
    '<div class="note">定額法(残存価額1円・月割償却)で自動計算します。耐用年数は国税庁の「耐用年数表」でご確認ください。</div>' +
    '<button type="button" class="btn block" id="af-save">保存する</button>'
  );
}
function openAssetModal(asset) {
  editingAssetId = asset ? asset.id : null;
  openModal(asset ? '固定資産を編集' : '固定資産を登録', assetFormHtml(asset));
  const dtype = function () { const el = document.querySelector('input[name="af-dtype"]:checked'); return el ? el.value : 'retire'; };
  document.querySelectorAll('input[name="af-dtype"]').forEach(function (r) { r.addEventListener('change', function () {
    document.getElementById('af-sale-fields').hidden = dtype() !== 'sale'; document.getElementById('af-retire-note').hidden = dtype() === 'sale';
  }); });
  document.getElementById('af-save').addEventListener('click', async function () {
    const doc = { name: val('af-name'), acquisitionDate: val('af-date'), cost: Number(val('af-cost')) || 0, usefulLifeYears: Number(val('af-life')), disposalDate: val('af-disposal') || null };
    const pay = fundPickerValue('af-pay'); doc.payFund = (pay === 'cash' || pay === 'accrued' || isBankFund(pay)) ? pay : undefined;
    if (doc.disposalDate) {
      doc.disposalType = dtype();
      if (doc.disposalType === 'sale') { doc.saleAmount = Number(val('af-sale-amount')) || 0; const sf = fundPickerValue('af-sale-fund'); doc.saleFund = (sf === 'cash' || isBankFund(sf)) ? sf : bankAccounts()[0].id; }
      else { doc.saleAmount = undefined; doc.saleFund = undefined; }
    } else { doc.disposalType = undefined; doc.saleAmount = undefined; doc.saleFund = undefined; }
    if (!doc.name || !doc.acquisitionDate || doc.cost <= 0) { toast('必須項目を入力してください'); return; }
    if (doc.disposalDate && doc.disposalDate < doc.acquisitionDate) { toast('除却・売却日は取得日より後にしてください', 6000); return; }
    if (doc.disposalType === 'sale' && doc.saleAmount < 0) { toast('売却代金を確認してください'); return; }
    if (!isValidUsefulLife(doc.usefulLifeYears)) { toast('耐用年数は 2〜50 年の整数で入力してください(償却率表にある範囲です)', 6000); document.getElementById('af-life').focus(); return; }
    const saved = editingAssetId ? await Store.updateFixedAsset(editingAssetId, doc) : await Store.addFixedAsset(doc);
    if (saved) { await syncPurchaseTransaction(saved); await syncSaleTransaction(saved); }
    closeModal(); renderShell();
  });
}
// 売却代金は「事業主借(入金)」の取引として自動で作り、固定資産と連動させる(linkedAssetId)
function linkedSaleTx(assetId) { return state.transactions.find(function (t) { return t.linkedAssetId === assetId && t.kind === 'contribution'; }); }
function linkedPurchaseTx(assetId) { return state.transactions.find(function (t) { return t.linkedAssetId === assetId && t.kind === 'asset_purchase'; }); }
function linkedTxs(assetId) { return state.transactions.filter(function (t) { return t.linkedAssetId === assetId; }); }
// 購入代金の支払いは「固定資産の購入」(借方 固定資産 / 貸方 現金・普通預金)の取引として自動で作り、台帳と連動させる
async function syncPurchaseTransaction(asset) {
  const linked = linkedPurchaseTx(asset.id);
  if (!asset.payFund) { if (linked) await Store.deleteTransaction(linked.id); return; }
  const payload = { kind: 'asset_purchase', date: asset.acquisitionDate, amount: Number(asset.cost) || 0, memo: '固定資産の購入(' + asset.name + ')', linkedAssetId: asset.id };
  // 未払金なら貸方は未払金(fund は持たない)、現金・普通預金なら貸方はその資金(liability は持たない)
  if (asset.payFund === 'accrued') { payload.liability = 'accrued'; payload.fund = undefined; } else { payload.fund = asset.payFund; payload.liability = undefined; }
  if (linked) await Store.updateTransaction(linked.id, payload); else { Object.keys(payload).forEach(function (k) { if (payload[k] === undefined) delete payload[k]; }); await Store.addTransaction(payload); }
}
async function syncSaleTransaction(asset) {
  const linked = linkedSaleTx(asset.id);
  if (!(asset.disposalDate && isSale(asset) && asset.saleAmount > 0)) { if (linked) await Store.deleteTransaction(linked.id); return; }
  const payload = { kind: 'contribution', date: asset.disposalDate, amount: asset.saleAmount, fund: asset.saleFund || bankAccounts()[0].id, memo: '固定資産の売却代金(' + asset.name + ')', linkedAssetId: asset.id };
  if (linked) await Store.updateTransaction(linked.id, payload); else await Store.addTransaction(payload);
}
function invYearFormHtml(y, data) {
  data = data || { opening: 0, closing: 0 };
  return (
    '<div class="field"><label>年度</label><input type="number" id="iy-year" value="' + (y || new Date().getFullYear()) + '" ' + (y ? 'readonly' : '') + '></div>' +
    '<div class="field-row"><div class="field"><label>期首棚卸高</label><input type="number" id="iy-open" value="' + data.opening + '"></div>' +
    '<div class="field"><label>期末棚卸高</label><input type="number" id="iy-close" value="' + data.closing + '"></div></div>' +
    '<div class="note">期首棚卸高は、前年の期末棚卸高と一致させるのが基本です。</div>' +
    '<button type="button" class="btn block" id="iy-save">保存する</button>'
  );
}
function openInvYearModal(year) {
  const data = (year != null && state.inventoryYearEnd[year]) ? state.inventoryYearEnd[year] : { opening: 0, closing: 0 };
  openModal(year != null ? year + '年度の棚卸高を編集' : '棚卸資産(年度)を登録', invYearFormHtml(year, data));
  document.getElementById('iy-save').addEventListener('click', async function () {
    const y = Number(val('iy-year')); if (!y) { toast('年度を入力してください'); return; }
    await Store.setInventoryYear(y, { opening: Number(val('iy-open')) || 0, closing: Number(val('iy-close')) || 0 });
    closeModal(); renderShell();
  });
}
function viewAssets() {
  const years = availableYears(); const year = window.__assetsYear || years[0] || new Date().getFullYear();
  const yearOptions = years.map(function (yr) { return '<option value="' + yr + '" ' + (yr === year ? 'selected' : '') + '>' + yr + '年</option>'; }).join('');
  const fa = state.fixedAssets || [];
  const rows = fa.map(function (a) {
    const dep = assetAnnualDepreciation(a, year); const bv = isDisposedBy(a, todayStr()) ? 0 : assetBookValueAsOf(a, todayStr());
    const lifeTag = isValidUsefulLife(Number(a.usefulLifeYears)) ? '' : ' <span class="tag" style="color:var(--danger);border-color:var(--danger);">耐用年数を確認</span>';
    const payTag = lifeTag + (a.payFund ? '' : ' <span class="tag" style="color:var(--danger);border-color:var(--danger);">支払い方法を設定してください</span>');
    const status = payTag + (a.disposalDate ? ' <span class="tag">' + (isSale(a) ? '売却' : '除却') + ' ' + esc(a.disposalDate) + '</span>' : '');
    return '<tr><td>' + esc(a.name) + status + '</td><td>' + esc(a.acquisitionDate) + '</td><td class="num">' + yen(a.cost) + '</td><td class="num">' + esc(a.usefulLifeYears) + '年</td><td class="num">' + yen(dep) + '</td><td class="num">' + yen(bv) + '</td><td><a data-edit-asset=\"' + esc(a.id) + '\">編集</a> <a data-del-asset=\"' + esc(a.id) + '\" style="color:var(--danger);">削除</a></td></tr>';
  }).join('');
  const inv = state.inventoryYearEnd || {}; const invYears = Object.keys(inv).map(Number).sort(function (a, b) { return b - a; });
  const invRows = invYears.map(function (y) { return '<tr><td>' + y + '年</td><td class="num">' + yen(inv[y].opening) + '</td><td class="num">' + yen(inv[y].closing) + '</td><td><a data-edit-inv-year="' + y + '">編集</a></td></tr>'; }).join('');
  const liab = { payable: liabilityBalance('payable', todayStr()), accrued: liabilityBalance('accrued', todayStr()), loan: liabilityBalance('loan', todayStr()) };
  return (
    '<section class="block"><h2>固定資産台帳</h2>' + assetPaymentNotice() +
      '<div style="margin-bottom:10px;"><select class="year-select" id="assets-year">' + yearOptions + '</select><span class="muted" style="margin-left:8px;font-size:12px;">の減価償却費を表示</span></div>' +
      '<div class="table-scroll"><table class="ledger compact"><tr><th>資産名</th><th>取得日</th><th class="num">取得価額</th><th class="num">耐用年数</th><th class="num">' + year + '年償却費</th><th class="num">現在の帳簿価額</th><th></th></tr>' +
        (rows || '<tr><td colspan="7" class="muted" style="padding:16px 6px;">まだ登録されていません</td></tr>') +
      '</table></div>' +
      '<button class="btn secondary" id="new-asset" style="margin-top:12px;">+ 固定資産を登録</button>' +
    '</section>' +
    '<section class="block"><h2>棚卸資産(年度末の在庫金額)</h2>' +
      '<div class="table-scroll"><table class="ledger compact"><tr><th>年度</th><th class="num">期首棚卸高</th><th class="num">期末棚卸高</th><th></th></tr>' +
        (invRows || '<tr><td colspan="4" class="muted" style="padding:16px 6px;">まだ登録されていません</td></tr>') +
      '</table></div>' +
      '<button class="btn secondary" id="new-inv-year" style="margin-top:12px;">+ 年度を登録・編集</button>' +
    '</section>' +
    '<section class="block"><h2>負債残高(本日時点)</h2>' +
      '<div class="table-scroll"><table class="ledger"><tr><th>科目</th><th class="num">残高</th></tr>' +
        '<tr><td>買掛金</td><td class="num">' + yen(liab.payable) + '</td></tr><tr><td>未払金 <a data-goto-ledger="liability:accrued" style="font-size:12px;margin-left:6px;">内訳を見る</a></td><td class="num">' + yen(liab.accrued) + '</td></tr><tr><td>借入金</td><td class="num">' + yen(liab.loan) + '</td></tr>' +
        '<tr><td><strong>負債合計</strong></td><td class="num"><strong>' + yen(liab.payable + liab.accrued + liab.loan) + '</strong></td></tr>' +
      '</table></div>' +
      '<div class="note">負債の発生・返済・支払いの記録は「入力」タブの区分から行います。</div>' +
    '</section>'
  );
}

/* ============================== 損益計算書タブ ============================== */
function viewPL() {
  const years = availableYears(); const y = window.__plYear || years[0] || new Date().getFullYear();
  const pl = computePL(y);
  const yearOptions = years.map(function (yr) { return '<option value="' + yr + '" ' + (yr === y ? 'selected' : '') + '>' + yr + '年</option>'; }).join('');
  return (
    '<section class="block"><h2>損益計算書</h2>' + (assetsWithInvalidLife().length ? '<div class="note" style="color:var(--danger);">範囲外の耐用年数を含むため、減価償却費は暫定値です。</div>' : '') +
      '<div style="margin-bottom:14px;"><select class="year-select" id="pl-year">' + yearOptions + '</select></div>' +
      '<div class="kpi-row">' +
        '<div class="kpi"><div class="lbl">収入合計</div><div class="val num">' + money(pl.incomeSum) + '</div></div>' +
        '<div class="kpi"><div class="lbl">売上総利益</div><div class="val num">' + money(pl.grossProfit) + '</div></div>' +
        '<div class="kpi"><div class="lbl accent">差引金額(所得)</div><div class="val num accent">' + money(pl.net) + '</div></div>' +
      '</div>' +
      '<div class="table-scroll"><table class="ledger"><tr><th>収入の部</th><th class="num">金額</th></tr>' +
        ACCOUNTS.income.map(function (a) { return '<tr><td>' + a.label + '</td><td class="num">' + money(pl.incomeTotals[a.key]) + '</td></tr>'; }).join('') +
        '<tr><td><strong>収入合計</strong></td><td class="num"><strong>' + money(pl.incomeSum) + '</strong></td></tr>' +
      '</table></div>' +
      '<div class="table-scroll" style="margin-top:16px;"><table class="ledger"><tr><th>売上原価</th><th class="num">金額</th></tr>' +
        '<tr><td>期首棚卸高</td><td class="num">' + money(pl.inventoryOpening) + '</td></tr>' +
        '<tr><td>仕入高</td><td class="num">' + money(pl.purchases) + '</td></tr>' +
        '<tr><td>期末棚卸高</td><td class="num">' + money(pl.inventoryClosing) + '</td></tr>' +
        '<tr><td><strong>売上原価</strong></td><td class="num"><strong>' + money(pl.cogs) + '</strong></td></tr>' +
        '<tr><td><strong>差引金額(売上総利益)</strong></td><td class="num"><strong>' + money(pl.grossProfit) + '</strong></td></tr>' +
      '</table></div>' +
      '<div class="table-scroll" style="margin-top:16px;"><table class="ledger"><tr><th>経費の部</th><th class="num">金額</th></tr>' +
        ACCOUNTS.expense.map(function (a) { return '<tr><td>' + a.label + (a.auto ? ' <span class="tag">自動計算</span>' : '') + '</td><td class="num">' + money(pl.expenseTotals[a.key]) + '</td></tr>'; }).join('') +
        '<tr><td><strong>経費合計</strong></td><td class="num"><strong>' + money(pl.expenseSum) + '</strong></td></tr>' +
        '<tr><td class="accent"><strong>差引金額(所得金額)</strong></td><td class="num accent"><strong>' + money(pl.net) + '</strong></td></tr>' +
      '</table></div>' +
      '<div class="note">この所得金額は青色申告特別控除(最大65万円)を適用する前の金額です。控除は確定申告書の作成時に適用してください。仕入・棚卸資産・固定資産の減価償却は自動計算されますが、実際の申告前に内容をご確認ください。</div>' +
      '<button class="btn secondary" id="pl-export" style="margin-top:10px;">この年をCSVで書き出す(確定申告用)</button>' +
    '</section>'
  );
}

/* ============================== 貸借対照表タブ ============================== */
function viewBS() {
  const asOf = window.__bsDate || todayStr();
  const bs = computeBS(asOf);
  return (
    '<section class="block"><h2>貸借対照表(簡易)</h2>' + assetPaymentNotice() + (assetsWithInvalidLife().length ? '<div class="note" style="color:var(--danger);">範囲外の耐用年数を含むため、固定資産の帳簿価額は暫定値です。</div>' : '') +
      '<div class="field" style="max-width:220px;"><label>基準日</label><input type="date" id="bs-date" value="' + esc(asOf) + '"></div>' +
      '<div class="table-scroll"><table class="ledger"><tr><th>資産の部</th><th class="num">金額</th></tr>' +
        '<tr><td>現金</td><td class="num">' + money(bs.cash) + '</td></tr>' +
        '<tr><td>普通預金</td><td class="num">' + money(bs.bank) + '</td></tr>' +
        (bs.bankBreakdown.length > 1 ? bs.bankBreakdown.map(function (b) { return '<tr><td style="padding-left:18px;" class="muted">' + esc(b.name) + '</td><td class="num muted">' + money(b.balance) + '</td></tr>'; }).join('') : '') +
        '<tr><td>棚卸資産</td><td class="num">' + money(bs.inventoryVal) + '</td></tr>' +
        '<tr><td>固定資産(帳簿価額)</td><td class="num">' + money(bs.fixedAssetsVal) + '</td></tr>' +
        '<tr><td><strong>資産合計</strong></td><td class="num"><strong>' + money(bs.assetsTotal) + '</strong></td></tr>' +
      '</table></div>' +
      '<div class="table-scroll" style="margin-top:16px;"><table class="ledger"><tr><th>負債の部</th><th class="num">金額</th></tr>' +
        '<tr><td>買掛金</td><td class="num">' + money(bs.payable) + '</td></tr>' +
        '<tr><td>未払金</td><td class="num">' + money(bs.accrued) + '</td></tr>' +
        '<tr><td>借入金</td><td class="num">' + money(bs.loan) + '</td></tr>' +
        '<tr><td><strong>負債合計</strong></td><td class="num"><strong>' + money(bs.liabilitiesTotal) + '</strong></td></tr>' +
      '</table></div>' +
      '<div class="table-scroll" style="margin-top:16px;"><table class="ledger"><tr><th>資本の部</th><th class="num">金額</th></tr>' +
        '<tr><td>元入金(開始時点)</td><td class="num">' + money(bs.openingCapital) + '</td></tr>' +
        '<tr><td>事業主借(累計)</td><td class="num">' + money(bs.contribution) + '</td></tr>' +
        '<tr><td>事業主貸(累計)</td><td class="num">' + money(-bs.drawing) + '</td></tr>' +
        '<tr><td>所得金額(累計・逆算)</td><td class="num">' + money(bs.retainedEarnings) + '</td></tr>' +
        '<tr><td class="accent"><strong>資本合計</strong></td><td class="num accent"><strong>' + money(bs.equityTotalVal) + '</strong></td></tr>' +
      '</table></div>' +
      '<div class="note">資産合計と「負債合計+資本合計」は常に一致するように計算しています。棚卸資産は直近に登録した年度末の金額を表示しています(日々の在庫変動は反映されません)。実際の申告前には内容を必ずご確認ください。</div>' +
    '</section>'
  );
}

/* ============================== 請求書タブ ============================== */
function viewInvoiceList() {
  if (invoiceDraft) return viewInvoiceForm();
  const q = getSearch('invoice'); const searching = isSearchActive(q);
  const all = state.invoices.slice().sort(function (a, b) { return (b.issueDate || '') < (a.issueDate || '') ? -1 : 1; });
  const list = searching ? all.filter(function (inv) { return invoiceMatches(inv, q); }) : all;
  return (
    '<section class="block"><h2>請求書' + (searching ? '(検索結果 ' + list.length + ' 件)' : '') + '</h2><button class="btn block" id="new-invoice" style="margin-bottom:12px;">新しい請求書を作成</button>' +
      (all.length ? searchBarHtml('invoice', '日付は発行日で探します。取引年月日(「9月分」など)は文字で探せます') : '') +
      (list.length ? list.map(invoiceRowHtml).join('') : '<div class="muted" style="padding:16px 0;">' + (searching ? '条件に合う請求書はありません' : 'まだ請求書がありません') + '</div>') +
      '<div class="note">入金があったら、忘れずに「入力」タブから収入として記録してください(請求書の作成だけでは帳簿に反映されません)。</div>' +
    '</section>'
  );
}
// 請求書の合計。税率ごとに対価の合計と消費税額を出す(端数処理は1請求書・1税率につき1回)。
// 端数処理は請求書ごとに作成時の設定を保存した taxRounding を使う(あとで設定を変えても発行済みの金額は変わらない)。
// taxRounding のない請求書は、以前の計算(四捨五入)のまま
function itemRate(inv, it) { const r = Number(it.taxRate !== undefined ? it.taxRate : inv.taxRate); return [10, 8, 0].indexOf(r) >= 0 ? r : 10; }
function invoiceTotals(inv) {
  const groups = {};
  (inv.items || []).forEach(function (it) { const r = itemRate(inv, it); groups[r] = (groups[r] || 0) + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0); });
  const byRate = Object.keys(groups).map(Number).sort(function (a, b) { return b - a; }).map(function (r) {
    const sub = Math.round(groups[r]); return { rate: r, subtotal: sub, tax: roundBy(inv.taxRounding || 'round', sub * r / 100) };
  });
  const subtotal = byRate.reduce(function (x, g) { return x + g.subtotal; }, 0), tax = byRate.reduce(function (x, g) { return x + g.tax; }, 0);
  return { byRate: byRate, subtotal: subtotal, tax: tax, total: subtotal + tax };
}
function rateLabel(r) { return r === 8 ? '8%(軽減)' : r + '%'; }
// 適格請求書の記載事項で足りないもの(登録番号・宛先・取引年月日・明細)
function invoiceMissing(inv) {
  const m = [];
  if (!(state.settings.businessName || state.settings.ownerName)) m.push('発行者の名前(設定の屋号・氏名)');
  if (!state.settings.invoiceRegNo) m.push('登録番号(設定)');
  if (!inv.clientName) m.push('宛先');
  if (!inv.transactionDate) m.push('取引年月日');
  if (!(inv.items || []).some(function (it) { return it.name; })) m.push('取引の内容');
  return m;
}
const INVOICE_STATUSES = ['下書き', '送付済み(未入金)', '入金済み'];
const HONORIFICS = ['御中', '様'];
let sendPromptFor = null; // 印刷したあと「送付済みにしましょう」と案内する請求書
// 送付済みの請求書の印刷: そのまま(再発行)か、控え(「控」の印)かを選ぶ
async function choosePrint(inv) {
  if (!isIssuedInvoice(inv)) { printInvoice(inv); return; }
  openModal('印刷のしかた', '<p style="line-height:1.7;margin-bottom:14px;">送付済みの請求書です。送ったときの内容で印刷します。</p>' +
    '<div style="display:flex;gap:10px;justify-content:flex-end;"><button class="btn secondary" id="pr-copy">控え(「控」の印付き)</button><button class="btn" id="pr-reissue">そのまま(再発行)</button></div>');
  document.getElementById('pr-copy').addEventListener('click', function () { closeModal(); printInvoice(inv, { copy: true }); });
  document.getElementById('pr-reissue').addEventListener('click', function () { closeModal(); printInvoice(inv); });
}
// 送付済みにする: 内容(宛先・自社の情報・振込先・明細・税率・端数処理・金額)を請求書の中に保存して固定する
async function markInvoiceSent(id) {
  const inv = findById(state.invoices, id); if (!inv || isIssuedInvoice(inv)) return;
  const missing = invoiceMissing(inv);
  const msg = (missing.length ? '適格請求書(インボイス)の記載事項が足りません: ' + missing.join('・') + '。\n' : '') +
    '送付済みにすると内容が固定され、直接は直せません(直すときは「修正版を作る」で新しい番号の請求書を作ります)。送付済みにしますか?';
  if (!(await confirmDialog(msg, '送付済みにする'))) return;
  await Store.updateInvoice(id, { status: '送付済み(未入金)', issued: { at: new Date().toISOString(), view: invoiceViewModel(inv, state.settings) } });
  sendPromptFor = null; renderView();
  openModal('送付済みにしました', '<p style="line-height:1.7;">送った請求書の控え(PDF)は、この請求書に添付しておきましたか?<br>電子取引データとして保存が必要です(原則7年)。まだのときは、印刷の画面の「PDF」→「PDFとして保存」で保存し、請求書の「添付ファイル」に加えてください。</p><div style="text-align:right;margin-top:12px;"><button class="btn" id="sent-ok">わかりました</button></div>');
  document.getElementById('sent-ok').addEventListener('click', closeModal);
}
// 修正版を作る: 送付済みの請求書を写した下書きを、次の番号で作る(元の請求書はそのまま残す)
function makeRevision(id) {
  const inv = findById(state.invoices, id); if (!inv) return;
  state.settings.invoiceSeq = (state.settings.invoiceSeq || 0) + 1;
  const src = JSON.parse(JSON.stringify(inv));
  invoiceDraft = Object.assign(src, { number: todayStr().slice(0, 4) + '-' + String(state.settings.invoiceSeq).padStart(3, '0'), issueDate: todayStr(), status: '下書き', revisionOf: inv.number, attachments: [] });
  delete invoiceDraft.id; delete invoiceDraft.issued; delete invoiceDraft.createdAt;
  editingInvoiceId = null; renderView(); toast('修正版の下書きを作りました(請求書番号 ' + inv.number + ' の修正)', 5000);
}
function isUnpaidInvoice(inv) { return inv.status === '送付済み(未入金)'; }
// 下書きの請求書だけ、取引先の名前の変更・統合に合わせて宛先名を変える(送付済み・入金済みの宛先は発行したときのまま)
function isDraftInvoice(inv) { return !inv.status || inv.status === '下書き'; }
function invoiceRowHtml(inv) {
  const t = invoiceTotals(inv);
  return (
    '<div class="invoice-list-row"><div class="tx-top"><span class="tx-cat">' + esc(inv.clientName || '(宛先未設定)') + '</span><span class="tx-amt num">' + yen(t.total) + '</span></div>' +
      '<div class="tx-meta">No.' + esc(inv.number) + ' ・ ' + esc(inv.issueDate) + ' ・ <span class="tag">' + esc(inv.status || '下書き') + '</span>' +
        (inv.revisionOf ? ' <span class="tag">' + esc(inv.revisionOf) + ' の修正</span>' : '') + (inv.issued && inv.issued.migrated ? ' <span class="tag">移行時の内容で固定</span>' : '') + '</div>' +
      (sendPromptFor === inv.id && !isIssuedInvoice(inv) ? '<div class="storage-flag"><span class="storage-dot warn"></span>印刷したら送付済みにしましょう <a data-send-inv="' + esc(inv.id) + '" style="cursor:pointer;margin-left:8px;">送付済みにする</a> <a data-send-later style="cursor:pointer;margin-left:8px;">あとで</a></div>' : '') +
      '<div class="tx-actions">' + (isIssuedInvoice(inv)
        ? '<a data-print-inv=\"' + esc(inv.id) + '\">印刷</a>' + (inv.status === '入金済み' ? '<a data-unpaid-inv="' + esc(inv.id) + '">未入金に戻す</a>' : '<a data-paid-inv="' + esc(inv.id) + '">入金済みにする</a>') + '<a data-revise-inv="' + esc(inv.id) + '">修正版を作る</a><a data-attach-inv="' + esc(inv.id) + '">添付</a>'
        : '<a data-edit-inv=\"' + esc(inv.id) + '\">編集</a><a data-print-inv=\"' + esc(inv.id) + '\">印刷</a><a data-send-inv="' + esc(inv.id) + '">送付済みにする</a>') +
        '<a data-del-inv=\"' + esc(inv.id) + '\" style="color:var(--danger);">削除</a></div></div>'
  );
}
function viewInvoiceForm() {
  const d = invoiceDraft; const t = invoiceTotals(d);
  return (
    '<section class="block"><h2>' + (editingInvoiceId ? '請求書を編集' : '新しい請求書') + '</h2>' +
      '<div class="field-row"><div class="field"><label>請求書番号</label><input type="text" id="inv-number" value="' + esc(d.number) + '"></div>' +
      '<div class="field"><label>発行日</label><input type="date" id="inv-issue" value="' + esc(d.issueDate) + '"></div></div>' +
      '<div class="field-row"><div class="field"><label>宛先(取引先)</label>' + partnerPickerHtml('inv-client', d.partnerId, d.clientName) + '</div>' +
      '<div class="field" style="max-width:110px;"><label>敬称</label><select id="inv-honorific">' + HONORIFICS.map(function (h) { return '<option' + ((d.honorific || '御中') === h ? ' selected' : '') + '>' + h + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field" style="max-width:160px;"><label>宛先の郵便番号(任意)</label><input type="text" id="inv-client-postal" maxlength="10" value="' + esc(d.clientPostalCode || '') + '" placeholder="123-4567"></div>' +
      (d.revisionOf ? '<div class="note">この請求書は、請求書番号 ' + esc(d.revisionOf) + ' の修正版です(印刷にも表示されます)。</div>' : '') +
      '<div class="field"><label>宛先住所(任意)</label><input type="text" id="inv-client-addr" value="' + esc(d.clientAddress) + '"></div>' +
      '<div class="field-row"><div class="field"><label>取引年月日(または期間)</label><input type="text" id="inv-txdate" maxlength="40" value="' + esc(d.transactionDate || '') + '" placeholder="例: 2026年9月30日 / 2026年9月分"></div>' +
      '<div class="field"><label>支払期限</label><input type="date" id="inv-due" value="' + esc(d.dueDate) + '"></div></div>' +
      '<div class="field"><label>項目</label>' +
        '<div class="invoice-item-row" style="font-size:11px; color:var(--ink-muted);"><div>内容</div><div>数量</div><div>単価(税抜)</div><div>税率</div><div></div></div>' +
        '<div id="inv-items"></div><button type="button" class="btn ghost small" id="inv-add-item">+ 項目を追加</button>' +
      '</div>' +
      '<div class="field"><label>備考</label><textarea id="inv-notes">' + esc(d.notes) + '</textarea></div>' +
      '<div class="field"><label>添付ファイル(送った請求書の控え PDF など。任意)</label>' + attachWidgetHtml('inv', d.attachments || []) + '</div>' +
      '<div class="note">消費税の端数処理: ' + esc(DEPRECIATION_ROUNDING[d.taxRounding || 'round']) + '(1枚・1税率につき1回。この請求書を作ったときの設定)</div>' +
      '<div class="kpi-row"><div class="kpi" style="flex:2;"><div class="lbl">税率ごとの合計</div><div class="val" id="inv-byrate" style="font-size:13px;">' + invoiceByRateHtml(t) + '</div></div>' +
      '<div class="kpi"><div class="lbl accent">合計</div><div class="val num accent" id="inv-total">' + money(t.total) + '</div></div></div>' +
      '<div style="display:flex; gap:10px;"><button class="btn block" id="inv-save">保存する</button><button class="btn secondary" id="inv-cancel">キャンセル</button></div>' +
    '</section>'
  );
}
function renderInvoiceItems() {
  const box = document.getElementById('inv-items'); if (!box) return;
  box.innerHTML = invoiceDraft.items.map(function (it, i) {
    return '<div class="invoice-item-row"><input type="text" data-item-field="name" data-item-idx="' + i + '" value="' + esc(it.name) + '" placeholder="作業内容">' +
      '<input type="number" data-item-field="qty" data-item-idx="' + i + '" value="' + it.qty + '" min="0">' +
      '<input type="number" data-item-field="unitPrice" data-item-idx="' + i + '" value="' + esc(it.unitPrice) + '" min="0">' +
      '<select data-item-field="taxRate" data-item-idx="' + i + '">' + [10, 8].map(function (r) { return '<option value="' + r + '"' + (itemRate(invoiceDraft, it) === r ? ' selected' : '') + '>' + rateLabel(r) + '</option>'; }).join('') +
        (itemRate(invoiceDraft, it) === 0 ? '<option value="0" selected>0%(以前の請求書)</option>' : '') + '</select>' +
      '<button type="button" class="rm" data-rm-item="' + i + '">×</button></div>';
  }).join('');
  box.querySelectorAll('input, select').forEach(function (inp) {
    inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', function () { const idx = Number(inp.dataset.itemIdx), field = inp.dataset.itemField; invoiceDraft.items[idx][field] = field === 'name' ? inp.value : Number(inp.value); updateInvoiceTotalsDisplay(); });
  });
  box.querySelectorAll('[data-rm-item]').forEach(function (btn) { btn.addEventListener('click', function () { invoiceDraft.items.splice(Number(btn.dataset.rmItem), 1); renderInvoiceItems(); updateInvoiceTotalsDisplay(); }); });
}
function invoiceByRateHtml(t) {
  if (!t.byRate.length) return '—';
  return t.byRate.map(function (g) { return '<div>' + esc(rateLabel(g.rate)) + '対象 ' + yen(g.subtotal) + '(消費税 ' + yen(g.tax) + ')</div>'; }).join('');
}
function updateInvoiceTotalsDisplay() {
  const t = invoiceTotals(invoiceDraft);
  const br = document.getElementById('inv-byrate'), tot = document.getElementById('inv-total');
  if (br) br.innerHTML = invoiceByRateHtml(t); if (tot) tot.innerHTML = money(t.total);
}

/* ============================== レポートタブ ============================== */
function viewTaxSection(y) {
  const r = computeConsumptionTax(y);
  const head = '<section class="block"><h2>消費税の集計(' + y + '年)</h2>' + taxReviewNotice() +
    '<div class="note" style="color:var(--danger);">申告書作成の参考値です。正確性は保証しません。申告の前に税理士・税務署に確認してください。</div>';
  if (r.status === 'unset' || r.status === 'unsetType') return head + '<p>設定画面の「消費税」で、課税方式' + (r.status === 'unsetType' ? 'に合わせて主たる事業区分' : 'と事業区分') + 'を選んでください。選ぶまでは計算しません。</p></section>';
  if (r.status === 'exempt') return head + '<p>免税事業者に設定されているため、消費税は計算しません。</p></section>';
  if (r.status === 'general') return head + '<p>本則課税は、この版では納付税額を計算しません(経費の税区分は記録できます)。</p></section>';
  const rows = function (label, v) { return '<tr><td>' + label + '</td><td class="num">' + money(v) + '</td></tr>'; };
  const typeRows = r.rates.map(function (x) {
    return Object.keys(x.byType).map(function (t) { return '<tr><td style="padding-left:16px;">' + esc(rateLabel(x.rate)) + ' ' + esc(BUSINESS_TYPES[t] ? BUSINESS_TYPES[t].label : '') + '</td><td class="num">' + yen(x.byType[t].inclusive) + '(税抜 ' + yen(x.byType[t].exclusive) + ')</td></tr>'; }).join('');
  }).join('');
  const interim = (state.taxInterim || {})[y] || {};
  return head + (r.warnings.length ? '<div class="note" style="color:var(--danger);">' + r.warnings.map(esc).join('<br>') + '</div>' : '') +
    '<div class="table-scroll"><table class="ledger">' +
      '<tr><th>課税方式</th><td>' + esc(TAX_METHODS[r.method]) + (r.method === 'simplified' ? '(主たる事業区分: ' + esc(BUSINESS_TYPES[state.settings.mainBusinessType].label) + ')' : '') + '</td></tr>' +
      '<tr><th colspan="2">課税売上(税込)の内訳</th></tr>' + (typeRows || '<tr><td colspan="2" class="muted">この年の課税売上はありません</td></tr>') +
      r.rates.map(function (x) { return rows(esc(rateLabel(x.rate)) + ' 課税標準額(千円未満切捨て)', x.base) + rows(esc(rateLabel(x.rate)) + ' 消費税額(' + (x.rate === 8 ? '6.24' : '7.8') + '%)', x.tax); }).join('') +
      rows('課税標準額(合計)', r.base) + rows('消費税額(合計)', r.tax) +
      rows('控除対象仕入税額(' + esc(r.how) + ')', r.deduction) +
      rows('差引税額(百円未満切捨て)', r.net) + rows('地方消費税(差引税額 × 22/78、百円未満切捨て)', r.local) +
      rows('中間納付(国税)', -r.interimNational) + rows('中間納付(地方)', -r.interimLocal) +
      '<tr><td class="accent"><strong>納付税額の合計(国税 ' + yen(r.payNational) + ' + 地方 ' + yen(r.payLocal) + ')</strong></td><td class="num accent"><strong>' + money(r.payTotal) + '</strong></td></tr>' +
    '</table></div>' +
    (r.candidates && r.candidates.length > 1 ? '<div class="note">比べた計算方法: ' + r.candidates.map(function (c) { return esc(c.label) + ' ' + yen(c.total); }).join(' / ') + '(控除額が最も大きい方法を使っています)</div>' : '') +
    '<div class="field-row" style="margin-top:10px;"><div class="field"><label>中間納付税額(国税)</label><input type="number" id="ti-national" min="0" step="1" value="' + esc(interim.national || '') + '"></div>' +
    '<div class="field"><label>中間納付譲渡割額(地方)</label><input type="number" id="ti-local" min="0" step="1" value="' + esc(interim.local || '') + '"></div></div>' +
    '<button class="btn secondary small" id="save-interim" data-year="' + y + '">中間納付を保存</button>' +
  '</section>';
}
// 取引先ごとの集計(年ごと): 売上・経費・仕入、未払金・買掛金の残高(年末時点)、未入金の請求書
function partnerSummary(year) {
  const end = year + '-12-31'; const rows = {};
  const row = function (id) { return rows[id] = rows[id] || { id: id, sales: 0, costs: 0, payable: 0, unpaid: 0, count: 0 }; };
  state.transactions.forEach(function (t) {
    const id = t.partnerId || '-'; const amt = Number(t.amount) || 0;
    if (t.date && t.date.slice(0, 4) === String(year)) {
      if (t.kind === 'income') { row(id).sales += amt; row(id).count++; }
      else if (t.kind === 'expense' || t.kind === 'purchase' || t.kind === 'expense_accrued') { row(id).costs += amt; row(id).count++; }
    }
    if (t.date && t.date <= end) {
      if (t.kind === 'expense_accrued') row(id).payable += amt; else if (t.kind === 'pay_liability') row(id).payable -= amt;
    }
  });
  state.invoices.forEach(function (inv) { if (isUnpaidInvoice(inv)) row(inv.partnerId || '-').unpaid += invoiceTotals(inv).total; });
  return Object.keys(rows).map(function (k) { return rows[k]; }).filter(function (r) { return r.count || r.payable || r.unpaid; })
    .sort(function (a, b) { return a.id === '-' ? 1 : b.id === '-' ? -1 : (b.sales + b.costs) - (a.sales + a.costs); });
}
function viewPartners() {
  const years = availableYears(); const y = window.__partnerYear || years[0] || new Date().getFullYear();
  const yearOptions = years.map(function (yr) { return '<option value="' + yr + '" ' + (yr === y ? 'selected' : '') + '>' + yr + '年</option>'; }).join('');
  const rows = partnerSummary(y);
  const sel = window.__partnerSel;
  const detail = sel ? state.transactions.filter(function (t) { return (sel === '-' ? !t.partnerId : t.partnerId === sel); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 300) : null;
  const list = (state.partners || []).slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  return '<section class="block"><h2>取引先ごとの集計</h2>' +
    '<div style="margin-bottom:12px;"><select class="year-select" id="partner-year">' + yearOptions + '</select><span class="muted" style="margin-left:8px;font-size:12px;">未払金・買掛金は年末時点の残高、未入金の請求書は「送付済み(未入金)」の合計</span></div>' +
    '<div class="table-scroll"><table class="ledger compact"><tr><th>取引先</th><th class="num">売上</th><th class="num">経費・仕入</th><th class="num">未払金・買掛金</th><th class="num">未入金の請求書</th></tr>' +
    (rows.length ? rows.map(function (r) {
      return '<tr><td><a data-partner-sel="' + esc(r.id) + '" style="cursor:pointer;">' + esc(r.id === '-' ? '(未設定)' : partnerName(r.id)) + '</a> <a data-partner-invoices="' + esc(r.id) + '" style="cursor:pointer;font-size:11px;margin-left:6px;">請求書</a></td><td class="num">' + money(r.sales) + '</td><td class="num">' + money(r.costs) + '</td><td class="num">' + money(r.payable) + '</td><td class="num">' + money(r.unpaid) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="muted" style="padding:16px 6px;">この年の取引はありません</td></tr>') +
    '</table></div></section>' +
    (detail ? '<section class="block"><h2>' + esc(sel === '-' ? '取引先が未設定の取引' : partnerName(sel) + 'の取引') + '(新しい順・' + detail.length + ' 件)</h2><a data-partner-sel="" style="cursor:pointer;font-size:12px;">閉じる</a>' +
      (detail.length ? detail.map(txRowHtml).join('') : '<div class="muted" style="padding:12px 0;">取引はありません</div>') + '</section>' : '') +
    '<section class="block"><h2>取引先の一覧(' + list.length + ')</h2><div class="note">名前を変えると、その取引先を使っている取引と下書きの請求書の表示が変わります(送付済み・入金済みの請求書の宛先は、発行したときのまま変わりません)。同じ相手が2つあるときは「統合」で1つにまとめられます。使われていない取引先だけ削除できます。</div>' +
    (list.length ? list.map(function (p) {
      const u = partnerUsage(p.id);
      return '<div class="tx-row" style="align-items:center;"><div style="flex:1;"><strong>' + esc(p.name) + '</strong><div class="muted" style="font-size:12px;">' + esc(p.address || '') + ' 取引 ' + u.transactions + ' 件・請求書 ' + u.invoices + ' 件</div></div>' +
        '<a data-partner-edit="' + esc(p.id) + '" style="cursor:pointer;font-size:12px;margin-right:10px;">編集</a>' +
        '<a data-partner-merge="' + esc(p.id) + '" style="cursor:pointer;font-size:12px;margin-right:10px;">統合</a>' +
        (u.transactions || u.invoices ? '' : '<a data-partner-del="' + esc(p.id) + '" style="cursor:pointer;font-size:12px;color:var(--danger);">削除</a>') + '</div>';
    }).join('') : '<div class="muted" style="padding:12px 0;">取引の入力や請求書の宛先で取引先を入れると、ここに表示されます。</div>') +
  '</section>';
}
function bindPartnerEvents() {
  const py = document.getElementById('partner-year'); if (py) py.addEventListener('change', function () { window.__partnerYear = Number(py.value); renderView(); });
  // その取引先の請求書の一覧(請求書タブを取引先で絞り込んだ状態で開く)
  document.querySelectorAll('[data-partner-invoices]').forEach(function (a) { a.addEventListener('click', function () {
    Object.keys(searchState).forEach(function (k) { delete searchState[k]; });
    searchState.invoice = Object.assign(emptySearch(), { partnerId: a.dataset.partnerInvoices });
    invoiceDraft = null; currentTab = 'invoice'; renderShell(); window.scrollTo(0, 0);
  }); });
  document.querySelectorAll('[data-partner-sel]').forEach(function (a) { a.addEventListener('click', function () { window.__partnerSel = a.dataset.partnerSel || null; renderView(); }); });
  document.querySelectorAll('[data-partner-edit]').forEach(function (a) { a.addEventListener('click', function () {
    const p = findById(state.partners, a.dataset.partnerEdit); if (!p) return;
    openModal('取引先を編集', '<div class="field"><label>名前</label><input type="text" id="pt-name" maxlength="100" value="' + esc(p.name) + '"></div>' +
      '<div class="field-row"><div class="field" style="max-width:140px;"><label>郵便番号(任意)</label><input type="text" id="pt-postal" maxlength="10" value="' + esc(p.postalCode || '') + '"></div>' +
      '<div class="field"><label>住所(任意・請求書の宛先住所に使う)</label><input type="text" id="pt-addr" maxlength="200" value="' + esc(p.address || '') + '"></div></div>' +
      '<button class="btn block" id="pt-save">保存する</button>');
    document.getElementById('pt-save').addEventListener('click', async function () {
      const name = normName(val('pt-name')).slice(0, 100); if (!name) { toast('名前を入力してください'); return; }
      const other = findPartnerByName(name); if (other && other.id !== p.id) { toast('同じ名前の取引先があります。「統合」を使ってください', 6000); return; }
      // 請求書の宛先名もそろえてから保存する(取引先の変更と同じ保存で書き込まれる)
      state.invoices = state.invoices.map(function (inv) { return inv.partnerId === p.id && isDraftInvoice(inv) ? Object.assign({}, inv, { clientName: name }) : inv; });
      await Store.updatePartner(p.id, { name: name, address: val('pt-addr').slice(0, 200) || undefined, postalCode: val('pt-postal').slice(0, 10) || undefined });
      closeModal(); renderView();
    });
  }); });
  document.querySelectorAll('[data-partner-merge]').forEach(function (a) { a.addEventListener('click', function () {
    const p = findById(state.partners, a.dataset.partnerMerge); if (!p) return;
    const others = state.partners.filter(function (x) { return x.id !== p.id; });
    if (!others.length) { toast('統合先の取引先がありません'); return; }
    openModal('「' + p.name + '」を統合', '<div class="note">「' + esc(p.name) + '」の取引・請求書をすべて、選んだ取引先に付け替えて、「' + esc(p.name) + '」を一覧から消します。</div>' +
      '<div class="field"><label>統合先</label><select id="pt-into">' + others.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join('') + '</select></div>' +
      '<button class="btn block" id="pt-merge">統合する</button>');
    document.getElementById('pt-merge').addEventListener('click', async function () { const into = val('pt-into'); closeModal(); await Store.mergePartner(p.id, into); renderView(); });
  }); });
  document.querySelectorAll('[data-partner-del]').forEach(function (a) { a.addEventListener('click', async function () {
    if (!(await confirmDialog('この取引先を削除しますか?', '削除する'))) return; await Store.deletePartner(a.dataset.partnerDel); renderView();
  }); });
}
function viewReport() {
  const years = availableYears(); const y = window.__reportYear || years[0] || new Date().getFullYear();
  const yearOptions = years.map(function (yr) { return '<option value="' + yr + '" ' + (yr === y ? 'selected' : '') + '>' + yr + '年</option>'; }).join('');
  const monthly = [];
  for (let mo = 1; mo <= 12; mo++) {
    let inc = 0, exp = 0;
    state.transactions.forEach(function (t) {
      if (t.date && t.date.slice(0, 4) === String(y) && Number(t.date.slice(5, 7)) === mo) {
        if (t.kind === 'income') inc += Number(t.amount) || 0;
        if (t.kind === 'expense' || t.kind === 'purchase') exp += Number(t.amount) || 0;
      }
    });
    monthly.push({ mo: mo, inc: inc, exp: exp });
  }
  const pl = computePL(y);
  const catData = ACCOUNTS.expense.map(function (a) { return { label: a.label, val: pl.expenseTotals[a.key] || 0 }; }).filter(function (d) { return d.val > 0; }).sort(function (a, b) { return b.val - a.val; });
  return (
    viewTaxSection(y) +
    '<section class="block"><h2>月次レポート</h2><div style="margin-bottom:14px;"><select class="year-select" id="report-year">' + yearOptions + '</select></div>' + monthlyBarChart(monthly) + '</section>' +
    '<section class="block"><h2>経費の内訳(' + y + '年)</h2>' + (catData.length ? categoryBarChart(catData) : '<div class="muted" style="padding:16px 0;">この年の経費記録はありません</div>') + '</section>'
  );
}
function monthlyBarChart(monthly) {
  const w = 320, h = 160, padL = 4, padB = 18, barGroupW = (w - padL) / 12;
  const maxVal = Math.max(1, Math.max.apply(null, monthly.map(function (m) { return Math.max(m.inc, m.exp); })));
  const scale = (h - padB - 14) / maxVal; let bars = '';
  monthly.forEach(function (m, i) {
    const x = padL + i * barGroupW; const incH = m.inc * scale, expH = m.exp * scale;
    bars += '<rect x="' + (x + 2) + '" y="' + (h - padB - incH) + '" width="' + (barGroupW / 2 - 3) + '" height="' + incH + '" fill="var(--indigo)"></rect>';
    bars += '<rect x="' + (x + barGroupW / 2 + 1) + '" y="' + (h - padB - expH) + '" width="' + (barGroupW / 2 - 3) + '" height="' + expH + '" fill="var(--vermillion)"></rect>';
    bars += '<text x="' + (x + barGroupW / 2) + '" y="' + (h - 4) + '" text-anchor="middle" class="bar-label">' + m.mo + '</text>';
  });
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="bar-chart" style="width:100%; height:auto;">' + bars + '</svg>' +
    '<div style="display:flex; gap:16px; font-size:12px; margin-top:6px;"><span><span style="display:inline-block;width:10px;height:10px;background:var(--indigo);border-radius:2px;margin-right:5px;"></span>収入</span><span><span style="display:inline-block;width:10px;height:10px;background:var(--vermillion);border-radius:2px;margin-right:5px;"></span>経費</span></div>';
}
function categoryBarChart(data) {
  const w = 320, rowH = 26, h = data.length * rowH + 6;
  const maxVal = Math.max.apply(null, data.map(function (d) { return d.val; }));
  const labelW = 92, barMaxW = w - labelW - 58; let rows = '';
  data.forEach(function (d, i) {
    const y = i * rowH + 4; const bw = maxVal ? (d.val / maxVal) * barMaxW : 0;
    rows += '<text x="0" y="' + (y + 14) + '" class="bar-label">' + esc(d.label) + '</text>';
    rows += '<rect x="' + labelW + '" y="' + y + '" width="' + Math.max(2, bw) + '" height="16" fill="var(--vermillion)" opacity="0.75"></rect>';
    rows += '<text x="' + (labelW + bw + 6) + '" y="' + (y + 13) + '" class="bar-value">' + yen(d.val) + '</text>';
  });
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%; height:auto;">' + rows + '</svg>';
}

/* ============================== 設定タブ ============================== */
function viewSettings() {
  const s = state.settings;
  return (
    '<section class="block"><h2>事業者情報</h2>' +
      '<div class="field"><label>屋号・事業者名</label><input type="text" id="s-businessName" value="' + esc(s.businessName) + '"></div>' +
      '<div class="field"><label>氏名</label><input type="text" id="s-ownerName" value="' + esc(s.ownerName) + '"></div>' +
      '<div class="field-row"><div class="field" style="max-width:140px;"><label>郵便番号(任意)</label><input type="text" id="s-postalCode" maxlength="10" value="' + esc(s.postalCode) + '" placeholder="123-4567"></div>' +
      '<div class="field"><label>住所</label><input type="text" id="s-address" value="' + esc(s.address) + '"></div></div>' +
      '<div class="field-row"><div class="field"><label>電話番号</label><input type="text" id="s-phone" value="' + esc(s.phone) + '"></div>' +
      '<div class="field"><label>FAX(任意)</label><input type="text" id="s-fax" value="' + esc(s.fax) + '"></div></div>' +
      '<div class="field"><label>インボイス登録番号(任意)</label><input type="text" id="s-invoiceRegNo" value="' + esc(s.invoiceRegNo) + '"></div>' +
      '<div class="field"><label>振込先(請求書に表示)</label>' +
        '<div class="field-row"><div class="field"><input type="text" id="s-bankName" value="' + esc(s.bankName) + '" placeholder="銀行名(例: ○○銀行)"></div><div class="field"><input type="text" id="s-bankBranch" value="' + esc(s.bankBranch) + '" placeholder="支店名(例: ○○支店)"></div></div>' +
        '<div class="field-row"><div class="field" style="max-width:110px;"><select id="s-bankAccountType">' + ['', '普通', '当座'].map(function (t) { return '<option value="' + t + '"' + ((s.bankAccountType || '') === t ? ' selected' : '') + '>' + (t || '種別') + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><input type="text" id="s-bankAccountNumber" value="' + esc(s.bankAccountNumber) + '" placeholder="口座番号"></div><div class="field"><input type="text" id="s-bankAccountHolder" value="' + esc(s.bankAccountHolder) + '" placeholder="口座名義(カナ)"></div></div>' +
        (s.bankInfo ? '<div class="note">以前の振込先(まとめて入力した文章): <span style="white-space:pre-wrap;">' + esc(s.bankInfo) + '</span><br>上の欄に分けて入力してください。分けて入力するまでは、この文章を請求書に印刷します。</div>' : '') +
      '</div>' +
      '<button class="btn secondary" id="save-business">保存する</button>' +
    '</section>' +
    '<section class="block"><h2>口座(普通預金)</h2><div class="note">預金を口座ごとに分けて記録できます。口座の名前はいつでも変えられます。取引・固定資産で使われておらず、開始残高が 0 の口座だけ削除できます(最後の1つは削除できません)。</div>' +
      bankAccounts().map(function (a) { const u = bankAccountUsage(a.id);
        return '<div class="tx-row" style="align-items:center;"><div style="flex:1;"><strong>' + esc(a.name) + '</strong><div class="muted" style="font-size:12px;">残高 ' + yen(fundBalance(a.id, todayStr())) + '</div></div>' +
          '<a data-bank-rename="' + esc(a.id) + '" style="cursor:pointer;font-size:12px;margin-right:10px;">名前を変える</a>' +
          (u || bankAccounts().length <= 1 ? '' : '<a data-bank-del="' + esc(a.id) + '" style="cursor:pointer;font-size:12px;color:var(--danger);">削除</a>') + '</div>'; }).join('') +
      '<div class="field-row" style="margin-top:10px;"><div class="field"><input type="text" id="bank-new" maxlength="60" placeholder="例: ○○銀行 普通"></div><div><button class="btn secondary" id="bank-add">口座を追加</button></div></div>' +
    '</section>' +
    '<section class="block"><h2>開始残高(元入金)</h2><div class="note">帳簿をつけ始める時点の現金・預金残高を入力してください。あとから変更もできます。</div>' +
      '<div class="field-row"><div class="field"><label>開始日</label><input type="date" id="s-openingDate" value="' + esc(s.openingDate) + '"></div></div>' +
      '<div class="field-row"><div class="field"><label>現金(開始時点)</label><input type="number" id="s-openingCash" value="' + esc(s.openingCash) + '"></div>' +
      '</div>' + bankAccounts().map(function (a) { return '<div class="field"><label>' + esc(a.name) + '(開始時点)</label><input type="number" data-opening-bank="' + esc(a.id) + '" value="' + esc(a.opening || 0) + '"></div>'; }).join('') +
      '<button class="btn secondary" id="save-opening">保存する</button>' +
    '</section>' +
    '<section class="block"><h2>消費税</h2>' + taxReviewNotice() +
      '<div class="note">申告のしかたに合わせて選んでください。分からない場合は税理士・税務署に確認してください。計算結果は「レポート」に表示します(申告書作成の参考値で、正確性は保証しません)。</div>' +
      '<div class="field-row"><div class="field"><label>課税方式</label><select id="s-taxMethod">' + Object.keys(TAX_METHODS).map(function (k) { return '<option value="' + k + '"' + ((s.taxMethod || '') === k ? ' selected' : '') + '>' + TAX_METHODS[k] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>主たる事業区分(簡易課税)</label><select id="s-mainBusinessType"><option value="0">未設定</option>' + Object.keys(BUSINESS_TYPES).map(function (k) { return '<option value="' + k + '"' + (Number(s.mainBusinessType) === Number(k) ? ' selected' : '') + '>' + BUSINESS_TYPES[k].label + '・みなし仕入率 ' + BUSINESS_TYPES[k].rate + '%</option>'; }).join('') + '</select></div></div>' +
      '<div class="note">2割特例: インボイス登録を機に課税事業者になった方が対象で、個人事業者は令和8年分(2026年分)まで。3割特例: 同じく令和9年分・令和10年分(2027・2028年分)。<br>本則課税は、この版では納付税額を計算しません(経費の税区分は記録できます)。<br>税率の表: ' + TAX_RATES.map(function (r) { return r.from + ' から 標準 ' + r.standard + '%・軽減 ' + r.reduced + '%'; }).join(' / ') + '</div>' +
      '<button class="btn secondary" id="save-tax">保存する</button>' +
    '</section>' +
    '<section class="block"><h2>請求書の消費税の端数処理</h2>' +
      '<div class="note">請求書に記載する消費税額の1円未満の扱いです(1枚の請求書・1つの税率につき1回)。初期値は切り捨て。<br><strong>変えても、すでに作った請求書の金額は変わりません</strong>(請求書ごとに作成時の端数処理を保存しています)。これから作る請求書に使われます。</div>' +
      '<div class="field"><select id="s-invRounding">' + Object.keys(DEPRECIATION_ROUNDING).map(function (k) { return '<option value="' + k + '"' + ((s.invoiceTaxRounding || 'floor') === k ? ' selected' : '') + '>' + DEPRECIATION_ROUNDING[k] + '</option>'; }).join('') + '</select></div>' +
      '<button class="btn secondary" id="save-invRounding">保存する</button>' +
    '</section>' +
    '<section class="block"><h2>減価償却の端数処理</h2>' +
      '<div class="note">固定資産の減価償却費を月数で按分したときの1円未満の扱いです(請求書の消費税とは別の設定です)。税理士・税務署に確認のうえ選んでください(初期値は切り捨て)。<br><strong>変更するとすべての年の償却費が計算し直されるため、申告済みの年の数字と合わなくなります。年度の途中や申告後には変えないでください。</strong></div>' +
      '<div class="field"><select id="s-depRounding">' + Object.keys(DEPRECIATION_ROUNDING).map(function (k) { return '<option value="' + k + '"' + (s.depreciationRounding === k ? ' selected' : '') + '>' + DEPRECIATION_ROUNDING[k] + '</option>'; }).join('') + '</select></div>' +
      '<button class="btn secondary" id="save-depRounding">保存する</button>' +
    '</section>' +
    '<section class="block"><h2>データの書き出し・バックアップ</h2>' + storageFlag() +
      '<div style="display:flex; flex-direction:column; gap:10px;">' +
        '<button class="btn secondary" id="export-tx-csv">取引一覧をCSVで書き出す</button>' +
        '<button class="btn secondary" id="export-backup">全データをバックアップ(JSON)として保存</button>' +
        '<button class="btn secondary" id="open-restore">自動バックアップから復元する</button>' +
        '<button class="btn secondary" id="open-history">変更履歴を見る</button>' +
        '<button class="btn secondary" id="import-backup-btn">バックアップファイル(JSON)を取り込む</button><input type="file" id="import-backup" accept="application/json" hidden>' +
      '</div>' +
      '<div class="note">アプリは起動時と終了時に自動でバックアップを取ります(直近30日分と各月末分を保持)。帳簿は税法上、原則7年(赤字の年は最長10年)の保存義務があります。データとバックアップはこの Mac 内にあるため、Time Machine などで外部ディスクにも保管してください。</div>' +
    '</section>' +
    '<section class="block"><h2>危険な操作</h2><button class="btn danger" id="wipe-all">すべてのデータを削除する</button></section>'
  );
}

/* ============================== イベント束ね ============================== */
function bindViewEvents() {
  hydrateReceipts();
  bindSearchBars();
  bindPartnerPicker('f-partner');
  bindPartnerEvents();
  bindAttachWidgets();
  const txForm = document.getElementById('tx-form');
  if (txForm) {
    const editing = editingTxId ? state.transactions.find(function (t) { return t.id === editingTxId; }) : null;
    renderDynamicFields(editing ? editing.kind : 'expense', editing);
    const kindSel = document.getElementById('f-kind');
    if (kindSel) kindSel.addEventListener('change', function () { renderDynamicFields(kindSel.value, null); });
    txForm.addEventListener('submit', onSubmitTx);
    const cancelBtn = document.getElementById('cancel-edit');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { editingTxId = null; renderView(); });
  }
  const linkedNotice = function (id) { const t = findById(state.transactions, id); if (t && t.linkedAssetId) { toast('この取引は固定資産台帳から自動で作られています。資産・負債タブの固定資産台帳で変更してください', 6000); return true; } return false; };
  document.querySelectorAll('[data-edit-tx]').forEach(function (a) { a.addEventListener('click', function () { if (linkedNotice(a.dataset.editTx)) return; editingTxId = a.dataset.editTx; renderView(); window.scrollTo(0, 0); }); });
  document.querySelectorAll('[data-del-tx]').forEach(function (a) { a.addEventListener('click', async function () { if (linkedNotice(a.dataset.delTx)) return; if (!(await confirmDialog('この取引を削除しますか?', '削除する'))) return; await Store.deleteTransaction(a.dataset.delTx); renderShell(); }); });

  const jy = document.getElementById('journal-year'); if (jy) jy.addEventListener('change', function () { window.__journalYear = Number(jy.value); renderView(); });
  const jm = document.getElementById('journal-month'); if (jm) jm.addEventListener('change', function () { window.__journalMonth = Number(jm.value); renderView(); });
  const ly = document.getElementById('ledger-year'); if (ly) ly.addEventListener('change', function () { window.__ledgerYear = Number(ly.value); renderView(); });
  // 「内訳を見る」: 総勘定元帳のその科目(今年)を開く
  document.querySelectorAll('[data-goto-ledger]').forEach(function (a) { a.style.cursor = 'pointer'; a.addEventListener('click', function () {
    window.__ledgerNode = a.dataset.gotoLedger; window.__ledgerYear = new Date().getFullYear(); currentTab = 'ledger'; renderShell(); window.scrollTo(0, 0);
  }); });
  const ln = document.getElementById('ledger-node'); if (ln) ln.addEventListener('change', function () { window.__ledgerNode = ln.value; renderView(); });
  const py = document.getElementById('pl-year'); if (py) py.addEventListener('change', function () { window.__plYear = Number(py.value); renderView(); });
  const pex = document.getElementById('pl-export'); if (pex) pex.addEventListener('click', exportPLCsv);
  const bd = document.getElementById('bs-date'); if (bd) bd.addEventListener('change', function () { window.__bsDate = bd.value; renderView(); });
  const ry = document.getElementById('report-year'); if (ry) ry.addEventListener('change', function () { window.__reportYear = Number(ry.value); renderView(); });

  const assetsYearSel = document.getElementById('assets-year'); if (assetsYearSel) assetsYearSel.addEventListener('change', function () { window.__assetsYear = Number(assetsYearSel.value); renderView(); });
  const newAsset = document.getElementById('new-asset'); if (newAsset) newAsset.addEventListener('click', function () { openAssetModal(null); });
  document.querySelectorAll('[data-edit-asset]').forEach(function (a) { a.addEventListener('click', function () { openAssetModal(state.fixedAssets.find(function (x) { return x.id === a.dataset.editAsset; })); }); });
  document.querySelectorAll('[data-del-asset]').forEach(function (a) { a.addEventListener('click', async function () { if (!(await confirmDialog('この固定資産を削除しますか?' + (linkedTxs(a.dataset.delAsset).length ? '(自動で作った購入・売却代金の取引も削除します)' : ''), '削除する'))) return; for (const lt of linkedTxs(a.dataset.delAsset)) await Store.deleteTransaction(lt.id); await Store.deleteFixedAsset(a.dataset.delAsset); renderShell(); }); });
  const newInvYear = document.getElementById('new-inv-year'); if (newInvYear) newInvYear.addEventListener('click', function () { openInvYearModal(null); });
  document.querySelectorAll('[data-edit-inv-year]').forEach(function (a) { a.addEventListener('click', function () { openInvYearModal(Number(a.dataset.editInvYear)); }); });

  const newInv = document.getElementById('new-invoice');
  if (newInv) newInv.addEventListener('click', function () {
    state.settings.invoiceSeq = (state.settings.invoiceSeq || 0) + 1;
    const num = todayStr().slice(0, 4) + '-' + String(state.settings.invoiceSeq).padStart(3, '0');
    invoiceDraft = { number: num, issueDate: todayStr(), dueDate: '', clientName: '', clientAddress: '', transactionDate: '', honorific: '御中', clientPostalCode: '', taxRounding: state.settings.invoiceTaxRounding || 'floor', items: [{ name: '', qty: 1, unitPrice: 0, taxRate: 10 }], taxRate: 10, notes: '', status: '下書き' };
    editingInvoiceId = null; renderView();
  });
  document.querySelectorAll('[data-edit-inv]').forEach(function (a) { a.addEventListener('click', function () { const inv = state.invoices.find(function (i) { return i.id === a.dataset.editInv; });
    if (isIssuedInvoice(inv)) { toast('送付済みの請求書は直接は直せません。「修正版を作る」を使ってください', 6000); return; }
    invoiceDraft = JSON.parse(JSON.stringify(inv)); editingInvoiceId = inv.id; renderView(); }); });
  document.querySelectorAll('[data-del-inv]').forEach(function (a) { a.addEventListener('click', async function () {
    const inv = findById(state.invoices, a.dataset.delInv);
    const msg = isIssuedInvoice(inv) ? '送付済みの請求書です。送った請求書の控えは保存が必要です(原則7年)。本当に削除しますか?' : 'この請求書を削除しますか?';
    if (!(await confirmDialog(msg, '削除する'))) return; await Store.deleteInvoice(a.dataset.delInv); renderView(); }); });
  document.querySelectorAll('[data-print-inv]').forEach(function (a) { a.addEventListener('click', function () { choosePrint(findById(state.invoices, a.dataset.printInv)); }); });
  document.querySelectorAll('[data-send-inv]').forEach(function (a) { a.addEventListener('click', function () { markInvoiceSent(a.dataset.sendInv); }); });
  document.querySelectorAll('[data-send-later]').forEach(function (a) { a.addEventListener('click', function () { sendPromptFor = null; renderView(); }); });
  document.querySelectorAll('[data-paid-inv]').forEach(function (a) { a.addEventListener('click', async function () { await Store.updateInvoice(a.dataset.paidInv, { status: '入金済み' }); renderView(); }); });
  document.querySelectorAll('[data-unpaid-inv]').forEach(function (a) { a.addEventListener('click', async function () { await Store.updateInvoice(a.dataset.unpaidInv, { status: '送付済み(未入金)' }); renderView(); }); });
  document.querySelectorAll('[data-revise-inv]').forEach(function (a) { a.addEventListener('click', function () { makeRevision(a.dataset.reviseInv); }); });
  // 送付済みの請求書は、添付ファイル(送った控えの PDF など)だけ加えられる
  document.querySelectorAll('[data-attach-inv]').forEach(function (a) { a.addEventListener('click', function () {
    const inv = findById(state.invoices, a.dataset.attachInv); if (!inv) return;
    invoiceDraft = { attachments: (inv.attachments || []).map(function (x) { return Object.assign({}, x); }) };
    openModal('請求書 No.' + inv.number + ' の添付ファイル', attachWidgetHtml('inv', invoiceDraft.attachments) + '<button class="btn block" id="inv-attach-save" style="margin-top:12px;">保存する</button>');
    bindAttachWidgets(); hydrateReceipts();
    document.getElementById('inv-attach-save').addEventListener('click', async function () { const list = invoiceDraft.attachments; invoiceDraft = null; closeModal(); await Store.updateInvoice(inv.id, { attachments: list }); renderView(); });
  }); });
  if (document.getElementById('inv-items')) renderInvoiceItems();
  const addItem = document.getElementById('inv-add-item'); if (addItem) addItem.addEventListener('click', function () { invoiceDraft.items.push({ name: '', qty: 1, unitPrice: 0, taxRate: 10 }); renderInvoiceItems(); updateInvoiceTotalsDisplay(); });

  [['inv-number', 'number'], ['inv-issue', 'issueDate'], ['inv-client-addr', 'clientAddress'], ['inv-client-postal', 'clientPostalCode'], ['inv-honorific', 'honorific'], ['inv-due', 'dueDate'], ['inv-txdate', 'transactionDate'], ['inv-notes', 'notes']].forEach(function (pair) {
    const el = document.getElementById(pair[0]); if (!el) return; el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () { invoiceDraft[pair[1]] = el.value; });
  });
  // 宛先: 取引先を選んだら宛先名と、住所が空なら取引先の住所を入れる。新しく入力するときは入力した名前を宛先にする
  if (invoiceDraft) bindPartnerPicker('inv-client', function (p) {
    const addr = document.getElementById('inv-client-addr');
    const postal = document.getElementById('inv-client-postal');
    if (p) { invoiceDraft.clientName = p.name; invoiceDraft.partnerId = p.id; if (p.address && addr && !addr.value) { addr.value = p.address; invoiceDraft.clientAddress = p.address; }
      if (p.postalCode && postal && !postal.value) { postal.value = p.postalCode; invoiceDraft.clientPostalCode = p.postalCode; } }
    else { invoiceDraft.clientName = (document.getElementById('inv-client-new') || {}).value || ''; delete invoiceDraft.partnerId; }
  });
  const invSave = document.getElementById('inv-save');
  if (invSave) invSave.addEventListener('click', async function () {
    delete invoiceDraft.taxRate; // 税率は明細ごと(以前の形式の項目は使わない)
    invoiceDraft.items.forEach(function (it) { it.taxRate = itemRate(invoiceDraft, it); });
    // 宛先: 選んだ取引先、または新しく入力した名前で取引先とつなぐ(なければ作る)
    invoiceDraft.clientName = normName(pickerName('inv-client'));
    const pid = await partnerIdForName(invoiceDraft.clientName, invoiceDraft.clientAddress);
    if (pid) invoiceDraft.partnerId = pid; else delete invoiceDraft.partnerId;
    const missing = invoiceMissing(invoiceDraft);
    if (missing.length && !(await confirmDialog('適格請求書(インボイス)の記載事項が足りません: ' + missing.join('・') + '。このまま保存しますか?', '保存する'))) return;
    if (editingInvoiceId) await Store.updateInvoice(editingInvoiceId, invoiceDraft); else await Store.addInvoice(invoiceDraft);
    invoiceDraft = null; editingInvoiceId = null; await Store.saveSettings({ invoiceSeq: state.settings.invoiceSeq }); renderView(); toast('請求書を保存しました');
  });
  const invCancel = document.getElementById('inv-cancel'); if (invCancel) invCancel.addEventListener('click', function () { invoiceDraft = null; editingInvoiceId = null; renderView(); });

  const saveBiz = document.getElementById('save-business');
  if (saveBiz) saveBiz.addEventListener('click', function () { Store.saveSettings({ businessName: val('s-businessName'), ownerName: val('s-ownerName'), address: val('s-address'), phone: val('s-phone'), invoiceRegNo: val('s-invoiceRegNo'), postalCode: val('s-postalCode'), fax: val('s-fax'),
    bankName: val('s-bankName'), bankBranch: val('s-bankBranch'), bankAccountType: val('s-bankAccountType'), bankAccountNumber: val('s-bankAccountNumber'), bankAccountHolder: val('s-bankAccountHolder') }).then(renderShell); });
  const bankAdd = document.getElementById('bank-add');
  if (bankAdd) bankAdd.addEventListener('click', async function () {
    const name = normName(val('bank-new')).slice(0, 60); if (!name) { toast('口座の名前を入力してください'); return; }
    if (bankAccounts().some(function (a) { return normName(a.name) === name; })) { toast('同じ名前の口座があります'); return; }
    await Store.addBankAccount(name); renderShell();
  });
  document.querySelectorAll('[data-bank-rename]').forEach(function (el) { el.addEventListener('click', function () {
    const a = findById(bankAccounts(), el.dataset.bankRename); if (!a) return;
    openModal('口座の名前を変える', '<div class="field"><input type="text" id="bank-rename" maxlength="60" value="' + esc(a.name) + '"></div><button class="btn block" id="bank-rename-save">保存する</button>');
    document.getElementById('bank-rename-save').addEventListener('click', async function () {
      const name = normName(val('bank-rename')).slice(0, 60); if (!name) { toast('名前を入力してください'); return; }
      if (bankAccounts().some(function (x) { return x.id !== a.id && normName(x.name) === name; })) { toast('同じ名前の口座があります'); return; }
      await Store.updateBankAccount(a.id, { name: name }); closeModal(); renderShell();
    });
  }); });
  document.querySelectorAll('[data-bank-del]').forEach(function (el) { el.addEventListener('click', async function () {
    if (!(await confirmDialog('この口座を削除しますか?', '削除する'))) return; await Store.deleteBankAccount(el.dataset.bankDel); renderShell();
  }); });
  const saveTax = document.getElementById('save-tax');
  if (saveTax) saveTax.addEventListener('click', function () { Store.saveSettings({ taxMethod: val('s-taxMethod'), mainBusinessType: Number(val('s-mainBusinessType')) || 0 }).then(renderShell); });
  document.querySelectorAll('[data-tax-review-done]').forEach(function (b) { b.addEventListener('click', function () { Store.saveSettings({ taxReview: '' }).then(renderShell); }); });
  const saveInterim = document.getElementById('save-interim');
  if (saveInterim) saveInterim.addEventListener('click', function () { Store.setTaxInterim(Number(saveInterim.dataset.year), { national: Math.max(0, Number(val('ti-national')) || 0), local: Math.max(0, Number(val('ti-local')) || 0) }).then(renderView); });
  const saveInvRounding = document.getElementById('save-invRounding');
  if (saveInvRounding) saveInvRounding.addEventListener('click', function () { Store.saveSettings({ invoiceTaxRounding: val('s-invRounding') }).then(renderShell); });
  const saveDepRounding = document.getElementById('save-depRounding');
  if (saveDepRounding) saveDepRounding.addEventListener('click', async function () {
    const v = val('s-depRounding'); if (v === state.settings.depreciationRounding) { toast('変更はありません'); return; }
    if (!(await confirmDialog('端数処理を「' + DEPRECIATION_ROUNDING[v] + '」に変えると、すべての年の償却費が計算し直されます。申告済みの年の数字と合わなくなることがあります。変更しますか?', '変更する'))) { renderView(); return; }
    Store.saveSettings({ depreciationRounding: v }).then(renderShell);
  });
  const saveOpening = document.getElementById('save-opening');
  if (saveOpening) saveOpening.addEventListener('click', async function () {
    // 口座ごとの開始残高は口座の一覧(bankAccounts)に保存する
    for (const el of Array.from(document.querySelectorAll('[data-opening-bank]'))) {
      const a = findById(bankAccounts(), el.dataset.openingBank); const v = Number(el.value) || 0;
      if (a && (Number(a.opening) || 0) !== v) await Store.updateBankAccount(a.id, { opening: v });
    }
    await Store.saveSettings({ openingDate: val('s-openingDate'), openingCash: Number(val('s-openingCash')) || 0 });
    renderShell();
  });
  const expTx = document.getElementById('export-tx-csv'); if (expTx) expTx.addEventListener('click', exportTransactionsCsv);
  const expBackup = document.getElementById('export-backup'); if (expBackup) expBackup.addEventListener('click', exportBackup);
  const openRestore = document.getElementById('open-restore'); if (openRestore) openRestore.addEventListener('click', openRestoreModal);
  const openHistory = document.getElementById('open-history'); if (openHistory) openHistory.addEventListener('click', openHistoryModal);
  const impBackup = document.getElementById('import-backup'); if (impBackup) impBackup.addEventListener('change', onImportBackup);
  // ボタンからファイル選択を開く(キーボードでも操作できるように label ではなく button を使う)
  const impBackupBtn = document.getElementById('import-backup-btn'); if (impBackupBtn && impBackup) impBackupBtn.addEventListener('click', function () { impBackup.value = ''; impBackup.click(); });
  const wipe = document.getElementById('wipe-all'); if (wipe) wipe.addEventListener('click', onWipeAll);
}

async function onSubmitTx(e) {
  e.preventDefault();
  const kind = val('f-kind'); const date = val('f-date') || todayStr(); const amount = Number(val('f-amount')) || 0; const memo = val('f-memo');
  if (amount <= 0) { toast('金額を入力してください'); return; }
  const payload = { kind: kind, date: date, amount: amount, memo: memo };
  if (['income', 'expense', 'purchase', 'drawing', 'contribution', 'repay', 'borrow', 'pay_liability'].indexOf(kind) >= 0) {
    payload.fund = fundPickerValue('fund-group') || 'cash';
  }
  if (kind === 'income' || kind === 'expense') payload.account = val('f-account');
  const pid = await partnerIdForName(pickerName('f-partner'));
  payload.partnerId = pid || undefined;
  const taxcat = document.getElementById('f-taxcat');
  if (taxcat && taxcat.value) payload.taxCategory = taxcat.value; else payload.taxCategory = undefined;
  const bizcat = document.getElementById('f-bizcat');
  payload.businessType = (kind === 'income' && bizcat && Number(bizcat.value)) ? Number(bizcat.value) : undefined;
  if (kind === 'expense_accrued') { const combo = val('f-accrual-account'); const parts = combo.split(':'); payload.accountType = parts[0]; payload.account = parts[1]; payload.liability = val('f-liability'); }
  if (kind === 'pay_liability') payload.liability = val('f-liability');

  payload.attachments = (formAttach.tx || []).slice();

  if (editingTxId) { await Store.updateTransaction(editingTxId, payload); toast('更新しました'); } else { await Store.addTransaction(payload); toast('記録しました'); }
  editingTxId = null; formAttach.tx = null; formAttach.txOwner = null; renderShell();
}

/* ============================== 印刷 ============================== */
// 印刷する内容(請求書 + 設定)。送付済みの請求書は、送付したときに保存した内容を使う(段階③)
function invoiceViewModel(inv, settings) {
  if (inv.issued && inv.issued.view && !settings) return inv.issued.view; // 送付済みは送付したときの内容
  const st = settings || state.settings || {};
  const hasSplitBank = !!(st.bankName || st.bankBranch || st.bankAccountNumber || st.bankAccountHolder);
  return {
    number: inv.number || '', issueDate: inv.issueDate || '', transactionDate: inv.transactionDate || '', dueDate: inv.dueDate || '',
    client: { name: inv.clientName || '', honorific: inv.honorific || '御中', postal: inv.clientPostalCode || '', address: inv.clientAddress || '' },
    issuer: { name: st.businessName || st.ownerName || '', owner: st.businessName ? (st.ownerName || '') : '', postal: st.postalCode || '', address: st.address || '', phone: st.phone || '', fax: st.fax || '', regNo: st.invoiceRegNo || '' },
    bank: hasSplitBank ? { name: st.bankName || '', branch: st.bankBranch || '', type: st.bankAccountType || '', number: st.bankAccountNumber || '', holder: st.bankAccountHolder || '' } : { text: st.bankInfo || '' },
    items: (inv.items || []).map(function (it) { return { name: it.name || '', qty: Number(it.qty) || 0, unitPrice: Number(it.unitPrice) || 0, taxRate: itemRate(inv, it) }; }),
    taxRounding: inv.taxRounding || 'round', notes: inv.notes || '', revisionOf: inv.revisionOf || ''
  };
}
// 送付済み・入金済みの請求書(内容を固定したもの)
function isIssuedInvoice(inv) { return !!(inv && inv.issued && inv.issued.view); }
// 送付したときの内容の検査・正規化(取り込み時)。形がおかしければ null
function cleanIssuedView(v) {
  if (!v || typeof v !== 'object') return null;
  const str = function (x, n) { return typeof x === 'string' ? x.slice(0, n || 200) : ''; };
  const obj = function (x) { return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; };
  const c = obj(v.client), i = obj(v.issuer), b = obj(v.bank);
  if (!Array.isArray(v.items)) return null;
  return {
    number: str(v.number, 40), issueDate: str(v.issueDate, 20), transactionDate: str(v.transactionDate, 40), dueDate: str(v.dueDate, 20),
    client: { name: str(c.name, 100), honorific: HONORIFICS.indexOf(c.honorific) >= 0 ? c.honorific : '御中', postal: str(c.postal, 10), address: str(c.address) },
    issuer: { name: str(i.name, 100), owner: str(i.owner, 100), postal: str(i.postal, 10), address: str(i.address), phone: str(i.phone, 40), fax: str(i.fax, 40), regNo: str(i.regNo, 40) },
    bank: b.text !== undefined ? { text: str(b.text, 1000) } : { name: str(b.name, 100), branch: str(b.branch, 100), type: b.type === '普通' || b.type === '当座' ? b.type : '', number: str(b.number, 40), holder: str(b.holder, 100) },
    items: v.items.slice(0, 200).filter(function (it) { return it && typeof it === 'object'; }).map(function (it) { return { name: str(it.name), qty: Number(it.qty) || 0, unitPrice: Number(it.unitPrice) || 0, taxRate: [10, 8, 0].indexOf(Number(it.taxRate)) >= 0 ? Number(it.taxRate) : 10 }; }),
    taxRounding: Object.prototype.hasOwnProperty.call(DEPRECIATION_ROUNDING, v.taxRounding) ? v.taxRounding : 'round', notes: str(v.notes, 2000), revisionOf: str(v.revisionOf, 40)
  };
}
function num(n) { n = Math.round(Number(n) || 0); return (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ja-JP'); }
// 請求書の印刷用 HTML(A4 縦・明朝体)。opts.copy = true で「控」の印を付ける
function invoicePrintHtml(m, opts) {
  opts = opts || {};
  const t = invoiceTotals({ items: m.items, taxRounding: m.taxRounding });
  const g = function (r) { return t.byRate.find(function (x) { return x.rate === r; }) || { subtotal: 0, tax: 0 }; };
  const has8 = t.byRate.some(function (x) { return x.rate === 8; });
  const jpDate = function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d) ? historyDate(d) : esc(d); };
  // A4 縦 1枚に収まるよう、余白・行の高さを詰めている(明細 9 行のとき約 950px。印刷できる高さは約 1024px)
  const B = 'border:1px solid #333;', cell = 'padding:3px 8px;', th = 'background:#e6e6e6;font-weight:normal;';
  const rows = m.items.map(function (it) {
    return '<tr><td style="' + cell + 'border-left:1px solid #333;border-bottom:1px solid #333;">' + esc(it.name) + (it.taxRate === 8 ? ' ※' : '') + '</td>' +
      '<td style="' + cell + 'text-align:right;border-left:1px solid #333;border-bottom:1px solid #333;">' + num(it.qty) + '</td>' +
      '<td style="' + cell + 'text-align:right;border-left:1px solid #333;border-bottom:1px solid #333;">' + num(it.unitPrice) + '</td>' +
      '<td style="' + cell + 'text-align:right;border-left:1px solid #333;border-right:1px solid #333;border-bottom:1px solid #333;">' + num(it.qty * it.unitPrice) + '</td></tr>';
  });
  while (rows.length < 9) rows.push('<tr><td style="' + cell + 'height:1.3em;border-left:1px solid #333;border-bottom:1px solid #333;"></td><td style="border-left:1px solid #333;border-bottom:1px solid #333;"></td><td style="border-left:1px solid #333;border-bottom:1px solid #333;"></td><td style="border-left:1px solid #333;border-right:1px solid #333;border-bottom:1px solid #333;"></td></tr>');
  const iss = m.issuer;
  const bankHtml = m.bank.text !== undefined ? '<div style="white-space:pre-wrap;">' + esc(m.bank.text) + '</div>'
    : '<div>' + esc([m.bank.name, m.bank.branch].filter(Boolean).join(' ')) + '</div><div>' + esc([m.bank.type, m.bank.number].filter(Boolean).join(' ')) + '</div>' + (m.bank.holder ? '<div>口座名義: ' + esc(m.bank.holder) + '</div>' : '');
  return '<div class="invoice-sheet" style="font-family:\'Hiragino Mincho ProN\',\'Hiragino Mincho Pro\',\'Yu Mincho\',serif;color:#111;font-size:12px;line-height:1.45;position:relative;">' +
    (opts.copy ? '<div style="position:absolute;top:0;right:0;border:2px solid #b33f2e;color:#b33f2e;font-size:20px;width:40px;height:40px;line-height:36px;text-align:center;border-radius:50%;">控</div>' : '') +
    '<h1 style="text-align:center;font-size:24px;letter-spacing:0.5em;font-weight:normal;margin:0 0 2px;">御請求書</h1>' +
    (m.revisionOf ? '<div style="text-align:center;font-size:12px;margin-bottom:6px;">(請求書番号 ' + esc(m.revisionOf) + ' の修正)</div>' : '<div style="height:6px;"></div>') +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;">' +
      '<div style="flex:1;padding-top:20px;"><div style="font-size:21px;border-bottom:1px solid #333;padding-bottom:3px;display:inline-block;min-width:80%;">' + esc(m.client.name) + ' ' + esc(m.client.honorific) + '</div>' +
        (m.client.postal ? '<div style="margin-top:14px;">〒' + esc(m.client.postal) + '</div>' : '<div style="height:14px;"></div>') + (m.client.address ? '<div>' + esc(m.client.address) + '</div>' : '') + '</div>' +
      '<div style="width:46%;padding-top:20px;">' + // 枠の上の端を、左の相手の社名の高さにそろえる
        '<table style="border-collapse:collapse;width:100%;margin-bottom:10px;">' +
          [['請求書番号', esc(m.number)], ['発行日', jpDate(m.issueDate)], ['取引年月日', jpDate(m.transactionDate)], ['お支払い期限', jpDate(m.dueDate)]].map(function (r) { return '<tr><th style="' + B + cell + th + 'width:38%;text-align:left;">' + r[0] + '</th><td style="' + B + cell + '">' + r[1] + '</td></tr>'; }).join('') +
        '</table>' +
        // 自社の情報は、上の枠の下(約 1cm あけて)に置く。名前は中央、ほかの行はまとめて中央に置き、左端をそろえる
        '<div style="text-align:center;margin-top:38px;"><div style="font-size:16px;">' + esc(iss.name) + '</div>' + (iss.owner ? '<div>' + esc(iss.owner) + '</div>' : '') +
        '<div style="display:inline-block;text-align:left;margin-top:2px;">' +
          (iss.postal ? '<div>〒' + esc(iss.postal) + '</div>' : '') + (iss.address ? '<div>' + esc(iss.address) + '</div>' : '') +
          (iss.phone ? '<div>TEL: ' + esc(iss.phone) + '</div>' : '') + (iss.fax ? '<div>FAX: ' + esc(iss.fax) + '</div>' : '') +
          (iss.regNo ? '<div>登録番号: ' + esc(iss.regNo) + '</div>' : '') +
        '</div></div>' +
      '</div></div>' +
    '<div style="margin:10px 0 4px;">下記のとおりご請求申し上げます。</div>' +
    '<table style="border-collapse:collapse;margin-bottom:6px;"><tr><th style="' + B + 'padding:6px 14px;' + th + '">御請求金額</th><td style="' + B + 'padding:6px 18px;font-size:19px;">¥ ' + num(t.total) + ' <span style="font-size:12px;">(税込)</span></td></tr></table>' +
    '<hr style="border:none;border-top:1px solid #333;margin:8px 0 10px;">' +
    '<table style="border-collapse:collapse;width:100%;"><tr>' +
      ['項目', '数量', '単価', '金額'].map(function (h, i) { return '<th style="' + B + cell + th + (i ? 'text-align:center;width:' + (i === 1 ? '10%' : '17%') + ';' : 'text-align:center;') + '">' + h + '</th>'; }).join('') + '</tr>' +
      rows.join('') +
      '<tr><td colspan="3" style="' + B + cell + 'text-align:center;">小計</td><td style="' + B + cell + 'text-align:right;">' + num(t.subtotal) + '</td></tr>' +
    '</table>' +
    (has8 ? '<div style="font-size:11px;margin-top:4px;">※は軽減税率(8%)対象</div>' : '') +
    '<div style="display:flex;gap:16px;margin-top:8px;">' +
      '<table style="border-collapse:collapse;flex:1;">' + [['合計(税抜)', t.subtotal], ['10%対象', g(10).subtotal], ['8%対象', g(8).subtotal]].map(function (r) { return '<tr><th style="' + B + cell + th + 'text-align:left;">' + r[0] + '</th><td style="' + B + cell + 'text-align:right;">' + num(r[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<table style="border-collapse:collapse;flex:1;">' + [['消費税額計', t.tax], ['消費税(10%)', g(10).tax], ['消費税(8%)', g(8).tax]].map(function (r) { return '<tr><th style="' + B + cell + th + 'text-align:left;">' + r[0] + '</th><td style="' + B + cell + 'text-align:right;">' + num(r[1]) + '</td></tr>'; }).join('') + '</table>' +
    '</div>' +
    '<div style="margin-top:10px;"><div>【振込先】</div>' + bankHtml + '</div>' +
    '<div style="margin-top:8px;"><div>備考</div><div style="' + B + 'min-height:3.5em;padding:4px 8px;white-space:pre-wrap;">' + esc(m.notes) + '</div></div>' +
  '</div>';
}
function printInvoice(inv, opts) {
  document.getElementById('print-area').innerHTML = invoicePrintHtml(invoiceViewModel(inv), opts);
  if (!isIssuedInvoice(inv)) { sendPromptFor = inv.id; setTimeout(renderView, 300); } // 下書きを印刷したら、送付済みにする案内を出す
  // window.print() は Tauri(WKWebView)では印刷ダイアログが開かないため、Rust 側の印刷を呼ぶ
  setTimeout(function () {
    invoke('print_page').catch(function (e) { toast('印刷できませんでした(' + String(typeof e === 'string' ? e : (e && e.message) || '').slice(0, 80) + ')', 8000); });
  }, 50);
}

/* ============================== CSV / バックアップ ============================== */
function exportTransactionsCsv() {
  const header = ['日付', '区分', '勘定科目', '資金', '口座', '金額', '取引先', 'メモ'];
  const lines = [header.map(csvField).join(',')];
  state.transactions.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (t) {
    lines.push([t.date, KIND_LABELS[t.kind], primaryLabel(t), t.fund === 'cash' ? '現金' : (t.fund ? '普通預金' : ''), t.fund && t.fund !== 'cash' ? fundLabel(t.fund) : '', t.amount, partnerName(t.partnerId), t.memo || ''].map(csvField).join(','));
  });
  downloadFile('取引一覧.csv', '\uFEFF' + lines.join('\r\n'));
}
function exportPLCsv() {
  const years = availableYears(); const y = window.__plYear || years[0] || new Date().getFullYear();
  const pl = computePL(y);
  const lines = [['項目', '金額'].map(csvField).join(',')];
  lines.push(['【収入の部】', ''].join(','));
  ACCOUNTS.income.forEach(function (a) { lines.push([a.label, pl.incomeTotals[a.key]].map(csvField).join(',')); });
  lines.push(['収入合計', pl.incomeSum].map(csvField).join(','));
  lines.push(['【売上原価】', ''].join(','));
  lines.push(['期首棚卸高', pl.inventoryOpening].map(csvField).join(','));
  lines.push(['仕入高', pl.purchases].map(csvField).join(','));
  lines.push(['期末棚卸高', pl.inventoryClosing].map(csvField).join(','));
  lines.push(['売上原価', pl.cogs].map(csvField).join(','));
  lines.push(['差引金額(売上総利益)', pl.grossProfit].map(csvField).join(','));
  lines.push(['【経費の部】', ''].join(','));
  ACCOUNTS.expense.forEach(function (a) { lines.push([a.label, pl.expenseTotals[a.key]].map(csvField).join(',')); });
  lines.push(['経費合計', pl.expenseSum].map(csvField).join(','));
  lines.push(['差引金額(所得金額・控除前)', pl.net].map(csvField).join(','));
  downloadFile(y + '年_損益計算書.csv', '\uFEFF' + lines.join('\r\n'));
}
function allAttachmentIds(list) {
  const ids = []; (list || []).forEach(function (x) { (x.attachments || []).forEach(function (a) { if (a && ID_RE.test(a.id)) ids.push(a.id); }); }); return ids;
}
async function exportBackup() {
  const ids = Array.from(new Set(allAttachmentIds(state.transactions).concat(allAttachmentIds(state.invoices))));
  if (ids.length && !(await confirmDialog('バックアップには添付ファイル(' + ids.length + ' 件)も含まれます。レシートには住所やカード番号の一部が、写真には撮影場所(位置情報)などが含まれていることがあります。ファイルを持ち出す・人に渡す際は取り扱いに注意してください。', '書き出す'))) return;
  const receipts = {}; let missing = 0;
  for (const id of ids) { try { receipts[id] = bytesToBase64(await readReceiptBytes(id)); } catch (e) { missing++; } }
  const data = { app: 'keiri-note', schemaVersion: SCHEMA_VERSION, transactions: state.transactions, invoices: state.invoices, settings: state.settings, fixedAssets: state.fixedAssets, inventoryYearEnd: state.inventoryYearEnd, taxInterim: state.taxInterim, partners: state.partners, bankAccounts: state.bankAccounts, receipts: receipts, exportedAt: new Date().toISOString() };
  const ok = await downloadFile('青りんご帳簿_バックアップ_' + todayStr() + '.json', JSON.stringify(data, null, 2));
  if (ok) { try { localStorage.setItem('keirinote_lastBackupAt', new Date().toISOString()); } catch (e) {} }
  if (ok && missing) toast('見つからない画像が ' + missing + ' 枚ありました(それ以外は書き出しました)');
}
/* ============================== バックアップの検証 ============================== */
const SCHEMA_VERSION = 11;
const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;
const B64_RE = /^[A-Za-z0-9+\/]*={0,2}$/;
// 旧版のデータを現在の形式に移行する。版ごとに1段ずつ上げる
function migrateBackup(raw) {
  const out = Object.assign({}, raw);
  let v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  if (v < 2) {
    // v1 → v2: バックアップにレシート画像(receipts: { 画像ID: base64 })を同梱できるようになった。v1 には無い
    out.receipts = {};
    v = 2;
  }
  if (v < 3) {
    // v2 → v3: 固定資産に処分の種類(disposalType: retire=除却 / sale=売却)・売却代金・受け取り先を追加。
    // それまでの「除却・売却日」は区別がなかったため、除却として扱う(画面で売却に直せる)
    if (Array.isArray(out.fixedAssets)) out.fixedAssets = out.fixedAssets.map(function (a) {
      if (a && typeof a === 'object' && a.disposalDate && a.disposalType === undefined) return Object.assign({}, a, { disposalType: 'retire' });
      return a;
    });
    v = 3;
  }
  if (v < 4) {
    // v3 → v4: 取引の区分に「固定資産の購入」(asset_purchase)と、固定資産に支払い方法(payFund: cash / bank / accrued=未払金)を追加。
    // 既存の固定資産は支払いが記録されていないため、payFund なしのまま(画面で設定できる)
    v = 4;
  }
  if (v < 5) {
    // v4 → v5: 添付は1件(receiptAssetId)から複数(attachments: [{ id, type, name, addedAt }])に。PDF・HEIC も添付できるように
    if (Array.isArray(out.transactions)) out.transactions = out.transactions.map(function (t) {
      if (!t || typeof t !== 'object' || t.receiptAssetId === undefined) return t;
      const o = Object.assign({}, t); const rid = o.receiptAssetId; delete o.receiptAssetId;
      if (typeof rid === 'string' && rid) o.attachments = [{ id: rid }];
      return o;
    });
    v = 5;
  }
  if (v < 6) {
    // v5 → v6: 消費税(取引の税区分 taxCategory・事業区分 businessType、設定の課税方式・事業区分、中間納付 taxInterim)と、
    // 請求書の明細ごとの税率(items[].taxRate)・取引年月日(transactionDate)を追加。
    // 既存の売上(収入)は「課税(標準税率)」として移行し、画面で見直しを促す(taxReview)。課税方式・事業区分は未設定のまま
    let incomes = 0;
    if (Array.isArray(out.transactions)) out.transactions = out.transactions.map(function (t) {
      if (!t || typeof t !== 'object' || t.kind !== 'income' || t.taxCategory !== undefined) return t;
      incomes++; return Object.assign({}, t, { taxCategory: 'standard' });
    });
    if (incomes && out.settings && typeof out.settings === 'object') out.settings = Object.assign({}, out.settings, { taxReview: 'pending' });
    else if (incomes) out.settings = { taxReview: 'pending' };
    if (Array.isArray(out.invoices)) out.invoices = out.invoices.map(function (inv) {
      if (!inv || typeof inv !== 'object') return inv;
      const o = Object.assign({}, inv); const rate = [10, 8, 0].indexOf(Number(o.taxRate)) >= 0 ? Number(o.taxRate) : 10;
      if (Array.isArray(o.items)) o.items = o.items.map(function (it) { return (it && typeof it === 'object' && it.taxRate === undefined) ? Object.assign({}, it, { taxRate: rate }) : it; });
      delete o.taxRate;
      return o;
    });
    v = 6;
  }
  if (v < 7) {
    // v6 → v7: 請求書ごとに消費税の端数処理(taxRounding)を保存する。以前の請求書は四捨五入で計算していたので、
    // 金額が変わらないよう 'round' を入れる。設定(invoiceTaxRounding)の初期値は切り捨てで、これから作る請求書に使う
    if (Array.isArray(out.invoices)) out.invoices = out.invoices.map(function (inv) {
      return (inv && typeof inv === 'object' && inv.taxRounding === undefined) ? Object.assign({}, inv, { taxRounding: 'round' }) : inv;
    });
    v = 7;
  }
  if (v < 8) {
    // v7 → v8: 取引先(partners: [{ id, name, address }])と、取引・請求書の partnerId を追加。
    // 既存の請求書の宛先(ユーザーが入力した名前)から取引先を作ってつなぐ。取引のメモからは推定しない(取引は未設定のまま)
    const partners = Array.isArray(out.partners) ? out.partners.slice() : [];
    const byName = {}; partners.forEach(function (p) { if (p && p.name) byName[String(p.name).normalize('NFKC').trim()] = p; });
    if (Array.isArray(out.invoices)) out.invoices = out.invoices.map(function (inv, i) {
      if (!inv || typeof inv !== 'object' || inv.partnerId) return inv;
      const name = String(inv.clientName || '').normalize('NFKC').trim().slice(0, 100); if (!name) return inv;
      let p = byName[name];
      if (!p) { p = { id: 'pt_m' + (partners.length + 1) + '_' + i, name: name }; if (inv.clientAddress) p.address = String(inv.clientAddress).slice(0, 200); partners.push(p); byName[name] = p; }
      const o = Object.assign({}, inv, { partnerId: p.id });
      if (o.status === undefined || o.status === '') o.status = '下書き';
      return o;
    });
    out.partners = partners;
    v = 8;
  }
  if (v < 9) {
    // v8 → v9: 普通預金を口座ごとに(bankAccounts: [{ id, name, opening }])。最初の口座は ID 'bank'・名前「普通預金」で、
    // 以前の取引の fund: 'bank' はそのままこの口座に入る。開始残高は設定の openingBank から移し、設定の値は 0 にする
    if (!Array.isArray(out.bankAccounts) || !out.bankAccounts.length) {
      const st = out.settings && typeof out.settings === 'object' ? out.settings : {};
      out.bankAccounts = [{ id: 'bank', name: '普通預金', opening: Number(st.openingBank) || 0 }];
      if (out.settings && typeof out.settings === 'object') out.settings = Object.assign({}, out.settings, { openingBank: 0 });
    }
    v = 9;
  }
  if (v < 10) {
    // v9 → v10: 請求書の見た目の作り直し。請求書に敬称(honorific)と宛先の郵便番号、設定に郵便番号・FAX・振込先の分割入力、
    // 取引先に郵便番号を追加。以前の請求書は「様」で印刷していたので、敬称は「様」のまま(新しい請求書の初期値は「御中」)。
    // 振込先の文章(bankInfo)は自動で分けない(設定画面で分けて入力するよう案内し、それまでは文章を印刷)
    if (Array.isArray(out.invoices)) out.invoices = out.invoices.map(function (inv) {
      return (inv && typeof inv === 'object' && inv.honorific === undefined) ? Object.assign({}, inv, { honorific: '様' }) : inv;
    });
    v = 10;
  }
  if (v < 11) {
    // v10 → v11: 送付済み・入金済みの請求書は、送ったときの内容を請求書の中に固定する(issued)。
    // 以前の送付済み・入金済みの請求書は、移行したときの設定の内容で固定し「移行時の内容で固定」と表示する
    const st = Object.assign(defaultSettings(), out.settings && typeof out.settings === 'object' ? out.settings : {});
    if (Array.isArray(out.invoices)) out.invoices = out.invoices.map(function (inv) {
      if (!inv || typeof inv !== 'object' || inv.issued || !(inv.status === '送付済み(未入金)' || inv.status === '入金済み')) return inv;
      return Object.assign({}, inv, { issued: { at: new Date().toISOString(), migrated: true, view: invoiceViewModel(inv, st) } });
    });
    v = 11;
  }
  out.schemaVersion = v;
  return out;
}
// 同梱画像の検証: ID の形式・base64 の形式・サイズ・JPEG/PNG であること。不正なものは取り込まない
function cleanReceipts(obj) {
  const out = Object.create(null); let dropped = 0;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { receipts: out, dropped: 0 };
  Object.keys(obj).slice(0, 10000).forEach(function (id) {
    const v = obj[id];
    if (!ID_RE.test(id) || BAD_KEYS.indexOf(id) >= 0 || typeof v !== 'string' || v.length > Math.ceil(MAX_RECEIPT_BYTES / 3) * 4 || v.length % 4 !== 0 || !B64_RE.test(v)) { dropped++; return; }
    let bytes; try { bytes = base64ToBytes(v); } catch (e) { dropped++; return; }
    if (!fileMime(bytes)) { dropped++; return; }
    out[id] = bytes;
  });
  return { receipts: out, dropped: dropped };
}
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const NUM_FIELDS = ['amount', 'cost', 'saleAmount', 'businessType', 'opening', 'usefulLifeYears', 'qty', 'unitPrice', 'taxRate', 'openingCash', 'openingBank', 'opening', 'closing', 'invoiceSeq'];
const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];
function importError(msg) { const e = new Error(msg); e.userMessage = msg; return e; }
function cleanValue(v, depth, key) {
  if (NUM_FIELDS.indexOf(key) >= 0) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') return v.slice(0, 5000);
  if (depth > 5) return undefined;
  if (Array.isArray(v)) return v.slice(0, 1000).map(function (x) { return cleanValue(x, depth + 1); }).filter(function (x) { return x !== undefined; });
  if (typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach(function (k) { if (BAD_KEYS.indexOf(k) >= 0 || k.length > 64) return; const c = cleanValue(v[k], depth + 1, k); if (c !== undefined) o[k] = c; });
    return o;
  }
  return undefined;
}
function cleanRecords(arr, check) {
  if (!Array.isArray(arr)) return undefined;
  return arr.slice(0, 100000).map(function (r) { return cleanValue(r, 0); })
    .filter(function (r) { return r && typeof r === 'object' && !Array.isArray(r) && typeof r.id === 'string' && ID_RE.test(r.id) && (!check || check(r)); });
}
function sanitizeBackup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw importError('青りんご帳簿のバックアップファイルではありません');
  // app の値は旧名(経理ノート)のときから 'keiri-note' のまま(変えると以前のバックアップを取り込めなくなる)
  if (raw.app !== undefined && raw.app !== 'keiri-note') throw importError('青りんご帳簿のバックアップファイルではありません');
  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > SCHEMA_VERSION) throw importError('新しい版で作られたバックアップです。アプリを更新してください');
  raw = migrateBackup(raw);
  const out = {};
  out.transactions = cleanRecords(raw.transactions, function (t) { return Object.prototype.hasOwnProperty.call(KIND_LABELS, t.kind); });
  // 画像 ID の形式が不正なら、取引は残して画像の参照だけ外す
  if (out.transactions) out.transactions.forEach(function (t) { if (t.linkedAssetId !== undefined && !(typeof t.linkedAssetId === 'string' && ID_RE.test(t.linkedAssetId))) delete t.linkedAssetId; });
  // 添付ファイルの一覧: ID の形式・形式名・ファイル名の長さを確かめ、不正なものは外す(取引・請求書は残す)
  const ATTACH_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'];
  function cleanAttachments(x) {
    if (x.receiptAssetId !== undefined) delete x.receiptAssetId; // v4 以前の項目(移行で attachments に移したあとの残り)
    if (x.attachments === undefined) return;
    if (!Array.isArray(x.attachments)) { delete x.attachments; return; }
    x.attachments = x.attachments.slice(0, 50).filter(function (a) { return a && typeof a === 'object' && typeof a.id === 'string' && ID_RE.test(a.id); }).map(function (a) {
      const o = { id: a.id };
      if (ATTACH_TYPES.indexOf(a.type) >= 0) o.type = a.type;
      if (typeof a.name === 'string') o.name = a.name.slice(0, 200);
      if (typeof a.addedAt === 'string') o.addedAt = a.addedAt.slice(0, 40);
      return o;
    });
  }
  (out.transactions || []).forEach(cleanAttachments); (out.invoices || []).forEach(cleanAttachments);
  const rc = cleanReceipts(raw.receipts);
  out.receipts = rc.receipts; out.droppedReceipts = rc.dropped;
  out.invoices = cleanRecords(raw.invoices);
  out.fixedAssets = cleanRecords(raw.fixedAssets);
  // このデータの口座の ID(移行後は必ず1つ以上ある)
  const knownBankIds = (Array.isArray(raw.bankAccounts) && raw.bankAccounts.length ? raw.bankAccounts : defaultBankAccounts())
    .map(function (b) { return b && b.id; }).filter(function (id) { return typeof id === 'string' && ID_RE.test(id); });
  if (out.fixedAssets) out.fixedAssets.forEach(function (a) {
    if (a.disposalType !== undefined && a.disposalType !== 'retire' && a.disposalType !== 'sale') delete a.disposalType;
    if (a.disposalDate && !a.disposalType) a.disposalType = 'retire';
    // 資金は現金か、このデータにある口座の ID だけ(支払い方法は未払金も)
    if (a.saleFund !== undefined && !(a.saleFund === 'cash' || knownBankIds.indexOf(a.saleFund) >= 0)) delete a.saleFund;
    if (a.payFund !== undefined && !(a.payFund === 'cash' || a.payFund === 'accrued' || knownBankIds.indexOf(a.payFund) >= 0)) delete a.payFund;
  });
  out.partners = cleanRecords(raw.partners, function (p) { return typeof p.name === 'string' && normName(p.name); });
  if (out.partners) {
    const seen = new Set();
    out.partners = out.partners.map(function (p) { const o = { id: p.id, name: normName(p.name).slice(0, 100) }; if (typeof p.address === 'string' && p.address) o.address = p.address.slice(0, 200); if (typeof p.postalCode === 'string' && p.postalCode) o.postalCode = p.postalCode.slice(0, 10); return o; })
      .filter(function (p) { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  }
  out.bankAccounts = cleanRecords(raw.bankAccounts, function (a) { return typeof a.name === 'string' && normName(a.name); });
  if (out.bankAccounts) {
    const seenB = new Set();
    out.bankAccounts = out.bankAccounts.map(function (a) { return { id: a.id, name: normName(a.name).slice(0, 60), opening: Number(a.opening) || 0 }; })
      .filter(function (a) { if (seenB.has(a.id)) return false; seenB.add(a.id); return true; });
    if (!out.bankAccounts.length) delete out.bankAccounts;
  }
  [out.transactions, out.invoices].forEach(function (list) { (list || []).forEach(function (x) { if (x.partnerId !== undefined && !(typeof x.partnerId === 'string' && ID_RE.test(x.partnerId))) delete x.partnerId; }); });
  (out.invoices || []).forEach(function (inv) { if (inv.status !== undefined && INVOICE_STATUSES.indexOf(inv.status) < 0) inv.status = '下書き'; });
  if (raw.taxInterim && typeof raw.taxInterim === 'object' && !Array.isArray(raw.taxInterim)) {
    out.taxInterim = {};
    Object.keys(raw.taxInterim).forEach(function (y) { if (/^\d{4}$/.test(y)) { const v = raw.taxInterim[y]; if (v && typeof v === 'object') out.taxInterim[y] = { national: Math.max(0, Number(v.national) || 0), local: Math.max(0, Number(v.local) || 0) }; } });
  }
  if (out.transactions) out.transactions.forEach(function (t) {
    if (t.taxCategory !== undefined && !Object.prototype.hasOwnProperty.call(TAX_CATEGORIES, t.taxCategory)) delete t.taxCategory;
    if (t.businessType !== undefined && !BUSINESS_TYPES[t.businessType]) delete t.businessType;
  });
  if (out.invoices) out.invoices.forEach(function (inv) {
    if (Array.isArray(inv.items)) inv.items.forEach(function (it) { if (it && typeof it === 'object' && [10, 8, 0].indexOf(Number(it.taxRate)) < 0) it.taxRate = 10; });
    if (inv.transactionDate !== undefined) inv.transactionDate = String(inv.transactionDate).slice(0, 40);
    if (inv.honorific !== undefined && HONORIFICS.indexOf(inv.honorific) < 0) inv.honorific = '御中';
    if (inv.revisionOf !== undefined) inv.revisionOf = String(inv.revisionOf).slice(0, 40);
    if (inv.issued !== undefined) {
      const rawInv = raw.invoices.find(function (x) { return x && x.id === inv.id; });
      const view = rawInv && rawInv.issued && typeof rawInv.issued === 'object' ? cleanIssuedView(rawInv.issued.view) : null;
      if (view) inv.issued = { at: typeof inv.issued.at === 'string' ? inv.issued.at.slice(0, 40) : '', view: view, migrated: inv.issued.migrated === true ? true : undefined };
      else delete inv.issued;
      if (inv.issued && inv.issued.migrated === undefined) delete inv.issued.migrated;
    }
    if (inv.clientPostalCode !== undefined) inv.clientPostalCode = String(inv.clientPostalCode).slice(0, 10);
    if (inv.taxRounding !== undefined && !Object.prototype.hasOwnProperty.call(DEPRECIATION_ROUNDING, inv.taxRounding)) inv.taxRounding = 'round';
  });
  if (raw.inventoryYearEnd && typeof raw.inventoryYearEnd === 'object') {
    out.inventoryYearEnd = {};
    Object.keys(raw.inventoryYearEnd).forEach(function (y) { if (/^\d{4}$/.test(y)) { const v = raw.inventoryYearEnd[y]; if (v && typeof v === 'object') out.inventoryYearEnd[y] = { opening: Number(v.opening) || 0, closing: Number(v.closing) || 0 }; } });
  }
  if (raw.settings && typeof raw.settings === 'object') {
    const def = defaultSettings(); out.settings = {};
    Object.keys(def).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(raw.settings, k)) return;
      const v = raw.settings[k];
      if (k === 'mainBusinessType') { const n = Number(v); if (n === 0 || BUSINESS_TYPES[n]) out.settings[k] = n; }
      else if (typeof def[k] === 'number') { const n = Number(v); if (Number.isFinite(n)) out.settings[k] = n; }
      else if (k === 'depreciationRounding' || k === 'invoiceTaxRounding') { if (Object.prototype.hasOwnProperty.call(DEPRECIATION_ROUNDING, v)) out.settings[k] = v; }
      else if (k === 'taxMethod') { if (Object.prototype.hasOwnProperty.call(TAX_METHODS, v)) out.settings[k] = v; }
      else if (k === 'taxReview') { if (v === '' || v === 'pending') out.settings[k] = v; }
      else if (k === 'bankAccountType') { if (v === '' || v === '普通' || v === '当座') out.settings[k] = v; }
      else if (typeof v === 'string') out.settings[k] = v.slice(0, 2000);
    });
  }
  return out;
}

function onImportBackup(e) {
  const file = e.target.files[0]; if (!file) return;
  if (file.size > 300 * 1024 * 1024) { toast('ファイルが大きすぎます(300MBまで)'); return; }
  const reader = new FileReader();
  reader.onload = async function () {
    try {
      const raw = JSON.parse(reader.result);
      const data = sanitizeBackup(raw);
      const rawLen = function (a) { return Array.isArray(a) ? a.length : 0; };
      const len = function (a) { return Array.isArray(a) ? a.length : 0; };
      const sum = function (a) { return (a || []).reduce(function (t, x) { return t + (Number(x.amount) || 0); }, 0); };
      const dropped = (rawLen(raw.transactions) - len(data.transactions)) + (rawLen(raw.invoices) - len(data.invoices)) + (rawLen(raw.fixedAssets) - len(data.fixedAssets));
      const msg = 'ファイルの内容: 取引 ' + len(data.transactions) + ' 件(金額合計 ' + yen(sum(data.transactions)) + ')・請求書 ' + len(data.invoices) + ' 件・固定資産 ' + len(data.fixedAssets) + ' 件・添付ファイル ' + Object.keys(data.receipts).length + ' 件' +
        (dropped > 0 ? '。形式が正しくない ' + dropped + ' 件は取り込みません' : '') +
        (data.droppedReceipts > 0 ? '。不正な添付ファイル ' + data.droppedReceipts + ' 件は取り込みません' : '') +
        (assetsWithInvalidLife(data.fixedAssets).length ? '。耐用年数が範囲外の固定資産 ' + assetsWithInvalidLife(data.fixedAssets).length + ' 件は、取り込み後に修正してください' : '') + '。現在のデータと統合します(同じ ID のものは取り込みません)。現在のデータは取り込み前に退避されます。よろしいですか?';
      if (!(await confirmDialog(msg, '取り込む'))) return;
      await saveChain; // 保存待ちの変更を書き終えてから退避する
      await invoke('backup_before_import');
      // 新しく追加する取引・請求書の添付ファイルだけを保存し、Rust 側で振られた新しい ID に付け替える
      // (同じバックアップを再度取り込んでも、取引・請求書が重複スキップされるのでファイルも増えない)
      let savedReceipts = 0; const newIdOf = {};
      for (const key of ['transactions', 'invoices']) {
        const curIds = new Set(state[key].map(function (x) { return x.id; }));
        for (const x of (data[key] || [])) {
          if (curIds.has(x.id) || !x.attachments) continue;
          const kept = [];
          for (const att of x.attachments) {
            if (!data.receipts[att.id]) { kept.push(att); continue; } // ファイルが同梱されていない添付は ID のまま(画面では「見つかりません」)
            if (!newIdOf[att.id]) { try { newIdOf[att.id] = await saveReceiptBytes(data.receipts[att.id]); savedReceipts++; } catch (e) { kept.push(att); continue; } }
            kept.push(Object.assign({}, att, { id: newIdOf[att.id], type: att.type || fileMime(data.receipts[att.id]) || undefined }));
          }
          x.attachments = kept;
        }
      }
      // 既存と同じ ID のものは取り込まない(統合)
      const added = { transactions: [], invoices: [], fixedAssets: [], partners: [], bankAccounts: [] };
      function mergeById(key) { const cur = state[key], add = data[key]; if (!Array.isArray(add)) return cur; const ids = new Set(cur.map(function (x) { return x.id; })); added[key] = add.filter(function (x) { return !ids.has(x.id); }); return cur.concat(added[key]); }
      await Store.replaceAll({
        transactions: mergeById('transactions'),
        invoices: mergeById('invoices'),
        fixedAssets: mergeById('fixedAssets'),
        inventoryYearEnd: Object.assign({}, state.inventoryYearEnd, data.inventoryYearEnd || {}),
        taxInterim: Object.assign({}, state.taxInterim, data.taxInterim || {}),
        partners: mergeById('partners'),
        bankAccounts: mergeById('bankAccounts'),
        settings: Object.assign({}, state.settings, data.settings || {})
      }, 'import');
      renderShell();
      const skipped = len(data.transactions) - added.transactions.length;
      openModal('取り込み結果', '<p style="line-height:1.8;">取引 ' + added.transactions.length + ' 件(金額合計 ' + yen(sum(added.transactions)) + ')<br>請求書 ' + added.invoices.length + ' 件<br>固定資産 ' + added.fixedAssets.length + ' 件' + (assetsWithInvalidLife(added.fixedAssets).length ? '(うち耐用年数が範囲外 ' + assetsWithInvalidLife(added.fixedAssets).length + ' 件。資産・負債タブで修正してください)' : '') + '<br>添付ファイル ' + savedReceipts + ' 件<br>を取り込みました。' +
        (skipped > 0 ? '<br>取引 ' + skipped + ' 件はすでにあるため取り込んでいません。' : '') + '</p>' +
        '<p class="muted" style="margin-top:10px;">取り込み後の取引は合計 ' + state.transactions.length + ' 件(金額合計 ' + yen(sum(state.transactions)) + ')です。</p>');
    } catch (err) { toast(err && err.userMessage ? err.userMessage : '取り込みに失敗しました。ファイルを確認してください'); }
  };
  reader.readAsText(file);
}
/* ============================== 変更履歴の表示 ============================== */
const HISTORY_ACTIONS = { add: '追加', update: '修正', delete: '削除', merge: '統合', import: '取り込み', restore: '復元', wipe: '全削除' };
const HISTORY_TARGETS = { transaction: '取引', invoice: '請求書', fixedAsset: '固定資産', inventory: '棚卸高', taxInterim: '中間納付', partner: '取引先', bankAccount: '口座', settings: '設定', all: '全データ' };
// 変更履歴の項目: [キー, 表示名, 値の表示のしかた]。並びは画面の入力欄の順(修正の差分もこの順で並べる)。
// データの項目を増やしたら、ここにも追加する(tests/check_history_labels.js が漏れを検出する)
const HISTORY_FIELDS = [
  // 取引
  ['kind', '区分', 'kind'], ['date', '日付', 'date'], ['amount', '金額', 'yen'], ['account', '勘定科目', 'account'], ['accountType', '科目の区分', 'accountType'],
  ['fund', '資金', 'fund'], ['liability', '負債の科目', 'liability'], ['partnerId', '取引先', 'partner'], ['memo', 'メモ', 'text'],
  ['taxCategory', '消費税の税区分', 'taxCategory'], ['businessType', '事業区分', 'businessType'], ['attachments', '添付ファイル', 'attachments'],
  ['receiptAssetId', 'レシート画像', 'receipt'], ['linkedAssetId', '連動する固定資産', 'linkedAsset'],
  // 請求書
  ['number', '請求書番号', 'text'], ['issueDate', '発行日', 'date'], ['transactionDate', '取引年月日', 'text'], ['dueDate', '支払期限', 'date'],
  ['clientName', '宛先', 'text'], ['honorific', '敬称', 'text'], ['clientPostalCode', '宛先の郵便番号', 'text'], ['clientAddress', '宛先住所', 'text'], ['status', '状態', 'text'], ['items', '明細', 'items'],
  ['taxRate', '税率', 'rate'], ['taxRounding', '消費税の端数処理', 'rounding'], ['notes', '備考', 'text'],
  ['revisionOf', '修正元の請求書番号', 'text'], ['issued', '送付したときの内容', 'issued'],
  // 固定資産
  ['name', '名称', 'text'], ['acquisitionDate', '取得日', 'date'], ['cost', '取得価額', 'yen'], ['payFund', '支払い方法', 'payFund'],
  ['usefulLifeYears', '耐用年数', 'years'], ['disposalDate', '除却・売却日', 'date'], ['disposalType', '処分の種類', 'disposalType'],
  ['saleAmount', '売却代金', 'yen'], ['saleFund', '受け取り先', 'fund'],
  // 棚卸高・中間納付・取引先
  ['opening', '期首棚卸高', 'yen'], ['closing', '期末棚卸高', 'yen'], ['national', '中間納付(国税)', 'yen'], ['local', '中間納付(地方)', 'yen'], ['address', '住所', 'text'],
  // 設定
  ['businessName', '屋号', 'text'], ['ownerName', '氏名', 'text'], ['postalCode', '郵便番号', 'text'], ['phone', '電話番号', 'text'], ['fax', 'FAX', 'text'], ['invoiceRegNo', '登録番号', 'text'],
  ['bankName', '振込先の銀行名', 'text'], ['bankBranch', '振込先の支店名', 'text'], ['bankAccountType', '振込先の種別', 'text'], ['bankAccountNumber', '振込先の口座番号', 'text'], ['bankAccountHolder', '振込先の口座名義', 'text'], ['bankInfo', '振込先(以前の文章)', 'text'],
  ['openingDate', '開始日', 'date'], ['openingCash', '開始時の現金', 'yen'], ['openingBank', '開始時の預金', 'yen'], ['invoiceSeq', '請求書の連番', 'int'],
  ['theme', '表示テーマ', 'theme'], ['taxMethod', '消費税の課税方式', 'taxMethod'], ['mainBusinessType', '主たる事業区分', 'businessType'],
  ['invoiceTaxRounding', '請求書の消費税の端数処理', 'rounding'], ['depreciationRounding', '減価償却の端数処理', 'rounding'], ['taxReview', '税区分の見直し', 'taxReview'],
  // 表示しない項目(内部の ID・記録日時)
  ['id', '', 'hidden'], ['createdAt', '', 'hidden'], ['addedAt', '', 'hidden']
];
const HISTORY_FIELD_INDEX = {}; HISTORY_FIELDS.forEach(function (f, i) { HISTORY_FIELD_INDEX[f[0]] = i; });
const HISTORY_FIELD_LABELS = {}; HISTORY_FIELDS.forEach(function (f) { HISTORY_FIELD_LABELS[f[0]] = f[1]; });
// 対象によって意味が違う項目の表示名(同じキーでも、口座の opening は「開始残高」)
const HISTORY_TARGET_LABELS = { bankAccount: { opening: '開始残高', name: '口座の名前' }, partner: { name: '取引先の名前' } };
function historyLabel(target, k) { const t = HISTORY_TARGET_LABELS[target]; return (t && t[k]) || HISTORY_FIELD_LABELS[k] || 'その他の項目'; }
const THEME_LABELS = { auto: '自動', light: 'ライト', dark: 'ダーク' };
function historyDate(v) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v)); return m ? m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日' : String(v); }
function anyAccountLabel(key, type) {
  if (type && ACCOUNTS[type]) { const f = ACCOUNTS[type].find(function (a) { return a.key === key; }); if (f) return f.label; }
  const all = [].concat(ACCOUNTS.income, ACCOUNTS.expense, ACCOUNTS.cogs || []); const f = all.find(function (a) { return a.key === key; });
  return f ? f.label : '(不明な科目)';
}
function attachmentKindLabel(a) { return a && a.type === 'application/pdf' ? 'PDF' : (a && a.type ? '画像' : 'ファイル'); }
// 値を画面の表示名にする。内部のキー・ID・JSON は出さない
function historyValue(k, v, rec) {
  const f = HISTORY_FIELDS[HISTORY_FIELD_INDEX[k]]; const how = f ? f[2] : 'other';
  if (how === 'hidden') return '';
  if (v === undefined || v === null || v === '') return how === 'taxReview' ? '確認済み' : '(なし)';
  const pick = function (map) { return Object.prototype.hasOwnProperty.call(map, v) ? map[v] : '(不明な値)'; };
  switch (how) {
    case 'yen': return yen(v);
    case 'date': return historyDate(v);
    case 'int': return String(Number(v) || 0);
    case 'years': return (Number(v) || 0) + '年';
    case 'text': return String(v);
    case 'kind': return pick(KIND_LABELS);
    case 'account': return anyAccountLabel(v, rec && rec.accountType);
    case 'accountType': return pick({ expense: '経費', cogs: '仕入', income: '収入' });
    case 'fund': return fundLabel(v);
    case 'payFund': return v === 'accrued' ? '未払金' : fundLabel(v);
    case 'liability': return pick({ payable: '買掛金', accrued: '未払金', loan: '借入金' });
    case 'partner': return partnerName(v) || '(削除された取引先)';
    case 'taxCategory': return pick(TAX_CATEGORIES);
    case 'businessType': return Number(v) === 0 ? '未設定' : (BUSINESS_TYPES[v] ? BUSINESS_TYPES[v].label + '・' + BUSINESS_TYPES[v].rate + '%' : '(不明な値)');
    case 'taxMethod': return pick(TAX_METHODS);
    case 'rounding': return pick(DEPRECIATION_ROUNDING);
    case 'disposalType': return pick({ retire: '除却(廃棄)', sale: '売却' });
    case 'theme': return pick(THEME_LABELS);
    case 'taxReview': return v === 'pending' ? '見直しが必要' : '確認済み';
    case 'rate': return rateLabel(Number(v));
    case 'receipt': return '画像あり';
    case 'issued': return v && v.view ? '固定済み(' + historyDate(v.at || '') + (v.migrated ? '・移行時の内容' : '') + ')' : '(なし)';
    case 'linkedAsset': { const a = findById(state.fixedAssets || [], v); return a ? a.name : '(削除された固定資産)'; }
    case 'items': return Array.isArray(v) && v.length ? v.map(function (it) { return (it.name || '(内容なし)') + ' ' + (Number(it.qty) || 0) + ' × ' + yen(it.unitPrice) + '(' + rateLabel(itemRate({}, it)) + ')'; }).join(' / ') : '(なし)';
    case 'attachments': return Array.isArray(v) && v.length ? v.map(function (a) { return (a.name || '名前なし') + '(' + attachmentKindLabel(a) + ')'; }).join('、') : '(なし)';
  }
  // 未知の項目: 真偽値・数値・短い文字はそのまま、内部の ID らしいものや入れ子は出さない
  if (typeof v === 'boolean') return v ? 'はい' : 'いいえ';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string' && !/^[a-z]{1,4}_[A-Za-z0-9_]+$/.test(v)) return v.slice(0, 100);
  return '(内部の値)';
}
// 添付ファイルの差分は「追加した/外した」で表す
function attachmentDiff(before, after) {
  const ids = function (l) { return (l || []).map(function (a) { return a.id; }); };
  const b = ids(before), a = ids(after); const out = [];
  (after || []).forEach(function (x) { if (b.indexOf(x.id) < 0) out.push('「' + (x.name || '名前なし') + '」(' + attachmentKindLabel(x) + ')を追加'); });
  (before || []).forEach(function (x) { if (a.indexOf(x.id) < 0) out.push('「' + (x.name || '名前なし') + '」(' + attachmentKindLabel(x) + ')を外した'); });
  return out.join('、') || '(並びの変更)';
}
function historySummary(e) {
  const d = e.after || e.before || {};
  if (e.target === 'transaction') return historyDate(d.date || '') + ' ' + (KIND_LABELS[d.kind] || '') + ' ' + yen(d.amount) + (d.partnerId ? ' ' + (partnerName(d.partnerId) || '') : '') + (d.memo ? ' ' + d.memo : '');
  if (e.target === 'invoice') return (d.number ? 'No.' + d.number : '') + ' ' + (d.clientName || '');
  if (e.target === 'bankAccount') return d.name || '';
  if (e.target === 'partner') return (d.name || '') + (e.moved !== undefined ? '(取引・請求書 ' + e.moved + ' 件を付け替え)' : '');
  if (e.target === 'fixedAsset') return (d.name || '') + ' ' + yen(d.cost);
  if (e.target === 'inventory' || e.target === 'taxInterim') return (e.year || '') + '年';
  if (e.target === 'all') {
    const c = function (x) { return x ? '取引' + x.transactions + '件・請求書' + x.invoices + '件・固定資産' + x.fixedAssets + '件' : ''; };
    return c(e.before) + ' → ' + c(e.after) + (e.backup ? '(' + backupLabel(e.backup) + ')' : '');
  }
  return '';
}
// 修正のとき、変わった項目だけを「前 → 後」で、画面の入力欄の順に並べる
function historyDiffLines(e) {
  if (e.action !== 'update' || !e.before || !e.after || e.target === 'all') return [];
  const keys = Object.keys(Object.assign({}, e.before, e.after)).filter(function (k) {
    const f = HISTORY_FIELDS[HISTORY_FIELD_INDEX[k]];
    return !(f && f[2] === 'hidden') && JSON.stringify(e.before[k]) !== JSON.stringify(e.after[k]);
  }).sort(function (x, y) { return (HISTORY_FIELD_INDEX[x] === undefined ? 999 : HISTORY_FIELD_INDEX[x]) - (HISTORY_FIELD_INDEX[y] === undefined ? 999 : HISTORY_FIELD_INDEX[y]); });
  return keys.map(function (k) {
    const label = historyLabel(e.target, k);
    if (k === 'attachments') return label + ': ' + attachmentDiff(e.before[k], e.after[k]);
    return label + ': ' + historyValue(k, e.before[k], e.before) + ' → ' + historyValue(k, e.after[k], e.after);
  });
}
function historyDiff(e) {
  if (e.action !== 'update' || !e.before || !e.after || e.target === 'all') return '';
  const lines = historyDiffLines(e);
  if (!lines.length) return '<div class="muted" style="font-size:12px;">変更なし</div>';
  return lines.map(function (l) { return '<div style="font-size:12px;">' + esc(l) + '</div>'; }).join('');
}
async function openHistoryModal() {
  let lines;
  try { lines = await invoke('read_history', { limit: 1000 }); } catch (e) { toast('変更履歴を読み込めませんでした'); return; }
  const parsed = lines.map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  // 完了・取り消しの印(ref)を集め、完了した変更(と印の仕組みより前の記録)だけを表示する
  const statusOf = {}; parsed.forEach(function (e) { if (e.ref) statusOf[e.ref] = e.status; });
  const rows = parsed.filter(function (e) { return !e.ref && (e.status !== 'pending' || statusOf[e.hid] === 'done'); }).slice(0, 300).map(function (e) {
    const at = typeof e.at === 'string' ? e.at.slice(0, 19).replace('T', ' ') : '';
    return '<div class="tx-row" style="display:block;">' +
      '<div style="font-size:12px;" class="muted">' + esc(at) + '</div>' +
      '<div><strong>' + esc((HISTORY_TARGETS[e.target] || e.target || '') + 'の' + (HISTORY_ACTIONS[e.action] || e.action || '')) + '</strong> ' + esc(historySummary(e)) + '</div>' +
      historyDiff(e) + '</div>';
  }).join('');
  openModal('変更履歴(新しい順・最大300件)', rows || '<p class="muted">まだ変更履歴がありません。</p>');
}

/* ============================== 自動バックアップからの復元 ============================== */
function backupLabel(name) {
  const m = /^data-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(-pre-restore|-pre-import|-pre-wipe|-pre-migrate)?\.json$/.exec(name);
  if (!m) return name;
  const tag = m[7] === '-pre-restore' ? '(復元前の退避)' : m[7] === '-pre-import' ? '(取り込み前の退避)' : m[7] === '-pre-wipe' ? '(削除前の退避)' : m[7] === '-pre-migrate' ? '(形式の移行前の退避)' : '';
  return m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日 ' + m[4] + ':' + m[5] + ':' + m[6] + tag;
}
async function openRestoreModal() {
  let names;
  try { names = await invoke('list_backups'); } catch (e) { toast('バックアップ一覧を読み込めませんでした'); return; }
  const rows = names.length ? names.map(function (n) {
    return '<div class="tx-row" style="align-items:center;"><div style="flex:1;">' + esc(backupLabel(n)) + '</div>' +
      '<button class="btn ghost small" data-restore="' + esc(n) + '">この時点に戻す</button></div>';
  }).join('') : '<p class="muted">まだバックアップがありません。</p>';
  openModal('自動バックアップから復元', '<div class="note" style="margin-bottom:12px;">選んだ時点のデータに置き換えます。現在のデータは「復元前の退避」として自動で保存されます。</div>' + rows);
  document.querySelectorAll('[data-restore]').forEach(function (b) { b.addEventListener('click', function () { restoreFromBackup(b.dataset.restore); }); });
}
async function restoreFromBackup(name) {
  let data;
  try { data = sanitizeBackup(JSON.parse(await invoke('read_backup', { name: name }))); }
  catch (e) { toast('このバックアップは読み込めません'); return; }
  const count = function (a) { return Array.isArray(a) ? a.length : 0; };
  const msg = backupLabel(name) + ' の状態に戻します(取引 ' + count(data.transactions) + ' 件・請求書 ' + count(data.invoices) + ' 件・固定資産 ' + count(data.fixedAssets) + ' 件)' + (/-pre-wipe\.json$/.test(name) ? '。削除前の変更履歴も戻します' : '') + '。現在のデータは退避されます。よろしいですか?';
  if (!(await confirmDialog(msg, '復元する'))) return;
  const before = { transactions: state.transactions.length, invoices: state.invoices.length, fixedAssets: state.fixedAssets.length };
  let hid = null;
  try {
    await saveChain; // 保存待ちの変更を書き終えてから退避・復元する
    hid = await logBegin('restore', 'all', before, { transactions: count(data.transactions), invoices: count(data.invoices), fixedAssets: count(data.fixedAssets) }, { backup: name });
    await invoke('restore_backup', { name: name });
  } catch (e) { logEnd(hid, false); toast('復元に失敗しました'); return; }
  logEnd(hid, true);
  await Store.loadAll();
  toast('復元しました'); renderShell();
}
async function onWipeAll() {
  if (!(await confirmDialog('本当にすべてのデータを削除しますか?取引・請求書・資産・設定と変更履歴が削除されます。削除の直前に「削除前の退避」を自動で作るので、「自動バックアップから復元する」から元に戻せます。', '次へ'))) return;
  if (!(await confirmDialog('もう一度確認します。すべて削除してよろしいですか?なお、自動バックアップ・削除前の退避・レシート画像はこの Mac 内に残ります(レシートには住所やカード番号の一部などが写っていることがあります)。完全に消す場合は、保存フォルダ(~/Library/Application Support/com.keirinote.desktop/)ごと削除してください。', 'すべて削除する'))) return;
  try {
    await saveChain; // 保存待ちの変更を書き終えてから退避する
    await invoke('wipe_all'); // 変更履歴も含めて退避し、変更履歴を消す
  } catch (e) { toast('削除前の退避に失敗したため、削除を中止しました'); return; }
  state.transactions = []; state.invoices = []; state.settings = defaultSettings(); state.fixedAssets = []; state.inventoryYearEnd = {}; state.taxInterim = {}; state.partners = []; state.bankAccounts = defaultBankAccounts();
  await persistOrWarn(); // 変更履歴は消したので、この削除自体は記録しない
  toast('削除しました'); renderShell();
}

/* ============================== 初期化 ============================== */
let APP_READY = false; // 起動時の読み込みと履歴の後始末が終わったら true(開発ビルドの自己テストが待つ)
async function init() {
  await Store.loadAll();
  await recoverPendingHistory();
  renderShell();
  APP_READY = true;
}
document.addEventListener('DOMContentLoaded', init);
