// 請求書の印刷用 HTML(A4・明朝体)のテスト。名前・金額はすべて架空。
// 実行: osascript -l JavaScript tests/check_invoice_print.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }
var document = { addEventListener: function () {} }; var window = {};
var localStorage = { getItem: function () { return null; }, setItem: function () {} };
var app = (new Function('document', 'window', 'localStorage', read('src/app.js') +
  '\nreturn { state: state, defaultSettings: defaultSettings, invoiceViewModel: invoiceViewModel, invoicePrintHtml: invoicePrintHtml, sanitizeBackup: sanitizeBackup, SCHEMA_VERSION: SCHEMA_VERSION, isIssuedInvoice: isIssuedInvoice, invoiceTotals: invoiceTotals };'))(document, window, localStorage);
var results = [];
function check(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push((ok ? 'OK  ' : 'NG  ') + name + (ok ? '' : '  実際=' + JSON.stringify(actual) + ' 期待=' + JSON.stringify(expected)));
}
function settings(extra) { app.state.settings = Object.assign(app.defaultSettings(), { businessName: '架空デザイン事務所', ownerName: '見本 太郎', postalCode: '100-0001', address: '東京都千代田区架空町1-2-3', phone: '03-0000-0000', fax: '03-0000-0001', invoiceRegNo: 'T0000000000000' }, extra || {}); }
var inv = { number: '2026-0001', issueDate: '2026-09-30', transactionDate: '2026年9月分', dueDate: '2026-10-31', clientName: '株式会社サンプル', honorific: '御中', clientPostalCode: '200-0002', clientAddress: '神奈川県架空市見本1-1',
  taxRounding: 'floor', notes: 'いつもありがとうございます。', items: [{ name: 'ロゴ制作', qty: 1, unitPrice: 50000, taxRate: 10 }, { name: '打ち合わせ菓子', qty: 2, unitPrice: 1234, taxRate: 8 }] };

settings({ bankName: '架空銀行', bankBranch: '見本支店', bankAccountType: '普通', bankAccountNumber: '1234567', bankAccountHolder: 'ミホン タロウ' });
var html = app.invoicePrintHtml(app.invoiceViewModel(inv));
check('タイトル・宛先と敬称・郵便番号', [/御請求書/.test(html), /株式会社サンプル 御中/.test(html), /〒200-0002/.test(html), /〒100-0001/.test(html)], [true, true, true, true]);
check('右上の表: 請求書番号・発行日・取引年月日・お支払い期限', ['2026-0001', '2026年9月30日', '2026年9月分', '2026年10月31日'].map(function (x) { return html.indexOf(x) >= 0; }), [true, true, true, true]);
check('自社: 名前・TEL・FAX・登録番号', ['架空デザイン事務所', 'TEL: 03-0000-0000', 'FAX: 03-0000-0001', '登録番号: T0000000000000'].map(function (x) { return html.indexOf(x) >= 0; }), [true, true, true, true]);
// 10%: 50,000 → 消費税 5,000 / 8%: 2,468 → 197.44 → 切り捨て 197 / 合計 52,468 + 5,197 = 57,665
check('金額: 御請求金額・小計・税率ごと(切り捨て)', ['¥ 57,665', '>52,468<', '>50,000<', '>2,468<', '>5,197<', '>5,000<', '>197<'].map(function (x) { return html.indexOf(x) >= 0; }), [true, true, true, true, true, true, true]);
check('8% の明細に※と注記', [/打ち合わせ菓子 ※/.test(html), /※は軽減税率\(8%\)対象/.test(html)], [true, true]);
check('明細は最低9行(2行 + 空行7行)', (html.match(/<tr><td style="[^"]*border-left:1px solid #333;border-bottom:1px solid #333;"/g) || []).length, 9);
check('振込先は分けて入力した内容', ['架空銀行 見本支店', '普通 1234567', '口座名義: ミホン タロウ'].map(function (x) { return html.indexOf(x) >= 0; }), [true, true, true]);
check('控えの印は指定したときだけ', [/>控</.test(html), />控</.test(app.invoicePrintHtml(app.invoiceViewModel(inv), { copy: true }))], [false, true]);

var only10 = Object.assign({}, inv, { items: [{ name: 'ロゴ制作', qty: 1, unitPrice: 50000, taxRate: 10 }] });
var h10 = app.invoicePrintHtml(app.invoiceViewModel(only10));
check('8% がない請求書は※の注記なし(8%対象・消費税(8%)は 0)', [/※は軽減税率/.test(h10), /8%対象<\/th><td[^>]*>0</.test(h10)], [false, true]);

settings({ bankInfo: '架空銀行 見本支店\n普通 7654321 ミホン' });
check('振込先を分けて入力していないときは、以前の文章を印刷', /架空銀行 見本支店\n普通 7654321 ミホン/.test(app.invoicePrintHtml(app.invoiceViewModel(inv))), true);
settings();
check('名前に HTML を入れても解釈されない', /<img/.test(app.invoicePrintHtml(app.invoiceViewModel(Object.assign({}, inv, { clientName: '<img src=x onerror=alert(1)>' })))), false);

var m = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 9, invoices: [{ id: 'iv_1', number: '1', items: [] }, { id: 'iv_2', number: '2', items: [], honorific: '御中' }],
  partners: [{ id: 'pt_1', name: 'A', postalCode: '123-4567890123' }], settings: { bankAccountType: '貯金' } });
check('移行 v9→v10: 以前の請求書の敬称は「様」(新しい請求書の初期値は「御中」)', m.invoices.map(function (i) { return i.honorific; }), ['様', '御中']);
check('取り込み: 郵便番号は 10 文字まで、振込先の種別は 普通・当座 だけ', [m.partners[0].postalCode, m.settings.bankAccountType], ['123-456789', undefined]);


/* 送付済みの請求書の固定(schemaVersion 11) */
settings({ bankName: '架空銀行', bankBranch: '見本支店', bankAccountType: '普通', bankAccountNumber: '1234567', bankAccountHolder: 'ミホン タロウ' });
var mg = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 10, settings: app.state.settings, invoices: [
  Object.assign({ id: 'iv_sent', status: '送付済み(未入金)' }, inv), Object.assign({ id: 'iv_paid', status: '入金済み' }, inv), Object.assign({ id: 'iv_draft', status: '下書き' }, inv)] });
check('移行 v10→v11: 送付済み・入金済みは移行時の設定の内容で固定、下書きは固定しない', mg.invoices.map(function (i) { return [app.isIssuedInvoice(i), !!(i.issued && i.issued.migrated)]; }), [[true, true], [true, true], [false, false]]);
var sent = mg.invoices[0];
check('固定した内容: 宛先・自社・振込先・明細・端数処理', [sent.issued.view.client.name, sent.issued.view.issuer.regNo, sent.issued.view.bank.number, sent.issued.view.items.length, sent.issued.view.taxRounding], ['株式会社サンプル', 'T0000000000000', '1234567', 2, 'floor']);
// あとで設定・取引先・請求書の項目を変えても、送付済みの印刷は固定した内容のまま
settings({ businessName: '別の名前に変えた', invoiceRegNo: 'T9999999999999', bankName: '別の銀行', bankAccountNumber: '9876543' });
var changed = Object.assign({}, sent, { clientName: '変更後の宛先', items: [{ name: '別の明細', qty: 1, unitPrice: 1, taxRate: 10 }] });
var hs = app.invoicePrintHtml(app.invoiceViewModel(changed));
check('設定や項目を変えても、送付済みの印刷は送ったときの内容', [/架空デザイン事務所/.test(hs), /T0000000000000/.test(hs), /1234567/.test(hs), /株式会社サンプル/.test(hs), /別の名前に変えた|変更後の宛先|別の明細|9876543/.test(hs)], [true, true, true, true, false]);
check('送付済みの金額も送ったときのまま(¥ 57,665)', /¥ 57,665/.test(hs), true);
var badIssued = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 11, invoices: [{ id: 'iv_b1', number: '1', items: [], status: '送付済み(未入金)', issued: { at: 'x', view: { items: 'not array' } } },
  { id: 'iv_b2', number: '2', items: [], status: '送付済み(未入金)', issued: { at: '2026-10-05', view: { number: '2', client: { name: '<b>x</b>', honorific: '殿' }, issuer: {}, bank: { type: '定期' }, items: [{ name: 'a', qty: '2', unitPrice: '100', taxRate: 5 }], taxRounding: 'evil' } } }] });
check('取り込み: 形のおかしい固定内容は外す/値は検査して正規化', [app.isIssuedInvoice(badIssued.invoices[0]), badIssued.invoices[1].issued.view.client.honorific, badIssued.invoices[1].issued.view.bank.type, badIssued.invoices[1].issued.view.items[0].taxRate, badIssued.invoices[1].issued.view.items[0].qty, badIssued.invoices[1].issued.view.taxRounding], [false, '御中', '', 10, 2, 'round']);
var rev = app.invoicePrintHtml(app.invoiceViewModel(Object.assign({}, inv, { revisionOf: '2026-0001' }), app.state.settings));
check('修正版の印刷に「請求書番号 ○○ の修正」', /請求書番号 2026-0001 の修正/.test(rev), true);
check('SCHEMA_VERSION は 11', app.SCHEMA_VERSION, 11);

results.join('\n') + '\n\n' + results.filter(function (r) { return r.indexOf('NG') === 0; }).length + ' 件 NG / ' + results.length + ' 件';
